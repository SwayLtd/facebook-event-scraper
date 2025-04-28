import 'dotenv/config';  // Load environment variables from a .env file if present
import fs from 'fs';
import fetch from 'node-fetch';  // Ensure node-fetch is installed
import stringSimilarity from 'string-similarity'; // For fuzzy matching
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';

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
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;    // Pour valider les tags/genres via Last.fm
const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';

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

// Normalize name using exceptions file
function getNormalizedName(originalName) {
    if (geocodingExceptions[originalName]) {
        return geocodingExceptions[originalName];
    }
    return originalName;
}

/*
 * Normalisation améliorée du nom d'artiste.
 * Supprime les caractères non alphanumériques situés au début ou à la fin,
 * sans retirer les symboles présents à l'intérieur (ex: "SANTØS" reste inchangé,
 * alors que "☆ fumi ☆" devient "fumi").
 */
function normalizeArtistNameEnhanced(name) {
    if (!name) return name;
    // Séparer les lettres des diacritiques
    let normalized = name.normalize('NFD');
    // Supprimer les marques diacritiques
    normalized = normalized.replace(/[\u0300-\u036f]/g, "");
    // Supprimer les caractères non alphanumériques en début et fin de chaîne
    normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return normalized;
}

// Initialize Supabase client
const supabase = createClient(supabaseUrl, serviceKey);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: openAIApiKey });

// --- SoundCloud Token Management ---
const TOKEN_FILE = 'soundcloud_token.json';

// Charger en mémoire les IDs des genres bannis
// Après avoir instancié `supabase = createClient(...)` :
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
 * Récupère les tracks d'un artiste depuis SoundCloud, en se basant sur l'ID SoundCloud.
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
 * Fonction utilitaire pour capitaliser chaque mot d'une chaîne.
 * Exemple : "hard techno" -> "Hard Techno"
 */
function capitalizeWords(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/**
 * Sépare un tag composé contenant des délimiteurs connus (" x ", " & ", " + ") en sous-tags.
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
 * Nettoie une description en retirant les balises HTML, la partie "Read more on Last.fm",
 * et supprime un éventuel " ." en fin de chaîne.
 * Si, après nettoyage, la description est trop courte (moins de 30 caractères), retourne "".
 */
function cleanDescription(desc) {
    if (!desc) return "";
    // 1. Supprimer toutes les balises HTML
    let text = desc.replace(/<[^>]*>/g, '').trim();
    // 2. Retirer "Read more on Last.fm"
    text = text.replace(/read more on last\.fm/gi, '').trim();
    // 3. Supprimer un résidu " ." en fin de description
    text = text.replace(/\s+\.\s*$/, '');
    // 4. Vérifier la longueur minimale
    return text.length < 30 ? "" : text;
}

/**
 * Vérifie via Last.fm si le tag correspond à un genre musical.
 * Retourne { valid, name, description, lastfmUrl }.
 * n’autorise que si la description contient "genre" ou "sub-genre"/"subgenre"
 * ou "<nom> music", et rejette si elle contient "umbrella term"
 * ou si le nom est une seule lettre.
 */
async function verifyGenreWithLastFM(tagName) {
    // rejeter noms à une seule lettre
    if (tagName.length === 1) {
        return { valid: false };
    }

    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodeURIComponent(tagName)}&api_key=${LASTFM_API_KEY}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data?.tag) return { valid: false };

        // Nettoyage initial et extraction du résumé
        const rawSummary = data.tag.wiki?.summary || "";
        const description = cleanDescription(rawSummary);
        if (!description) return { valid: false };

        const lowerDesc = description.toLowerCase();
        const lowerTag = tagName.toLowerCase();

        // Conditions d'acceptation
        const hasGenreWord = /(genre|sub-genre|subgenre)/.test(lowerDesc);
        const hasMusicPhrase = new RegExp(`${lowerTag}\\s+music`).test(lowerDesc);
        const isUmbrella = /umbrella term/.test(lowerDesc);

        if (isUmbrella || !(hasGenreWord || hasMusicPhrase)) {
            return { valid: false };
        }

        // Extraction de l’URL du tag
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
 * Cette fonction prend en paramètre un nom de genre (tel que récupéré depuis Last.fm ou une autre source)
 * et le reformate pour un affichage plus lisible. Elle applique d'abord une capitalisation mot par mot,
 * puis détecte et corrige certains cas particuliers (par exemple, si le nom ne contient pas d'espaces et contient
 * le mot "techno", elle insère un espace avant "Techno"). Ce raffinement permet d'obtenir des noms de genre tels que
 * "Hard Techno" au lieu de "Hardtechno" pour une meilleure clarté visuelle et une uniformité dans la base de données.
 *
 * @param {string} name - Le nom de genre à raffiner.
 * @returns {string} - Le nom de genre reformatté pour affichage (ex. "Hard Techno").
 */
