/**
 * import_event_core.js
 * 
 * Core event processing logic extracted from import_event.js
 * Used by both the CLI script and the server for processing events
 */

import 'dotenv/config';
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';
import OpenAI from 'openai';
import stringSimilarity from 'string-similarity';
import fs from 'fs';

import { normalizeNameEnhanced, getNormalizedName } from './utils/name.js';
import { logMessage } from './utils/logger.js';
import { detectFestival, extractFestivalName } from './utils/festival-detection.js';
import { getClashfinderTimetable } from './get_data/get_clashfinder_timetable.js';
import { toUtcIso } from './utils/date.js';
import { delay } from './utils/delay.js';
import { getAccessToken } from './utils/token.js';

// Import models
import artistModel from './models/artist.js';
import genreModel from './models/genre.js';
import promoterModel from './models/promoter.js';
import venueModel from './models/venue.js';
import timetableModel from './models/timetable.js';

// Import utility functions
import geoUtils from './utils/geo.js';
import databaseUtils from './utils/database.js';

// Initialize clients and configuration
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const FUZZY_THRESHOLD = 0.75;
const bannedGenres = ["90s", "Disco", "Dub", "Guaracha", "Bootleg", "Montreal", "Lebanon", "Stereo", "Berghain", "Jaw", "Not", "Monster", "Dream", "Drone", "Eurodance", "Storytelling", "Nostalgic", "Guitar", "Art", "Future", "Romania", "Drums", "Atmosphere", "Emo", "Lyrical", "Indonesia", "Mood", "Mellow", "Work", "Feminism", "Download", "This", "Poetry", "Sound", "Malibu", "Twek", "Money", "Orgasm", "Cover", "Viral", "Sexy", "Z", "Nas", "Weird", "P", "Indonesion", "Funky", "Tearout", "Uplifting", "Love", "Core", "Violin", "Simpsons", "Riddim", "World Music", "Dancehall", "Gbr", "Fußball", "German", "New", "Eargasm", "Ecstasy", "Coldwave", "Brazilian", "Beat", "Song", "Soulful", "Smooth", "Contemporary", "Ballad", "Modern", "Beyonce", "Occult", "Evil", "Vinyl", "2000's", "Dog", "Gangsta", "Hair", "Soundtrack", "Hard Drance", "Bassline", "Queer", "Interview", "Krautrock", "Soundscape", "Darkwave", "Atmospheric", "Americana", "Mpc", "Detroit", "Fast", "Argentina", "Emotional", "Germany", "Frankfurt", "Karlsruhe", "Driving", "Cosmic", "Summer", "Basement", "Beachbar", "Party", "Producer", "Alive", "Pulse", "Coding", "Offensive", "Alex", "Time", "Soho", "Spring", "Aus", "X", "Modern Dancehall", "Elektra", "Piano", "Italo", "Synth", "Ghetto", "Moombahton", "Ghetto", "Chicago", "Happy", "80s", "Munich", "Melancholic", "Samples", "Madrid", "Amapiano", "00s", "Breakbeat", "Retro", "Breakz", "Spain", "Pandora", "Tropical", "Latin Pop", "Night", "Aussie", "Australian", "Fire", "Hot", "Spotify", "Ur", "2step", "Lonely", "Sad", "Angry", "Heavy", "Hex", "A", "Complex", "Freestyle", "Mainstream", "All", "Long", "Antifa", "Horror", "Scary", "Japan", "Popular", "Memphis", "Nostalgia", "Ost", "Speech", "Shoegaze", "Orchestral", "London", "Kinky", "Tresor", "Chillout", "Cool", "Sun", "Ethnic", "Banjo", "Trippy", "Persian", "Traditional", "Persian Traditional", "Bochka", "Oh", "God", "Kids", "Compilation", "Ghost", "Space", "Christ", "Based", "De", "Juke", "Gent", "Valearic", "Ebm", "Sac-sha", "Amsterdam", "Noise", "Eclectic", "Hi-nrg", "Antwerp", "Feelgood", "Body", "Indie Dance", "Barcelona", "Fusion", "C", "Comedy", "Zephyr", "E", "Tiktok", "Brasil", "O", "It", "Us", "Yes", "Scantraxx", "Qlimax", "Style", "Italian", "Spiritual", "Quiet", "Best", "Denver", "Colorado", "Soca", "Bobo", "G", "Zouk", "Booba", "Game", "Cello", "Jam", "Hardtekk", "Break", "Goa", "Boogie", "Idm", "Haldtime", "Spanish", "Screamo", "Ra", "Jersey", "Organ", "Palestine", "Congo", "Healing", "Minecraft", "Cyberpunk", "Television", "Film", "Cursed", "Crossbreed", "Funama", "Kuduro", "Mashups", "Collaboration", "France", "Alien", "Banger", "Tool", "Insomnia", "Flow", "Kafu", "Adele", "Makina", "Manchester", "Salford", "Macedonia", "Japanese", "Relax", "Relaxing", "Relaxation", "Is", "Bdr", "Bier", "Jckson", "Jersey Club", "Big Room", "Brooklyn", "Coffee", "Green", "Tekkno", "Flips", "Sia", "Ccr", "Ai", "Unicorn", "Q", "Aversion", "Gym", "Get", "Buningman", "Rotterdam", "Matrix", "Indian", "Brazil", "S", "Hybrid", "Beats", "Singer", "Ans", "Theme", "Future Bass", "Club House", "Glam", "Aggressive", "Prog", "Technoid", "Funny", "Raggamuffin", "Bangface", "Bandcamp", "Bristol", "Organic", "Brazilian Phonk", "Revolution", "Afterlife", "Rockabilly", "Tune", "Brixton", "Psydub", "Harmony", "Montana", "Imaginarium", "Cheesy", "Choral", "other", "mixtape", "world", "venice", "hate", "bbc", "original", "hip", "Indie", "dan", "wave", "J", "deep", "holiday", "berlin", "Classic", "fun", "Electric", "Leftfield", "Italo-disco", "Electronica", "Singer-songwriter", "alternative", "sampled", "anime", "hit", "speed garage", "groovy", "donk", "latin", "R", "soul", "trash", "vocal", "alternative rock", "werewolf", "christmas", "xmas", "amen", "fox", "you", "Dl", "girl", "Intelligent", "audio", "musical", "tony", "moon", "ukf", "zombies", "Complextro", "Doom", "death", "Monstercat", "cake", "scene", "queen", "slam", "fox", "Czech", "workout", "winter", "modus", "iaginarium", "avalon", "fullon", "football", "colombia", "portugal", "badass", "recorder", "chile", "road", "breton", "sufi", "chanson", "noize", "balada", "running", "footwork", "santa", "crazy", "microwave", "bop", "great", "carnaval", "standard", "demo", "twilight", "female", "hippie", "community", "meditative", "yoga", "meditation", "drop", "haunting", "chant", "Birmingham", "opium", "combo", "austria", "old", "worldwide", "free", "rap", "d", "snap", "n", "hip-hop", "hiphip", "breaks", "electronic", "belgian", "belgium", "up", "noir", "bass", "murder", "ep", "rave", "bad", "oldschool", "music", "remix", "track", "podcast", "dance", "set", "festival", "ecstacy", "uk", "live", "paris", "internet", "episode", "r", "D", "club", "dj", "mix", "radio", "soundcloud", "sesh"];

