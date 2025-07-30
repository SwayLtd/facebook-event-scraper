// services/unified-import.js
// Unified import service that combines import_event.js and import_timetable.js logic

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { scrapeFbEvent } from 'facebook-event-scraper';

// Import existing modules
import { logMessage } from '../utils/logger.js';
import { detectFestival, extractFestivalName } from '../utils/festival-detection.js';
import { getClashfinderTimetable } from '../get_data/get_clashfinder_timetable.js';
import { extractEventsFromCsv } from '../extract_events_timetable.js';

// Import models and utilities
import artistModel from '../models/artist.js';
import { findEvent, updateEventMetadata, linkArtistsToEvent } from '../models/event.js';
import {
    groupPerformancesForB2B,
    extractStagesAndDaysFromPerformances,
    generateTimetableStatistics,
    logTimetableStatistics
} from '../models/timetable.js';

import { getAccessToken } from '../utils/token.js';
import { delay } from '../utils/delay.js';
import { toUtcIso } from '../utils/date.js';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_TIMEZONE = 'Europe/Brussels';

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Main unified import function
 * @param {string} facebookUrl - Facebook event URL
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import result
 */
export async function unifiedImport(facebookUrl, options = {}) {
    const {
        importType = 'auto', // 'simple', 'festival', 'auto'
        dryRun = false,
        timezone = DEFAULT_TIMEZONE,
        forceClashfinder = false
    } = options;

    const result = {
        success: false,
        importType: null,
        eventId: null,
        festivalDetection: null,
        clashfinderData: null,
        artistsImported: 0,
        error: null,
        processing: {
            scrapingTime: 0,
            detectionTime: 0,
            clashfinderTime: 0,
            importTime: 0,
            totalTime: 0
        }
    };

    const startTime = Date.now();

    try {
        logMessage(`🚀 Starting unified import for: ${facebookUrl}`);
        logMessage(`📋 Import type: ${importType}, Dry run: ${dryRun}`);

        // Step 1: Scrape Facebook event
        logMessage("🔎 Scraping Facebook event...");
        const scrapingStart = Date.now();
        const eventData = await scrapeFbEvent(facebookUrl);
        result.processing.scrapingTime = Date.now() - scrapingStart;
        
        logMessage(`✅ Scraped event: "${eventData.name}" (ID: ${eventData.id})`);

        // Step 2: Festival detection (unless explicitly specified)
        let shouldUseTimetable = importType === 'festival' || forceClashfinder;
        
        if (importType === 'auto') {
            logMessage("🤖 Running festival detection...");
            const detectionStart = Date.now();
            result.festivalDetection = detectFestival(eventData);
            result.processing.detectionTime = Date.now() - detectionStart;
            
            logMessage(`🎯 Festival detection result: ${result.festivalDetection.isFestival ? 'FESTIVAL' : 'SIMPLE'} (${result.festivalDetection.confidence}% confidence)`);
            logMessage(`📝 Reasons: ${result.festivalDetection.reasons.join(', ')}`);
            
            shouldUseTimetable = result.festivalDetection.isFestival;
        }

        // Step 3: Choose import path
        if (shouldUseTimetable) {
            result.importType = 'festival';
            logMessage("🎪 Using festival/timetable import path");
            const festivalResult = await importAsFestival(eventData, facebookUrl, { dryRun, timezone });
            Object.assign(result, festivalResult);
        } else {
            result.importType = 'simple';
            logMessage("🎵 Using simple event import path");
            const simpleResult = await importAsSimpleEvent(eventData, facebookUrl, { dryRun });
            Object.assign(result, simpleResult);
        }

        result.processing.totalTime = Date.now() - startTime;
        result.success = true;
        
        logMessage(`✅ Import completed successfully in ${result.processing.totalTime}ms`);
        logMessage(`📊 Summary: ${result.importType} event, ${result.artistsImported} artists imported`);

    } catch (error) {
        result.error = error.message;
        result.processing.totalTime = Date.now() - startTime;
        logMessage(`❌ Import failed: ${error.message}`);
        throw error;
    }

    return result;
}

/**
 * Import event as a festival with timetable
 * @param {Object} eventData - Facebook event data
 * @param {string} facebookUrl - Facebook event URL
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import result
 */