function refineGenreName(name) {
    // Par défaut, on applique la capitalisation mot par mot
    let refined = name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());

    // Exemple de raffinement pour "techno" :
    // Si le nom ne contient pas d'espace mais inclut "techno", on insère un espace avant "Techno"
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(techno)$/i, (match, p1, p2) => {
            return p1.trim() + " " + p2.charAt(0).toUpperCase() + p2.slice(1).toLowerCase();
        });
    }
    // Vous pouvez ajouter d'autres conditions si nécessaire.

    return refined;
}

/**
 * Insère le genre dans la table "genres" s'il n'existe pas déjà.
 * D'abord, on vérifie via l'URL dans external_links ; si rien n'est trouvé, on vérifie par nom.
 * Retourne l'ID du genre.
 */
async function insertGenreIfNew(genreObject) {
    const { name, description, lastfmUrl } = genreObject;
    // On travaille ici avec le nom original pour le raffinement
    const normalizedName = name.toLowerCase();
    const genreSlug = slugifyGenre(normalizedName);

    // Récupérer tous les genres existants (pour détecter un doublon par slug ou external link)
    let { data: existingGenres, error: selectError } = await supabase
        .from('genres')
        .select('id, name, external_links');
    if (selectError) {
        console.error("[Genres] Error selecting genre:", selectError);
        throw selectError;
    }

    let duplicateGenre = null;
    // Vérification par external_links si disponible
    if (lastfmUrl) {
        duplicateGenre = existingGenres.find(g => g.external_links &&
            g.external_links.lastfm &&
            g.external_links.lastfm.link === lastfmUrl);
    }
    // Sinon, vérification par le slug du nom
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
    // Utilisation de refineGenreName pour obtenir le titre affiché souhaité
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
 * Lie un artiste à un genre dans la table pivot "artist_genre".
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
 * Extrait et normalise les tags d'un track.
 * On se base sur le champ "genre" et "tag_list". Renvoie un tableau de tags en minuscules.
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
    // Supprime tous les caractères non alphanumériques pour obtenir une version condensée.
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * Pour un artiste, utilise l'API SoundCloud pour récupérer ses tracks,
 * extrait les tags et vérifie via Last.fm lesquels correspondent à des genres musicaux.
 * Retourne un tableau d'objets genre validés.
 */
async function processArtistGenres(artistData) {
    const genresFound = [];

    // 1) Vérifier que l'artiste a bien un lien SoundCloud
    if (
        !artistData.external_links ||
        !artistData.external_links.soundcloud ||
        !artistData.external_links.soundcloud.id
    ) {
        console.log(`[Genres] No SoundCloud external link for "${artistData.name}"`);
        return genresFound;
    }

    // 2) Récupérer les tracks
    const soundcloudUserId = artistData.external_links.soundcloud.id;
    const token = await getAccessToken();
    if (!token) {
        console.log("[Genres] No SoundCloud token available");
        return genresFound;
    }
    const tracks = await fetchArtistTracks(soundcloudUserId, token);

    // 3) Extraire et dédupliquer tous les tags
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

    // 5) Parcourir chaque tag
    for (const rawTag of allTags) {
        const tag = rawTag.toLowerCase().trim();

        // 5a) Si alias, forcer l'ID 437
        if (aliasTagIds[tag]) {
            const id = aliasTagIds[tag];
            console.log(`[Genres] Alias DnB detected ("${tag}") → forcing genre_id ${id}`);
            if (!genresFound.some(g => g.id === id)) {
                genresFound.push({ id });
            }
            continue;
        }

        // 5b) Sinon, validation via Last.fm
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
 * Déduit les genres d'un événement à partir des artistes qui y participent.
 * Seules les occurrences d'un même genre atteignant MIN_GENRE_OCCURRENCE
 * ET NON bannies seront affectées à l'événement. Retourne la liste d'IDs retenus.
 */
async function assignEventGenres(eventId) {
    // 1) Récupérer les artists de l’event
    const { data: eventArtists, error: eaError } = await supabase
        .from('event_artist')
        .select('artist_id')
        .eq('event_id', eventId);
    if (eaError) throw eaError;

    // 2) Compter les genres
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

    // 3) Premier filtre : seuil + exclusion des bannis
    let topGenreIds = Object.entries(genreCounts)
        .filter(([genreId, count]) =>
            count >= MIN_GENRE_OCCURRENCE &&
            !bannedGenreIds.includes(Number(genreId))
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([genreId]) => Number(genreId));

    // 4) Fallback plus permissif : on ignore le seuil, mais pas les bannis
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([genreId]) => Number(genreId));

        console.log(
            `[Genres] Aucun genre ≥ ${MIN_GENRE_OCCURRENCE} occurences non-banni pour event ${eventId}, ` +
            `fallback top 3 sans seuil :`,
            topGenreIds
        );
    } else {
        console.log(
            `[Genres] Top genres pour event ${eventId} (seuil ${MIN_GENRE_OCCURRENCE}) :`,
            topGenreIds
        );
    }

    // 5) Enregistrer dans event_genre
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
 * Pour un promoteur, déduit ses genres via ses événements.
 * Seules les occurrences atteignant MIN_GENRE_OCCURRENCE et non bannies
 * seront affectées ; sinon, fallback sur le top 5.
 */
async function assignPromoterGenres(promoterId) {
    // 1) Récupérer les events du promoteur
    const { data: promoterEvents, error: peError } = await supabase
        .from('event_promoter')
        .select('event_id')
        .eq('promoter_id', promoterId);
    if (peError) throw peError;

    // 2) Compter les genres de ces events
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

    // 3) Premier filtre : seuil + exclusion des bannis
    let topGenreIds = Object.entries(genreCounts)
        .filter(([genreId, count]) =>
            count >= MIN_GENRE_OCCURRENCE &&
            !bannedGenreIds.includes(Number(genreId))
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([genreId]) => Number(genreId));

    // 4) Fallback plus permissif
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([genreId]) => Number(genreId));

        console.log(
            `[Genres] Aucun genre ≥ ${MIN_GENRE_OCCURRENCE} occurences non-banni pour promoteur ${promoterId}, ` +
            `fallback top 3 sans seuil :`,
            topGenreIds
        );
    } else {
        console.log(
            `[Genres] Top genres pour promoteur ${promoterId} (seuil ${MIN_GENRE_OCCURRENCE}) :`,
            topGenreIds
        );
    }

    // 5) Enregistrer dans promoter_genre
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
 * Recherche ou insère un promoteur, puis retourne { id, name, image_url }.
 */
async function findOrInsertPromoter(promoterName, eventData) {
    const normalizedName = getNormalizedName(promoterName);

    // 1) Exact match sur le nom
    const { data: exactMatches, error: exactError } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .eq('name', normalizedName);
    if (exactError) throw exactError;

    if (exactMatches && exactMatches.length > 0) {
        const p = exactMatches[0];
        console.log(`➡️ Promoter "${promoterName}" trouvé (exact) → id=${p.id}`);
        return { id: p.id, name: p.name, image_url: p.image_url };
    }

    // 2) Fuzzy match contre tous les promoteurs existants
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
                `➡️ Promoteur "${promoterName}" similaire à "${p.name}" → id=${p.id}`
            );
            return { id: p.id, name: p.name, image_url: p.image_url };
        }
    }

    // 3) Insertion d'un nouveau promoteur
    console.log(`➡️ Insertion d’un nouveau promoteur "${promoterName}"…`);
    const promoterSource = eventData.hosts.find(h => h.name === promoterName);
    const newPromoterData = { name: normalizedName };

    // tenter de récupérer une image haute résolution via Facebook Graph
    if (promoterSource?.id) {
        const highRes = await fetchHighResImage(promoterSource.id);
        if (highRes) newPromoterData.image_url = highRes;
    }

    // fallback sur photo.imageUri si disponible
    if (!newPromoterData.image_url && promoterSource?.photo?.imageUri) {
        newPromoterData.image_url = promoterSource.photo.imageUri;
    }

    const { data: inserted, error: insertError } = await supabase
        .from('promoters')
        .insert(newPromoterData)
        .select('id, name, image_url');
    if (insertError || !inserted || inserted.length === 0) {
        throw insertError || new Error('Échec de l’insertion du promoteur');
    }

    const created = inserted[0];
    console.log(
        `✅ Promoteur inséré : "${promoterName}" → id=${created.id}`
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

    // 1. Normalisation du nom
    artistName = normalizeArtistNameEnhanced(artistName);

    // 2. Recherche sur SoundCloud
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(artistName, token);
    }

    // 3. Construction de l'objet artistData
    let artistData;
    if (scArtist) {
        // Si trouvé sur SC, extraire les infos enrichies
        artistData = await extractArtistInfo(scArtist);
    } else {
        // Sinon fallback minimal
        artistData = {
            name: artistName,
            external_links: artistObj.soundcloud
                ? { soundcloud: { link: artistObj.soundcloud } }
                : null,
        };
    }

    // 4. Détection de doublons via lien SoundCloud
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

    // 5. Détection de doublons via nom
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('id')
        .ilike('name', artistName);
    if (nameError) throw nameError;
    if (existingByName.length > 0) {
        console.log(`➡️ Artist exists by name: "${artistName}" (id=${existingByName[0].id})`);
        return existingByName[0].id;
    }

    // 6. Insertion du nouvel artiste
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    const newArtistId = inserted[0].id;
    console.log(`✅ Artist inserted: "${artistName}" (id=${newArtistId})`);

    // 7. Traitement des genres et liaison
    try {
        const genres = await processArtistGenres(artistData);
        for (const genreObj of genres) {
            if (genreObj.id) {
                // ✨ Alias DnB détecté → liaison directe sur l'ID forcé (437)
                await linkArtistGenre(newArtistId, genreObj.id);
                console.log(`   ↳ Linked artist to forced genre_id=${genreObj.id}`);
            } else {
                // Workflow normal pour les autres genres
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
        // On remplace `promoterIds` par `promoterInfos`, qui contiendra { id, name, image_url }
        const promoterInfos = [];

        for (const promoterName of promotersList) {
            if (!promoterName) continue;

            console.log(`\n🔍 Processing promoter "${promoterName}"...`);

            // Valeur par défaut en DRY_RUN
            let info = { id: null, name: promoterName, image_url: null };

            if (DRY_RUN) {
                console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
            } else {
                // findOrInsertPromoter renvoie désormais { id, name, image_url }
                info = await findOrInsertPromoter(promoterName, eventData);
            }

            promoterInfos.push(info);
        }

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
                            const newVenueData = {
                                name: normalizedVenueName,
                                location: venueAddress
                            };
                            const geo = {};
                            if (venueCity) geo.locality = venueCity;
                            if (venueCountry) geo.country = venueCountry;
                            if (Object.keys(geo).length) newVenueData.geo = geo;
                            if (venueLatitude && venueLongitude) {
                                newVenueData.location_point = `SRID=4326;POINT(${venueLongitude} ${venueLatitude})`;
                            }

                            // ---- COPY PROMOTER IMAGE IF NAMES MATCH ----
                            // normalize for comparison
                            const normVenue = normalizeArtistNameEnhanced(normalizedVenueName).toLowerCase();
                            const matchingPromo = promoterInfos.find(p =>
                                p.image_url &&
                                normalizeArtistNameEnhanced(p.name).toLowerCase() === normVenue
                            );
                            if (matchingPromo) {
                                newVenueData.image_url = matchingPromo.image_url;
                                console.log(
                                    `➡️ Copied image from promoter "${matchingPromo.name}" ` +
                                    `to new venue "${normalizedVenueName}".`
                                );
                            }
                            // --------------------------------------------

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
            // Recherche par URL
            const { data: eventsByUrl, error: eventsByUrlError } = await supabase
                .from('events')
                .select('id, metadata')
                .ilike('metadata->>facebook_url', fbEventUrl);
            if (eventsByUrlError) throw eventsByUrlError;

            if (eventsByUrl && eventsByUrl.length > 0) {
                eventId = eventsByUrl[0].id;
                console.log(`➡️ Event found by facebook_url (id=${eventId}).`);
            } else {
                // Recherche par titre
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

                // --- NOUVEAU : récupérer l'existant et comparer ---
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
                    console.log(`🔄 Event (id=${eventId}) mis à jour:`, updates);
                } else {
                    console.log(`ℹ️ Event (id=${eventId}) déjà à jour, pas de modification nécessaire.`);
                }

                // … ici vous pouvez continuer avec les relations event_promoter, event_venue, etc.

            } else {
                // Insertion d'un nouvel événement
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
            if (promoterIds.length > 0) {
                console.log("\n🔗 Ensuring event_promoter relations...");
                for (const pid of promoterIds) {
                    if (!pid) continue;
                    await ensureRelation("event_promoter", { event_id: eventId, promoter_id: pid }, "event_promoter");
                }
            }
            if (venueId) {
                console.log("\n🔗 Ensuring event_venue relation...");
                await ensureRelation("event_venue", { event_id: eventId, venue_id: venueId }, "event_venue");
            }
            if (venueId && venueName) {
                const matchingIndexes = promotersList.reduce((indexes, name, idx) => {
                    if (name === venueName) indexes.push(idx);
                    return indexes;
                }, []);
                for (const idx of matchingIndexes) {
                    const promoterId = promoterIds[idx];
                    if (!promoterId) continue;
                    await ensureRelation("venue_promoter", { venue_id: venueId, promoter_id: promoterId }, "venue_promoter");
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
                // Écriture de la sortie OpenAI dans le fichier "artists.json"
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

main();
