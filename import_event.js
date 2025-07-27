import 'dotenv/config';  // Load environment variables from a .env file if present
import fs from 'fs';
import stringSimilarity from 'string-similarity'; // For fuzzy matching
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';
import OpenAI from 'openai';

import { normalizeNameEnhanced, getNormalizedName } from './utils/name.js';

// Import models
import artistModel from './models/artist.js';
import genreModel from './models/genre.js';
import promoterModel from './models/promoter.js';
import venueModel from './models/venue.js';

// Import utility functions
import geoUtils from './utils/geo.js';
import databaseUtils from './utils/database.js';

// --- Global Parameters ---
const DRY_RUN = false; // Set true for dry-run mode (no DB writes)
const FUZZY_THRESHOLD = 0.75; // Similarity threshold for fuzzy matching

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

// Initialize Supabase client
const supabase = createClient(supabaseUrl, serviceKey);

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: openAIApiKey });

// Initialize Geocoder
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',
    httpAdapter: 'https',
    formatter: null
});

// Load geocoding exceptions
let geocodingExceptions = {};
try {
    geocodingExceptions = JSON.parse(fs.readFileSync('geocoding_exceptions.json', 'utf8'));
} catch (err) {
    console.error("Error loading geocoding_exceptions.json:", err);
}

let bannedGenreIds = [];

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

        // Log image info for debugging
        if (eventData.photo && eventData.photo.imageUri) {
            console.log(`🖼️ Event image found: ${eventData.photo.imageUri}`);
        } else if (eventData.photo) {
            console.log('🖼️ Event photo object exists but no imageUri:', eventData.photo);
        } else {
            console.log('⚠️ No event image found (eventData.photo is null or undefined)');
        }

        if (!venueAddress && venueName) {
            console.log(`\n🔍 No address found from Facebook for venue "${venueName}". Querying Google Maps...`);
            const googleResult = await venueModel.fetchAddressFromGoogle(venueName, googleApiKey, geocodingExceptions);
            if (googleResult) {
                const googleLat = googleResult.geometry.location.lat;
                const googleLng = googleResult.geometry.location.lng;
                if (venueLatitude && venueLongitude) {
                    const distance = geoUtils.haversineDistance(venueLatitude, venueLongitude, googleLat, googleLng);
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
                const nominatimResult = await geoUtils.fetchAddressFromNominatim(venueLatitude, venueLongitude);
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
        const promoterInfos = [];
        for (const promoterName of promotersList) {
            if (!promoterName) continue;
            console.log(`\n🔍 Processing promoter "${promoterName}"...`);
            let info = { id: null, name: promoterName, image_url: null };
            if (DRY_RUN) {
                console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
            } else {
                info = await promoterModel.findOrInsertPromoter(supabase, promoterName, eventData);
            }
            promoterInfos.push(info);
        }
        const promoterIds = promoterInfos.map(p => p.id).filter(id => id);

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
                    console.log(`➡️ Venue found by address: "${venueAddress}" (id=${venueId}).`);
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
                            console.log(`➡️ No venue found for "${normalizedVenueName}". Inserting new venue...`);
                            let standardizedAddress = venueAddress;
                            try {
                                const geoResults = await geocoder.geocode(venueAddress);
                                if (geoResults && geoResults.length > 0) {
                                    const g = geoResults[0];
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

                            if (!newVenueData.image_url) {
                                try {
                                    const photoUrl = await venueModel.fetchGoogleVenuePhoto(venueName, venueAddress);
                                    newVenueData.image_url = photoUrl;
                                    console.log(`✅ image_url obtained via Google Maps for "${normalizedVenueName}"`);
                                } catch (err) {
                                    console.warn(`⚠️ Could not retrieve Google photo for id=${venueId}: ${err.message}`);
                                }
                            }

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

        // (3) Process event
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
                await databaseUtils.ensureRelation(supabase, 
                    "event_promoter",
                    { event_id: eventId, promoter_id: pid },
                    "event_promoter"
                );
            }

            // event_venue relation
            if (venueId) {
                console.log("\n🔗 Ensuring event_venue relation...");
                await databaseUtils.ensureRelation(supabase,
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
                        await databaseUtils.ensureRelation(supabase,
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

        // (6) Import artists and create relations
        if (!DRY_RUN && eventId && parsedArtists.length > 0) {
            for (const artistObj of parsedArtists) {
                const artistName = (artistObj.name || '').trim();
                if (!artistName) {
                    console.log("⚠️ Skipping artist with no name:", artistObj);
                    continue;
                }
                let artistId = null;
                try {
                    artistId = await artistModel.findOrInsertArtist(supabase, artistObj);
                } catch (e) {
                    console.error(`❌ Error processing artist "${artistName}":`, e);
                }
                try {
                    await databaseUtils.createEventArtistRelation(supabase, eventId, artistId, artistObj);
                } catch (e) {
                    console.error(`❌ Error creating relation for artist "${artistName}":`, e);
                }
            }
            console.log("✅ Completed full event import (with artists).");
        } else if (!DRY_RUN && parsedArtists.length === 0) {
            console.log("✅ Event import done. No artists found via OpenAI.");
        } else if (DRY_RUN) {
            console.log("(DRY_RUN) Would process artists:", parsedArtists);
        }

        // (7) Post-processing: Assign genres
        if (!DRY_RUN && eventId) {
            try {
                await genreModel.assignEventGenres(supabase, eventId, bannedGenreIds);
                console.log("✅ Event genres assigned.");
            } catch (err) {
                console.error("Error assigning event genres:", err);
            }
        }
        if (!DRY_RUN && promoterIds.length > 0) {
            for (const promoterId of promoterIds) {
                if (!promoterId) continue;
                try {
                    await promoterModel.assignPromoterGenres(supabase, promoterId, bannedGenreIds);
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

// Start script
(async () => {
    bannedGenreIds = await genreModel.getBannedGenreIds(supabase, bannedGenres);
    await main().catch(err => {
        console.error("❌ Unhandled error:", err);
        process.exit(1);
    });
})();