let bannedGenreIds = [];

/**
 * Main event processing function
 * @param {Object} options - Processing options
 * @param {string} options.eventUrl - Facebook event URL
 * @param {boolean} options.detectedAsFestival - Pre-detected festival status
 * @param {string} options.festivalName - Pre-extracted festival name
 * @param {string} options.clashfinderId - Pre-found Clashfinder ID
 * @param {boolean} options.dryRun - Dry run mode
 * @returns {Object} Processing result
 */
export async function processEventImport(options) {
    const { eventUrl, detectedAsFestival, festivalName, clashfinderId, dryRun = false } = options;
    
    logMessage(`Starting event import: ${eventUrl}`);
    
    try {
        // Initialize banned genre IDs
        if (bannedGenreIds.length === 0) {
            bannedGenreIds = await genreModel.getBannedGenreIds(supabase, bannedGenres);
        }
        
        // Scrape Facebook event
        console.log("🔎 Scraping the Facebook event...");
        const eventData = await scrapeFbEvent(eventUrl);
        console.log(`✅ Scraped data for event: "${eventData.name}" (Facebook ID: ${eventData.id})`);
        
        // Festival detection (use provided data or detect fresh)
        let festivalDetection;
        if (detectedAsFestival !== null && detectedAsFestival !== undefined) {
            // Use pre-detected results
            festivalDetection = {
                isFestival: detectedAsFestival,
                confidence: detectedAsFestival ? 80 : 20, // Assume high confidence if pre-detected
                festivalName: festivalName,
                reasons: ['Pre-detected by server']
            };
        } else {
            // Fresh detection
            festivalDetection = detectFestival(eventData);
        }
        
        logMessage(`Festival detection: ${festivalDetection.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (confidence: ${festivalDetection.confidence}%)`);
        
        // Process basic event data
        const eventResult = await processBasicEventData(eventData, eventUrl, dryRun);
        
        // Determine import strategy and process artists
        let artistsCount = 0;
        let strategy = 'simple';
        
        if (festivalDetection.isFestival && festivalDetection.confidence >= 60) {
            strategy = 'festival';
            const timetableResult = await processFestivalTimetable(
                eventResult.eventId, 
                eventData, 
                festivalDetection.festivalName || festivalName,
                clashfinderId,
                dryRun
            );
            artistsCount = timetableResult.artistsCount;
        } else {
            strategy = 'simple';
            const simpleResult = await processSimpleEventArtists(
                eventResult.eventId, 
                eventData.description, 
                dryRun
            );
            artistsCount = simpleResult.artistsCount;
        }
        
        // Post-processing: Assign genres
        if (!dryRun && eventResult.eventId) {
            try {
                await genreModel.assignEventGenres(supabase, eventResult.eventId, bannedGenreIds, festivalDetection.isFestival);
                console.log("✅ Event genres assigned.");
            } catch (err) {
                console.error("Error assigning event genres:", err);
            }
        }
        
        logMessage(`Event import completed: ${artistsCount} artists processed using ${strategy} strategy`);
        
        return {
            eventId: eventResult.eventId,
            artistsCount,
            strategy,
            festivalDetection
        };
        
    } catch (error) {
        logMessage(`Event import failed: ${error.message}`);
        throw error;
    }
}

