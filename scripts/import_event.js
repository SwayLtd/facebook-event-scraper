import 'dotenv/config';  // Load environment variables from a .env file if present
import fs from 'fs';
import stringSimilarity from 'string-similarity'; // For fuzzy matching
import { scrapeFbEvent } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';
import OpenAI from 'openai';

import { normalizeNameEnhanced, getNormalizedName } from '../utils/name.js';
import { logMessage } from '../utils/logger.js';
import { detectFestival, extractFestivalName } from '../utils/festival-detection.js';
import { getClashfinderTimetable } from './get_data/get_clashfinder_timetable.js';

// Import extraction functions
import { convertClashfinderToJSON } from './extract_events_timetable.js';

// Import models
import artistModel from '../models/artist.js';
import genreModel from '../models/genre.js';
import promoterModel from '../models/promoter.js';
import venueModel from '../models/venue.js';
import timetableModel from '../models/timetable.js';

// Import utility functions
import geoUtils from '../utils/geo.js';
import databaseUtils from '../utils/database.js';

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
    const startTime = Date.now(); // Track execution time
    
    try {
        const eventUrl = process.argv[2];
        const skipArtists = process.argv.includes('--no-artists') || process.argv.includes('--skip-artists');
        const forceFestival = process.argv.includes('--festival');
        
        if (!eventUrl) {
            console.error('❌ Please specify a Facebook Events URL. Example:');
            console.error('   node import_event.js https://www.facebook.com/events/1234567890');
            console.error('   node import_event.js https://www.facebook.com/events/1234567890 --no-artists');
            console.error('   node import_event.js https://www.facebook.com/events/1234567890 --festival');
            console.error('');
            console.error('Options:');
            console.error('   --no-artists    Skip artist import (faster for event-only import)');
            console.error('   --festival      Force import as festival (enables timetable search even without end date)');
            process.exit(1);
        }

        if (skipArtists) {
            console.log('🚫 Artist import disabled by --no-artists flag');
        }
        
        if (forceFestival) {
            console.log('🎪 Festival mode FORCED by --festival flag');
        }

        console.log("🔎 Scraping the Facebook event...");
        const eventData = await scrapeFbEvent(eventUrl);
        console.log(`✅ Scraped data for event: "${eventData.name}" (Facebook ID: ${eventData.id})`);

        // === FESTIVAL DETECTION ===
        console.log("\n🎪 Analyzing event to detect if it's a festival...");
        const festivalDetection = detectFestival(eventData, { forceFestival });
        logMessage(`Festival detection result: ${festivalDetection.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (confidence: ${festivalDetection.confidence}%)`);
        logMessage(`Detection reasons: ${festivalDetection.reasons.join(', ')}`);
        
        if (festivalDetection.duration) {
            console.log(`⏱️ Event duration: ${festivalDetection.duration.hours.toFixed(1)} hours (${festivalDetection.duration.days} days)`);
        }

        // Determine import strategy based on festival detection
        let importStrategy = 'simple'; // Default to simple event import
        let timetableData = null;
        let clashfinderResult = null;
        
        // Primary criterion: Forced festival mode OR Duration > 24 hours OR Known festival
        if (forceFestival || festivalDetection.isFestival || 
            (festivalDetection.duration && festivalDetection.duration.hours > 24)) {
            importStrategy = 'festival';
            const durationText = festivalDetection.duration ? 
                `${festivalDetection.duration.hours.toFixed(1)}h` : 'unknown duration';
            console.log(`🎪 Event detected as FESTIVAL (${durationText}) - will attempt timetable import`);
            
            // Try to get timetable from Clashfinder
            const festivalName = festivalDetection.festivalName || extractFestivalName(eventData.name);
            if (festivalName) {
                console.log(`🔍 Searching Clashfinder for festival: "${festivalName}"`);
                try {
                    // Use original event name for better year detection and variant generation
                    clashfinderResult = await getClashfinderTimetable(eventData.name, { 
                        saveFile: false, 
                        silent: true,
                        minSimilarity: 70  // Higher threshold to avoid false positives
                    });
                    console.log(`✅ Found Clashfinder data for: ${clashfinderResult.festival.name} (similarity: ${clashfinderResult.similarity}%)`);
                    console.log(`🔗 Clashfinder URL: ${clashfinderResult.clashfinderUrl}`);
                    
                    // Check if year matches
                    const eventYear = eventData.name.match(/\b(20\d{2})\b/)?.[1];
                    const timetableId = clashfinderResult.festival.id;
                    let timetableYear = timetableId.match(/\b(20\d{2})\b/)?.[1];
                    
                    // Extract year from ID patterns like "lir23" -> "2023"
                    if (!timetableYear && timetableId.match(/\w+(\d{2})$/)) {
                        const shortYear = timetableId.match(/\w+(\d{2})$/)[1];
                        timetableYear = shortYear.startsWith('0') || shortYear.startsWith('1') ? `20${shortYear}` : `20${shortYear}`;
                        if (parseInt(shortYear) > 50) timetableYear = `19${shortYear}`; // Handle edge case
                    }
                    
                    if (eventYear && timetableYear && eventYear !== timetableYear) {
                        console.log(`❌ Rejecting timetable from ${timetableYear} for ${eventYear} event - year mismatch`);
                        console.log(`🔄 Falling back to simple event import with OpenAI parsing`);
                        importStrategy = 'simple_fallback';
                    } else {
                        // Convert CSV to JSON format expected by timetable import
                        timetableData = await convertClashfinderToJSON(clashfinderResult.csv);
                        console.log(`📊 Converted CSV to JSON: ${timetableData.length} performances`);
                    }
                    
                } catch (clashfinderError) {
                    console.log(`⚠️ Clashfinder lookup failed: ${clashfinderError.message}`);
                    console.log(`🔄 Falling back to simple event import with OpenAI parsing`);
                    importStrategy = 'simple_fallback';
                }
            } else {
                console.log(`⚠️ Could not extract festival name for Clashfinder search`);
                importStrategy = 'simple_fallback';
            }
        } else {
            const durationText = festivalDetection.duration ? 
                `${festivalDetection.duration.hours.toFixed(1)}h` : 'no duration data';
            console.log(`📝 Event detected as SIMPLE EVENT (${durationText}) - will use OpenAI artist parsing`);
        }

        const eventName = eventData.name || null;
        const eventDescription = eventData.description || null;
        // Set type as "festival" if detected as festival, otherwise use Facebook category
        const eventType = (importStrategy === 'festival') ? 'festival' : 
                         ((eventData.categories && eventData.categories.length) ? eventData.categories[0].label : null);
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
                    // Different thresholds for festivals vs regular events
                    const threshold = (importStrategy === 'festival') ? 5000 : 500; // 5km for festivals, 500m for regular events
                    if (distance < threshold) {
                        venueAddress = googleResult.formatted_address;
                        console.log(`✅ Using Google address: ${venueAddress}`);
                    } else {
                        const eventTypeText = (importStrategy === 'festival') ? 'festival' : 'event';
                        console.log(`⚠️ Google address is too far from FB coordinates for ${eventTypeText} (${distance.toFixed(0)}m > ${threshold}m).`);
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
            // Search by URL first (primary key for uniqueness)
            const { data: eventsByUrl, error: eventsByUrlError } = await supabase
                .from('events')
                .select('id, metadata')
                .ilike('metadata->>facebook_url', fbEventUrl);
            if (eventsByUrlError) throw eventsByUrlError;

            if (eventsByUrl && eventsByUrl.length > 0) {
                eventId = eventsByUrl[0].id;
                console.log(`➡️ Event found by facebook_url (id=${eventId}).`);
            } else {
                // Search by title only if no Facebook URL provided (rare case)
                // This ensures that events with different Facebook URLs are always treated as separate events
                if (!fbEventUrl) {
                    const { data: eventsByName, error: eventsByNameError } = await supabase
                        .from('events')
                        .select('id')
                        .eq('title', eventName);
                    if (eventsByNameError) throw eventsByNameError;

                    if (eventsByName && eventsByName.length > 0) {
                        eventId = eventsByName[0].id;
                        console.log(`➡️ Event found by title matching (id=${eventId}) - no Facebook URL provided.`);
                    }
                } else {
                    console.log(`➡️ Event with different Facebook URL - will create new event even if same name exists.`);
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

        // (5) Import artists based on detected strategy
        if (!skipArtists) {
            if (importStrategy === 'festival' && timetableData && timetableData.length > 0) {
                // Use timetable module to process festival timetable
                await timetableModel.processFestivalTimetable(supabase, eventId, timetableData, clashfinderResult, {
                    dryRun: DRY_RUN,
                    soundCloudClientId: SOUND_CLOUD_CLIENT_ID,
                    soundCloudClientSecret: SOUND_CLOUD_CLIENT_SECRET,
                    logMessage,
                    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
                });
            } else {
                // Use artist module to process simple event artists
                await artistModel.processSimpleEventArtists(supabase, openai, eventId, eventDescription, DRY_RUN);
            }
        } else {
            console.log('⏭️ Skipping artist import as requested');
        }

        // (6) Post-processing: Assign genres
        if (!DRY_RUN && eventId) {
            try {
                await genreModel.assignEventGenres(supabase, eventId, bannedGenreIds, festivalDetection.isFestival);
                console.log("✅ Event genres assigned.");
            } catch (err) {
                console.error("Error assigning event genres:", err);
            }
        }
        if (!DRY_RUN && promoterIds.length > 0) {
            for (const promoterId of promoterIds) {
                if (!promoterId) continue;
                try {
                    await promoterModel.assignPromoterGenres(supabase, promoterId, bannedGenreIds, festivalDetection.isFestival);
                    console.log(`✅ Genres assigned for promoter id=${promoterId}.`);
                } catch (err) {
                    console.error(`Error assigning genres for promoter id=${promoterId}:`, err);
                }
            }
        }

        // Final success message
        console.log('\n🎉 ============================================');
        console.log('🎉 FACEBOOK EVENT IMPORT COMPLETED SUCCESSFULLY');
        console.log('🎉 ============================================');
        if (importStrategy === 'festival') {
            console.log(`✅ Festival event "${eventName || 'Unknown'}" fully imported`);
        } else {
            console.log(`✅ Event "${eventName || 'Unknown'}" fully imported`);
        }
        console.log(`📊 Event ID: ${eventId}`);
        console.log(`🎭 Import strategy: ${importStrategy}`);
        console.log(`⏱️  Total execution time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        console.log('🎉 ============================================\n');

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
