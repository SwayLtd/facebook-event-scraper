// models/timetable.js
// Timetable-related business logic and processing

import { DateTime } from 'luxon';
import { logMessage } from '../utils/logger.js';

/**
 * Groups performances by time slot and stage for B2B detection
 * @param {Array} jsonData - Array of performance objects
 * @returns {Array} Array of grouped performances
 */
export function groupPerformancesForB2B(jsonData) {
    // Key: stage|time|end_time|performance_mode
    const groups = {};
    for (const perf of jsonData) {
        if (!perf.name || !perf.stage || !perf.time || !perf.end_time) continue;
        const key = `${perf.stage}|${perf.time}|${perf.end_time}|${perf.performance_mode || ''}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(perf);
    }
    return Object.values(groups);
}

/**
 * Extracts unique stages and festival days from performances
 * @param {Array} performances - Array of performance objects
 * @param {string} timezone - Timezone for date calculations (default: 'Europe/Brussels')
 * @returns {Object} Object with stages and festival_days arrays
 */
export function extractStagesAndDaysFromPerformances(performances, timezone = 'Europe/Brussels') {
    // Extract unique stages
    const stagesSet = new Set();
    performances.forEach(p => {
        if (p.stage && p.stage.trim() !== "") {
            stagesSet.add(p.stage.trim());
        }
    });
    const stages = Array.from(stagesSet).map(name => ({ name }));

    // Automatic detection of effective days with timezone management
    function parseInZone(dateStr) {
        return DateTime.fromISO(dateStr, { zone: timezone });
    }
    
    const slots = performances
        .filter(p => p.time && p.end_time)
        .map(p => ({
            start: parseInZone(p.time),
            end: parseInZone(p.end_time),
            raw: p
        }))
        .sort((a, b) => a.start - b.start);
    
    const festival_days = [];
    if (slots.length > 0) {
        let currentDay = [];
        let lastEnd = null;
        let dayIdx = 1;
        const MAX_GAP_HOURS = 4;
        
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (lastEnd) {
                const gap = slot.start.diff(lastEnd, 'hours').hours;
                if (gap > MAX_GAP_HOURS) {
                    festival_days.push({
                        name: `Day ${dayIdx}`,
                        start: currentDay[0].start.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
                        end: currentDay[currentDay.length - 1].end.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
                    });
                    dayIdx++;
                    currentDay = [];
                }
            }
            currentDay.push(slot);
            lastEnd = slot.end;
        }
        
        if (currentDay.length > 0) {
            festival_days.push({
                name: `Day ${dayIdx}`,
                start: currentDay[0].start.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
                end: currentDay[currentDay.length - 1].end.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
            });
        }
    }
    
    return { stages, festival_days };
}

/**
 * Generates comprehensive statistics from timetable data
 * @param {Array} jsonData - Array of performance objects
 * @returns {Object} Statistics object with detailed analysis
 */
export function generateTimetableStatistics(jsonData) {
    const uniqueArtists = new Set();
    const artistPerformances = {};
    const stagesSet = new Set();
    const performanceModes = new Set();
    const timeSlots = {};
    let withSoundCloud = 0;

    // Fill stats from raw JSON (before B2B)
    for (const perf of jsonData) {
        const artistName = perf.name.trim();
        uniqueArtists.add(artistName);
        
        if (!artistPerformances[artistName]) artistPerformances[artistName] = [];
        artistPerformances[artistName].push(perf);
        
        if (perf.stage) stagesSet.add(perf.stage);
        if (perf.performance_mode) performanceModes.add(perf.performance_mode);
        
        if (perf.time) {
            const hour = perf.time.split(':')[0];
            timeSlots[hour] = (timeSlots[hour] || 0) + 1;
        }
        
        if (perf.soundcloud && perf.soundcloud.trim()) withSoundCloud++;
    }

    return {
        uniqueArtists,
        artistPerformances,
        stagesSet,
        performanceModes,
        timeSlots,
        withSoundCloud,
        totalPerformances: jsonData.length
    };
}

/**
 * Logs detailed timetable statistics in a formatted way
 * @param {Object} stats - Statistics object from generateTimetableStatistics
 * @param {Function} logFunction - Logging function to use (defaults to logMessage)
 */
export function logTimetableStatistics(stats, logFunction = logMessage) {
    const {
        uniqueArtists,
        artistPerformances,
        stagesSet,
        performanceModes,
        timeSlots,
        withSoundCloud,
        totalPerformances
    } = stats;

    logFunction(`\n📊 Detailed statistics:`);
    logFunction(`   Total performances: ${totalPerformances}`);
    logFunction(`   Unique artists: ${uniqueArtists.size}`);
    
    // Stages
    logFunction(`\n🎪 Stages (${stagesSet.size}):`);
    Array.from(stagesSet).sort().forEach(stage => {
        const count = Object.values(artistPerformances)
            .flat()
            .filter(p => p.stage === stage).length;
        logFunction(`   • ${stage}: ${count} performances`);
    });
    
    // Performance modes
    if (performanceModes.size > 0) {
        logFunction(`\n🎭 Performance modes:`);
        Array.from(performanceModes).forEach(mode => {
            const count = Object.values(artistPerformances)
                .flat()
                .filter(p => p.performance_mode === mode).length;
            logFunction(`   • ${mode}: ${count} performances`);
        });
    }
    
    // Artists with multiple performances
    const multiplePerformances = Object.entries(artistPerformances)
        .filter(([, performances]) => performances.length > 1)
        .sort((a, b) => b[1].length - a[1].length);
    
    if (multiplePerformances.length > 0) {
        logFunction(`\n🔄 Artists with multiple performances (${multiplePerformances.length}):`);
        multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
            logFunction(`   • ${artist}: ${performances.length} performances`);
            performances.forEach(p => {
                logFunction(`     - ${p.stage} at ${p.time} (${p.end_time})`);
            });
        });
        if (multiplePerformances.length > 10) {
            logFunction(`   ... and ${multiplePerformances.length - 10} others`);
        }
    }
    
    // Distribution by hour
    logFunction(`\n⏰ Distribution by hour:`);
    Object.entries(timeSlots)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .forEach(([hour, count]) => {
            const bar = '█'.repeat(Math.ceil(count / 2));
            logFunction(`   ${hour}h: ${count.toString().padStart(2)} ${bar}`);
        });
    
    // SoundCloud links already provided
    logFunction(`\n🎵 SoundCloud Links:`);
    logFunction(`   Already provided: ${withSoundCloud}/${totalPerformances} (${((withSoundCloud / totalPerformances) * 100).toFixed(1)}%)`);
    
    // Artist sample
    logFunction(`\n📝 Artist Sample:`);
    const sampleArtists = Array.from(uniqueArtists).slice(0, 10);
    sampleArtists.forEach((artist, index) => {
        logFunction(`   ${index + 1}. ${artist}`);
    });
    if (uniqueArtists.size > 10) {
        logFunction(`   ... and ${uniqueArtists.size - 10} other artists`);
    }
}

/**
 * Processes and analyzes a complete timetable import
 * @param {Array} jsonData - Array of performance objects
 * @param {string} timezone - Timezone for processing
 * @returns {Object} Complete timetable analysis
 */
export function processTimetableData(jsonData, timezone = 'Europe/Brussels') {
    const stats = generateTimetableStatistics(jsonData);
    const { stages, festival_days } = extractStagesAndDaysFromPerformances(jsonData, timezone);
    const groupedPerformances = groupPerformancesForB2B(jsonData);
    
    return {
        stats,
        stages,
        festival_days,
        groupedPerformances,
        metadata: {
            timezone,
            processedAt: new Date().toISOString(),
            totalPerformances: jsonData.length,
            uniqueArtists: stats.uniqueArtists.size,
            stagesCount: stats.stagesSet.size,
            daysCount: festival_days.length
        }
    };
}

/**
 * Processes festival timetable data and imports artists with timing information
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client
 * @param {number} eventId - The event ID in the database
 * @param {Array} timetableData - Array of performance objects from Clashfinder
 * @param {Object} clashfinderResult - Original Clashfinder result with metadata
 * @param {Object} options - Processing options
 * @param {boolean} options.dryRun - Whether to perform actual database operations
 * @param {string} options.soundCloudClientId - SoundCloud client ID
 * @param {string} options.soundCloudClientSecret - SoundCloud client secret
 * @param {Function} options.logMessage - Logging function
 * @param {Function} options.delay - Delay function for rate limiting
 * @returns {Promise<Object>} Processing results with statistics
 */
async function processFestivalTimetable(supabase, eventId, timetableData, clashfinderResult, options = {}) {
    const {
        dryRun = false,
        soundCloudClientId,
        soundCloudClientSecret,
        logMessage = console.log,
        delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    } = options;

    if (dryRun) {
        console.log(`(DRY_RUN) Would process festival timetable with ${timetableData.length} performances`);
        return { processedCount: 0, successCount: 0, soundCloudFoundCount: 0 };
    }

    console.log(`\n🎪 Processing festival timetable with ${timetableData.length} performances...`);
    logMessage(`Starting festival timetable import for event ${eventId}`);
    
    // Set default timezone
    const timezone = 'Europe/Brussels';
    
    // Generate statistics and extract metadata
    const stats = generateTimetableStatistics(timetableData);
    const { stages, festival_days } = extractStagesAndDaysFromPerformances(timetableData, timezone);
    
    // Update event metadata with festival information
    const { updateEventMetadata } = await import('./event.js');
    await updateEventMetadata(supabase, { id: eventId }, stages, festival_days, dryRun);
    
    // Log statistics
    logTimetableStatistics(stats, logMessage);
    
    // Group performances for B2B detection
    const groupedPerformances = groupPerformancesForB2B(timetableData);
    
    // Get SoundCloud access token
    const { getAccessToken } = await import('../utils/token.js');
    const accessToken = await getAccessToken(soundCloudClientId, soundCloudClientSecret);
    
    let processedCount = 0;
    let successCount = 0;
    let soundCloudFoundCount = 0;
    const artistNameToId = {};
    const artistsWithoutSoundCloud = []; // Track artists without SoundCloud link
    
    // Import artist model
    const artistModule = await import('./artist.js');
    const insertOrUpdateArtist = artistModule.default.insertOrUpdateArtist;
    const eventModule = await import('./event.js');
    const linkArtistsToEvent = eventModule.default.linkArtistsToEvent;
    
    for (const group of groupedPerformances) {
        const artistIds = [];
        const artistNames = [];
        
        for (const perf of group) {
            let soundCloudData = null;
            
            // Search SoundCloud if we have an access token
            if (accessToken && perf.name) {
                try {
                    const artistModule = await import('./artist.js');
                    const searchArtist = artistModule.default.searchArtist;
                    const extractArtistInfo = artistModule.default.extractArtistInfo;
                    const scArtist = await searchArtist(perf.name, accessToken);
                    if (scArtist) {
                        soundCloudData = await extractArtistInfo(scArtist);
                        soundCloudFoundCount++;
                    }
                } catch (error) {
                    console.error(`Error searching SoundCloud for ${perf.name}:`, error);
                }
            }
            
            // Insert or update artist
            const artistData = { name: perf.name };
            const result = await insertOrUpdateArtist(supabase, artistData, soundCloudData, dryRun);
            
            if (result.id) {
                artistIds.push(result.id);
                artistNames.push(perf.name);
                artistNameToId[perf.name] = result.id;
            }
        }
        
        // Link artists to event with performance details
        if (artistIds.length > 0) {
            const refPerf = group[0];
            await linkArtistsToEvent(supabase, eventId, artistIds, refPerf, dryRun);
            
            successCount += group.length;
            processedCount += group.length;
            logMessage(`Successfully processed: ${artistNames.join(' & ')} (${group.length} performance(s))`);
        }
        
        await delay(500); // Rate limiting
    }
    
    logMessage(`Festival timetable import complete: ${processedCount} artists processed, ${successCount} imported, ${soundCloudFoundCount} with SoundCloud`);
    console.log(`✅ Festival import complete: ${processedCount} artists, ${soundCloudFoundCount} found on SoundCloud`);
    
    return {
        processedCount,
        successCount,
        soundCloudFoundCount,
        artistNameToId,
        stats,
        stages,
        festival_days
    };
}

export default {
    groupPerformancesForB2B,
    extractStagesAndDaysFromPerformances,
    generateTimetableStatistics,
    logTimetableStatistics,
    processTimetableData,
    processFestivalTimetable
};