/**
 * Processes basic event data (venue, promoters, event record)
 */
async function processBasicEventData(eventData, eventUrl, dryRun) {
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

    // Process venue address if missing
    if (!venueAddress && venueName) {
        console.log(`\n🔍 No address found from Facebook for venue "${venueName}". Querying Google Maps...`);
        const googleResult = await venueModel.fetchAddressFromGoogle(venueName, process.env.GOOGLE_API_KEY, geocodingExceptions);
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

    // Process promoters
    const promoterInfos = [];
    for (const promoterName of promotersList) {
        if (!promoterName) continue;
        console.log(`\n🔍 Processing promoter "${promoterName}"...`);
        let info = { id: null, name: promoterName, image_url: null };
        if (dryRun) {
            console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
        } else {
            info = await promoterModel.findOrInsertPromoter(supabase, promoterName, eventData);
        }
        promoterInfos.push(info);
    }
    const promoterIds = promoterInfos.map(p => p.id).filter(id => id);

    // Process venue
    let venueId = null;
    if (venueName) {
        console.log(`\n🔍 Processing venue "${venueName}"...`);
        const normalizedVenueName = getNormalizedName(venueName);

        if (!dryRun) {
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
                        // Insert new venue
                        venueId = await insertNewVenue(normalizedVenueName, venueAddress, venueCity, venueCountry, venueLatitude, venueLongitude, promoterInfos);
                    }
                }
            }
        } else {
            console.log(`(DRY_RUN) Would find/insert venue "${venueName}" / Address: "${venueAddress}"`);
        }
    } else {
        console.log("\nℹ️ No venue information to insert (online event or venue not specified).");
    }

    // Process event
    console.log(`\n📝 Checking if event "${eventName}" already exists in the database...`);
    let eventId = null;
    if (!dryRun) {
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
        } else {
            // Insert new event
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

        // Create relations: event_promoter, event_venue, venue_promoter
        if (eventId) {
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
    } else {
        console.log(`(DRY_RUN) Would find/insert event "${eventName}"`);
        eventId = 999; // Example dummy ID
    }

    return { eventId, promoterIds, venueId };
}

/**
 * Inserts a new venue into the database
 */
