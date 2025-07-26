import 'dotenv/config';  // Load environment variables from a .env file if present
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';  // Ensure node-fetch is installed
import stringSimilarity from 'string-similarity'; // For fuzzy matching
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';

// Imports OpenAI
import OpenAI from 'openai';

// --- Global Parameters ---
const DRY_RUN = false;            // Set true for dry-run mode (no DB writes)
const FUZZY_THRESHOLD = 0.75;     // Similarity threshold for fuzzy matching
const MIN_GENRE_OCCURRENCE = 3; // Minimum occurrences for genre assignment

const bannedGenres = ["90s", "Disco", "Dub", "Guaracha", "Bootleg", "Montreal", "Lebanon", "Stereo", "Berghain", "Jaw", "Not", "Monster", "Dream", "Drone", "Eurodance", "Storytelling", "Nostalgic", "Guitar", "Art", "Future", "Romania", "Drums", "Atmosphere", "Emo", "Lyrical", "Indonesia", "Mood", "Mellow", "Work", "Feminism", "Download", "This", "Poetry", "Sound", "Malibu", "Twek", "Money", "Orgasm", "Cover", "Viral", "Sexy", "Z", "Nas", "Weird", "P", "Indonesion", "Funky", "Tearout", "Uplifting", "Love", "Core", "Violin", "Simpsons", "Riddim", "World Music", "Dancehall", "Gbr", "Fußball", "German", "New", "Eargasm", "Ecstasy", "Coldwave", "Brazilian", "Beat", "Song", "Soulful", "Smooth", "Contemporary", "Ballad", "Modern", "Beyonce", "Occult", "Evil", "Vinyl", "2000's", "Dog", "Gangsta", "Hair", "Soundtrack", "Hard Drance", "Bassline", "Queer", "Interview", "Krautrock", "Soundscape", "Darkwave", "Atmospheric", "Americana", "Mpc", "Detroit", "Fast", "Argentina", "Emotional", "Germany", "Frankfurt", "Karlsruhe", "Driving", "Cosmic", "Summer", "Basement", "Beachbar", "Party", "Producer", "Alive", "Pulse", "Coding", "Offensive", "Alex", "Time", "Soho", "Spring", "Aus", "X", "Modern Dancehall", "Elektra", "Piano", "Italo", "Synth", "Ghetto", "Moombahton", "Ghetto", "Chicago", "Happy", "80s", "Munich", "Melancholic", "Samples", "Madrid", "Amapiano", "00s", "Breakbeat", "Retro", "Breakz", "Spain", "Pandora", "Tropical", "Latin Pop", "Night", "Aussie", "Australian", "Fire", "Hot", "Spotify", "Ur", "2step", "Lonely", "Sad", "Angry", "Heavy", "Hex", "A", "Complex", "Freestyle", "Mainstream", "All", "Long", "Antifa", "Horror", "Scary", "Japan", "Popular", "Memphis", "Nostalgia", "Ost", "Speech", "Shoegaze", "Orchestral", "London", "Kinky", "Tresor", "Chillout", "Cool", "Sun", "Ethnic", "Banjo", "Trippy", "Persian", "Traditional", "Persian Traditional", "Bochka", "Oh", "God", "Kids", "Compilation", "Ghost", "Space", "Christ", "Based", "De", "Juke", "Gent", "Valearic", "Ebm", "Sac-sha", "Amsterdam", "Noise", "Eclectic", "Hi-nrg", "Antwerp", "Feelgood", "Body", "Indie Dance", "Barcelona", "Fusion", "C", "Comedy", "Zephyr", "E", "Tiktok", "Brasil", "O", "It", "Us", "Yes", "Scantraxx", "Qlimax", "Style", "Italian", "Spiritual", "Quiet", "Best", "Denver", "Colorado", "Soca", "Bobo", "G", "Zouk", "Booba", "Game", "Cello", "Jam", "Hardtekk", "Break", "Goa", "Boogie", "Idm", "Haldtime", "Spanish", "Screamo", "Ra", "Jersey", "Organ", "Palestine", "Congo", "Healing", "Minecraft", "Cyberpunk", "Television", "Film", "Cursed", "Crossbreed", "Funama", "Kuduro", "Mashups", "Collaboration", "France", "Alien", "Banger", "Tool", "Insomnia", "Flow", "Kafu", "Adele", "Makina", "Manchester", "Salford", "Macedonia", "Japanese", "Relax", "Relaxing", "Relaxation", "Is", "Bdr", "Bier", "Jckson", "Jersey Club", "Big Room", "Brooklyn", "Coffee", "Green", "Tekkno", "Flips", "Sia", "Ccr", "Ai", "Unicorn", "Q", "Aversion", "Gym", "Get", "Buningman", "Rotterdam", "Matrix", "Indian", "Brazil", "S", "Hybrid", "Beats", "Singer", "Ans", "Theme", "Future Bass", "Club House", "Glam", "Aggressive", "Prog", "Technoid", "Funny", "Raggamuffin", "Bangface", "Bandcamp", "Bristol", "Organic", "Brazilian Phonk", "Revolution", "Afterlife", "Rockabilly", "Tune", "Brixton", "Psydub", "Harmony", "Montana", "Imaginarium", "Cheesy", "Choral", "other", "mixtape", "world", "venice", "hate", "bbc", "original", "hip", "Indie", "dan", "wave", "J", "deep", "holiday", "berlin", "Classic", "fun", "Electric", "Leftfield", "Italo-disco", "Electronica", "Singer-songwriter", "alternative", "sampled", "anime", "hit", "speed garage", "groovy", "donk", "latin", "R", "soul", "trash", "vocal", "alternative rock", "werewolf", "christmas", "xmas", "amen", "fox", "you", "Dl", "girl", "Intelligent", "audio", "musical", "tony", "moon", "ukf", "zombies", "Complextro", "Doom", "death", "Monstercat", "cake", "scene", "queen", "slam", "fox", "Czech", "workout", "winter", "modus", "iaginarium", "avalon", "fullon", "football", "colombia", "portugal", "badass", "recorder", "chile", "road", "breton", "sufi", "chanson", "noize", "balada", "running", "footwork", "santa", "crazy", "microwave", "bop", "great", "carnaval", "standard", "demo", "twilight", "female", "hippie", "community", "meditative", "yoga", "meditation", "drop", "haunting", "chant", "Birmingham", "opium", "combo", "austria", "old", "worldwide", "free", "rap", "d", "snap", "n", "hip-hop", "hiphip", "breaks", "electronic", "belgian", "belgium", "up", "noir", "bass", "murder", "ep", "rave", "bad", "oldschool", "music", "remix", "track", "podcast", "dance", "set", "festival", "ecstacy", "uk", "live", "paris", "internet", "episode", "r", "D", "club", "dj", "mix", "radio", "soundcloud", "sesh"];

// Read environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const longLivedToken = process.env.LONG_LIVED_TOKEN;  // Facebook Graph API token
const googleApiKey = process.env.GOOGLE_API_KEY;      // Google Maps API key
const openAIApiKey = process.env.OPENAI_API_KEY;      // OpenAI key
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;    // To validate tags/genres via Last.fm
const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';

const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    httpAdapter: 'https',
    formatter: null
});

