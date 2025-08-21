/**
 * import_timetable.js
 *
 * Generic script to import festival artists
 * from a formatted JSON and link them to SoundCloud.
 *
 * Usage:
 *   node import_timetable.js --event-url=https://www.facebook.com/events/xxx/ --json=my_event.json
 *
 * This script:
 * 1. Reads the festival artists JSON
 * 2. Searches for each artist on SoundCloud
 * 3. Imports the data into Supabase
 * 4. Creates the Facebook event and links the artists
 * 5. Logs all results
 */

import 'dotenv/config';
import fs from 'fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

// Import utility functions
import { delay } from './utils/delay.js';
import { getAccessToken } from './utils/token.js';
import { logMessage } from './utils/logger.js';
import { toUtcIso } from './utils/date.js';

// Import model functions
import artistModel from './models/artist.js';
import { findEvent, updateEventMetadata, linkArtistsToEvent } from './models/event.js';
import {
    groupPerformancesForB2B,
    extractStagesAndDaysFromPerformances,
    generateTimetableStatistics,
    logTimetableStatistics
} from './models/timetable.js';

// --- Configuration ---
const DRY_RUN = process.env.DRY_RUN === 'true';
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- CLI argument handling ---
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--event-url=')) {
            result.eventUrl = args[i].split('=')[1];
        } else if (args[i].startsWith('--json=')) {
            result.jsonFilePath = args[i].split('=')[1];
        } else if (args[i] === '--event-url' && args[i + 1]) {
            result.eventUrl = args[i + 1]; i++;
        } else if (args[i] === '--json' && args[i + 1]) {
            result.jsonFilePath = args[i + 1]; i++;
        }
    }
    return result;
}

async function main() {
    const { eventUrl, jsonFilePath } = parseArgs();
    if (!eventUrl || !jsonFilePath) {
        console.error('Usage: node import_timetable.js --event-url=<facebook_event_url> --json=<path_to_json>');
        process.exit(1);
    }
    // Set default timezone
    const timezone = 'Europe/Brussels';
    try {
        logMessage(`=== Starting Event Import${DRY_RUN ? ' (DRY_RUN MODE)' : ''} ===`);
        if (!fs.existsSync(jsonFilePath)) {
            throw new Error(`JSON file not found: ${jsonFilePath}`);
        }
        logMessage(`[INFO] Timezone used for import: ${timezone}`);
        const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
        logMessage(`Loaded ${jsonData.length} artist performances from JSON`);
        const accessToken = await getAccessToken(SOUND_CLOUD_CLIENT_ID, SOUND_CLOUD_CLIENT_SECRET);
        
        // Initialize global token for automatic refresh on 401 errors
        artistModel.initializeGlobalToken(accessToken);
        
        logMessage("Searching for the event in the database (robust search)...");
        const event = await findEvent(supabase, { facebookUrl: eventUrl });
        if (!event) {
            logMessage("❌ No event found with this Facebook URL or title in the database. Create it first!");
            throw new Error("Event not found in the database. Create it first!");
        }
        // --- Enrich event metadata ---
        const { stages, festival_days } = extractStagesAndDaysFromPerformances(jsonData, timezone);
        await updateEventMetadata(supabase, event, stages, festival_days, DRY_RUN);
        
        // --- Generate and log statistics ---
        const stats = generateTimetableStatistics(jsonData);
        logTimetableStatistics(stats, logMessage);
        // --- B2B Management ---
        const groupedPerformances = groupPerformancesForB2B(jsonData);
        const artistNameToId = {};
        let processedCount = 0;
        let successCount = 0;
        let soundCloudFoundCount = 0;
        const dryRunLinks = [];
        for (const group of groupedPerformances) {
            const artistIds = [];
            const artistNames = [];
            for (const perf of group) {
                // Convert dates to UTC for the database
                if (perf.time) {
                    perf.time = toUtcIso(perf.time, timezone);
                }
                if (perf.end_time) {
                    perf.end_time = toUtcIso(perf.end_time, timezone);
                }
                const artistName = perf.name.trim();
                artistNames.push(artistName);
                if (!artistNameToId[artistName]) {
                    logMessage(`🎵 SoundCloud search for: "${artistName}"`);
                    const scArtist = await artistModel.searchArtist(artistName, accessToken);
                    let soundCloudData = null;
                    
                    if (scArtist) {
                        const artistInfo = await artistModel.extractArtistInfo(scArtist);
                        logMessage(`✅ Best SoundCloud match for "${artistName}": ${artistInfo.name}`);
                        logMessage(`   └─ SoundCloud Profile: ${artistInfo.external_links.soundcloud.link}`);
                        
                        soundCloudData = {
                            soundcloud_id: artistInfo.external_links.soundcloud.id,
                            soundcloud_permalink: artistInfo.external_links.soundcloud.link,
                            image_url: artistInfo.image_url,
                            username: artistInfo.name,
                            description: artistInfo.description,
                        };
                        soundCloudFoundCount++;
                    } else {
                        logMessage(`❌ No suitable SoundCloud match for "${artistName}"`);
                    }
                    
                    const artist = await artistModel.insertOrUpdateArtist(supabase, { name: artistName }, soundCloudData, DRY_RUN);
                    artistNameToId[artistName] = artist.id;
                }
                artistIds.push(artistNameToId[artistName]);
            }
            const refPerf = group[0];
            const linkResult = await linkArtistsToEvent(supabase, event.id, artistIds, refPerf, DRY_RUN);
            if (DRY_RUN) {
                dryRunLinks.push({ artists: artistNames, performance: refPerf, linkResult });
            }
            successCount += group.length;
            processedCount += group.length;
            logMessage(`Successfully processed: ${artistNames.join(' & ')} (${group.length} performance(s))`);
            await delay(500);
        }
        
        logMessage("\n=== Import Summary ===");
        logMessage(`Total artists processed: ${processedCount}`);
        logMessage(`Successfully imported: ${successCount}`);
        logMessage(`Found on SoundCloud: ${soundCloudFoundCount}`);
        logMessage(`SoundCloud success rate: ${((soundCloudFoundCount / successCount) * 100).toFixed(1)}%`);
        logMessage(`Event: ${event.title || event.name} (ID: ${event.id})`);
        
        logMessage(`\n✅ Statistical analysis complete.`);
        if (DRY_RUN) {
            logMessage(`\n[DRY_RUN] Number of simulated artist-event links: ${dryRunLinks.length}`);
            dryRunLinks.slice(0, 10).forEach(l => {
                logMessage(`[DRY_RUN] Example: ${l.artists.join(' & ')} on stage ${l.performance.stage} at ${l.performance.time}`);
            });
            if (dryRunLinks.length > 10) {
                logMessage(`[DRY_RUN] ...and ${dryRunLinks.length - 10} other simulated links.`);
            }
        }
        logMessage("=== Import Complete ===");
    } catch (error) {
        logMessage(`Fatal error during import: ${error.message}`);
        throw error;
    }
}

// --- Auto-call if executed from CLI ---
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import_timetable.js')) {
    main();
}
