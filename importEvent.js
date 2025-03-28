import 'dotenv/config';  // Load environment variables from a .env file if present
import fs from 'fs';
import fetch from 'node-fetch';  // Assurez-vous d'installer node-fetch
import stringSimilarity from 'string-similarity'; // Pour le fuzzy matching
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';

// Imports OpenAI
import OpenAI from 'openai';

// --- Paramètres globaux ---
const DRY_RUN = false;            // Change to true for dry-run mode (no DB insertion)
const FUZZY_THRESHOLD = 0.75;     // Seuil de similarité pour le fuzzy matching

// Lecture des variables d'environnement
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const longLivedToken = process.env.LONG_LIVED_TOKEN;  // Graph API (FB) Long-Lived Token
const googleApiKey = process.env.GOOGLE_API_KEY;      // Google Maps API key
const openAIApiKey = process.env.OPENAI_API_KEY;      // OpenAI Key
const SOUND_CLOUD_CLIENT_ID = process.env.SOUND_CLOUD_CLIENT_ID;
const SOUND_CLOUD_CLIENT_SECRET = process.env.SOUND_CLOUD_CLIENT_SECRET;
const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';

// Vérifications de base
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

// Charger les exceptions depuis geocoding_exceptions.json
let geocodingExceptions = {};
try {
    geocodingExceptions = JSON.parse(fs.readFileSync('geocoding_exceptions.json', 'utf8'));
} catch (err) {
    console.error("Error loading geocoding_exceptions.json:", err);
}

// Normaliser un nom via un fichier d'exceptions
function getNormalizedName(originalName) {
    if (geocodingExceptions[originalName]) {
        return geocodingExceptions[originalName];
    }
    return originalName;
}

// Initialisation Supabase
const supabase = createClient(supabaseUrl, serviceKey);

// Initialisation OpenAI
const openai = new OpenAI({ apiKey: openAIApiKey });

// --- Gestion du token SoundCloud ---
// Fichier pour stocker temporairement le token
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

// --- Fonctions de géocodage / fetch images (inchangées) ---
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

// Calcul de distance avec la formule de Haversine
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

// --- Fonction getBestImageUrl (adaptée depuis import_artist.js) ---
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

// --- Vérification/Insertion dans une table pivot ---
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

// --- Gestion des Promoteurs (inchangé) ---
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

// --- Gestion des Artistes ---
// Recherche sur SoundCloud et insertion dans la table artists
async function findOrInsertArtist(artistObj) {
    // artistObj: { name, time, soundcloud, stage, performance_mode }
    const artistName = (artistObj.name || '').trim();
    if (!artistName) return null;

    // Obtenir un token SoundCloud et rechercher l'artiste
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(artistName, token);
    }
    let artistData = null;
    if (scArtist) {
        artistData = await extractArtistInfo(scArtist);
    } else {
        // Fallback: utiliser les infos du prompt OpenAI
        artistData = {
            name: artistName,
            external_links: artistObj.soundcloud ? { soundcloud: { link: artistObj.soundcloud } } : null,
        };
    }

    // Vérifier par external_links si possible
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

    // Vérifier par nom
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('*')
        .ilike('name', artistName);
    if (nameError) throw nameError;
    if (existingByName && existingByName.length > 0) {
        console.log(`➡️ Artist already exists by name: "${artistName}" (id=${existingByName[0].id}).`);
        return existingByName[0].id;
    }

    // Sinon, insérer
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    console.log(`✅ Artist inserted: name="${artistName}", id=${inserted[0].id}`);
    return inserted[0].id;
}

// Fonction pour interroger SoundCloud pour un artiste
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