// Basic checks
if (!supabaseUrl || !serviceKey) {
    console.error("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment variables.");
    process.exit(1);
}
if (!longLivedToken) {
    console.error("Please set LONG_LIVED_TOKEN in your environment variables.");
    process.exit(1);
}
if (!googleApiKey) {
    console.error("Please set GOOGLE_API_KEY in your environment variables.");
    process.exit(1);
}
if (!openAIApiKey) {
    console.error("Please set OPENAI_API_KEY in your environment variables.");
    process.exit(1);
}
if (!SOUND_CLOUD_CLIENT_ID || !SOUND_CLOUD_CLIENT_SECRET) {
    console.error("Please set SOUND_CLOUD_CLIENT_ID and SOUND_CLOUD_CLIENT_SECRET in your environment variables.");
    process.exit(1);
}
if (!LASTFM_API_KEY) {
    console.error("Please set LASTFM_API_KEY in your environment variables.");
    process.exit(1);
}

// Load geocoding exceptions
let geocodingExceptions = {};
try {
    geocodingExceptions = JSON.parse(fs.readFileSync('geocoding_exceptions.json', 'utf8'));
} catch (err) {
    console.error("Error loading geocoding_exceptions.json:", err);
}

// --- Social Link Normalization Helpers (from updateArtistExternalLinks.js) ---
const URL_REGEX = /\bhttps?:\/\/[^")\s'<>]+/gi;
const HANDLE_REGEX = /(?:IG:?|Insta:?|Instagram:?|Twitter:?|TW:?|X:?|x:?|FB:?|Facebook:?|SC:?|SoundCloud:?|Wiki:?|Wikipedia:?|BandCamp:?|BC:?|@)([A-Za-z0-9._-]+)/gi;
const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function normalizeSocialLink(raw) {
    const r = raw.trim();
    // Full URL
    if (/^https?:\/\//i.test(r)) {
        let url;
        try { url = new URL(r); } catch { return null; }
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 1) return null;
        const id = segments[0].toLowerCase();
        if (!VALID_ID.test(id) || id.length < 2 || ['http', 'https'].includes(id)) return null;
        let platform;
        switch (host) {
            case 'instagram.com': platform = 'instagram'; break;
            case 'twitter.com':
            case 'x.com': platform = 'x'; break;
            case 'facebook.com': platform = 'facebook'; break;
            case 'soundcloud.com': platform = 'soundcloud'; break;
            default:
                if (host.endsWith('.bandcamp.com')) platform = 'bandcamp';
                else if (host.endsWith('.wikipedia.org')) platform = 'wikipedia';
                else return null;
        }
        return { platform, link: `${url.protocol}//${url.hostname}/${segments[0]}` };
    }
    // Raw handle
    if (/^https?:/i.test(r)) return null;
    const prefixMatch = r.match(/^[A-Za-z]+(?=[:@]?)/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    const id = r.replace(/^[A-Za-z]+[:@]?/i, '').trim().toLowerCase();
    if (!VALID_ID.test(id) || id.length < 2) return null;
    if (['instagram', 'insta', 'ig'].includes(prefix)) return { platform: 'instagram', link: `https://instagram.com/${id}` };
    if (['twitter', 'tw', 'x'].includes(prefix)) return { platform: 'x', link: `https://x.com/${id}` };
    if (['facebook', 'fb'].includes(prefix)) return { platform: 'facebook', link: `https://facebook.com/${id}` };
    if (['soundcloud', 'sc'].includes(prefix)) return { platform: 'soundcloud', link: `https://soundcloud.com/${id}` };
    if (['bandcamp', 'bc'].includes(prefix)) return { platform: 'bandcamp', link: `https://${id}.bandcamp.com` };
    if (['wikipedia', 'wiki'].includes(prefix)) return { platform: 'wikipedia', link: `https://en.wikipedia.org/wiki/${encodeURIComponent(id.replace(/\s+/g, '_'))}` };
    return null;
}

function normalizeExternalLinks(externalLinksObj) {
    if (!externalLinksObj || typeof externalLinksObj !== 'object') return null;
    const normalized = {};
    for (const [platform, data] of Object.entries(externalLinksObj)) {
        if (!data || !data.link) continue;
        const norm = normalizeSocialLink(data.link);
        if (norm) normalized[platform] = { ...data, link: norm.link };
        else normalized[platform] = data;
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
}

// --- Setup logs for Google Maps fallback ---
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const imageLogFile = path.join(logsDir, 'syncVenueImages.log');
function writeImageLog(level, msg) {
    const ts = new Date().toISOString();
    fs.appendFileSync(imageLogFile, `${ts} [${level}] ${msg}\n`);
}

// Normalize name using exceptions file
function getNormalizedName(originalName) {
    if (geocodingExceptions[originalName]) {
        return geocodingExceptions[originalName];
    }
    return originalName;
}

/*
 * Enhanced artist name normalization.
 * Removes non-alphanumeric characters from the beginning or end,
 * without removing symbols inside (e.g., "SANTØS" remains unchanged,
 * while "☆ fumi ☆" becomes "fumi").
 */
function normalizeNameEnhanced(name) {
    if (!name) return name;
    // Separate letters from diacritics
    let normalized = name.normalize('NFD');
    // Remove diacritical marks
    normalized = normalized.replace(/[\u0300-\u036f]/g, "");
    // Remove non-alphanumeric characters at the beginning and end of the string
    normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return normalized;
}

/**
 * Retrieves the URL of a Google Places photo for a given address.
 */
async function fetchGoogleVenuePhoto(name, address) {
    // Google Maps geocoding
    const geoRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_API_KEY}`
    );
    const geoJson = await geoRes.json();
    if (!geoJson.results?.length) throw new Error('No geocoding results');
    const { lat, lng } = geoJson.results[0].geometry.location;

    // findPlaceFromText to get place_id
    const findRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(name + ' ' + address)}` +
        `&inputtype=textquery&fields=place_id&key=${process.env.GOOGLE_API_KEY}`
    );
    const findJson = await findRes.json();
    if (!findJson.candidates?.length) throw new Error('No place_id found');
    const placeId = findJson.candidates[0].place_id;

    // details to get photo_reference
    const detailRes = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${placeId}&fields=photos&key=${process.env.GOOGLE_API_KEY}`
    );
    const detailJson = await detailRes.json();
    const photoRef = detailJson.result.photos?.[0]?.photo_reference;
    if (!photoRef) throw new Error('No photo available');

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${process.env.GOOGLE_API_KEY}`;
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, serviceKey);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: openAIApiKey });

// --- SoundCloud Token Management ---
const TOKEN_FILE = 'soundcloud_token.json';

// Load banned genre IDs into memory
// After instantiating `supabase = createClient(...)`:
const { data: bannedGenreRecords, error: bannedError } = await supabase
    .from('genres')
    .select('id')
    .in('name', bannedGenres.map(g => refineGenreName(g)));
if (bannedError) throw bannedError;
const bannedGenreIds = bannedGenreRecords.map(r => r.id);

async function getStoredToken() {
    if (fs.existsSync(TOKEN_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
            if (data.expiration && Date.now() < data.expiration) {
                console.log("[SoundCloud] Using stored access token.");
                return data.token;
            } else {
                console.log("[SoundCloud] Stored access token is expired.");
            }
        } catch (err) {
            console.log("[SoundCloud] Error reading token file:", err);
        }
    }
    return null;
}

async function storeToken(token, expiresIn) {
    const expiration = Date.now() + expiresIn * 1000;
    const data = { token, expiration };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log("[SoundCloud] Access token stored.");
}

