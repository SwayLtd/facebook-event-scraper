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
const MIN_GENRE_OCCURRENCE = 3;

const bannedGenres = ["other", "remix", "track", "podcast", "dance", "set"];

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
 * Nettoie une description en retirant les balises HTML et en supprimant la partie "Read more on Last.fm".
 * Si, après nettoyage, la description est trop courte (moins de 30 caractères), retourne une chaîne vide.
 */
function cleanDescription(desc) {
    if (!desc) return "";
    // Supprimer toutes les balises HTML
    let text = desc.replace(/<[^>]*>/g, '').trim();
    // Retirer toute occurrence de "Read more on Last.fm" (insensible à la casse)
    text = text.replace(/read more on last\.fm/gi, '').trim();
    // Si le texte est trop court, on considère qu'il n'y a pas de description utile
    if (text.length < 30) {
        return "";
    }
    return text;
}

/**
 * Vérifie via Last.fm si le tag correspond à un genre musical.
 * Extrait, si présent, l'URL du genre depuis la partie HTML du wiki.summary.
 * Retourne un objet { valid: boolean, name: string, description: string, lastfmUrl: string }.
 */
async function verifyGenreWithLastFM(tagName) {
    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodeURIComponent(tagName)}&api_key=${LASTFM_API_KEY}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        // Optionnel : vous pouvez commenter ou décommenter ce log
        // console.log(`[Genres] Last.fm API response for tag "${tagName}": ${JSON.stringify(data)}`);
        if (data && data.tag) {
            // Récupérer le wiki summary et nettoyer la description
            const wikiSummary = data.tag.wiki ? data.tag.wiki.summary : "";

            // Extraire l'URL contenue dans la balise <a href="...">
            let extractedUrl = "";
            const linkMatch = wikiSummary.match(/<a href="([^"]+)">/);
            if (linkMatch && linkMatch[1]) {
                extractedUrl = linkMatch[1];
            } else {
                // Si aucun lien n'est trouvé, utiliser data.tag.url
                extractedUrl = data.tag.url || "";
            }

            // Nettoyer la description en retirant les balises HTML et la partie "Read more on Last.fm"
            const cleanDesc = cleanDescription(wikiSummary);

            return {
                valid: true,
                name: data.tag.name.toLowerCase(), // conversion en minuscule pour la comparaison
                description: cleanDesc,
                lastfmUrl: extractedUrl
            };
        }
    } catch (error) {
        console.error("[Genres] Error verifying genre with Last.fm for tag:", tagName, error);
    }
    return { valid: false };
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
    let genresFound = [];
    if (!artistData.external_links || !artistData.external_links.soundcloud || !artistData.external_links.soundcloud.id) {
        console.log(`[Genres] No SoundCloud external link found for artist "${artistData.name}"`);
        return genresFound;
    }
    const soundcloudUserId = artistData.external_links.soundcloud.id;
    const token = await getAccessToken();
    if (!token) {
        console.log("[Genres] No SoundCloud token available");
        return genresFound;
    }
    const tracks = await fetchArtistTracks(soundcloudUserId, token);
    let allTags = [];
    for (const track of tracks) {
        let tags = extractTagsFromTrack(track);
        // Pour chaque tag, s'il s'agit d'un tag composé, le diviser en sous-tags
        let splitted = [];
        tags.forEach(tag => {
            splitted = splitted.concat(splitCompoundTags(tag));
        });
        // Filtrer les tags qui ne contiennent pas au moins une lettre (par exemple "240")
        splitted = splitted.filter(tag => /[a-zA-Z]/.test(tag));
        allTags = allTags.concat(splitted);
    }
    // Conserver uniquement les tags uniques
    allTags = Array.from(new Set(allTags));
    // console.log(`[Genres] Aggregated unique tags for artist "${artistData.name}": ${JSON.stringify(allTags)}`);

    // Vérifier chaque tag via Last.fm
    for (const tag of allTags) {
        console.log(`[Genres] Verifying tag "${tag}" via Last.fm...`);
        const genreVerification = await verifyGenreWithLastFM(tag);
        // console.log(`[Genres] Last.fm result for tag "${tag}": ${JSON.stringify(genreVerification)}`);
        if (genreVerification.valid && genreVerification.description) {
            // Filtrer les genres génériques (en comparant en slug)
            const genreSlug = slugifyGenre(genreVerification.name);
            if (bannedGenres.includes(genreSlug)) {
                console.log(`[Genres] Genre "${genreVerification.name}" skipped: generic genre.`);
                continue;
            }
            genresFound.push({
                name: genreVerification.name, // stocké en minuscule pour la comparaison
                description: genreVerification.description,
                lastfmUrl: genreVerification.lastfmUrl
            });
        } else {
            console.log(`[Genres] Tag "${tag}" skipped: not a valid genre or description deemed insufficient.`);
        }
    }

    console.log(`[Genres] Final genres found for artist "${artistData.name}": ${JSON.stringify(genresFound)}`);
    return genresFound;
}

