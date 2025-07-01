// --- Normalisation avancée du nom d'artiste (copié de importEvent.js) ---
function normalizeArtistNameEnhanced(name) {
    if (!name) return name;
    let normalized = name.normalize('NFD');
    normalized = normalized.replace(/[\u0300-\u036f]/g, "");
    normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return normalized;
}

// --- Récupération d'image SoundCloud de haute qualité (copié de importEvent.js) ---
import fetch from 'node-fetch';
async function getBestImageUrl(avatarUrl) {
    if (!avatarUrl) return avatarUrl;
    if (!avatarUrl.includes('-large')) return avatarUrl;
    const t500Url = avatarUrl.replace('-large', '-t500x500');
    try {
        const response = await fetch(t500Url, { method: 'HEAD' });
        if (response.status === 200) {
            return t500Url;
        } else {
            return avatarUrl;
        }
    } catch (error) {
        return avatarUrl;
    }
}
/**
 * import_dour_2025.js
 *
 * Script spécialement conçu pour importer les artistes du festival Dour 2025
 * depuis le JSON formatté et les lier à SoundCloud
 *
 * Usage:
 *   node import_dour_2025.js path/to/true_dour2025.json
 *
 * Ce script :
 * 1. Lit le JSON des artistes du festival Dour 2025
 * 2. Recherche chaque artiste sur SoundCloud
 * 3. Importe les données dans Supabase
 * 4. Crée l'événement Facebook et lie les artistes
 * 5. Log tous les résultats
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
const TOKEN_FILE = path.join(__dirname, 'soundcloud_token.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Festival Dour 2025 Event Info
const DOUR_EVENT_INFO = {
    facebook_url: 'https://www.facebook.com/events/471964535551297',
    event_id: '471964535551297',
    name: 'Dour Festival 2025',
    description: 'Festival de musique électronique et alternative à Dour, Belgique',
    start_time: '2025-07-17T12:00:00.000Z', // À ajuster selon les vraies dates
    end_time: '2025-07-20T06:00:00.000Z',   // À ajuster selon les vraies dates
    location: 'Dour, Belgium',
    venue_name: 'Dour Festival Site'
};

// --- Logging Setup ---
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

function getTimestampedLogFilePath() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return path.join(logsDir, `dour_2025_${timestamp}.log`);
}
const logFilePath = getTimestampedLogFilePath();

function logMessage(msg) {
    const timestamp = new Date().toISOString();
    const fullMsg = `[${timestamp}] ${msg}`;
    console.log(fullMsg);
    fs.appendFileSync(logFilePath, fullMsg + "\n");
}

// --- Utility functions ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retrieves the stored access token from TOKEN_FILE if it exists and is still valid.
 */
async function getStoredToken() {
    if (fs.existsSync(TOKEN_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
            if (data.expiration && Date.now() < data.expiration) {
                logMessage("Using stored SoundCloud access token.");
                return data.token;
            } else {
                logMessage("Stored SoundCloud access token is expired.");
            }
        } catch (err) {
            logMessage("Error reading token file: " + err);
        }
    }
    return null;
}

/**
 * Stores the access token along with its expiration time.
 */
function storeToken(token, expiresIn) {
    const expiration = Date.now() + (expiresIn * 1000) - 60000; // 1 minute buffer
    const data = { token, expiration };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
    logMessage("Access token stored successfully.");
}

/**
 * Obtains an access token from SoundCloud using client credentials.
 */