async function getAccessToken() {
    let token = await getStoredToken();
    if (token) return token;
    try {
        const response = await fetch(`${TOKEN_URL}?client_id=${SOUND_CLOUD_CLIENT_ID}&client_secret=${SOUND_CLOUD_CLIENT_SECRET}&grant_type=client_credentials`, {
            method: 'POST'
        });
        const data = await response.json();
        token = data.access_token;
        const expiresIn = data.expires_in || 3600;
        console.log("[SoundCloud] Access token obtained:", token);
        await storeToken(token, expiresIn);
        return token;
    } catch (error) {
        console.error("[SoundCloud] Error obtaining access token:", error);
        return null;
    }
}

// --- Geocoding / Image Fetch Functions (unchanged) ---
async function fetchHighResImage(objectId) {
    try {
        const response = await fetch(`https://graph.facebook.com/${objectId}?fields=picture.width(720).height(720)&access_token=${longLivedToken}`);
        const data = await response.json();
        if (data.picture && data.picture.data && data.picture.data.url) {
            return data.picture.data.url;
        }
    } catch (err) {
        console.error("Error fetching high resolution image:", err);
    }
    return null;
}

async function fetchAddressFromGoogle(venueName) {
    try {
        const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(venueName)}&key=${googleApiKey}`);
        const data = await response.json();
        if (data.status === "OK" && data.results && data.results.length > 0) {
            return data.results[0];
        } else {
            console.error("Google Geocoding API error or no results:", data.status);
        }
    } catch (err) {
        console.error("Error fetching address from Google:", err);
    }
    return null;
}

async function fetchAddressFromNominatim(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const data = await response.json();
        if (data && data.display_name) {
            return data;
        } else {
            console.error("Nominatim reverse geocoding returned no result");
        }
    } catch (err) {
        console.error("Error fetching address from Nominatim:", err);
    }
    return null;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- getBestImageUrl (from import_artist.js) ---
async function getBestImageUrl(avatarUrl) {
    if (!avatarUrl) return avatarUrl;
    if (!avatarUrl.includes('-large')) return avatarUrl;
    const t500Url = avatarUrl.replace('-large', '-t500x500');
    let retryCount = 0;
    while (retryCount < 3) {
        try {
            const response = await fetch(t500Url, { method: 'HEAD' });
            if (response.status === 200) {
                return t500Url;
            } else if (response.status === 429) {
                // Rate limit reached, wait 60s and retry (max 3 tries)
                console.warn('[getBestImageUrl] Rate limit reached for SoundCloud image. Waiting 60s before retry...');
                await new Promise(resolve => setTimeout(resolve, 60000));
                retryCount++;
                continue;
            } else {
                return avatarUrl;
            }
        } catch (error) {
            // If error is a rate limit, retry
            if (error && error.status === 429) {
                console.warn('[getBestImageUrl] Rate limit error (exception). Waiting 60s before retry...');
                await new Promise(resolve => setTimeout(resolve, 60000));
                retryCount++;
                continue;
            }
            return avatarUrl;
        }
        break;
    }
    return avatarUrl;
}

// --- Ensure relation in a pivot table (unchanged) ---
async function ensureRelation(table, relationData, relationName) {
    const { data, error } = await supabase
        .from(table)
        .select()
        .match(relationData);
    if (error) throw error;
    if (!data || data.length === 0) {
        const { error: insertError } = await supabase
            .from(table)
            .insert(relationData);
        if (insertError) throw insertError;
        console.log(`✅ ${relationName} relation created: ${JSON.stringify(relationData)}`);
    } else {
        console.log(`➡️ ${relationName} relation already exists: ${JSON.stringify(relationData)}`);
    }
}

// --- Additional Functions for Genre Management ---

/**
 * Fetches artist tracks from SoundCloud based on the SoundCloud user ID.
 */
async function fetchArtistTracks(soundcloudUserId, token) {
    try {
        const url = `https://api.soundcloud.com/users/${soundcloudUserId}/tracks?limit=10`;
        const response = await fetch(url, {
            headers: { "Authorization": `OAuth ${token}` }
        });
        const data = await response.json();
        if (!Array.isArray(data)) {
            console.error(`[Genres] Expected tracks to be an array but got: ${JSON.stringify(data)}`);
            return [];
        }
        // console.log(`[Genres] Fetched ${data.length} tracks for SoundCloud user ${soundcloudUserId}`);
        return data;
    } catch (error) {
        console.error("[Genres] Error fetching artist tracks from SoundCloud:", error);
        return [];
    }
}

/**
 * Utility function to capitalize each word in a string.
 * Example: "hard techno" -> "Hard Techno"
 */
function capitalizeWords(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Splits a compound tag containing known delimiters (" x ", " & ", " + ") into sub-tags.
 */
function splitCompoundTags(tag) {
    const delimiters = [" x ", " & ", " + "];
    for (const delim of delimiters) {
        if (tag.includes(delim)) {
            return tag.split(delim).map(t => t.trim());
        }
    }
    return [tag];
}


/**
 * Cleans a description by removing HTML tags, the "Read more on Last.fm" part,
 * and removes a possible " ." at the end of the string.
 * If, after cleaning, the description is too short (less than 30 characters), returns "".
 */
function cleanDescription(desc) {
    if (!desc) return "";
    // 1. Remove all HTML tags
    let text = desc.replace(/<[^>]*>/g, '').trim();
    // 2. Remove "Read more on Last.fm"
    text = text.replace(/read more on last\.fm/gi, '').trim();
    // 3. Remove a residual " ." at the end of the description
    text = text.replace(/\s+\.\s*$/, '');
    // 4. Check minimum length
    return text.length < 30 ? "" : text;
}

/**
 * Checks via Last.fm if the tag corresponds to a musical genre.
 * Returns { valid, name, description, lastfmUrl }.
 * Only allows if the description contains "genre" or "sub-genre"/"subgenre"
 * or "<name> music", and rejects if it contains "umbrella term"
 * or if the name is a single letter.
 */
async function verifyGenreWithLastFM(tagName) {
    // reject single-letter names
    if (tagName.length === 1) {
        return { valid: false };
    }

    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodeURIComponent(tagName)}&api_key=${LASTFM_API_KEY}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data?.tag) return { valid: false };

        // Initial cleaning and summary extraction
        const rawSummary = data.tag.wiki?.summary || "";
        const description = cleanDescription(rawSummary);
        if (!description) return { valid: false };

        const lowerDesc = description.toLowerCase();
        const lowerTag = tagName.toLowerCase();

        // Acceptance conditions
        const hasGenreWord = /(genre|sub-genre|subgenre)/.test(lowerDesc);
        const hasMusicPhrase = new RegExp(`${lowerTag}\\s+music`).test(lowerDesc);
        const isUmbrella = /umbrella term/.test(lowerDesc);

        if (isUmbrella || !(hasGenreWord || hasMusicPhrase)) {
            return { valid: false };
        }

        // Extraction of the tag URL
        let lastfmUrl = data.tag.url || "";
        const linkMatch = rawSummary.match(/<a href="([^"]+)"/);
        if (linkMatch?.[1]) lastfmUrl = linkMatch[1];

        return {
            valid: true,
            name: data.tag.name.toLowerCase(),
            description,
            lastfmUrl
        };
    } catch (error) {
        console.error("[Genres] Error verifying genre with Last.fm for tag:", tagName, error);
        return { valid: false };
    }
}

