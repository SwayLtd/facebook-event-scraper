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
    
    // Process genres for all imported artists in batch mode
    if (!dryRun && Object.keys(artistNameToId).length > 0) {
        console.log(`\n🎵 Processing genres for ${Object.keys(artistNameToId).length} festival artists...`);
        await processFestivalArtistGenres(supabase, artistNameToId, options);
    }
    
    // Auto-detect and update event end time if not already set
    let detectedEndTime = null;
    if (!dryRun) {
        console.log(`\n🏁 Detecting event end time from timetable...`);
        detectedEndTime = detectEventEndTimeFromTimetable(timetableData, options);
        
        if (detectedEndTime) {
            // Check if event already has an end_date_time
            const { data: eventData, error: fetchError } = await supabase
                .from('events')
                .select('end_date_time')
                .eq('id', eventId)
                .single();
            
            if (fetchError) {
                console.error('[End Time Update] Error fetching event data:', fetchError);
            } else if (!eventData.end_date_time) {
                // Update event with detected end time
                const { error: updateError } = await supabase
                    .from('events')
                    .update({ end_date_time: detectedEndTime })
                    .eq('id', eventId);
                
                if (updateError) {
                    console.error('[End Time Update] Error updating event end time:', updateError);
                    logMessage(`[End Time Update] Failed to update event end time: ${updateError.message}`);
                } else {
                    logMessage(`[End Time Update] ✅ Event end time updated to: ${detectedEndTime}`);
                    console.log(`🏁 Event end time automatically set to: ${new Date(detectedEndTime).toLocaleString()}`);
                }
            } else {
                logMessage(`[End Time Update] Event already has end_date_time: ${eventData.end_date_time} (not overriding)`);
                console.log(`🏁 Event already has end time set, skipping auto-detection`);
            }
        } else {
            logMessage(`[End Time Update] No valid end time could be detected from timetable`);
            console.log(`⚠️  Could not detect event end time from timetable data`);
        }
    }
    
    return {
        processedCount,
        successCount,
        soundCloudFoundCount,
        artistNameToId,
        stats,
        stages,
        festival_days,
        detectedEndTime: detectedEndTime
    };
}

export default {
    groupPerformancesForB2B,
    extractStagesAndDaysFromPerformances,
    generateTimetableStatistics,
    logTimetableStatistics,
    processTimetableData,
    processFestivalTimetable,
    processFestivalArtistGenres,
    detectEventEndTimeFromTimetable
};

/**
 * Processes music genres for festival artists using optimized batch processing
 * 
 * IMPORTANT: Each artist receives individual genre analysis via Last.fm API.
 * Batch processing is ONLY used for API rate limiting optimization, not genre grouping.
 * Artists from the same stage/batch can have completely different genres.
 * 
 * Example: Main Stage batch could contain:
 * - Martin Garrix (Big Room House, Progressive House)
 * - Deadmau5 (Progressive House, Electro House) 
 * - Armin van Buuren (Trance, Progressive Trance)
 * - David Guetta (Commercial House, Pop Dance)
 * 
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client
 * @param {Object} artistNameToId - Mapping of artist names to IDs
 * @param {Object} options - Processing options including logMessage, banned genres, etc.
 */