/**
 * Déduit les genres d'un événement à partir des artistes qui y participent.
 * Seules les occurrences d'un même genre atteignant MIN_GENRE_OCCURRENCE seront affectées à l'événement.
 * Retourne une liste unique d'ID de genres retenus.
 */
async function assignEventGenres(eventId) {
    // Récupérer toutes les liaisons artist-genre pour les artistes de l'événement.
    const { data: eventArtists, error: eaError } = await supabase
        .from('event_artist')
        .select('artist_id');
    if (eaError) throw eaError;

    // Compteur de fréquence pour les genres
    const genreCounts = {};

    for (const row of eventArtists) {
        // Chaque row.artist_id est un tableau de chaînes
        for (const aid of row.artist_id) {
            const { data: artistGenres, error: agError } = await supabase
                .from('artist_genre')
                .select('genre_id')
                .eq('artist_id', parseInt(aid));
            if (agError) throw agError;
            if (artistGenres) {
                artistGenres.forEach(g => {
                    const genreId = g.genre_id;
                    genreCounts[genreId] = (genreCounts[genreId] || 0) + 1;
                });
            }
        }
    }

    // Filtrer pour ne conserver que les genres atteignant le seuil
    const retainedGenreIds = Object.keys(genreCounts)
        .filter(genreId => genreCounts[genreId] >= MIN_GENRE_OCCURRENCE);

    console.log(`[Genres] Aggregated genre IDs for event ${eventId} (threshold ${MIN_GENRE_OCCURRENCE}): ${JSON.stringify(retainedGenreIds)}`);

    for (const genreId of retainedGenreIds) {
        await ensureRelation("event_genre", { event_id: eventId, genre_id: genreId }, "event_genre");
    }
    return retainedGenreIds;
}

/**
 * Pour un promoteur, déduit les genres en se basant sur l'ensemble des événements auxquels il participe.
 * Seules les occurrences d'un même genre atteignant MIN_GENRE_OCCURRENCE seront affectées au promoteur.
 */
async function assignPromoterGenres(promoterId) {
    // Récupérer les événements liés au promoteur
    const { data: promoterEvents, error: peError } = await supabase
        .from('event_promoter')
        .select('event_id')
        .eq('promoter_id', promoterId);
    if (peError) throw peError;

    // Compter la fréquence des genres pour l'ensemble des événements du promoteur
    const genreCounts = {};
    for (const row of promoterEvents) {
        const { data: eventGenres, error: egError } = await supabase
            .from('event_genre')
            .select('genre_id')
            .eq('event_id', row.event_id);
        if (egError) throw egError;
        if (eventGenres) {
            eventGenres.forEach(g => {
                genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
            });
        }
    }

    // Garder uniquement les genres dont la fréquence est >= MIN_GENRE_OCCURRENCE
    const retainedGenreIds = Object.keys(genreCounts)
        .filter(genreId => genreCounts[genreId] >= MIN_GENRE_OCCURRENCE);

    console.log(`[Genres] Aggregated genre IDs for promoter ${promoterId} (threshold ${MIN_GENRE_OCCURRENCE}): ${JSON.stringify(retainedGenreIds)}`);

    // Créer la relation dans la table pivot pour chacun des genres retenus
    for (const genreId of retainedGenreIds) {
        await ensureRelation("promoter_genre", { promoter_id: promoterId, genre_id: genreId }, "promoter_genre");
    }
}