/**
 * refineGenreName
 *
 * This function takes a genre name (as retrieved from Last.fm or another source)
 * and reformats it for more readable display. It first applies word-by-word capitalization,
 * then detects and corrects certain special cases (for example, if the name does not contain spaces and contains
 * the word "techno", it inserts a space before "Techno"). This refinement allows for genre names such as
 * "Hard Techno" instead of "Hardtechno" for better visual clarity and uniformity in the database.
 *
 * @param {string} name - The genre name to refine.
 * @returns {string} - The reformatted genre name for display (e.g., "Hard Techno").
 */
function refineGenreName(name) {
    // By default, apply word-by-word capitalization
    let refined = name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

    // Example of refinement for "techno":
    // If the name does not contain a space but includes "techno", insert a space before "Techno"
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(techno)$/i, (match, p1, p2) => {
            return p1.trim() + " " + p2.charAt(0).toUpperCase() + p2.slice(1).toLowerCase();
        });
    }
    // You can add other conditions if necessary.

    return refined;
}

/**
 * Inserts the genre into the "genres" table if it does not already exist.
 * First, it checks via the URL in external_links; if nothing is found, it checks by name.
 * Returns the genre ID.
 */
async function insertGenreIfNew(genreObject) {
    const { name, description, lastfmUrl } = genreObject;
    // We work here with the original name for refinement
    const normalizedName = name.toLowerCase();
    const genreSlug = slugifyGenre(normalizedName);

    // Get all existing genres (to detect a duplicate by slug or external link)
    let { data: existingGenres, error: selectError } = await supabase
        .from('genres')
        .select('id, name, external_links');
    if (selectError) {
        console.error("[Genres] Error selecting genre:", selectError);
        throw selectError;
    }

    let duplicateGenre = null;
    // Check by external_links if available
    if (lastfmUrl) {
        duplicateGenre = existingGenres.find(g => g.external_links &&
            g.external_links.lastfm &&
            g.external_links.lastfm.link === lastfmUrl);
    }
    // Otherwise, check by the name's slug
    if (!duplicateGenre) {
        duplicateGenre = existingGenres.find(g => slugifyGenre(g.name) === genreSlug);
    }
    if (duplicateGenre) {
        console.log(`[Genres] Genre "${name}" already exists with ID ${duplicateGenre.id}`);
        return duplicateGenre.id;
    }

    let externalLinks = null;
    if (lastfmUrl) {
        externalLinks = { lastfm: { link: lastfmUrl } };
    }
    // Use refineGenreName to get the desired display title
    const finalName = refineGenreName(name);
    const { data: newGenre, error: insertError } = await supabase
        .from('genres')
        .insert({ name: finalName, description, external_links: externalLinks })
        .select();
    if (insertError || !newGenre) {
        console.error("[Genres] Error inserting genre:", insertError);
        throw insertError || new Error("Genre insertion failed");
    }
    console.log(`[Genres] Genre inserted: ${finalName} (id=${newGenre[0].id}) with description: ${description} and external_links: ${JSON.stringify(externalLinks)}`);
    return newGenre[0].id;
}

/**
 * Links an artist to a genre in the "artist_genre" pivot table.
 */
async function linkArtistGenre(artistId, genreId) {
    const { data, error } = await supabase
        .from('artist_genre')
        .select('*')
        .match({ artist_id: artistId, genre_id: genreId });
    if (error) throw error;
    if (!data || data.length === 0) {
        const { error: insertError } = await supabase
            .from('artist_genre')
            .insert({ artist_id: artistId, genre_id: genreId });
        if (insertError) throw insertError;
        console.log(`[Genres] Linked artist (id=${artistId}) to genre (id=${genreId}).`);
    } else {
        console.log(`[Genres] Artist (id=${artistId}) already linked to genre (id=${genreId}).`);
    }
}

/**
 * Extracts and normalizes tags from a track.
 * It uses the "genre" and "tag_list" fields. Returns an array of lowercase tags.
 */
function extractTagsFromTrack(track) {
    let tags = [];
    if (track.genre) {
        tags.push(track.genre.toLowerCase().trim());
    }
    if (track.tag_list) {
        const rawTags = track.tag_list.split(/\s+/);
        rawTags.forEach(tag => {
            tag = tag.replace(/^#/, "").toLowerCase().trim();
            if (tag && !tags.includes(tag)) {
                tags.push(tag);
            }
        });
    }
    console.log(`[Genres] For track "${track.title || 'unknown'}", extracted tags: ${JSON.stringify(tags)}`);
    return tags;
}

function slugifyGenre(name) {
    // Removes all non-alphanumeric characters to get a condensed version.
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * For an artist, uses the SoundCloud API to retrieve their tracks,
 * extracts the tags, and checks via Last.fm which ones correspond to musical genres.
 * Returns an array of validated genre objects.
 */
async function processArtistGenres(artistData) {
    const genresFound = [];

    // 1) Check that the artist has a SoundCloud link
    if (
        !artistData.external_links ||
        !artistData.external_links.soundcloud ||
        !artistData.external_links.soundcloud.id
    ) {
        console.log(`[Genres] No SoundCloud external link for "${artistData.name}"`);
        return genresFound;
    }

    // 2) Get the tracks
    const soundcloudUserId = artistData.external_links.soundcloud.id;
    const token = await getAccessToken();
    if (!token) {
        console.log("[Genres] No SoundCloud token available");
        return genresFound;
    }
    const tracks = await fetchArtistTracks(soundcloudUserId, token);

    // 3) Extract and deduplicate all tags
    let allTags = [];
    for (const track of tracks) {
        const tags = extractTagsFromTrack(track);
        let splitted = [];
        tags.forEach(t => { splitted = splitted.concat(splitCompoundTags(t)); });
        allTags = allTags.concat(splitted.filter(t => /[a-zA-Z]/.test(t)));
    }
    allTags = Array.from(new Set(allTags));

    // 4) Alias DnB → genre_id 437
    const aliasTagIds = {
        'dnb': 437,
        'drumnbass': 437,
        "drum'n'bass": 437,
        'drumandbass': 437,
    };

    // 5) Go through each tag
    for (const rawTag of allTags) {
        const tag = rawTag.toLowerCase().trim();

        // 5a) If alias, force ID 437
        if (aliasTagIds[tag]) {
            const id = aliasTagIds[tag];
            console.log(`[Genres] Alias DnB detected ("${tag}") → forcing genre_id ${id}`);
            if (!genresFound.some(g => g.id === id)) {
                genresFound.push({ id });
            }
            continue;
        }

        // 5b) Otherwise, validation via Last.fm
        console.log(`[Genres] Verifying "${tag}" via Last.fm…`);
        const v = await verifyGenreWithLastFM(tag);
        if (v.valid && v.description) {
            const slug = slugifyGenre(v.name);
            if (!bannedGenres.includes(slug)) {
                genresFound.push({
                    name: v.name,
                    description: v.description,
                    lastfmUrl: v.lastfmUrl
                });
            } else {
                console.log(`[Genres] Skipping generic genre "${v.name}".`);
            }
        } else {
            console.log(`[Genres] Skipping invalid or too-short tag "${tag}".`);
        }
    }

    return genresFound;
}

/**
 * Deduces the genres of an event from the artists participating in it.
 * Only occurrences of the same genre reaching MIN_GENRE_OCCURRENCE
 * AND NOT banned will be assigned to the event. Returns the list of selected IDs.
 */
async function assignEventGenres(eventId) {
    // 1) Get the event's artists
    const { data: eventArtists, error: eaError } = await supabase
        .from('event_artist')
        .select('artist_id')
        .eq('event_id', eventId);
    if (eaError) throw eaError;

    // 2) Count the genres
    const genreCounts = {};
    for (const { artist_id } of eventArtists) {
        for (const aid of artist_id) {
            const { data: artistGenres, error: agError } = await supabase
                .from('artist_genre')
                .select('genre_id')
                .eq('artist_id', parseInt(aid, 10));
            if (agError) throw agError;
            artistGenres.forEach(g => {
                genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
            });
        }
    }

    // 3) First filter: threshold + exclusion of banned genres
    let topGenreIds = Object.entries(genreCounts)
        .filter(([genreId, count]) =>
            count >= MIN_GENRE_OCCURRENCE &&
            !bannedGenreIds.includes(Number(genreId))
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([genreId]) => Number(genreId));

    // 4) More permissive fallback: ignore the threshold, but not the banned genres
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([genreId]) => Number(genreId));

        console.log(
            `[Genres] No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for event ${eventId}, ` +
            `fallback top 3 without threshold:`,
            topGenreIds
        );
    } else {
        console.log(
            `[Genres] Top genres for event ${eventId} (threshold ${MIN_GENRE_OCCURRENCE}):`,
            topGenreIds
        );
    }

    // 5) Save in event_genre
    for (const genreId of topGenreIds) {
        await ensureRelation(
            "event_genre",
            { event_id: eventId, genre_id: genreId },
            "event_genre"
        );
    }

    return topGenreIds;
}