async function processFestivalArtistGenres(supabase, artistNameToId, options) {
    const { logMessage = console.log } = options;
    
    try {
        // Import genre processing utilities
        const genreModule = await import('./genre.js');
        
        // Get banned genres list - these are filtered out to maintain data quality
        const bannedGenres = ["90s", "Disco", "Dub", "Guaracha", "Bootleg", "Montreal", "Lebanon", "Stereo", "Berghain", "Jaw", "Not", "Monster", "Dream", "Drone", "Eurodance", "Storytelling", "Nostalgic", "Guitar", "Art", "Future", "Romania", "Drums", "Atmosphere", "Emo", "Lyrical", "Indonesia", "Mood", "Mellow", "Work", "Feminism", "Download", "This", "Poetry", "Sound", "Malibu", "Twek", "Money", "Orgasm", "Cover", "Viral", "Sexy", "Z", "Nas", "Weird", "P", "Indonesion", "Funky", "Tearout", "Uplifting", "Love", "Core", "Violin", "Simpsons", "Riddim", "World Music", "Dancehall", "Gbr", "Fußball", "German", "New", "Eargasm", "Ecstasy", "Coldwave", "Brazilian", "Beat", "Song", "Soulful", "Smooth", "Contemporary", "Ballad", "Modern", "Beyonce", "Occult", "Evil", "Vinyl", "2000's", "Dog", "Gangsta", "Hair", "Soundtrack", "Hard Drance", "Bassline", "Queer", "Interview", "Krautrock", "Soundscape", "Darkwave", "Atmospheric", "Americana", "Mpc", "Detroit", "Fast", "Argentina", "Emotional", "Germany", "Frankfurt", "Karlsruhe", "Driving", "Cosmic", "Summer", "Basement", "Beachbar", "Party", "Producer", "Alive", "Pulse", "Coding", "Offensive", "Alex", "Time", "Soho", "Spring", "Aus", "X", "Modern Dancehall", "Elektra", "Piano", "Italo", "Synth", "Ghetto", "Moombahton", "Ghetto", "Chicago", "Happy", "80s", "Munich", "Melancholic", "Samples", "Madrid", "Amapiano", "00s", "Breakbeat", "Retro", "Breakz", "Spain", "Pandora", "Tropical", "Latin Pop", "Night", "Aussie", "Australian", "Fire", "Hot", "Spotify", "Ur", "2step", "Lonely", "Sad", "Angry", "Heavy", "Hex", "A", "Complex", "Freestyle", "Mainstream", "All", "Long", "Antifa", "Horror", "Scary", "Japan", "Popular", "Memphis", "Nostalgia", "Ost", "Speech", "Shoegaze", "Orchestral", "London", "Kinky", "Tresor", "Chillout", "Cool", "Sun", "Ethnic", "Banjo", "Trippy", "Persian", "Traditional", "Persian Traditional", "Bochka", "Oh", "God", "Kids", "Compilation", "Ghost", "Space", "Christ", "Based", "De", "Juke", "Gent", "Valearic", "Ebm", "Sac-sha", "Amsterdam", "Noise", "Eclectic", "Hi-nrg", "Antwerp", "Feelgood", "Body", "Indie Dance", "Barcelona", "Fusion", "C", "Comedy", "Zephyr", "E", "Tiktok", "Brasil", "O", "It", "Us", "Yes", "Scantraxx", "Qlimax", "Style", "Italian", "Spiritual", "Quiet", "Best", "Denver", "Colorado", "Soca", "Bobo", "G", "Zouk", "Booba", "Game", "Cello", "Jam", "Hardtekk", "Break", "Goa", "Boogie", "Idm", "Haldtime", "Spanish", "Screamo", "Ra", "Jersey", "Organ", "Palestine", "Congo", "Healing", "Minecraft", "Cyberpunk", "Television", "Film", "Cursed", "Crossbreed", "Funama", "Kuduro", "Mashups", "Collaboration", "France", "Alien", "Banger", "Tool", "Insomnia", "Flow", "Kafu", "Adele", "Makina", "Manchester", "Salford", "Macedonia", "Japanese", "Relax", "Relaxing", "Relaxation", "Is", "Bdr", "Bier", "Jckson", "Jersey Club", "Big Room", "Brooklyn", "Coffee", "Green", "Tekkno", "Flips", "Sia", "Ccr", "Ai", "Unicorn", "Q", "Aversion", "Gym", "Get", "Buningman", "Rotterdam", "Matrix", "Indian", "Brazil", "S", "Hybrid", "Beats", "Singer", "Ans", "Theme", "Future Bass", "Club House", "Glam", "Aggressive", "Prog", "Technoid", "Funny", "Raggamuffin", "Bangface", "Bandcamp", "Bristol", "Organic", "Brazilian Phonk", "Revolution", "Afterlife", "Rockabilly", "Tune", "Brixton", "Psydub", "Harmony", "Montana", "Imaginarium", "Cheesy", "Choral"];
        
        // Process artists in small batches to respect API rate limits
        // Each artist gets individual Last.fm analysis regardless of batch grouping
        const artistIds = Object.values(artistNameToId);
        const batchSize = 8; // Slightly smaller batches for better API stability
        let processedCount = 0;
        let genresAssigned = 0;
        
        logMessage(`[Genres] Processing ${artistIds.length} festival artists individually in batches of ${batchSize} (API rate limiting only)...`);
        
        for (let i = 0; i < artistIds.length; i += batchSize) {
            const batch = artistIds.slice(i, i + batchSize);
            
            // Fetch artist data for this batch
            const { data: artistsData, error: fetchError } = await supabase
                .from('artists')
                .select('*')
                .in('id', batch);
                
            if (fetchError) {
                console.error(`[Genres] Error fetching artist data for batch:`, fetchError);
                continue;
            }
            
            // Process each artist individually within this batch
            // Each artist receives unique genre analysis via Last.fm API
            for (const artistData of artistsData) {
                try {
                    logMessage(`[Genres] Analyzing individual artist: ${artistData.name}...`);
                    
                    // Individual Last.fm API call for this specific artist
                    // Result: artist-specific genres (e.g., "Progressive House", "Trance") 
                    const genres = await genreModule.default.processArtistGenres(
                        supabase,
                        artistData,
                        process.env.LASTFM_API_KEY,
                        bannedGenres
                    );
                    
                    // Link discovered genres to this specific artist
                    for (const genreObj of genres) {
                        if (genreObj.id) {
                            await genreModule.default.linkArtistGenre(supabase, artistData.id, genreObj.id);
                            genresAssigned++;
                        } else if (genreObj.name && genreObj.description) {
                            // Insert new genre if not exists
                            const genreId = await genreModule.default.insertGenreIfNew(supabase, genreObj);
                            await genreModule.default.linkArtistGenre(supabase, artistData.id, genreId);
                            genresAssigned++;
                        }
                    }
                    
                    processedCount++;
                    logMessage(`[Genres] ✅ ${artistData.name} → ${genres.length} genre(s) assigned`);
                    
                } catch (genreError) {
                    console.error(`[Genres] Error processing genres for artist ${artistData.name}:`, genreError);
                }
            }
            
            // API rate limiting delay between batches (not related to genre similarity)
            if (i + batchSize < artistIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay for API stability
            }
            
            logMessage(`[Genres] Batch ${Math.ceil((i + batchSize) / batchSize)}/${Math.ceil(artistIds.length / batchSize)}: ${Math.min(i + batchSize, artistIds.length)}/${artistIds.length} artists processed`);
        }
        
        logMessage(`[Genres] Festival individual genre processing complete: ${processedCount} artists analyzed, ${genresAssigned} unique genre assignments created`);
        console.log(`🎵 Festival genres complete: ${processedCount} artists individually processed, ${genresAssigned} genre links`);
        
    } catch (error) {
        console.error(`[Genres] Error in festival genre processing:`, error);
        logMessage(`[Genres] Error in festival genre processing: ${error.message}`);
    }
}