// --- Existing Manage Promoters (unchanged) ---
async function findOrInsertPromoter(promoterName, eventData) {
    const normalizedName = getNormalizedName(promoterName);
    const { data: exactMatches, error: exactError } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .eq('name', normalizedName);
    if (exactError) throw exactError;
    if (exactMatches && exactMatches.length > 0) {
        console.log(`➡️ Promoter "${promoterName}" (normalized as "${normalizedName}") found by exact match (id=${exactMatches[0].id}).`);
        return exactMatches[0].id;
    }
    const { data: allPromoters, error: allError } = await supabase
        .from('promoters')
        .select('id, name, image_url');
    if (allError) throw allError;
    if (allPromoters && allPromoters.length > 0) {
        const matches = stringSimilarity.findBestMatch(normalizedName.toLowerCase(), allPromoters.map(p => p.name.toLowerCase()));
        const bestMatch = matches.bestMatch;
        if (bestMatch.rating >= FUZZY_THRESHOLD) {
            const matchedPromoter = allPromoters[matches.bestMatchIndex];
            console.log(`➡️ Promoter "${promoterName}" (normalized as "${normalizedName}") is similar to existing promoter "${matchedPromoter.name}" (id=${matchedPromoter.id}).`);
            return matchedPromoter.id;
        }
    }
    console.log(`➡️ Promoter "${promoterName}" not found by fuzzy matching. Inserting new promoter...`);
    const promoterSource = eventData.hosts.find(h => h.name === promoterName);
    const newPromoterData = { name: normalizedName };
    if (promoterSource && promoterSource.id) {
        const highResUrl = await fetchHighResImage(promoterSource.id);
        if (highResUrl) newPromoterData.image_url = highResUrl;
    }
    if (!newPromoterData.image_url && promoterSource && promoterSource.photo && promoterSource.photo.imageUri) {
        newPromoterData.image_url = promoterSource.photo.imageUri;
    }
    const { data: newPromoter, error: insertPromoterError } = await supabase
        .from('promoters')
        .insert(newPromoterData)
        .select();
    if (insertPromoterError || !newPromoter) throw insertPromoterError || new Error("Promoter insertion failed");
    console.log(`✅ New promoter inserted: "${promoterName}" (normalized as "${normalizedName}") (id=${newPromoter[0].id}).`);
    return newPromoter[0].id;
}