/**
 * For a promoter, deduces their genres via their events.
 * Only occurrences reaching MIN_GENRE_OCCURRENCE and not banned
 * will be assigned; otherwise, fallback to the top 5.
 */
async function assignPromoterGenres(promoterId) {
    // 1) Get the promoter's events
    const { data: promoterEvents, error: peError } = await supabase
        .from('event_promoter')
        .select('event_id')
        .eq('promoter_id', promoterId);
    if (peError) throw peError;

    // 2) Count the genres of these events
    const genreCounts = {};
    for (const { event_id } of promoterEvents) {
        const { data: eventGenres, error: egError } = await supabase
            .from('event_genre')
            .select('genre_id')
            .eq('event_id', event_id);
        if (egError) throw egError;
        eventGenres.forEach(g => {
            genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
        });
    }

    // 3) First filter: threshold + exclusion of banned genres
    let topGenreIds = Object.entries(genreCounts)
        .filter(([genreId, count]) =>
            count >= MIN_GENRE_OCCURRENCE &&
            !bannedGenreIds.includes(Number(genreId))
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([genreId]) => Number(genreId));

    // 4) More permissive fallback
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([genreId]) => Number(genreId));

        console.log(
            `[Genres] No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for promoter ${promoterId}, ` +
            `fallback top 3 without threshold:`,
            topGenreIds
        );
    } else {
        console.log(
            `[Genres] Top genres for promoter ${promoterId} (threshold ${MIN_GENRE_OCCURRENCE}):`,
            topGenreIds
        );
    }

    // 5) Save in promoter_genre
    for (const genreId of topGenreIds) {
        await ensureRelation(
            "promoter_genre",
            { promoter_id: promoterId, genre_id: genreId },
            "promoter_genre"
        );
    }

    return topGenreIds;
}

// --- Existing Manage Promoters (unchanged) ---
/**
 * Finds or inserts a promoter, then returns { id, name, image_url }.
 */
async function findOrInsertPromoter(promoterName, eventData) {
    const normalizedName = getNormalizedName(promoterName);

    // 1) Exact match on the name
    const { data: exactMatches, error: exactError } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .eq('name', normalizedName);
    if (exactError) throw exactError;

    if (exactMatches && exactMatches.length > 0) {
        const p = exactMatches[0];
        console.log(`➡️ Promoter "${promoterName}" found (exact) → id=${p.id}`);
        return { id: p.id, name: p.name, image_url: p.image_url };
    }

    // 2) Fuzzy match against all existing promoters
    const { data: allPromoters, error: allError } = await supabase
        .from('promoters')
        .select('id, name, image_url');
    if (allError) throw allError;

    if (allPromoters && allPromoters.length > 0) {
        const names = allPromoters.map(p => p.name.toLowerCase());
        const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(
            normalizedName.toLowerCase(),
            names
        );
        if (bestMatch.rating >= FUZZY_THRESHOLD) {
            const p = allPromoters[bestMatchIndex];
            console.log(
                `➡️ Promoter "${promoterName}" similar to "${p.name}" → id=${p.id}`
            );
            return { id: p.id, name: p.name, image_url: p.image_url };
        }
    }

    // 3) Insertion of a new promoter
    console.log(`➡️ Inserting a new promoter "${promoterName}"…`);
    const promoterSource = eventData.hosts.find(h => h.name === promoterName);
    const newPromoterData = { name: normalizedName };

    // try to get a high-resolution image via Facebook Graph
    if (promoterSource?.id) {
        const highRes = await fetchHighResImage(promoterSource.id);
        if (highRes) newPromoterData.image_url = highRes;
    }

    // fallback to photo.imageUri if available
    if (!newPromoterData.image_url && promoterSource?.photo?.imageUri) {
        newPromoterData.image_url = promoterSource.photo.imageUri;
    }

    const { data: inserted, error: insertError } = await supabase
        .from('promoters')
        .insert(newPromoterData)
        .select('id, name, image_url');
    if (insertError || !inserted || inserted.length === 0) {
        throw insertError || new Error('Promoter insertion failed');
    }

    const created = inserted[0];
    console.log(
        `✅ Promoter inserted: "${promoterName}" → id=${created.id}`
    );
    return {
        id: created.id,
        name: created.name,
        image_url: created.image_url ?? null
    };
}

// --- Manage Artists ---
async function findOrInsertArtist(artistObj) {
    // artistObj: { name, time, soundcloud, stage, performance_mode }
    let artistName = (artistObj.name || '').trim();
    if (!artistName) return null;

    // 1. Name normalization
    artistName = normalizeNameEnhanced(artistName);

    // 2. Search on SoundCloud
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(artistName, token);
    }

    // 3. Construction of the artistData object
    let artistData;
    if (scArtist) {
        // If found on SC, extract enriched info
        artistData = await extractArtistInfo(scArtist);
    } else {
        // Otherwise minimal fallback
        artistData = {
            name: artistName,
            external_links: artistObj.soundcloud
                ? { soundcloud: { link: artistObj.soundcloud } }
                : null,
        };
    }
    // --- Social link normalization ---
    if (artistData.external_links) {
        artistData.external_links = normalizeExternalLinks(artistData.external_links);
    }

    // 4. Duplicate detection via SoundCloud link
    if (artistData.external_links?.soundcloud?.id) {
        const { data: existingByExternal, error: extError } = await supabase
            .from('artists')
            .select('id')
            .eq('external_links->soundcloud->>id', artistData.external_links.soundcloud.id);
        if (extError) throw extError;
        if (existingByExternal.length > 0) {
            console.log(`➡️ Artist exists by external link: "${artistName}" (id=${existingByExternal[0].id})`);
            return existingByExternal[0].id;
        }
    }

    // 5. Duplicate detection via name
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('id')
        .ilike('name', artistName);
    if (nameError) throw nameError;
    if (existingByName.length > 0) {
        console.log(`➡️ Artist exists by name: "${artistName}" (id=${existingByName[0].id})`);
        return existingByName[0].id;
    }

    // 6. Insertion of the new artist
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    const newArtistId = inserted[0].id;
    console.log(`✅ Artist inserted: "${artistName}" (id=${newArtistId})`);

    // 7. Processing and linking genres
    try {
        const genres = await processArtistGenres(artistData);
        for (const genreObj of genres) {
            if (genreObj.id) {
                // ✨ DnB alias detected → direct link to the forced ID (437)
                await linkArtistGenre(newArtistId, genreObj.id);
                console.log(`   ↳ Linked artist to forced genre_id=${genreObj.id}`);
            } else {
                // Normal workflow for other genres
                const genreId = await insertGenreIfNew(genreObj);
                await linkArtistGenre(newArtistId, genreId);
                console.log(`   ↳ Linked artist to genre_id=${genreId}`);
            }
        }
    } catch (err) {
        console.error("❌ Error processing genres for artist:", artistName, err);
    }

    return newArtistId;
}