async function insertNewVenue(normalizedVenueName, venueAddress, venueCity, venueCountry, venueLatitude, venueLongitude, promoterInfos) {
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
            const photoUrl = await venueModel.fetchGoogleVenuePhoto(normalizedVenueName, venueAddress);
            newVenueData.image_url = photoUrl;
            console.log(`✅ image_url obtained via Google Maps for "${normalizedVenueName}"`);
        } catch (err) {
            console.warn(`⚠️ Could not retrieve Google photo: ${err.message}`);
        }
    }

    const { data: newVenue, error: insertVenueError } = await supabase
        .from('venues')
        .insert(newVenueData)
        .select('id');
    if (insertVenueError || !newVenue || newVenue.length === 0) {
        throw insertVenueError || new Error("Venue insertion failed");
    }
    const venueId = newVenue[0].id;
    console.log(`✅ New venue inserted: "${normalizedVenueName}" (id=${venueId}).`);
    return venueId;
}

/**
 * Processes festival timetable data
 */
async function processFestivalTimetable(eventId, eventData, festivalName, clashfinderId, dryRun) {
    if (dryRun) {
        console.log(`(DRY_RUN) Would process festival timetable`);
        return { artistsCount: 0 };
    }

    console.log(`\n🎪 Processing festival timetable...`);
    
    let timetableData = null;
    let clashfinderResult = null;
    
    // Try to get timetable from Clashfinder
    const searchName = festivalName || extractFestivalName(eventData.name);
    if (searchName) {
        console.log(`🔍 Searching Clashfinder for festival: "${searchName}"`);
        try {
            clashfinderResult = await getClashfinderTimetable(searchName, { 
                saveFile: false, 
                silent: true 
            });
            console.log(`✅ Found Clashfinder data for: ${clashfinderResult.festival.name}`);
            console.log(`🔗 Clashfinder URL: ${clashfinderResult.clashfinderUrl}`);
            
            // Convert CSV to JSON format expected by timetable import
            timetableData = convertClashfinderToJSON(clashfinderResult.csv);
            console.log(`📊 Converted CSV to JSON: ${timetableData.length} performances`);
            
        } catch (clashfinderError) {
            console.log(`⚠️ Clashfinder lookup failed: ${clashfinderError.message}`);
            console.log(`🔄 Falling back to simple event import with OpenAI parsing`);
            return await processSimpleEventArtists(eventId, eventData.description, dryRun);
        }
    } else {
        console.log(`⚠️ Could not extract festival name for Clashfinder search`);
        return await processSimpleEventArtists(eventId, eventData.description, dryRun);
    }

    if (!timetableData || timetableData.length === 0) {
        console.log(`⚠️ No timetable data found, falling back to simple import`);
        return await processSimpleEventArtists(eventId, eventData.description, dryRun);
    }

    // Process timetable data
    const timezone = 'Europe/Brussels';
    const stats = timetableModel.generateTimetableStatistics(timetableData);
    const { stages, festival_days } = timetableModel.extractStagesAndDaysFromPerformances(timetableData, timezone);
    
    // Update event metadata
    await updateEventMetadata(eventId, stages, festival_days, clashfinderResult);
    
    // Log statistics
    timetableModel.logTimetableStatistics(stats, logMessage);
    
    // Group performances for B2B detection
    const groupedPerformances = timetableModel.groupPerformancesForB2B(timetableData);
    
    // Get SoundCloud access token
    const accessToken = await getAccessToken(process.env.SOUND_CLOUD_CLIENT_ID, process.env.SOUND_CLOUD_CLIENT_SECRET);
    
    let processedCount = 0;
    let soundCloudFoundCount = 0;
    const artistNameToId = {};
    
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
                
                const artist = await artistModel.insertOrUpdateArtist(supabase, { name: artistName }, soundCloudData, dryRun);
                artistNameToId[artistName] = artist.id;
            }
            artistIds.push(artistNameToId[artistName]);
        }
        
        // Link artists to event with performance details
        const refPerf = group[0];
        await linkArtistsToEvent(eventId, artistIds, refPerf);
        
        processedCount += group.length;
        logMessage(`Successfully processed: ${artistNames.join(' & ')} (${group.length} performance(s))`);
        
        await delay(500); // Rate limiting
    }
    
    logMessage(`Festival timetable import complete: ${processedCount} artists processed, ${soundCloudFoundCount} with SoundCloud`);
    console.log(`✅ Festival import complete: ${processedCount} artists, ${soundCloudFoundCount} found on SoundCloud`);
    
    return { artistsCount: processedCount };
}

/**
 * Processes simple event artists using OpenAI
 */