// Création de la relation event_artist
async function createEventArtistRelation(eventId, artistId, artistObj) {
    if (!artistId) return;

    let startTime = null;
    let endTime = null;
    let customName = artistObj.performance_mode || null;
    let stage = artistObj.stage || null;

    if (artistObj.time) {
        // Exemple : "21:30-22:30"
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

    // Vérifier si une relation identique existe déjà (sauf pour les cas avec horaires différents)
    if (!startTime && !endTime) {
        const { data: existing, error } = await supabase
            .from('event_artist')
            .select('*')
            .match({ event_id: eventId, stage: stage, custom_name: customName });
        if (error) throw error;
        if (existing && existing.length > 0) {
            for (let rel of existing) {
                if (rel.artist_id && rel.artist_id.includes(artistId)) {
                    console.log(`➡️ event_artist relation already exists for artist_id=${artistId} with no performance time.`);
                    return;
                }
            }
        }
    }

    const row = {
        event_id: eventId,
        artist_id: [artistId],
        start_time: startTime,
        end_time: endTime,
        status: 'confirmed',
        stage: stage || null,
        custom_name: customName || null,
    };

    const { data, error } = await supabase
        .from('event_artist')
        .insert(row)
        .select();
    if (error) {
        console.error("Error creating event_artist relation:", error);
    } else {
        console.log(`➡️ Created event_artist relation for artist_id=${artistId}`, data);
    }
}

// --- Fonction utilitaire : délai ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- SCRIPT PRINCIPAL ---
async function main() {
    try {
        // Récupération de l'URL de l'événement
        const eventUrl = process.argv[2];
        if (!eventUrl) {
            console.error('❌ Please specify a Facebook Events URL. Example:');
            console.error('   node importEvent.js https://www.facebook.com/events/1234567890');
            process.exit(1);
        }

        console.log("🔎 Scraping the Facebook event...");
        const eventData = await scrapeFbEvent(eventUrl);
        console.log(`✅ Scraped data for event: "${eventData.name}" (Facebook ID: ${eventData.id})`);

        // --- Transformation des données standard (promoteurs, lieu, date...) ---
        const eventName = eventData.name || null;
        const eventDescription = eventData.description || null;
        const eventType = (eventData.categories && eventData.categories.length) ? eventData.categories[0].label : null;
        const startTimeISO = eventData.startTimestamp ? new Date(eventData.startTimestamp * 1000).toISOString() : null;
        const endTimeISO = eventData.endTimestamp ? new Date(eventData.endTimestamp * 1000).toISOString() : null;
        const fbEventUrl = eventData.url || eventUrl;

        // --- Promoteurs ---
        const promotersList = eventData.hosts ? eventData.hosts.map(h => h.name) : [];

        // --- Lieu ---
        const location = eventData.location || null;
        const venueName = location ? location.name : null;
        let venueAddress = location ? location.address : null;
        const venueCity = location && location.city ? location.city.name : null;
        const venueCountry = location ? location.countryCode : null;
        const venueLatitude = (location && location.coordinates) ? location.coordinates.latitude : null;
        const venueLongitude = (location && location.coordinates) ? location.coordinates.longitude : null;

        // Vérification d'adresse via Google Maps, Nominatim, etc.
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

        // (1) Gérer/insérer promoteurs
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

        // (2) Gérer/insérer la venue
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

        // (3) Vérifier ou insérer l'événement
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
            eventId = 999; // Exemple fictif
        }

        // (4) Relations event_promoter, event_venue, venue_promoter
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

        // (5) Extraction des artistes via OpenAI
        console.log("\n💬 Calling OpenAI to parse artists from event description...");
        let parsedArtists = [];
        if (eventDescription) {
            const systemPrompt = `
You are an expert at extracting structured data from Facebook Event descriptions. Your task is to analyze the provided text and extract information solely about the artists, generating a valid JSON output. For each artist identified, extract the following elements if they are present:

- name: The name of the artist.
- time: The performance time, if mentioned.
- soundcloud: The SoundCloud link for the artist, if provided.
- stage: The stage associated with the artist (only one stage per artist).
- performance_mode: The performance mode associated with the artist. Look for indicators like "B2B", "F2F", "B3B", or "VS". If an artist is involved in a collaborative performance (e.g., B2B, F2F, B3B, or VS), record the specific mode here. If no such label is found, leave this value empty.

The output must be a JSON array where each artist is represented as an object with these keys, for example:
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
- If any piece of information (time, SoundCloud link, stage, or performance_mode) is missing, you may leave the value as an empty string.
- Ensure that artists indicated with collaboration modes (B2B, F2F, B3B, or VS) are individually extracted with the corresponding performance_mode value.
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
                    model: "gpt-4o-mini", // Utilisation du modèle gpt-4o-mini
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    temperature: 0,
                    max_tokens: 2000,
                });
                let artistsJSON = response.choices[0].message?.content || '';
                // Nettoyage d'éventuels backticks
                artistsJSON = artistsJSON
                    .replace(/^\s*```(json)?\s*/i, '')
                    .replace(/\s*```(\s*)?$/, '')
                    .trim();
                parsedArtists = JSON.parse(artistsJSON);
                console.log("➡️ OpenAI parsed artists:", parsedArtists);
            } catch (err) {
                console.error("❌ Could not parse artists from OpenAI response:", err);
            }

        } else {
            console.log("⚠️ No description found, skipping artist extraction.");
        }

        // (6) Importation et création des relations event_artist pour les artistes
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

    } catch (err) {
        console.error("❌ An error occurred:", err.message || err);
        process.exit(1);
    }
}

// Lancement
main();