async function searchArtist(artistName, accessToken) {
    try {
        const url = `https://api.soundcloud.com/users?q=${encodeURIComponent(artistName)}&limit=1`;
        const response = await fetch(url, {
            headers: { "Authorization": `OAuth ${accessToken}` }
        });
        const data = await response.json();
        if (!data || data.length === 0) {
            console.log(`No SoundCloud artist found for: ${artistName}`);
            return null;
        }
        return data[0];
    } catch (error) {
        console.error("Error searching for artist on SoundCloud:", error);
        return null;
    }
}

async function extractArtistInfo(artist) {
    const bestImageUrl = await getBestImageUrl(artist.avatar_url);
    return {
        name: artist.username,
        image_url: bestImageUrl,
        description: artist.description,
        location_info: {
            country: artist.country || null,
            city: artist.city || null
        },
        external_links: {
            soundcloud: {
                link: artist.permalink_url,
                id: String(artist.id)
            }
        }
    };
}

// --- Create event_artist relation (unchanged) ---
async function createEventArtistRelation(eventId, artistId, artistObj) {
    if (!artistId) return;
    const artistIdStr = String(artistId);

    let startTime = null;
    let endTime = null;
    const stage = artistObj.stage || null;
    const customName = null;

    if (artistObj.time && artistObj.time.trim() !== "") {
        const match = artistObj.time.match(/(\d{1,2}:\d{2})-?(\d{1,2}:\d{2})?/);
        if (match) {
            const startStr = match[1];
            const endStr = match[2] || null;
            if (startStr) {
                startTime = `2025-06-27T${startStr}:00`;
            }
            if (endStr) {
                endTime = `2025-06-27T${endStr}:00`;
            }
        }
    }

    let query = supabase
        .from('event_artist')
        .select('*')
        .eq('event_id', eventId);

    if (stage === null) {
        query = query.is('stage', null);
    } else {
        query = query.eq('stage', stage);
    }
    query = query.is('custom_name', null);
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
    query = query.contains('artist_id', [artistIdStr]);

    const { data: existing, error } = await query;
    if (error) {
        console.error("Error during existence check:", error);
        throw error;
    }
    if (existing && existing.length > 0) {
        console.log(`➡️ A row already exists for artist_id=${artistIdStr} with the same performance details.`);
        return;
    }

    const row = {
        event_id: eventId,
        artist_id: [artistIdStr],
        start_time: startTime,
        end_time: endTime,
        status: 'confirmed',
        stage: stage,
        custom_name: customName
    };

    const { data, error: insertError } = await supabase
        .from('event_artist')
        .insert(row)
        .select();
    if (insertError) {
        console.error("Error creating event_artist relation:", insertError);
    } else {
        console.log(`➡️ Created event_artist relation for artist_id=${artistIdStr}`, data);
    }
}