async function importAsFestival(eventData, facebookUrl, options = {}) {
    const { dryRun = false, timezone = DEFAULT_TIMEZONE } = options;
    const result = { eventId: null, artistsImported: 0, clashfinderData: null };

    try {
        // Step 1: Create/update the basic event first (using simplified import_event logic)
        logMessage("📝 Creating/updating base event...");
        const eventId = await createOrUpdateBaseEvent(eventData, facebookUrl, dryRun);
        result.eventId = eventId;

        // Step 2: Try to get Clashfinder data
        logMessage("🔍 Searching for event on Clashfinder...");
        const clashfinderStart = Date.now();
        
        const festivalName = extractFestivalName(eventData.name);
        logMessage(`🎯 Searching Clashfinder for: "${festivalName}"`);
        
        let clashfinderResult = null;
        try {
            clashfinderResult = await getClashfinderTimetable(festivalName, {
                saveFile: false,
                silent: true
            });
            result.clashfinderData = clashfinderResult;
            logMessage(`✅ Found on Clashfinder: ${clashfinderResult.festival.name}`);
        } catch (clashfinderError) {
            logMessage(`⚠️ Not found on Clashfinder: ${clashfinderError.message}`);
            // Continue with simple import if no Clashfinder data
        }

        result.processing.clashfinderTime = Date.now() - clashfinderStart;

        // Step 3: Import artists based on available data
        if (clashfinderResult) {
            // Use Clashfinder timetable data
            logMessage("🎪 Importing artists from Clashfinder timetable...");
            const timetableResult = await importFromTimetable(
                clashfinderResult, 
                eventId, 
                timezone, 
                dryRun
            );
            result.artistsImported = timetableResult.artistsImported;
        } else {
            // Fall back to description parsing
            logMessage("📝 Falling back to description parsing...");
            const descriptionResult = await importFromDescription(
                eventData, 
                eventId, 
                dryRun
            );
            result.artistsImported = descriptionResult.artistsImported;
        }

    } catch (error) {
        logMessage(`❌ Festival import failed: ${error.message}`);
        throw error;
    }

    return result;
}

/**
 * Import event as a simple event (original import_event.js logic)
 * @param {Object} eventData - Facebook event data
 * @param {string} facebookUrl - Facebook event URL
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import result
 */
async function importAsSimpleEvent(eventData, facebookUrl, options = {}) {
    const { dryRun = false } = options;
    const result = { eventId: null, artistsImported: 0 };

    try {
        // Create/update the event
        const eventId = await createOrUpdateBaseEvent(eventData, facebookUrl, dryRun);
        result.eventId = eventId;

        // Import artists from description
        const descriptionResult = await importFromDescription(eventData, eventId, dryRun);
        result.artistsImported = descriptionResult.artistsImported;

    } catch (error) {
        logMessage(`❌ Simple import failed: ${error.message}`);
        throw error;
    }

    return result;
}

/**
 * Create or update the base event (shared logic from import_event.js)
 * @param {Object} eventData - Facebook event data
 * @param {string} facebookUrl - Facebook event URL
 * @param {boolean} dryRun - Whether to perform actual database operations
 * @returns {Promise<number>} Event ID
 */
async function createOrUpdateBaseEvent(eventData, facebookUrl, dryRun = false) {
    // Extract basic event information
    const eventName = eventData.name || null;
    const eventDescription = eventData.description || null;
    const eventType = (eventData.categories && eventData.categories.length) 
        ? eventData.categories[0].label : null;
    const startTimeISO = eventData.startTimestamp 
        ? new Date(eventData.startTimestamp * 1000).toISOString() : null;
    const endTimeISO = eventData.endTimestamp 
        ? new Date(eventData.endTimestamp * 1000).toISOString() : null;

    if (dryRun) {
        logMessage(`[DRY_RUN] Would create/update event: "${eventName}"`);
        return 999; // Dummy ID for dry run
    }

    // Check if event already exists
    const existingEvent = await findEvent(supabase, { facebookUrl, title: eventName });
    
    if (existingEvent) {
        logMessage(`✅ Event already exists (ID: ${existingEvent.id}), checking for updates...`);
        
        // Check for updates needed
        const { data: current, error: fetchError } = await supabase
            .from('events')
            .select('description, date_time, end_date_time')
            .eq('id', existingEvent.id)
            .single();
        
        if (fetchError) throw fetchError;

        const updates = {};
        if (current.description !== eventDescription) {
            updates.description = eventDescription;
        }
        if (current.date_time !== startTimeISO) {
            updates.date_time = startTimeISO;
        }
        if (current.end_date_time !== endTimeISO) {
            updates.end_date_time = endTimeISO;
        }

        if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabase
                .from('events')
                .update(updates)
                .eq('id', existingEvent.id);
            
            if (updateError) throw updateError;
            logMessage(`🔄 Event updated with: ${JSON.stringify(updates)}`);
        }

        return existingEvent.id;
    }

    // Create new event
    logMessage(`📝 Creating new event: "${eventName}"`);
    
    const metadata = { facebook_url: facebookUrl };
    if (eventData.ticketUrl) {
        metadata.ticket_link = eventData.ticketUrl;
    }

    const eventRecord = {
        title: eventName,
        type: eventType,
        date_time: startTimeISO,
        end_date_time: endTimeISO,
        description: eventDescription,
        image_url: (eventData.photo && eventData.photo.imageUri) ? eventData.photo.imageUri : null,
        metadata: metadata
    };

    const { data: newEvent, error: insertError } = await supabase
        .from('events')
        .insert(eventRecord)
        .select()
        .single();

    if (insertError) throw insertError;
    
    logMessage(`✅ Event created successfully (ID: ${newEvent.id})`);
    return newEvent.id;
}