// --- Manage Artists ---
// --- Manage Artists ---
async function findOrInsertArtist(artistObj) {
    // artistObj: { name, time, soundcloud, stage, performance_mode }
    let artistName = (artistObj.name || '').trim();
    if (!artistName) return null;

    // Normalisation du nom pour enlever les caractères parasites et diacritiques
    artistName = normalizeArtistNameEnhanced(artistName);

    // Obtenir le token SoundCloud et chercher l'artiste sur SoundCloud
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(artistName, token);
    }
    let artistData = null;
    if (scArtist) {
        // extractArtistInfo retourne l'objet tel que fourni par l'API SoundCloud
        artistData = await extractArtistInfo(scArtist);
    } else {
        // Fallback : utiliser les données fournies par le prompt OpenAI
        artistData = {
            name: artistName,
            external_links: artistObj.soundcloud ? { soundcloud: { link: artistObj.soundcloud } } : null,
        };
    }

    // Vérification des doublons via le lien externe SoundCloud
    if (artistData.external_links && artistData.external_links.soundcloud && artistData.external_links.soundcloud.id) {
        const { data: existingByExternal, error: extError } = await supabase
            .from('artists')
            .select('*')
            .eq('external_links->soundcloud->>id', artistData.external_links.soundcloud.id);
        if (extError) throw extError;
        if (existingByExternal && existingByExternal.length > 0) {
            console.log(`➡️ Artist already exists (matched by external link): "${artistName}" (id=${existingByExternal[0].id}).`);
            return existingByExternal[0].id;
        }
    }

    // Vérification des doublons via le nom
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('*')
        .ilike('name', artistName);
    if (nameError) throw nameError;
    if (existingByName && existingByName.length > 0) {
        console.log(`➡️ Artist already exists by name: "${artistName}" (id=${existingByName[0].id}).`);
        return existingByName[0].id;
    }

    // Insertion du nouvel artiste
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    console.log(`✅ Artist inserted: name="${artistName}", id=${inserted[0].id}`);

    const newArtistId = inserted[0].id;

    // Traitement des genres et liaison avec l'artiste
    try {
        const genres = await processArtistGenres(artistData);
        for (const genreObj of genres) {
            const genreId = await insertGenreIfNew(genreObj);
            await linkArtistGenre(newArtistId, genreId);
        }
    } catch (err) {
        console.error("Error processing genres for artist:", artistName, err);
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
        const promoterIds = [];
        for (const promoterName of promotersList) {
            if (!promoterName) continue;
            console.log(`\n🔍 Processing promoter "${promoterName}"...`);
            let promoterId = null;
            if (DRY_RUN) {
                console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
            } else {
                promoterId = await findOrInsertPromoter(promoterName, eventData);
            }
            promoterIds.push(promoterId);
        }

        // (2) Process venue
        let venueId = null;
        if (venueName) {
            console.log(`\n🔍 Processing venue "${venueName}"...`);
            const normalizedVenueName = getNormalizedName(venueName);
            if (!DRY_RUN) {
                let { data: venuesByAddress, error: vAddrError } = await supabase
                    .from('venues')
                    .select('id, location, name')
                    .eq('location', venueAddress);
                if (vAddrError) throw vAddrError;
                if (venuesByAddress && venuesByAddress.length > 0) {
                    venueId = venuesByAddress[0].id;
                    console.log(`➡️ Venue found by address (location): "${venueAddress}" (id=${venueId}).`);
                } else {
                    let { data: venuesByName, error: vNameError } = await supabase
                        .from('venues')
                        .select('id, name, location')
                        .eq('name', normalizedVenueName);
                    if (vNameError) throw vNameError;
                    if (venuesByName && venuesByName.length > 0) {
                        venueId = venuesByName[0].id;
                        console.log(`➡️ Venue "${normalizedVenueName}" found by exact name (id=${venueId}).`);
                    } else {
                        const { data: allVenues, error: allVenuesError } = await supabase
                            .from('venues')
                            .select('id, name, location');
                        if (allVenuesError) throw allVenuesError;
                        const match = allVenues.find(v => stringSimilarity.compareTwoStrings(v.name.toLowerCase(), normalizedVenueName.toLowerCase()) >= FUZZY_THRESHOLD);
                        if (match) {
                            venueId = match.id;
                            console.log(`➡️ Venue "${normalizedVenueName}" is similar to existing venue "${match.name}" (id=${venueId}).`);
                        } else {
                            console.log(`➡️ No venue found for "${normalizedVenueName}". Inserting new venue...`);
                            const newVenueData = { name: normalizedVenueName, location: venueAddress };
                            const geo = {};
                            if (venueCity) geo.locality = venueCity;
                            if (venueCountry) geo.country = venueCountry;
                            if (Object.keys(geo).length > 0) newVenueData.geo = geo;
                            if (venueLatitude && venueLongitude) {
                                newVenueData.location_point = `SRID=4326;POINT(${venueLongitude} ${venueLatitude})`;
                            }
                            const promoterSource = eventData.hosts.find(h => getNormalizedName(h.name) === normalizedVenueName);
                            if (promoterSource && promoterSource.id) {
                                const highResUrl = await fetchHighResImage(promoterSource.id);
                                if (highResUrl) {
                                    newVenueData.image_url = highResUrl;
                                    console.log(`➡️ No image for venue, using high-res promoter image from Graph API.`);
                                }
                            }
                            const { data: newVenue, error: insertVenueError } = await supabase
                                .from('venues')
                                .insert(newVenueData)
                                .select();
                            if (insertVenueError || !newVenue) throw insertVenueError || new Error("Venue insertion failed");
                            venueId = newVenue[0].id;
                            console.log(`✅ New venue inserted: "${normalizedVenueName}" (id=${venueId}).`);
                        }
                    }
                }
            } else {
                console.log(`(DRY_RUN) Would find/insert venue: "${venueName}" / Address: "${venueAddress}"`);
            }
        } else {
            console.log("\nℹ️ No venue information to insert (online event or venue not specified).");
        }

        // (3) Process event (check if exists then insert or update)
        console.log(`\n📝 Checking if event "${eventName}" already exists in the database...`);
        let eventId = null;
        if (!DRY_RUN) {
            const { data: eventsByUrl, error: eventsByUrlError } = await supabase
                .from('events')
                .select('id, metadata')
                .ilike('metadata->>facebook_url', fbEventUrl);
            if (eventsByUrlError) throw eventsByUrlError;
            if (eventsByUrl && eventsByUrl.length > 0) {
                eventId = eventsByUrl[0].id;
                console.log(`➡️ Event found by facebook_url (id=${eventId}).`);
            } else {
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
                console.log("\n🔄 Event already exists. Updating missing relations...");
            } else {
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