// --- Utility function: delay ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- MAIN SCRIPT ---
async function main() {
    try {
        const eventUrl = process.argv[2];
        if (!eventUrl) {
            console.error('❌ Please specify a Facebook Events URL. Example:');
            console.error('   node importEvent.js https://www.facebook.com/events/1234567890');
            process.exit(1);
        }

        console.log("🔎 Scraping the Facebook event...");
        const eventData = await scrapeFbEvent(eventUrl);
        console.log(`✅ Scraped data for event: "${eventData.name}" (Facebook ID: ${eventData.id})`);

        const eventName = eventData.name || null;
        const eventDescription = eventData.description || null;
        const eventType = (eventData.categories && eventData.categories.length) ? eventData.categories[0].label : null;
        const startTimeISO = eventData.startTimestamp ? new Date(eventData.startTimestamp * 1000).toISOString() : null;
        const endTimeISO = eventData.endTimestamp ? new Date(eventData.endTimestamp * 1000).toISOString() : null;
        const fbEventUrl = eventData.url || eventUrl;

        const promotersList = eventData.hosts ? eventData.hosts.map(h => h.name) : [];

        const location = eventData.location || null;
        const venueName = location ? location.name : null;
        let venueAddress = location ? location.address : null;
        const venueCity = location && location.city ? location.city.name : null;
        const venueCountry = location ? location.countryCode : null;
        const venueLatitude = (location && location.coordinates) ? location.coordinates.latitude : null;
        const venueLongitude = (location && location.coordinates) ? location.coordinates.longitude : null;

        if (!venueAddress && venueName) {
            console.log(`\n🔍 No address found from Facebook for venue "${venueName}". Querying Google Maps...`);
            const googleResult = await fetchAddressFromGoogle(venueName);
            if (googleResult) {
                const googleLat = googleResult.geometry.location.lat;
                const googleLng = googleResult.geometry.location.lng;
                if (venueLatitude && venueLongitude) {
                    const distance = haversineDistance(venueLatitude, venueLongitude, googleLat, googleLng);
                    console.log(`Distance between FB and Google: ${distance.toFixed(2)} meters`);
                    const threshold = 500;
                    if (distance < threshold) {
                        venueAddress = googleResult.formatted_address;
                        console.log(`✅ Using Google address: ${venueAddress}`);
                    } else {
                        console.log("⚠️ Google address is too far from FB coordinates.");
                    }
                } else {
                    venueAddress = googleResult.formatted_address;
                    console.log(`✅ Using Google address (no FB coordinates): ${venueAddress}`);
                }
            }
            if (!venueAddress && venueLatitude && venueLongitude) {
                console.log(`\n🔍 No address from Google. Querying Nominatim reverse geocoding for coordinates ${venueLatitude}, ${venueLongitude}...`);
                const nominatimResult = await fetchAddressFromNominatim(venueLatitude, venueLongitude);
                if (nominatimResult) {
                    venueAddress = nominatimResult.display_name;
                    console.log(`✅ Using Nominatim address: ${venueAddress}`);
                }
            }
            if (!venueAddress) {
                console.log(`⚠️ No address found via Google Maps or Nominatim; using venue name "${venueName}" as address.`);
                venueAddress = venueName;
            }
        }

        // (1) Process promoters
        // We replace `promoterIds` with `promoterInfos`, which will contain { id, name, image_url }
        const promoterInfos = [];

        for (const promoterName of promotersList) {
            if (!promoterName) continue;

            console.log(`
🔍 Processing promoter "${promoterName}"...`);

            // Default value in DRY_RUN
            let info = { id: null, name: promoterName, image_url: null };

            if (DRY_RUN) {
                console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
            } else {
                // findOrInsertPromoter now returns { id, name, image_url }
                info = await findOrInsertPromoter(promoterName, eventData);
            }

            promoterInfos.push(info);
        }

        // Unique declaration of promoterIds, accessible throughout the script
        const promoterIds = promoterInfos
            .map(p => p.id)
            .filter(id => id);


        // (2) Process venue
        let venueId = null;
        if (venueName) {
            console.log(`\n🔍 Processing venue "${venueName}"...`);
            const normalizedVenueName = getNormalizedName(venueName);

            if (!DRY_RUN) {
                // 2A) Try find by exact address
                let { data: venuesByAddress, error: vAddrError } = await supabase
                    .from('venues')
                    .select('id, location, name')
                    .eq('location', venueAddress);
                if (vAddrError) throw vAddrError;

                if (venuesByAddress && venuesByAddress.length > 0) {
                    venueId = venuesByAddress[0].id;
                    console.log(`➡️ Venue found by address: "${venueAddress}" (id=${venueId}).`);
                } else {
                    // 2B) Try find by exact name
                    let { data: venuesByName, error: vNameError } = await supabase
                        .from('venues')
                        .select('id, name, location')
                        .eq('name', normalizedVenueName);
                    if (vNameError) throw vNameError;

                    if (venuesByName && venuesByName.length > 0) {
                        venueId = venuesByName[0].id;
                        console.log(`➡️ Venue "${normalizedVenueName}" found by exact name (id=${venueId}).`);
                    } else {
                        // 2C) Try fuzzy match against all venues
                        const { data: allVenues, error: allVenuesError } = await supabase
                            .from('venues')
                            .select('id, name, location');
                        if (allVenuesError) throw allVenuesError;

                        const match = allVenues.find(v =>
                            stringSimilarity.compareTwoStrings(
                                v.name.toLowerCase(),
                                normalizedVenueName.toLowerCase()
                            ) >= FUZZY_THRESHOLD
                        );
                        if (match) {
                            venueId = match.id;
                            console.log(`➡️ Venue "${normalizedVenueName}" is similar to "${match.name}" (id=${venueId}).`);
                        } else {
                            // 2D) Insert new venue
                            console.log(`➡️ No venue found for "${normalizedVenueName}". Inserting new venue...`);

                            // 2D-1) Address normalization via Node-Geocoder
                            let standardizedAddress = venueAddress;
                            try {
                                const geoResults = await geocoder.geocode(venueAddress);
                                if (geoResults && geoResults.length > 0) {
                                    const g = geoResults[0];
                                    // ad-hoc country mapping
                                    let country = g.country;
                                    if (country === 'België / Belgique / Belgien') {
                                        country = 'Belgium';
                                    }
                                    standardizedAddress = [
                                        g.streetNumber,
                                        g.streetName,
                                        g.city,
                                        g.zipcode,
                                        country
                                    ].filter(Boolean).join(', ');
                                    if (standardizedAddress.length > 0) {
                                        console.log(`✅ Standardized address: "${standardizedAddress}"`);
                                    } else {
                                        console.warn(`⚠️ Partial geocoding for address: "${venueAddress}" → ${JSON.stringify(g)}`);
                                    }
                                } else {
                                    console.warn(`   ⚠️ No geocoding result for "${venueAddress}", keeping the original.`);
                                }
                            } catch (errNorm) {
                                console.warn(`   ⚠️ Geocoding failed for "${venueAddress}": ${errNorm.message}`);
                            }
                            // ─────────────────────────────────────────────────

                            // 2D-2) Data preparation
                            const newVenueData = {
                                name: normalizedVenueName,
                                location: standardizedAddress,
                                geo: {}
                            };
                            if (venueCity) newVenueData.geo.locality = venueCity;
                            if (venueCountry) newVenueData.geo.country = venueCountry;
                            if (venueLatitude && venueLongitude) {
                                newVenueData.location_point = `SRID=4326;POINT(${venueLongitude} ${venueLatitude})`;
                            }

                            // 2D-3) Copy the promoter's image if the names match
                            const normVenue = normalizeNameEnhanced(normalizedVenueName).toLowerCase();
                            const matchingPromo = promoterInfos.find(p =>
                                p.image_url &&
                                normalizeNameEnhanced(p.name).toLowerCase() === normVenue
                            );
                            if (matchingPromo) {
                                newVenueData.image_url = matchingPromo.image_url;
                                console.log(
                                    `➡️ Copied image from promoter "${matchingPromo.name}" ` +
                                    `to new venue "${normalizedVenueName}".`
                                );
                            }

                            // 2D-4) If still no image, try Google Maps
                            if (!newVenueData.image_url) {
                                try {
                                    const photoUrl = await fetchGoogleVenuePhoto(venueName, venueAddress);
                                    newVenueData.image_url = photoUrl;
                                    console.log(`✅ image_url obtained via Google Maps for "${normalizedVenueName}"`);
                                } catch (err) {
                                    console.warn(`⚠️ Could not retrieve Google photo for id=${venueId}: ${err.message}`);
                                }
                            }

                            // 2D-5) Database insertion
                            const { data: newVenue, error: insertVenueError } = await supabase
                                .from('venues')
                                .insert(newVenueData)
                                .select('id');
                            if (insertVenueError || !newVenue || newVenue.length === 0) {
                                throw insertVenueError || new Error("Venue insertion failed");
                            }
                            venueId = newVenue[0].id;
                            console.log(`✅ New venue inserted: "${normalizedVenueName}" (id=${venueId}).`);
                        }
                    }
                }
            } else {
                console.log(`(DRY_RUN) Would find/insert venue "${venueName}" / Address: "${venueAddress}"`);
            }
        } else {
            console.log("\nℹ️ No venue information to insert (online event or venue not specified).");
        }

        // (3) Process event (check if exists then insert or update)
        console.log(`\n📝 Checking if event "${eventName}" already exists in the database...`);
        let eventId = null;

        if (!DRY_RUN) {
            // Search by URL
            const { data: eventsByUrl, error: eventsByUrlError } = await supabase
                .from('events')
                .select('id, metadata')
                .ilike('metadata->>facebook_url', fbEventUrl);
            if (eventsByUrlError) throw eventsByUrlError;

            if (eventsByUrl && eventsByUrl.length > 0) {
                eventId = eventsByUrl[0].id;
                console.log(`➡️ Event found by facebook_url (id=${eventId}).`);
            } else {
                // Search by title
                const { data: eventsByName, error: eventsByNameError } = await supabase
                    .from('events')
                    .select('id')
                    .eq('title', eventName);
                if (eventsByNameError) throw eventsByNameError;

                if (eventsByName && eventsByName.length > 0) {
                    eventId = eventsByName[0].id;
                    console.log(`➡️ Event found by title matching (id=${eventId}).`);
                }
            }

            if (eventId) {
                console.log("\n🔄 Event already exists. Checking for updates...");

                // --- NEW: get the existing record and compare ---
                const { data: existing, error: fetchErr } = await supabase
                    .from('events')
                    .select('description, date_time, end_date_time')
                    .eq('id', eventId)
                    .single();
                if (fetchErr) throw fetchErr;

                const updates = {};
                if (existing.description !== eventDescription) {
                    updates.description = eventDescription;
                }
                if (existing.date_time !== startTimeISO) {
                    updates.date_time = startTimeISO;
                }
                if (existing.end_date_time !== endTimeISO) {
                    updates.end_date_time = endTimeISO;
                }

                if (Object.keys(updates).length > 0) {
                    const { error: updateErr } = await supabase
                        .from('events')
                        .update(updates)
                        .eq('id', eventId);
                    if (updateErr) throw updateErr;
                    console.log(`🔄 Event (id=${eventId}) updated:`, updates);
                } else {
                    console.log(`ℹ️ Event (id=${eventId}) already up to date, no changes needed.`);
                }

                // … here you can continue with event_promoter, event_venue relations, etc.

            } else {
                // Insertion of a new event
                console.log(`\n📝 Inserting event "${eventName}" into the events table...`);
                const metadata = { facebook_url: fbEventUrl };
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
                const { data: newEvent, error: insertEventError } = await supabase
                    .from('events')
                    .insert(eventRecord)
                    .select();
                if (insertEventError || !newEvent) throw insertEventError || new Error("Event insertion failed");
                eventId = newEvent[0].id;
                console.log(`✅ Event inserted successfully (id=${eventId}).`);
            }

        } else {
            console.log(`(DRY_RUN) Would find/insert event "${eventName}"`);
            eventId = 999; // Example dummy ID
        }

        // (4) Create relations: event_promoter, event_venue, venue_promoter
        if (!DRY_RUN && eventId) {
            // event_promoter relations
            console.log("\n🔗 Ensuring event_promoter relations...");
            for (const pid of promoterIds) {
                await ensureRelation(
                    "event_promoter",
                    { event_id: eventId, promoter_id: pid },
                    "event_promoter"
                );
            }

            // event_venue relation
            if (venueId) {
                console.log("\n🔗 Ensuring event_venue relation...");
                await ensureRelation(
                    "event_venue",
                    { event_id: eventId, venue_id: venueId },
                    "event_venue"
                );
            }

            // venue_promoter relations
            if (venueId && venueName) {
                console.log("\n🔗 Ensuring venue_promoter relations...");
                for (const pInfo of promoterInfos) {
                    if (
                        pInfo.id &&
                        normalizeNameEnhanced(pInfo.name).toLowerCase() ===
                        normalizeNameEnhanced(venueName).toLowerCase()
                    ) {
                        await ensureRelation(
                            "venue_promoter",
                            { venue_id: venueId, promoter_id: pInfo.id },
                            "venue_promoter"
                        );
                    }
                }
            }
        }

        // (5) Extract artists via OpenAI using model "gpt-4o-mini"
        console.log("\n💬 Calling OpenAI to parse artists from event description...");
        let parsedArtists = [];
        if (eventDescription) {
            const systemPrompt = `
                You are an expert at extracting structured data from Facebook Event descriptions. Your task is to analyze the provided text and extract information solely about the artists. Assume that each line of the text (separated by line breaks) represents one artist's entry, unless it clearly contains a collaboration indicator (such as "B2B", "F2F", "B3B", or "VS"), in which case treat each artist separately. 

                For each artist identified, extract the following elements if they are present:
                - name: The name of the artist. IMPORTANT: Remove any trailing suffixes such as "A/V". In a line where the text starts with a numeric identifier followed by additional text (for example, "999999999 DOMINION A/V"), output only the numeric identifier. For other names, simply remove suffixes like " A/V" so that "I HATE MODELS A/V" becomes "I HATE MODELS".
                - time: The performance time, if mentioned.
                - soundcloud: The SoundCloud link for the artist, if provided.
                - stage: The stage associated with the artist (only one stage per artist).
                - performance_mode: The performance mode associated with the artist. Look for collaboration indicators (B2B, F2F, B3B, VS). If an artist is involved in a collaborative performance, record the specific mode here; otherwise leave this value empty.

                The output must be a valid JSON array where each artist is represented as an object with these keys. For example:
                [
                {
                    "name": "Reinier Zonneveld",
                    "time": "18:00",
                    "soundcloud": "",
                    "stage": "KARROSSERIE",
                    "performance_mode": ""
                }
                ]

                Additional Instructions:
                - Use only the provided text for extraction.
                - Treat each line as a separate artist entry unless a collaboration indicator suggests multiple names.
                - If any piece of information (time, SoundCloud link, stage, performance_mode) is missing, use an empty string.
                - The generated JSON must be valid and strictly follow the structure requested.
                - The output should be in English.
                `.trim();

            const userPrompt = `
Text to Analyze:

\`\`\`
${eventDescription}
\`\`\`
            `.trim();

            try {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini", // Using the gpt-4o-mini model
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    temperature: 0,
                    max_tokens: 2000,
                });
                let artistsJSON = response.choices[0].message?.content || '';
                // Remove any markdown backticks
                artistsJSON = artistsJSON
                    .replace(/^\s*```(json)?\s*/i, '')
                    .replace(/\s*```(\s*)?$/, '')
                    .trim();
                parsedArtists = JSON.parse(artistsJSON);
                console.log("➡️ OpenAI parsed artists:", parsedArtists);
                // Write OpenAI output to "artists.json" file
                fs.writeFileSync('artists.json', JSON.stringify(parsedArtists, null, 2));
            } catch (err) {
                console.error("❌ Could not parse artists from OpenAI response:", err);
            }

        } else {
            console.log("⚠️ No description found, skipping artist extraction.");
        }

        // (6) Import and create event_artist relations for each artist
        if (!DRY_RUN && eventId && parsedArtists.length > 0) {
            for (const artistObj of parsedArtists) {
                const artistName = (artistObj.name || '').trim();
                if (!artistName) {
                    console.log("⚠️ Skipping artist with no name:", artistObj);
                    continue;
                }
                let artistId = null;
                try {
                    artistId = await findOrInsertArtist(artistObj);
                } catch (e) {
                    console.error(`Error finding/inserting artist "${artistName}":`, e);
                    continue;
                }
                try {
                    await createEventArtistRelation(eventId, artistId, artistObj);
                } catch (e) {
                    console.error("Error linking artist to event:", e);
                }
            }
            console.log("✅ Completed full event import (with artists).");
        } else if (!DRY_RUN && parsedArtists.length === 0) {
            console.log("✅ Event import done. No artists found via OpenAI.");
        } else if (DRY_RUN) {
            console.log("✅ DRY_RUN completed. (No actual writes to the DB.)");
        }

        // --- (7) Post-processing: Deduce and assign event genres and promoter genres ---
        if (!DRY_RUN && eventId) {
            try {
                await assignEventGenres(eventId);
                console.log("✅ Event genres assigned.");
            } catch (err) {
                console.error("Error assigning event genres:", err);
            }
        }
        if (!DRY_RUN && promoterIds.length > 0) {
            for (const promoterId of promoterIds) {
                if (!promoterId) continue;
                try {
                    await assignPromoterGenres(promoterId);
                    console.log(`✅ Genres assigned for promoter id=${promoterId}.`);
                } catch (err) {
                    console.error(`Error assigning genres for promoter id=${promoterId}:`, err);
                }
            }
        }

    } catch (err) {
        console.error("❌ An error occurred:", err.message || err);
        process.exit(1);
    }
}

// 4) Start
main().catch(err => {
    console.error("❌ Unhandled error:", err);
    process.exit(1);
});
