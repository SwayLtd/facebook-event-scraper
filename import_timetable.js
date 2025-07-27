import { DateTime } from 'luxon';
import { normalizeNameEnhanced } from './utils/name.js';
import { getBestImageUrl } from './utils/artist.js';
import { delay } from './utils/delay.js';
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
import path from 'path';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import stringSimilarity from 'string-similarity';

// Define __filename and __dirname for ESM
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const DRY_RUN = process.env.DRY_RUN === 'true';
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';
import tokenUtils from './utils/token.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Logging Setup ---
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

function getTimestampedLogFilePath() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return path.join(logsDir, `import_timetable_${timestamp}.log`);
}
const logFilePath = getTimestampedLogFilePath();

function logMessage(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    console.log(fullMsg);
    fs.appendFileSync(logFilePath, fullMsg + "\n");
}


/**
 * Obtains an access token from SoundCloud using client credentials.
 */
async function getAccessToken() {
    let token = await tokenUtils.getStoredToken();
    if (token) return token;

    try {
        logMessage("Requesting new SoundCloud access token...");
        const response = await axios.post(TOKEN_URL, {
            grant_type: 'client_credentials',
            client_id: SOUND_CLOUD_CLIENT_ID,
            client_secret: SOUND_CLOUD_CLIENT_SECRET
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        token = response.data.access_token;
        const expiresIn = response.data.expires_in;
        await tokenUtils.storeToken(token, expiresIn);
        logMessage("New SoundCloud access token obtained successfully.");
        return token;
    } catch (error) {
        logMessage("Error obtaining SoundCloud access token: " + error.message);
        throw error;
    }
}

/**
 * Searches for an artist on SoundCloud
 */
async function searchSoundCloudArtist(artistName, accessToken) {
    try {
        logMessage(`🎵 SoundCloud search for: "${artistName}"`);
        const normName = normalizeNameEnhanced(artistName);
        logMessage(`   └─ Normalized name for search: "${normName}"`);

        const response = await axios.get('https://api.soundcloud.com/users', {
            params: {
                q: normName,
                limit: 10
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (response.data && response.data.length > 0) {
            logMessage(`   └─ ${response.data.length} result(s) found on SoundCloud`);
            // --- New composite scoring ---
            let bestMatch = null;
            let bestScore = 0;
            const maxFollowers = Math.max(...response.data.map(u => u.followers_count || 0), 1);
            response.data.forEach((user, idx) => {
                const userNorm = normalizeNameEnhanced(user.username);
                const nameScore = stringSimilarity.compareTwoStrings(normName.toLowerCase(), userNorm.toLowerCase());
                // Followers: log to flatten extremes, normalized [0,1]
                const followers = user.followers_count || 0;
                const followersScore = Math.log10(followers + 1) / Math.log10(maxFollowers + 1);
                // Bonus for the first result
                const positionScore = 1 - (idx / response.data.length); // 1 for the 1st, 0.9 for the 2nd, etc.
                // Weighting: name 60%, followers 30%, position 10%
                const score = (nameScore * 0.6) + (followersScore * 0.3) + (positionScore * 0.1);
                logMessage(`   └─ Candidate: "${user.username}" | name: ${nameScore.toFixed(2)} | followers: ${followers} | followersScore: ${followersScore.toFixed(2)} | pos: ${idx + 1} | score: ${score.toFixed(3)}`);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = user;
                }
            });
            if (bestMatch && bestScore > 0.6) {
                logMessage(`✅ Best SoundCloud match for "${artistName}": ${bestMatch.username} (score: ${bestScore.toFixed(3)})`);
                logMessage(`   └─ SoundCloud Profile: ${bestMatch.permalink_url}`);
                const bestImageUrl = await getBestImageUrl(bestMatch.avatar_url);
                return {
                    soundcloud_id: bestMatch.id,
                    soundcloud_permalink: bestMatch.permalink_url,
                    image_url: bestImageUrl,
                    username: bestMatch.username,
                    description: bestMatch.description,
                };
            } else {
                logMessage(`⚠️ No sufficient match found for "${artistName}" (best score: ${bestScore.toFixed(3)})`);
            }
        } else {
            logMessage(`   └─ No results on SoundCloud for "${normName}"`);
        }
        logMessage(`❌ No suitable SoundCloud match for "${artistName}"`);
        return null;
    } catch (error) {
        logMessage(`❌ Error during SoundCloud search for "${artistName}": ${error.message}`);
        return null;
    }
}

/**
 * Inserts or updates an artist in the database
 */
async function insertOrUpdateArtist(artistData, soundCloudData = null) {
    try {
        // Advanced name normalization for search
        const normName = normalizeNameEnhanced(artistData.name);
        // Check for duplicates by SoundCloud ID if available
        if (soundCloudData && soundCloudData.soundcloud_id) {
            const { data: existingByExternal, error: extError } = await supabase
                .from('artists')
                .select('id')
                .eq('external_links->soundcloud->>id', String(soundCloudData.soundcloud_id));
            if (extError) throw extError;
            if (existingByExternal && existingByExternal.length > 0) {
                logMessage(`➡️ Existing artist found by SoundCloud ID: "${artistData.name}" (id=${existingByExternal[0].id})`);
                return { id: existingByExternal[0].id };
            }
        }
        // Otherwise, check for duplicates by name (normalized)
        logMessage(`🔍 Checking if artist "${artistData.name}" already exists...`);
        const { data: existingArtist, error: fetchError } = await supabase
            .from('artists')
            .select('id, name, external_links')
            .ilike('name', normName)
            .single();
        if (fetchError && fetchError.code !== 'PGRST116') {
            logMessage(`❌ Error while searching for artist: ${fetchError.message}`);
            throw fetchError;
        }
        if (DRY_RUN) {
            logMessage(`[DRY_RUN] Would have inserted/updated artist: ${artistData.name}`);
            return { id: `dryrun_artist_${normName}` };
        }
        // Prepare SoundCloud external links for JSONB
        let external_links = existingArtist && existingArtist.external_links ? { ...existingArtist.external_links } : {};
        if (soundCloudData) {
            external_links.soundcloud = {
                link: soundCloudData.soundcloud_permalink,
                id: String(soundCloudData.soundcloud_id)
            };
        }
        // Build the enriched artist object
        const artistRecord = {
            name: normName,
            image_url: soundCloudData ? soundCloudData.image_url : undefined,
            description: soundCloudData ? soundCloudData.description : undefined,
            external_links: Object.keys(external_links).length > 0 ? external_links : undefined
        };
        if (existingArtist) {
            // Update
            const { error: updateError } = await supabase
                .from('artists')
                .update(artistRecord)
                .eq('id', existingArtist.id)
                .select();
            if (updateError) throw updateError;
            logMessage(`✅ Updated artist: ${artistRecord.name} (ID: ${existingArtist.id})`);
            return { id: existingArtist.id };
        } else {
            // Insertion
            const { data: inserted, error: insertError } = await supabase
                .from('artists')
                .insert(artistRecord)
                .select();
            if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
            logMessage(`✅ Inserted new artist: ${artistRecord.name} (ID: ${inserted[0].id})`);
            return { id: inserted[0].id };
        }
    } catch (error) {
        logMessage(`❌ Error inserting/updating artist "${artistData.name}": ${error.message}`);
        throw error;
    }
}

// --- Generic event search ---
async function findExistingEvent(eventUrl) {
    try {
        logMessage(`Searching for event in the database via Facebook URL: ${eventUrl}`);
        const { data: eventsByMetaUrl, error: metaUrlError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .ilike('metadata->>facebook_url', eventUrl);
        if (metaUrlError) throw metaUrlError;
        if (eventsByMetaUrl && eventsByMetaUrl.length > 0) {
            const event = eventsByMetaUrl[0];
            logMessage(`✅ Event found: "${event.title}" (ID: ${event.id})`);
            return event;
        }
        logMessage("❌ No event found with this Facebook URL in the database");
        throw new Error("Event not found in the database. Create it first!");
    } catch (error) {
        logMessage(`Error searching for event: ${error.message}`);
        throw error;
    }
}

import { toUtcIso } from './utils/date_utils.js';
function extractStagesAndDaysFromPerformances(performances, timezone = 'Europe/Brussels') {
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

// --- Merge and update event metadata ---
async function updateEventMetadata(event, newStages, newFestivalDays) {
    let metadata = event.metadata || {};
    // Parse if string
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    // Merge stages
    metadata.stages = newStages;
    // Merge festival_days
    metadata.festival_days = newFestivalDays;
    // Optionally preserve other keys (ticket_link, facebook_url, etc)
    // Add timetable if not present
    if (!('timetable' in metadata)) metadata.timetable = true;
    // Update in DB
    if (!DRY_RUN) {
        const { error } = await supabase
            .from('events')
            .update({ metadata })
            .eq('id', event.id);
        if (error) throw error;
    }
    logMessage(`[INFO] Event metadata updated with stages and festival_days`);
    logMessage(`[INFO] stages: ${JSON.stringify(metadata.stages)}`);
    logMessage(`[INFO] festival_days: ${JSON.stringify(metadata.festival_days)}`);
    return metadata;
}

// --- Group B2B performances ---
function groupPerformancesForB2B(jsonData) {
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

// Patch: Accept array of artistIds for B2B
async function linkArtistToEvent(eventId, artistIds, performanceData) {
    try {
        if (DRY_RUN) {
            logMessage(`[DRY_RUN] Would have linked artists ${artistIds.join(', ')} to event ${eventId} (stage: ${performanceData.stage}, time: ${performanceData.time}, end_time: ${performanceData.end_time})`);
            return { id: `dryrun_link_${artistIds.join('_')}_${eventId}` };
        }
        const artistIdStrs = artistIds.map(String);
        // Use ISO 8601 date-times directly from JSON (already formatted)
        let startTime = null;
        let endTime = null;
        if (performanceData.time && performanceData.time.trim() !== "") {
            startTime = performanceData.time;
        }
        if (performanceData.end_time && performanceData.end_time.trim() !== "") {
            endTime = performanceData.end_time;
        }
        // Check if link already exists with the same details
        let query = supabase
            .from('event_artist')
            .select('id')
            .eq('event_id', eventId);
        if (performanceData.stage === null || performanceData.stage === "") {
            query = query.is('stage', null);
        } else {
            query = query.eq('stage', performanceData.stage);
        }
        if (startTime === null) {
            query = query.is('start_time', null);
        } else {
            query = query.eq('start_time', startTime);
        }
        if (endTime === null) {
            query = query.is('end_time', null);
        } else {
            query = query.eq('end_time', endTime);
        }
        // Check if artist_id array contains all our artists
        query = query.contains('artist_id', artistIdStrs);
        const { data: existing, error: fetchError } = await query;
        if (fetchError) { throw fetchError; }
        if (existing && existing.length > 0) {
            logMessage(`➡️ Artist-event link already exists for artist_ids=${artistIdStrs.join(',')} with same performance details`);
            return existing[0];
        }
        // Create new link with format compatible with existing system
        const linkRecord = {
            event_id: eventId,
            artist_id: artistIdStrs, // Array format
            start_time: startTime,
            end_time: endTime,
            status: 'confirmed',
            stage: performanceData.stage || null,
            custom_name: performanceData.custom_name || null,
            created_at: new Date().toISOString(),
            // ... no updated_at ...
        };
        const { data, error } = await supabase
            .from('event_artist')
            .insert(linkRecord)
            .select()
            .single();
        if (error) throw error;
        logMessage(`✅ Created artist-event link for artist_ids=${artistIdStrs.join(',')} (ID: ${data.id})`);
        return data;
    } catch (error) {
        logMessage(`Error linking artist to event: ${error.message}`);
        throw error;
    }
}

// --- CLI argument handling ---
import process from 'node:process';

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
        const accessToken = await getAccessToken();
        logMessage("Searching for the event in the database...");
        // Patch: pass eventUrl to findExistingEvent
        const event = await findExistingEvent(eventUrl);
        // --- Enrich event metadata ---
        const { stages, festival_days } = extractStagesAndDaysFromPerformances(jsonData, timezone);
        await updateEventMetadata(event, stages, festival_days);
        // --- Advanced statistics ---
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
                    const soundCloudData = await searchSoundCloudArtist(artistName, accessToken);
                    if (soundCloudData) soundCloudFoundCount++;
                    const artist = await insertOrUpdateArtist({ name: artistName }, soundCloudData);
                    artistNameToId[artistName] = artist.id;
                }
                artistIds.push(artistNameToId[artistName]);
            }
            const refPerf = group[0];
            const linkResult = await linkArtistToEvent(event.id, artistIds, refPerf);
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
        // --- Detailed statistics ---
        logMessage(`\n📊 Detailed statistics:`);
        logMessage(`   Total performances: ${jsonData.length}`);
        logMessage(`   Unique artists: ${uniqueArtists.size}`);
        // Stages
        logMessage(`\n🎪 Stages (${stagesSet.size}):`);
        Array.from(stagesSet).sort().forEach(stage => {
            const count = jsonData.filter(p => p.stage === stage).length;
            logMessage(`   • ${stage}: ${count} performances`);
        });
        // Performance modes
        if (performanceModes.size > 0) {
            logMessage(`\n🎭 Performance modes:`);
            Array.from(performanceModes).forEach(mode => {
                const count = jsonData.filter(p => p.performance_mode === mode).length;
                logMessage(`   • ${mode}: ${count} performances`);
            });
        }
        // Artists with multiple performances
        const multiplePerformances = Object.entries(artistPerformances)
            .filter(([performances]) => performances.length > 1)
            .sort((a, b) => b[1].length - a[1].length);
        if (multiplePerformances.length > 0) {
            logMessage(`\n🔄 Artists with multiple performances (${multiplePerformances.length}):`);
            multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
                logMessage(`   • ${artist}: ${performances.length} performances`);
                performances.forEach(p => {
                    logMessage(`     - ${p.stage} at ${p.time} (${p.end_time})`);
                });
            });
            if (multiplePerformances.length > 10) {
                logMessage(`   ... and ${multiplePerformances.length - 10} others`);
            }
        }
        // Distribution by hour
        logMessage(`\n⏰ Distribution by hour:`);
        Object.entries(timeSlots)
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .forEach(([hour, count]) => {
                const bar = '█'.repeat(Math.ceil(count / 2));
                logMessage(`   ${hour}h: ${count.toString().padStart(2)} ${bar}`);
            });
        // SoundCloud links already provided
        logMessage(`\n🎵 SoundCloud Links:`);
        logMessage(`   Already provided: ${withSoundCloud}/${jsonData.length} (${((withSoundCloud / jsonData.length) * 100).toFixed(1)}%)`);
        // Artist sample
        logMessage(`\n📝 Artist Sample:`);
        const sampleArtists = Array.from(uniqueArtists).slice(0, 10);
        sampleArtists.forEach((artist, index) => {
            logMessage(`   ${index + 1}. ${artist}`);
        });
        if (uniqueArtists.size > 10) {
            logMessage(`   ... and ${uniqueArtists.size - 10} other artists`);
        }
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
// ...end patch...

// --- Auto-call main() if executed directly ---
if (process.argv[1] && process.argv[1].endsWith('import_timetable.js')) {
    main();
}