/**
 * Import artists from Clashfinder timetable data
 * @param {Object} clashfinderResult - Clashfinder API result
 * @param {number} eventId - Event ID
 * @param {string} timezone - Timezone for date conversion
 * @param {boolean} dryRun - Whether to perform actual database operations
 * @returns {Promise<Object>} Import result
 */
async function importFromTimetable(clashfinderResult, eventId, timezone, dryRun = false) {
    const result = { artistsImported: 0 };

    try {
        // Extract events from CSV data
        const tempCsvPath = path.join(process.cwd(), `temp_${Date.now()}.csv`);
        fs.writeFileSync(tempCsvPath, clashfinderResult.csv);
        
        const events = extractEventsFromCsv(tempCsvPath);
        fs.unlinkSync(tempCsvPath); // Clean up

        logMessage(`📊 Extracted ${events.length} performances from timetable`);

        // Get existing event for metadata update
        const event = await findEvent(supabase, { eventId });
        if (!event) throw new Error('Event not found for metadata update');

        // Extract stages and festival days
        const { stages, festival_days } = extractStagesAndDaysFromPerformances(events, timezone);
        await updateEventMetadata(supabase, event, stages, festival_days, dryRun);

        // Generate statistics
        const stats = generateTimetableStatistics(events);
        logTimetableStatistics(stats, logMessage);

        // Get SoundCloud access token
        const accessToken = await getAccessToken(
            process.env.SOUND_CLOUD_CLIENT_ID, 
            process.env.SOUND_CLOUD_CLIENT_SECRET
        );

        // Group performances for B2B handling
        const groupedPerformances = groupPerformancesForB2B(events);
        const artistNameToId = {};
        let soundCloudFoundCount = 0;

        for (const group of groupedPerformances) {
            const artistIds = [];
            const artistNames = [];

            for (const perf of group) {
                // Convert dates to UTC
                if (perf.time) {
                    perf.time = toUtcIso(perf.time, timezone);
                }
                if (perf.end_time) {
                    perf.end_time = toUtcIso(perf.end_time, timezone);
                }

                const artistName = perf.name.trim();
                artistNames.push(artistName);

                if (!artistNameToId[artistName]) {
                    logMessage(`🎵 Processing artist: "${artistName}"`);
                    
                    // Search SoundCloud
                    const scArtist = await artistModel.searchArtist(artistName, accessToken);
                    let soundCloudData = null;

                    if (scArtist) {
                        const artistInfo = await artistModel.extractArtistInfo(scArtist);
                        soundCloudData = {
                            soundcloud_id: artistInfo.external_links.soundcloud.id,
                            soundcloud_permalink: artistInfo.external_links.soundcloud.link,
                            image_url: artistInfo.image_url,
                            username: artistInfo.name,
                            description: artistInfo.description,
                        };
                        soundCloudFoundCount++;
                        logMessage(`✅ Found on SoundCloud: ${artistInfo.name}`);
                    }

                    // Insert/update artist
                    const artist = await artistModel.insertOrUpdateArtist(
                        supabase, 
                        { name: artistName }, 
                        soundCloudData, 
                        dryRun
                    );
                    artistNameToId[artistName] = artist.id;
                }

                artistIds.push(artistNameToId[artistName]);
            }

            // Link artists to event
            const refPerf = group[0];
            await linkArtistsToEvent(supabase, eventId, artistIds, refPerf, dryRun);
            
            result.artistsImported += group.length;
            logMessage(`✅ Processed: ${artistNames.join(' & ')}`);
            
            await delay(200); // Rate limiting
        }

        logMessage(`🎯 Timetable import complete: ${result.artistsImported} artists, ${soundCloudFoundCount} found on SoundCloud`);

    } catch (error) {
        logMessage(`❌ Timetable import error: ${error.message}`);
        throw error;
    }

    return result;
}

/**
 * Import artists from event description using OpenAI
 * @param {Object} eventData - Facebook event data
 * @param {number} eventId - Event ID
 * @param {boolean} dryRun - Whether to perform actual database operations
 * @returns {Promise<Object>} Import result
 */
async function importFromDescription(eventData, eventId, dryRun = false) {
    const result = { artistsImported: 0 };

    // This would use the OpenAI parsing logic from import_event.js
    // For now, simplified implementation
    logMessage("💬 Parsing artists from description...");
    
    if (!eventData.description) {
        logMessage("⚠️ No description available for artist extraction");
        return result;
    }

    // TODO: Implement OpenAI parsing or simple regex-based extraction
    // For now, just log that we would do this
    if (dryRun) {
        logMessage("[DRY_RUN] Would parse artists from description");
        result.artistsImported = 5; // Mock count
    }

    return result;
}

export default {
    unifiedImport
};