/**
 * Detects the event end time from timetable data by finding the latest performance
 * 
 * Analyzes all performances in the timetable to determine when the event should end:
 * 1. Looks for performances with explicit end_time
 * 2. For performances without end_time, estimates duration (defaults to 1 hour)
 * 3. Returns the latest end time found across all performances
 * 
 * @param {Array} timetableData - Array of performance objects with time/end_time
 * @param {Object} options - Options including logMessage function
 * @returns {string|null} ISO 8601 date string of latest end time, or null if no valid times found
 */
function detectEventEndTimeFromTimetable(timetableData, options = {}) {
    const { logMessage = console.log } = options;
    
    try {
        if (!timetableData || !Array.isArray(timetableData) || timetableData.length === 0) {
            logMessage('[End Time Detection] No timetable data provided');
            return null;
        }
        
        let latestEndTime = null;
        let performancesWithTimes = 0;
        let performancesWithEndTimes = 0;
        let latestPerformance = null;
        
        logMessage(`[End Time Detection] Analyzing ${timetableData.length} performances to find event end time...`);
        
        // Collect all end times first, then find the maximum
        const endTimes = [];
        
        for (const performance of timetableData) {
            let endTime = null;
            
            // Case 1: Performance has explicit end_time
            if (performance.end_time && performance.end_time.trim() !== '') {
                endTime = performance.end_time;
                performancesWithEndTimes++;
            }
            // Case 2: Performance has start time but no end_time - estimate 1 hour duration
            else if (performance.time && performance.time.trim() !== '') {
                try {
                    const startTime = new Date(performance.time);
                    if (!isNaN(startTime.getTime())) {
                        // Add 1 hour (default performance duration)
                        const estimatedEndTime = new Date(startTime.getTime() + (60 * 60 * 1000));
                        endTime = estimatedEndTime.toISOString();
                        performancesWithTimes++;
                    }
                } catch (error) {
                    logMessage(`[End Time Detection] Invalid start time format for ${performance.name}: ${performance.time}`);
                    continue;
                }
            }
            
            // Collect valid end times
            if (endTime) {
                try {
                    const endTimeDate = new Date(endTime);
                    if (!isNaN(endTimeDate.getTime())) {
                        endTimes.push({
                            endTime: endTime,
                            endTimeDate: endTimeDate,
                            performance: performance
                        });
                    }
                } catch (error) {
                    logMessage(`[End Time Detection] Invalid end time format: ${endTime}`);
                }
            }
        }
        
        // Find the latest end time
        if (endTimes.length > 0) {
            const latest = endTimes.reduce((max, current) => 
                current.endTimeDate > max.endTimeDate ? current : max
            );
            latestEndTime = latest.endTime;
            latestPerformance = latest.performance;
        }
        
        logMessage(`[End Time Detection] Analysis complete:`);
        logMessage(`  - Performances with explicit end_time: ${performancesWithEndTimes}`);
        logMessage(`  - Performances with estimated end_time: ${performancesWithTimes}`);
        if (latestEndTime && latestPerformance) {
            logMessage(`  - Event end time detected: ${latestEndTime} (${latestPerformance.name} on ${latestPerformance.stage})`);
        } else {
            logMessage(`  - Event end time detected: None found`);
        }
        if (latestEndTime) {
            const endDate = new Date(latestEndTime);
            logMessage(`🏁 Event end time: ${endDate.toLocaleString()} (${latestEndTime})`);
        }
        
        return latestEndTime;
        
    } catch (error) {
        console.error('[End Time Detection] Error detecting event end time:', error);
        logMessage(`[End Time Detection] Error: ${error.message}`);
        return null;
    }
}