async function processSimpleEventArtists(eventId, eventDescription, dryRun) {
    console.log("\n💬 Processing simple event - calling OpenAI to parse artists from description...");
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
                model: "gpt-4o-mini",
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
            logMessage(`OpenAI parsed ${parsedArtists.length} artists from event description`);
        } catch (err) {
            console.error("❌ Could not parse artists from OpenAI response:", err);
            logMessage(`Error parsing artists: ${err.message}`);
        }
    } else {
        console.log("⚠️ No description found, skipping artist extraction.");
        logMessage("No event description available for artist extraction");
    }

    // Import artists and create relations
    if (!dryRun && eventId && parsedArtists.length > 0) {
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
                logMessage(`Error processing artist ${artistName}: ${e.message}`);
            }
            try {
                await databaseUtils.createEventArtistRelation(supabase, eventId, artistId, artistObj);
            } catch (e) {
                console.error(`❌ Error creating relation for artist "${artistName}":`, e);
                logMessage(`Error creating relation for artist ${artistName}: ${e.message}`);
            }
        }
        console.log("✅ Completed simple event import with artists.");
        logMessage(`Simple event import completed: ${parsedArtists.length} artists processed`);
    } else if (!dryRun && parsedArtists.length === 0) {
        console.log("✅ Event import done. No artists found via OpenAI.");
        logMessage("Event import completed - no artists found");
    } else if (dryRun) {
        console.log("(DRY_RUN) Would process artists:", parsedArtists);
        logMessage(`DRY_RUN: Would process ${parsedArtists.length} artists`);
    }

    return { artistsCount: parsedArtists.length };
}

/**
 * Converts Clashfinder CSV data to JSON format
 */
function convertClashfinderToJSON(csvData) {
    const lines = csvData.split('\n').filter(line => line.trim());
    if (lines.length <= 1) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const performances = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const performance = {};
        
        headers.forEach((header, index) => {
            const value = values[index] || '';
            switch (header.toLowerCase()) {
                case 'artist':
                case 'name':
                    performance.name = value;
                    break;
                case 'stage':
                case 'venue':
                    performance.stage = value;
                    break;
                case 'start':
                case 'time':
                case 'start_time':
                    performance.time = value;
                    break;
                case 'end':
                case 'end_time':
                    performance.end_time = value;
                    break;
                case 'day':
                    performance.day = value;
                    break;
                default:
                    performance[header] = value;
                    break;
            }
        });
        
        if (performance.name && performance.stage) {
            performances.push(performance);
        }
    }
    
    return performances;
}

/**
 * Updates event metadata with festival information
 */
async function updateEventMetadata(eventId, stages, festival_days, clashfinderResult) {
    try {
        const { data: currentEvent, error: fetchError } = await supabase
            .from('events')
            .select('metadata')
            .eq('id', eventId)
            .single();
        
        if (fetchError) throw fetchError;
        
        const currentMetadata = currentEvent.metadata || {};
        const updatedMetadata = {
            ...currentMetadata,
            festival_stages: stages,
            festival_days: festival_days,
            is_festival: true,
            clashfinder_url: clashfinderResult?.clashfinderUrl,
            clashfinder_festival_id: clashfinderResult?.festival?.id,
            timetable_imported_at: new Date().toISOString()
        };
        
        const { error: updateError } = await supabase
            .from('events')
            .update({ metadata: updatedMetadata })
            .eq('id', eventId);
        
        if (updateError) throw updateError;
        
        console.log(`✅ Event metadata updated with festival information`);
        logMessage(`Event ${eventId} metadata updated with ${stages.length} stages and ${festival_days.length} days`);
        
    } catch (error) {
        console.error(`❌ Error updating event metadata: ${error.message}`);
        logMessage(`Error updating event metadata: ${error.message}`);
    }
}

/**
 * Links artists to event with performance details
 */
async function linkArtistsToEvent(eventId, artistIds, performance) {
    try {
        for (const artistId of artistIds) {
            const relationData = {
                event_id: eventId,
                artist_id: artistId,
                performance_time: performance.time || null,
                performance_end_time: performance.end_time || null,
                stage: performance.stage || null,
                performance_mode: performance.performance_mode || null
            };
            
            await databaseUtils.ensureRelation(supabase, "event_artist", relationData, "event_artist");
        }
    } catch (error) {
        console.error(`❌ Error linking artists to event: ${error.message}`);
        logMessage(`Error linking artists to event: ${error.message}`);
    }
}