async function getAccessToken() {
    let token = await getStoredToken();
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
        storeToken(token, expiresIn);
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
        logMessage(`🎵 Recherche SoundCloud pour: "${artistName}"`);
        const normName = normalizeArtistNameEnhanced(artistName);
        logMessage(`   └─ Nom normalisé pour recherche: "${normName}"`);

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
            logMessage(`   └─ ${response.data.length} résultat(s) trouvé(s) sur SoundCloud`);
            // --- Nouveau scoring composite ---
            let bestMatch = null;
            let bestScore = 0;
            const maxFollowers = Math.max(...response.data.map(u => u.followers_count || 0), 1);
            response.data.forEach((user, idx) => {
                const userNorm = normalizeArtistNameEnhanced(user.username);
                const nameScore = stringSimilarity.compareTwoStrings(normName.toLowerCase(), userNorm.toLowerCase());
                // Followers: log pour écraser les extrêmes, normalisé [0,1]
                const followers = user.followers_count || 0;
                const followersScore = Math.log10(followers + 1) / Math.log10(maxFollowers + 1);
                // Bonus pour le premier résultat
                const positionScore = 1 - (idx / response.data.length); // 1 pour le 1er, 0.9 pour le 2e, etc.
                // Pondération : nom 60%, followers 30%, position 10%
                const score = (nameScore * 0.6) + (followersScore * 0.3) + (positionScore * 0.1);
                logMessage(`   └─ Candidat: "${user.username}" | nom: ${nameScore.toFixed(2)} | followers: ${followers} | scoreFollowers: ${followersScore.toFixed(2)} | pos: ${idx + 1} | score: ${score.toFixed(3)}`);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = user;
                }
            });
            if (bestMatch && bestScore > 0.6) {
                logMessage(`✅ Meilleure correspondance SoundCloud pour "${artistName}": ${bestMatch.username} (score: ${bestScore.toFixed(3)})`);
                logMessage(`   └─ Profile SoundCloud: ${bestMatch.permalink_url}`);
                const bestImageUrl = await getBestImageUrl(bestMatch.avatar_url);
                return {
                    soundcloud_id: bestMatch.id,
                    soundcloud_permalink: bestMatch.permalink_url,
                    image_url: bestImageUrl,
                    username: bestMatch.username,
                    description: bestMatch.description,
                };
            } else {
                logMessage(`⚠️ Aucune correspondance suffisante trouvée pour "${artistName}" (meilleur score: ${bestScore.toFixed(3)})`);
            }
        } else {
            logMessage(`   └─ Aucun résultat sur SoundCloud pour "${normName}"`);
        }
        logMessage(`❌ Pas de correspondance SoundCloud appropriée pour "${artistName}"`);
        return null;
    } catch (error) {
        logMessage(`❌ Erreur lors de la recherche SoundCloud pour "${artistName}": ${error.message}`);
        return null;
    }
}

/**
 * Inserts or updates an artist in the database
 */
async function insertOrUpdateArtist(artistData, soundCloudData = null) {
    try {
        // Normalisation avancée du nom pour la recherche
        const normName = normalizeArtistNameEnhanced(artistData.name);
        // Check doublon par ID SoundCloud si dispo
        if (soundCloudData && soundCloudData.soundcloud_id) {
            const { data: existingByExternal, error: extError } = await supabase
                .from('artists')
                .select('id')
                .eq('external_links->soundcloud->>id', String(soundCloudData.soundcloud_id));
            if (extError) throw extError;
            if (existingByExternal && existingByExternal.length > 0) {
                logMessage(`➡️ Artiste existant trouvé par SoundCloud ID: "${artistData.name}" (id=${existingByExternal[0].id})`);
                return { id: existingByExternal[0].id };
            }
        }
        // Sinon, check doublon par nom (normalisé)
        logMessage(`🔍 Vérification si l'artiste "${artistData.name}" existe déjà...`);
        const { data: existingArtist, error: fetchError } = await supabase
            .from('artists')
            .select('id, name, external_links')
            .ilike('name', normName)
            .single();
        if (fetchError && fetchError.code !== 'PGRST116') {
            logMessage(`❌ Erreur lors de la recherche d'artiste: ${fetchError.message}`);
            throw fetchError;
        }
        if (DRY_RUN) {
            logMessage(`[DRY_RUN] Aurait inséré/mis à jour l'artiste: ${artistData.name}`);
            return { id: `dryrun_artist_${normName}` };
        }
        // Prépare les liens externes SoundCloud pour JSONB
        let external_links = existingArtist && existingArtist.external_links ? { ...existingArtist.external_links } : {};
        if (soundCloudData) {
            external_links.soundcloud = {
                link: soundCloudData.soundcloud_permalink,
                id: String(soundCloudData.soundcloud_id)
            };
        }
        // Construction de l'objet artiste enrichi
        const artistRecord = {
            name: normName,
            image_url: soundCloudData ? soundCloudData.image_url : undefined,
            description: soundCloudData ? soundCloudData.description : undefined,
            external_links: Object.keys(external_links).length > 0 ? external_links : undefined
        };
        if (existingArtist) {
            // Mise à jour
            const { data: updated, error: updateError } = await supabase
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

/**
 * Finds the existing Dour 2025 event in the database using multiple search strategies
 * Based on the schema used in importEvent.js
 */
async function findExistingEvent() {
    try {
        logMessage("Searching for existing Dour 2025 event in database...");

        // Strategy 1: Search by Facebook URL in metadata (JSONB)
        logMessage(`Searching by Facebook URL in metadata: ${DOUR_EVENT_INFO.facebook_url}`);
        const { data: eventsByMetaUrl, error: metaUrlError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .ilike('metadata->>facebook_url', DOUR_EVENT_INFO.facebook_url);
        if (metaUrlError) throw metaUrlError;
        if (eventsByMetaUrl && eventsByMetaUrl.length > 0) {
            const event = eventsByMetaUrl[0];
            logMessage(`✅ Event found by Facebook URL in metadata: "${event.title}" (ID: ${event.id})`);
            return event;
        }

        // Strategy 2: Search by event title
        logMessage(`Searching by title: ${DOUR_EVENT_INFO.name}`);
        const { data: eventsByTitle, error: titleError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .ilike('title', `%${DOUR_EVENT_INFO.name}%`);
        if (titleError) throw titleError;
        if (eventsByTitle && eventsByTitle.length > 0) {
            const event = eventsByTitle[0];
            logMessage(`✅ Event found by title: "${event.title}" (ID: ${event.id})`);
            return event;
        }

        // Strategy 3: Search for "Dour" in event titles (more flexible)
        logMessage("Searching for 'Dour' in event titles...");
        const { data: eventsByDour, error: dourError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .ilike('title', '%Dour%');
        if (dourError) throw dourError;
        if (eventsByDour && eventsByDour.length > 0) {
            // If multiple events, try to find the 2025 one
            const dour2025 = eventsByDour.find(e =>
                e.title.includes('2025') ||
                (e.date_time && e.date_time.includes('2025'))
            );
            if (dour2025) {
                logMessage(`✅ Event found by 'Dour' + '2025': "${dour2025.title}" (ID: ${dour2025.id})`);
                return dour2025;
            } else {
                // Take the first Dour event found
                const event = eventsByDour[0];
                logMessage(`✅ Event found by 'Dour' (general): "${event.title}" (ID: ${event.id})`);
                return event;
            }
        }

        // No event found
        logMessage("❌ No existing Dour event found in database");
        throw new Error("No existing Dour Festival event found. Please make sure the event exists in the database before running this import.");
    } catch (error) {
        logMessage(`Error searching for existing event: ${error.message}`);
        throw error;
    }
}

// --- Extract stages and festival days from performances ---
function extractStagesAndDaysFromPerformances(performances) {
    // Extract unique stages
    const stagesSet = new Set();
    performances.forEach(p => {
        if (p.stage && p.stage.trim() !== "") {
            stagesSet.add(p.stage.trim());
        }
    });
    const stages = Array.from(stagesSet).map(name => ({ name }));

    // Guess festival days (assume 5 days, noon to 6am next day)
    // If you have real dates, adapt here
    const baseDate = new Date("2025-07-17T12:00:00");
    const festival_days = [];
    for (let i = 0; i < 5; i++) {
        const start = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 18 * 60 * 60 * 1000); // +18h (noon to 6am)
        festival_days.push({
            name: `Day ${i + 1}`,
            start: start.toISOString().slice(0, 16),
            end: end.toISOString().slice(0, 16)
        });
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

// --- Regroup B2B performances ---
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
            logMessage(`[DRY_RUN] Aurait lié les artistes ${artistIds.join(', ')} à l'event ${eventId} (stage: ${performanceData.stage}, time: ${performanceData.time}, end_time: ${performanceData.end_time})`);
            return { id: `dryrun_link_${artistIds.join('_')}_${eventId}` };
        }
        const artistIdStrs = artistIds.map(String);
        // Convert time format to match database expectations
        let startTime = null;
        let endTime = null;
        if (performanceData.time && performanceData.time.trim() !== "") {
            startTime = `2025-07-17T${performanceData.time}:00`;
        }
        if (performanceData.end_time && performanceData.end_time.trim() !== "") {
            let endDate = "2025-07-17";
            const endHour = parseInt(performanceData.end_time.split(':')[0]);
            if (endHour < 12) { endDate = "2025-07-18"; }
            endTime = `${endDate}T${performanceData.end_time}:00`;
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
            custom_name: null,
            created_at: new Date().toISOString(),
            // ... pas de updated_at ...
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

// ...existing code...

// Remplacement de la fonction processDourArtists
let processDourArtists = undefined;
const oldProcessDourArtists = processDourArtists;
processDourArtists = async function processDourArtists(jsonFilePath) {
    try {
        logMessage(`=== Starting Dour 2025 Artists Import${DRY_RUN ? ' (DRY_RUN MODE)' : ''} ===`);
        if (!fs.existsSync(jsonFilePath)) {
            throw new Error(`JSON file not found: ${jsonFilePath}`);
        }
        const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
        logMessage(`Loaded ${jsonData.length} artist performances from JSON`);
        const accessToken = await getAccessToken();
        logMessage("Finding existing Dour 2025 event...");
        const event = await findExistingEvent();
        // --- Enrichir metadata event ---
        const { stages, festival_days } = extractStagesAndDaysFromPerformances(jsonData);
        await updateEventMetadata(event, stages, festival_days);
        // --- Statistiques avancées ---
        const uniqueArtists = new Set();
        const artistPerformances = {};
        const stagesSet = new Set();
        const performanceModes = new Set();
        const timeSlots = {};
        let withSoundCloud = 0;
        // Remplir les stats à partir du JSON brut (avant B2B)
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
        // --- Gestion B2B ---
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
        // --- Statistiques détaillées ---
        logMessage(`\n📊 Statistiques détaillées:`);
        logMessage(`   Total des performances: ${jsonData.length}`);
        logMessage(`   Artistes uniques: ${uniqueArtists.size}`);
        // Scènes
        logMessage(`\n🎪 Scènes (${stagesSet.size}):`);
        Array.from(stagesSet).sort().forEach(stage => {
            const count = jsonData.filter(p => p.stage === stage).length;
            logMessage(`   • ${stage}: ${count} performances`);
        });
        // Modes de performance
        if (performanceModes.size > 0) {
            logMessage(`\n🎭 Modes de performance:`);
            Array.from(performanceModes).forEach(mode => {
                const count = jsonData.filter(p => p.performance_mode === mode).length;
                logMessage(`   • ${mode}: ${count} performances`);
            });
        }
        // Artistes avec plusieurs performances
        const multiplePerformances = Object.entries(artistPerformances)
            .filter(([_, performances]) => performances.length > 1)
            .sort((a, b) => b[1].length - a[1].length);
        if (multiplePerformances.length > 0) {
            logMessage(`\n🔄 Artistes avec plusieurs performances (${multiplePerformances.length}):`);
            multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
                logMessage(`   • ${artist}: ${performances.length} performances`);
                performances.forEach(p => {
                    logMessage(`     - ${p.stage} à ${p.time} (${p.end_time})`);
                });
            });
            if (multiplePerformances.length > 10) {
                logMessage(`   ... et ${multiplePerformances.length - 10} autres`);
            }
        }
        // Répartition par heure
        logMessage(`\n⏰ Répartition par heure:`);
        Object.entries(timeSlots)
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
            .forEach(([hour, count]) => {
                const bar = '█'.repeat(Math.ceil(count / 2));
                logMessage(`   ${hour}h: ${count.toString().padStart(2)} ${bar}`);
            });
        // Liens SoundCloud déjà renseignés
        logMessage(`\n🎵 Liens SoundCloud:`);
        logMessage(`   Déjà renseignés: ${withSoundCloud}/${jsonData.length} (${((withSoundCloud / jsonData.length) * 100).toFixed(1)}%)`);
        // Échantillon d'artistes
        logMessage(`\n📝 Échantillon d'artistes:`);
        const sampleArtists = Array.from(uniqueArtists).slice(0, 10);
        sampleArtists.forEach((artist, index) => {
            logMessage(`   ${index + 1}. ${artist}`);
        });
        if (uniqueArtists.size > 10) {
            logMessage(`   ... et ${uniqueArtists.size - 10} autres artistes`);
        }
        logMessage(`\n✅ Analyse statistique terminée.`);
        if (DRY_RUN) {
            logMessage(`\n[DRY_RUN] Nombre de liens artistes-event simulés: ${dryRunLinks.length}`);
            dryRunLinks.slice(0, 10).forEach(l => {
                logMessage(`[DRY_RUN] Exemple: ${l.artists.join(' & ')} sur scène ${l.performance.stage} à ${l.performance.time}`);
            });
            if (dryRunLinks.length > 10) {
                logMessage(`[DRY_RUN] ...et ${dryRunLinks.length - 10} autres liens simulés.`);
            }
        }
        logMessage("=== Import Complete ===");
    } catch (error) {
        logMessage(`Fatal error during import: ${error.message}`);
        throw error;
    }
}
// ...fin patch...

// --- Appel auto si exécuté en CLI ---
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import_dour_2025.js')) {
    console.log('[DEBUG] Script démarré, appel processDourArtists');
    const jsonFilePath = process.argv[2];
    if (!jsonFilePath) {
        console.error('Usage: node import_dour_2025.js path/to/artists.json');
        process.exit(1);
    }
    processDourArtists(jsonFilePath).catch(err => {
        console.error('Erreur lors de l\'import:', err);
        process.exit(2);
    });
}
