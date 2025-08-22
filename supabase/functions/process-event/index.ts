/**
 * Edge Function: process-event
 * 
 * Complete event processing system replicating the local import_event.js logic
 * Uses facebook-event-scraper package exactly like the local script
 * 
 * Features matching local script:
 * - facebook-event-scraper integration 
 * - Festival detection with 24h+ duration logic
 * - Clashfinder timetable processing
 * - Complete promoter/venue/artist processing
 * - Genre assignment with banned genres
 * - Exact same data flow as local script
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Deno declarations
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient } from 'jsr:@supabase/supabase-js@2';
// Import facebook-event-scraper exactly like local script
import { scrapeFbEvent } from 'npm:facebook-event-scraper';
// Import artist processing functions
import { processSimpleEventArtists } from './models/artist.ts';

// Banned genres (replicated from local script)
const bannedGenres = [
    'Techno', 'House', 'Trance', 'Drum and Bass', 'Dubstep', 'EDM', 'Dance', 
    'Electronic', 'Electro', 'Hardcore', 'Gabber', 'Hardstyle', 'Psytrance',
    'Deep House', 'Progressive House', 'Tech House', 'Minimal', 'Ambient',
    'Breakbeat', 'UK Garage', 'Future Bass', 'Trap', 'Glitch', 'IDM',
    'Synthwave', 'Vaporwave', 'Chillwave', 'Downtempo', 'Trip Hop'
];

// Fuzzy threshold for venue matching (replicated from local script)
const FUZZY_THRESHOLD = 0.85;

/**
 * String similarity utility (replicated from local script)
 */
const stringSimilarity = {
  compareTwoStrings: (str1: string, str2: string): number => {
    if (str1 === str2) return 1.0;
    if (str1.length < 2 || str2.length < 2) return 0.0;
    
    const bigrams1 = new Set<string>();
    const bigrams2 = new Set<string>();
    
    for (let i = 0; i < str1.length - 1; i++) {
      bigrams1.add(str1.substring(i, i + 2));
    }
    
    for (let i = 0; i < str2.length - 1; i++) {
      bigrams2.add(str2.substring(i, i + 2));
    }
    
    const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
    return (2.0 * intersection.size) / (bigrams1.size + bigrams2.size);
  }
};

/**
 * Detect festival logic (replicated from local script)
 */
function detectFestival(eventData: any, options: { forceFestival?: boolean } = {}): {
  isFestival: boolean;
  confidence: number; 
  reasons: string[];
  duration: { hours: number; days: number } | null;
} {
  if (options.forceFestival) {
    return {
      isFestival: true,
      confidence: 100,
      reasons: ['Force festival flag'],
      duration: null
    };
  }

  const reasons: string[] = [];
  let confidence = 0;
  let duration: { hours: number; days: number } | null = null;

  // Calculate duration if we have both start and end times
  if (eventData.startTimestamp && eventData.endTimestamp) {
    const startMs = eventData.startTimestamp * 1000;
    const endMs = eventData.endTimestamp * 1000;
    const durationMs = endMs - startMs;
    const hours = durationMs / (1000 * 60 * 60);
    const days = Math.ceil(hours / 24);
    
    duration = { hours, days };
    
    if (hours > 24) {
      confidence += 60;
      reasons.push(`Duration > 24h (${hours.toFixed(1)}h)`);
    }
  }

  // Check for festival keywords in name
  const festivalKeywords = ['festival', 'fest', 'open air', 'openair', 'gathering'];
  const name = eventData.name.toLowerCase();
  
  for (const keyword of festivalKeywords) {
    if (name.includes(keyword)) {
      confidence += 30;
      reasons.push(`Name contains "${keyword}"`);
      break;
    }
  }

  // If we have duration > 24h OR confidence > 50, it's likely a festival
  const isFestival = (duration && duration.hours > 24) || confidence > 50;
  
  return {
    isFestival,
    confidence: Math.min(confidence, 100),
    reasons,
    duration
  };
}

/**
 * Normalize name function (simplified version from local script)
 */
function getNormalizedName(name: string): string {
  return name.trim().toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters except dash
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Retrieves the URL of a Google Places photo for a given address.
 * Replicates functionality from models/venue.js
 */
async function fetchGoogleVenuePhoto(name: string, address: string): Promise<string | null> {
  const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!googleApiKey) {
    console.warn('Google API key not found');
    return null;
  }

  try {
    // Step 1: Google Maps geocoding
    const geoResponse = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`
    );
    const geoJson = await geoResponse.json();
    
    if (!geoJson.results?.length) {
      throw new Error('No geocoding results');
    }

    // Step 2: findPlaceFromText to get place_id
    const findResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
      `?input=${encodeURIComponent(name + ' ' + address)}` +
      `&inputtype=textquery&fields=place_id&key=${googleApiKey}`
    );
    const findJson = await findResponse.json();
    
    if (!findJson.candidates?.length) {
      throw new Error('No place_id found');
    }
    const placeId = findJson.candidates[0].place_id;

    // Step 3: details to get photo_reference
    const detailResponse = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${placeId}&fields=photos&key=${googleApiKey}`
    );
    const detailJson = await detailResponse.json();
    const photoRef = detailJson.result?.photos?.[0]?.photo_reference;
    
    if (!photoRef) {
      throw new Error('No photo available');
    }

    return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${googleApiKey}`;
    
  } catch (error) {
    console.error(`Error fetching Google venue photo for "${name}":`, error);
    return null;
  }
}

function normalizeNameEnhanced(name: string): string {
  return name.trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assigns genres to a promoter based on the events they organize.
 * Replicates functionality from models/promoter.js
 */
async function assignPromoterGenres(supabase: any, promoterId: number, bannedGenreIds: number[], isFestival: boolean = false): Promise<number[]> {
  try {
    // 1) Get the promoter's events
    const { data: promoterEvents, error: peError } = await supabase
      .from('event_promoter')
      .select('event_id')
      .eq('promoter_id', promoterId);
      
    if (peError) throw peError;

    // 2) Count the genres of these events
    const genreCounts: { [genreId: number]: number } = {};
    for (const { event_id } of promoterEvents) {
      const { data: eventGenres, error: egError } = await supabase
        .from('event_genre')
        .select('genre_id')
        .eq('event_id', event_id);
        
      if (egError) throw egError;
      
      eventGenres.forEach((g: any) => {
        genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
      });
    }

    // 3) First filter: threshold + exclusion of banned genres
    const MIN_GENRE_OCCURRENCE = 1;
    const MAX_GENRES_REGULAR = 3;
    const MAX_GENRES_FESTIVAL = 8;
    const FESTIVAL_FALLBACK_GENRES = 5;
    
    const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
    const fallbackGenres = isFestival ? FESTIVAL_FALLBACK_GENRES : 3;

    let topGenreIds = Object.entries(genreCounts)
      .filter(([genreId, count]) =>
        count >= MIN_GENRE_OCCURRENCE &&
        !bannedGenreIds.includes(Number(genreId))
      )
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, maxGenres)
      .map(([genreId]) => Number(genreId));

    // 4) More permissive fallback
    if (topGenreIds.length === 0) {
      topGenreIds = Object.entries(genreCounts)
        .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
        .sort(([, a], [, b]) => Number(b) - Number(a))
        .slice(0, fallbackGenres)
        .map(([genreId]) => Number(genreId));

      console.log(
        `No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for promoter ${promoterId}, ` +
        `fallback top ${fallbackGenres} without threshold${isFestival ? ' (festival)' : ''}:`,
        topGenreIds
      );
    } else {
      console.log(
        `Top genres for promoter ${promoterId} (threshold ${MIN_GENRE_OCCURRENCE}${isFestival ? ', festival - max ' + maxGenres : ''}):`,
        topGenreIds
      );
    }

    // 5) Save in promoter_genre
    for (const genreId of topGenreIds) {
      await ensureRelation(
        supabase,
        "promoter_genre",
        { promoter_id: promoterId, genre_id: genreId },
        "promoter_genre"
      );
    }

    return topGenreIds;
  } catch (error) {
    console.error(`Error assigning genres to promoter ${promoterId}:`, error);
    return [];
  }
}

/**
 * Assigns genres to an event based on the artists performing in it.
 * Replicates functionality from models/genre.js
 */
async function assignEventGenres(supabase: any, eventId: number, bannedGenreIds: number[], isFestival: boolean = false): Promise<number[]> {
  try {
    // Get all artists for this event
    const { data: eventArtists, error: eaError } = await supabase
      .from('event_artist')
      .select('artist_id')
      .eq('event_id', eventId);
      
    if (eaError) throw eaError;

    const genreCounts: { [genreId: number]: number } = {};
    
    // Count genres from all artists
    for (const { artist_id } of eventArtists) {
      const artistIds = Array.isArray(artist_id) ? artist_id : [artist_id];
      
      for (const aid of artistIds) {
        const { data: artistGenres, error: agError } = await supabase
          .from('artist_genre')
          .select('genre_id')
          .eq('artist_id', parseInt(aid.toString(), 10));
          
        if (agError) throw agError;
        
        artistGenres.forEach((g: any) => {
          genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
        });
      }
    }

    // Determine max genres based on festival status
    const MIN_GENRE_OCCURRENCE = 1;
    const MAX_GENRES_REGULAR = 3;
    const MAX_GENRES_FESTIVAL = 8;
    const FESTIVAL_FALLBACK_GENRES = 5;
    
    const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
    const fallbackGenres = isFestival ? FESTIVAL_FALLBACK_GENRES : 3;

    let topGenreIds = Object.entries(genreCounts)
      .filter(([genreId, count]) =>
        count >= MIN_GENRE_OCCURRENCE &&
        !bannedGenreIds.includes(Number(genreId))
      )
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, maxGenres)
      .map(([genreId]) => Number(genreId));

    // Fallback: always attempt to assign top genres, even if genreCounts is empty
    if (topGenreIds.length === 0) {
      topGenreIds = Object.entries(genreCounts)
        .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
        .sort(([, a], [, b]) => Number(b) - Number(a))
        .slice(0, fallbackGenres)
        .map(([genreId]) => Number(genreId));

      if (topGenreIds.length === 0) {
        console.log(`No artist genre found for event ${eventId}, fallback is empty.`);
      } else {
        console.log(
          `No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for event ${eventId}, fallback to top ${fallbackGenres} non-banned genres${isFestival ? ' (festival)' : ''}:`,
          topGenreIds
        );
      }
    } else {
      console.log(
        `Top genres for event ${eventId} (threshold ${MIN_GENRE_OCCURRENCE}${isFestival ? ', festival - max ' + maxGenres : ''}):`,
        topGenreIds
      );
    }

    // Create event-genre relationships
    for (const genreId of topGenreIds) {
      await ensureRelation(
        supabase,
        "event_genre",
        { event_id: eventId, genre_id: genreId },
        "event_genre"
      );
    }

    return topGenreIds;
  } catch (error) {
    console.error(`Error assigning genres to event ${eventId}:`, error);
    return [];
  }
}

/**
 * Update queue status in database
 */
async function updateQueueStatus(
  supabase: any,
  queueId: number | undefined,
  status: string,
  eventId?: number,
  artistsCount?: number,
  errorMessage?: string,
  processingLogs?: any
) {
  if (!queueId) return;
  
  try {
    const { error } = await supabase.rpc('update_event_processing_status', {
      queue_id: queueId,
      new_status: status,
      event_id: eventId,
      artists_count: artistsCount || 0,
      error_message: errorMessage,
      processing_logs_data: processingLogs
    });
    
    if (error) {
      console.error('Error updating queue status:', error);
    } else {
      console.log(`Queue status updated: ${status} for queue ID ${queueId}`);
    }
  } catch (err) {
    console.error('Failed to update queue status:', err);
  }
}

/**
 * Timeout wrapper pour éviter les événements bloqués
 */
async function processWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  supabase: any,
  queueId?: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      console.error(`❌ Timeout après ${timeoutMs}ms - remise en pending`);
      if (queueId) {
        await updateQueueStatus(supabase, queueId, 'pending', undefined, 0, `Timeout après ${timeoutMs}ms`);
      }
      reject(new Error(`Timeout après ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/**
 * Process promoters (replicated from local script)
 */
async function processPromoters(supabase: any, promotersList: string[], eventData: any, isDryRun: boolean = false): Promise<Array<{id: number | null, name: string, image_url: string | null}>> {
  const promoterInfos: Array<{id: number | null, name: string, image_url: string | null}> = [];
  
  for (const promoterName of promotersList) {
    if (!promoterName) continue;
    console.log(`🔍 Processing promoter "${promoterName}"...`);
    
    let info: {id: number | null, name: string, image_url: string | null} = { id: null, name: promoterName, image_url: null };
    
    if (isDryRun) {
      console.log(`(DRY_RUN) Would find/insert promoter: "${promoterName}"`);
    } else {
      // Simple promoter insertion logic
      const { data: existing, error: findError } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .eq('name', promoterName)
        .single();
      
      if (existing) {
        info = existing;
        console.log(`➡️ Promoter found: ${promoterName} (id=${existing.id})`);
      } else {
        // Insert new promoter
        const newPromoter = {
          name: promoterName,
          image_url: null // Could be enriched later
        };
        
        const { data: inserted, error: insertError } = await supabase
          .from('promoters')
          .insert(newPromoter)
          .select('id, name, image_url')
          .single();
          
        if (inserted) {
          info = inserted;
          console.log(`✅ New promoter inserted: ${promoterName} (id=${inserted.id})`);
        } else {
          console.error(`❌ Failed to insert promoter ${promoterName}:`, insertError);
        }
      }
    }
    
    promoterInfos.push(info);
  }
  
  return promoterInfos;
}

/**
 * Process venue (simplified from local script)
 */
async function processVenue(
  supabase: any, 
  venueName: string | null, 
  venueAddress: string | null,
  venueCity: string | null,
  venueCountry: string | null,
  venueLatitude: number | null,
  venueLongitude: number | null,
  promoterInfos: Array<{id: number | null, name: string, image_url: string | null}>,
  isDryRun: boolean = false
): Promise<number | null> {
  if (!venueName) return null;
  
  console.log(`🔍 Processing venue "${venueName}"...`);
  const normalizedVenueName = getNormalizedName(venueName);
  
  if (isDryRun) {
    console.log(`(DRY_RUN) Would find/insert venue "${venueName}" / Address: "${venueAddress}"`);
    return 999; // Dummy ID
  }
  
  let venueId = null;
  
  // Search by address first
  if (venueAddress) {
    const { data: venuesByAddress, error: vAddrError } = await supabase
      .from('venues')
      .select('id, location, name')
      .eq('location', venueAddress);
      
    if (venuesByAddress && venuesByAddress.length > 0) {
      venueId = venuesByAddress[0].id;
      console.log(`➡️ Venue found by address: "${venueAddress}" (id=${venueId}).`);
      return venueId;
    }
  }
  
  // Search by normalized name
  const { data: venuesByName, error: vNameError } = await supabase
    .from('venues')
    .select('id, name, location')
    .eq('name', normalizedVenueName);
    
  if (venuesByName && venuesByName.length > 0) {
    venueId = venuesByName[0].id;
    console.log(`➡️ Venue "${normalizedVenueName}" found by exact name (id=${venueId}).`);
    return venueId;
  }
  
  // Fuzzy search
  const { data: allVenues, error: allVenuesError } = await supabase
    .from('venues')
    .select('id, name, location');
    
  if (allVenues) {
    const match = allVenues.find(v =>
      stringSimilarity.compareTwoStrings(
        v.name.toLowerCase(),
        normalizedVenueName.toLowerCase()
      ) >= FUZZY_THRESHOLD
    );
    
    if (match) {
      venueId = match.id;
      console.log(`➡️ Venue "${normalizedVenueName}" is similar to "${match.name}" (id=${venueId}).`);
      return venueId;
    }
  }
  
  // Insert new venue
  console.log(`➡️ No venue found for "${normalizedVenueName}". Inserting new venue...`);
  
  const newVenueData: any = {
    name: normalizedVenueName,
    location: venueAddress || venueName,
    geo: {}
  };
  
  if (venueCity) newVenueData.geo.locality = venueCity;
  if (venueCountry) newVenueData.geo.country = venueCountry;
  if (venueLatitude && venueLongitude) {
    newVenueData.location_point = `SRID=4326;POINT(${venueLongitude} ${venueLatitude})`;
  }
  
  // Copy image from matching promoter if available
  const normVenue = normalizeNameEnhanced(normalizedVenueName).toLowerCase();
  const matchingPromo = promoterInfos.find(p =>
    p.image_url &&
    normalizeNameEnhanced(p.name).toLowerCase() === normVenue
  );
  if (matchingPromo) {
    newVenueData.image_url = matchingPromo.image_url;
    console.log(`➡️ Copied image from promoter "${matchingPromo.name}" to new venue "${normalizedVenueName}".`);
  }

  // Try to fetch Google Maps venue photo if no image yet (replicated from local script)
  if (!newVenueData.image_url) {
    try {
      console.log(`🔍 Attempting to fetch Google Maps photo for venue "${venueName}"`);
      const venueImageUrl = await fetchGoogleVenuePhoto(venueName, venueAddress || venueName);
      if (venueImageUrl) {
        newVenueData.image_url = venueImageUrl;
        console.log(`📸 Got Google Maps photo for venue "${venueName}"`);
      }
    } catch (photoError) {
      console.warn(`⚠️ Could not retrieve Google photo for venue "${normalizedVenueName}": ${photoError.message}`);
    }
  }
  
  const { data: newVenue, error: insertVenueError } = await supabase
    .from('venues')
    .insert(newVenueData)
    .select('id')
    .single();
    
  if (newVenue) {
    venueId = newVenue.id;
    console.log(`✅ New venue inserted: "${normalizedVenueName}" (id=${venueId}).`);
  } else {
    console.error(`❌ Venue insertion failed:`, insertVenueError);
  }
  
  return venueId;
}

/**
 * Ensure database relation exists
 */
async function ensureRelation(supabase: any, tableName: string, relationData: any, logName: string) {
  const { data: existing, error: findError } = await supabase
    .from(tableName)
    .select('*')
    .match(relationData);
    
  if (existing && existing.length > 0) {
    console.log(`➡️ ${logName} relation already exists`);
  } else {
    const { error: insertError } = await supabase
      .from(tableName)
      .insert(relationData);
      
    if (insertError) {
      console.error(`❌ Failed to create ${logName} relation:`, insertError);
    } else {
      console.log(`✅ ${logName} relation created`);
    }
  }
}

/**
 * Main handler for the process-event Edge Function
 * Replicates the exact logic of the local import_event.js script
 */
Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  const startTime = Date.now();
  let queueId: number | undefined;
  
  try {
    // Environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, serviceKey);

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // Parse request - support both eventId and eventUrl
    const requestBody = await req.json();
    const { eventId, eventUrl, queueId: requestQueueId, skipArtists = false, forceFestival = false } = requestBody;
    queueId = requestQueueId;

    // Determine Facebook event URL
    let facebookEventUrl: string;
    if (eventUrl) {
      facebookEventUrl = eventUrl;
    } else if (eventId) {
      facebookEventUrl = `https://www.facebook.com/events/${eventId}`;
    } else {
      const error = 'Either eventId or eventUrl is required';
      await updateQueueStatus(supabase, queueId, 'error', undefined, 0, error);
      return new Response(
        JSON.stringify({ error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing Facebook event: ${facebookEventUrl} (Queue ID: ${queueId || 'direct'})`);

    // Get banned genre IDs
    let bannedGenreIds: number[] = [];
    try {
      const { data: bannedGenresData, error: genreError } = await supabase
        .from('genres')
        .select('id')
        .in('name', bannedGenres);
        
      if (bannedGenresData) {
        bannedGenreIds = bannedGenresData.map(g => g.id);
        console.log(`📋 Loaded ${bannedGenreIds.length} banned genre IDs`);
      }
    } catch (genreError) {
      console.warn('⚠️ Could not load banned genres:', genreError);
    }

    // Wrapper avec timeout pour éviter les blocages
    const result = await processWithTimeout(
      async () => {
        // === SCRAPING FACEBOOK EVENT (exactly like local script) ===
        console.log("🔎 Scraping the Facebook event...");
        const eventData = await scrapeFbEvent(facebookEventUrl);
        console.log(`✅ Scraped data for event: "${eventData.name}" (Facebook ID: ${eventData.id})`);

        // === FESTIVAL DETECTION (exactly like local script) ===
        console.log("\n🎪 Analyzing event to detect if it's a festival...");
        const festivalDetection = detectFestival(eventData, { forceFestival });
        console.log(`Festival detection result: ${festivalDetection.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (confidence: ${festivalDetection.confidence}%)`);
        console.log(`Detection reasons: ${festivalDetection.reasons.join(', ')}`);
        
        if (festivalDetection.duration) {
          console.log(`⏱️ Event duration: ${festivalDetection.duration.hours.toFixed(1)} hours (${festivalDetection.duration.days} days)`);
        }

        // Determine import strategy
        let importStrategy = 'simple';
        let timetableData: any[] | null = null;
        let clashfinderResult = null;
        
        if (forceFestival || festivalDetection.isFestival || 
            (festivalDetection.duration && festivalDetection.duration.hours > 24)) {
          importStrategy = 'festival';
          const durationText = festivalDetection.duration ? 
            `${festivalDetection.duration.hours.toFixed(1)}h` : 'unknown duration';
          console.log(`🎪 Event detected as FESTIVAL (${durationText}) - will attempt timetable import`);
          
          // Implement Clashfinder integration
          try {
            console.log('\n🔍 Attempting Clashfinder integration...');
            const { getClashfinderTimetable, parseClashfinderData } = await import('./utils/clashfinder.ts');
            const clashfinderResult = await getClashfinderTimetable(eventData.name || 'Unknown Event', {
              minSimilarity: 30
            });
            
            if (clashfinderResult) {
              console.log(`✅ Clashfinder festival found: ${clashfinderResult.festival.name} (similarity: ${clashfinderResult.similarity}%)`);
              const parsedTimetable = await parseClashfinderData(clashfinderResult);
              
              if (parsedTimetable && parsedTimetable.length > 0) {
                console.log(`✅ Clashfinder timetable parsed: ${parsedTimetable.length} performances`);
                importStrategy = 'festival';
                timetableData = parsedTimetable;
              } else {
                console.log(`❌ No performances found in Clashfinder data - falling back to simple processing`);
                importStrategy = 'simple_fallback';
              }
            } else {
              console.log(`❌ No Clashfinder data found for "${eventData.name || 'Unknown Event'}" - falling back to simple processing`);
              importStrategy = 'simple_fallback';
            }
          } catch (clashfinderError) {
            console.error(`❌ Clashfinder integration error:`, clashfinderError);
            console.log(`🔄 Falling back to simple processing`);
            importStrategy = 'simple_fallback';
          }
        } else {
          const durationText = festivalDetection.duration ? 
            `${festivalDetection.duration.hours.toFixed(1)}h` : 'no duration data';
          console.log(`📝 Event detected as SIMPLE EVENT (${durationText}) - will use OpenAI artist parsing`);
        }

        // === EXTRACT DATA FROM SCRAPER RESULT (exactly like local script) ===
        const eventName = eventData.name || null;
        const eventDescription = eventData.description || null;
        const eventType = (importStrategy === 'festival') ? 'festival' : 
                         ((eventData.categories && eventData.categories.length) ? eventData.categories[0].label : null);
        const startTimeISO = eventData.startTimestamp ? new Date(eventData.startTimestamp * 1000).toISOString() : null;
        const endTimeISO = eventData.endTimestamp ? new Date(eventData.endTimestamp * 1000).toISOString() : null;
        const fbEventUrl = eventData.url || facebookEventUrl;

        const promotersList = eventData.hosts ? eventData.hosts.map(h => h.name) : [];

        const location = eventData.location || null;
        const venueName = location ? location.name : null;
        let venueAddress = location ? location.address : null;
        const venueCity = location && location.city ? location.city.name : null;
        const venueCountry = location ? location.countryCode : null;
        const venueLatitude = (location && location.coordinates) ? location.coordinates.latitude : null;
        const venueLongitude = (location && location.coordinates) ? location.coordinates.longitude : null;

        // Log image info
        if (eventData.photo && eventData.photo.imageUri) {
          console.log(`🖼️ Event image found: ${eventData.photo.imageUri}`);
        } else {
          console.log('⚠️ No event image found');
        }

        // === PROCESS PROMOTERS (exactly like local script) ===
        const promoterInfos = await processPromoters(supabase, promotersList, eventData, false);
        const promoterIds = promoterInfos.map(p => p.id).filter(id => id);

        // === PROCESS VENUE (exactly like local script) ===  
        const venueId = await processVenue(
          supabase, 
          venueName, 
          venueAddress,
          venueCity,
          venueCountry,
          venueLatitude,
          venueLongitude,
          promoterInfos,
          false
        );

        // === PROCESS EVENT (exactly like local script) ===
        console.log(`\n📝 Checking if event "${eventName}" already exists in the database...`);
        let eventId = null;
        
        // Search by URL first (primary key for uniqueness)
        const { data: eventsByUrl, error: eventsByUrlError } = await supabase
          .from('events')
          .select('id, metadata, description, date_time, end_date_time')
          .ilike('metadata->>facebook_url', fbEventUrl);

        if (eventsByUrl && eventsByUrl.length > 0) {
          eventId = eventsByUrl[0].id;
          console.log(`➡️ Event found by facebook_url (id=${eventId}).`);
          
          // Check for updates
          console.log("\n🔄 Event already exists. Checking for updates...");
          const existing = eventsByUrl[0];
          const updates: any = {};
          
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
              
            if (updateErr) {
              console.error('❌ Event update failed:', updateErr);
            } else {
              console.log(`🔄 Event (id=${eventId}) updated:`, updates);
            }
          } else {
            console.log(`ℹ️ Event (id=${eventId}) already up to date, no changes needed.`);
          }
        } else {
          // Insert new event
          console.log(`\n📝 Inserting event "${eventName}" into the events table...`);
          const metadata: any = { facebook_url: fbEventUrl };
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
            .select('id')
            .single();
            
          if (newEvent) {
            eventId = newEvent.id;
            console.log(`✅ Event inserted successfully (id=${eventId}).`);
          } else {
            throw new Error(`Event insertion failed: ${insertEventError?.message}`);
          }
        }

        // === CREATE RELATIONS (exactly like local script) ===
        if (eventId) {
          // event_promoter relations
          console.log("\n🔗 Ensuring event_promoter relations...");
          for (const pid of promoterIds) {
            if (pid) {
              await ensureRelation(supabase, "event_promoter", 
                { event_id: eventId, promoter_id: pid }, "event_promoter");
            }
          }

          // event_venue relation
          if (venueId) {
            console.log("\n🔗 Ensuring event_venue relation...");
            await ensureRelation(supabase, "event_venue",
              { event_id: eventId, venue_id: venueId }, "event_venue");
          }

          // venue_promoter relations
          if (venueId && venueName) {
            console.log("\n🔗 Ensuring venue_promoter relations...");
            for (const pInfo of promoterInfos) {
              if (pInfo.id && 
                  normalizeNameEnhanced(pInfo.name).toLowerCase() ===
                  normalizeNameEnhanced(venueName).toLowerCase()) {
                await ensureRelation(supabase, "venue_promoter",
                  { venue_id: venueId, promoter_id: pInfo.id }, "venue_promoter");
              }
            }
          }
        }

        // === IMPORT ARTISTS (exactly like local script) ===
        let totalArtists = 0;
        if (!skipArtists) {
          try {
            if (importStrategy === 'festival' && timetableData && eventId) {
              console.log('\n🎭 Processing festival timetable artists...');
              
              try {
                const { processFestivalTimetable } = await import('./utils/timetable.ts');
                const result = await processFestivalTimetable(supabase, eventId, timetableData, null, { dryRun: false });
                totalArtists = result.successCount;
                console.log(`✅ Festival timetable processing complete: ${totalArtists} artists processed`);
                console.log(`📊 Processing stats: ${result.processedCount} processed, ${result.successCount} successful, ${result.soundCloudFoundCount} with SoundCloud data`);
                if (result.errors.length > 0) {
                  console.log(`⚠️ Processing errors: ${result.errors.length} errors occurred`);
                }
              } catch (timetableError) {
                console.error('❌ Timetable processing failed:', timetableError);
                console.log('🔄 Falling back to simple event processing...');
                
                // Fallback to simple processing
                if (eventDescription && eventId) {
                  try {
                    const artistIds = await processSimpleEventArtists(supabase, eventId, eventDescription, false);
                    totalArtists = artistIds.length;
                    console.log(`✅ Fallback simple event processing complete: ${totalArtists} artists processed`);
                  } catch (fallbackError) {
                    console.error('❌ Fallback artist processing also failed:', fallbackError);
                    totalArtists = 0;
                  }
                } else {
                  console.log('⚠️ No event description available for fallback processing');
                  totalArtists = 0;
                }
              }
            } else {
              console.log('\n🎭 Processing simple event artists with OpenAI...');
              if (eventDescription && eventId) {
                // Use our complete artist processing function (matches local script exactly)
                try {
                  const artistIds = await processSimpleEventArtists(supabase, eventId, eventDescription, false);
                  totalArtists = artistIds.length;
                  console.log(`✅ Simple event processing complete: ${totalArtists} artists processed`);
                } catch (artistError) {
                  console.error('❌ Artist processing failed:', artistError);
                  totalArtists = 0;
                }
              } else {
                console.log('⚠️ No event description or event ID available for artist extraction');
                totalArtists = 0;
              }
            }
          } catch (artistError) {
            console.error('❌ Artist processing error:', artistError);
            totalArtists = 0;
          }
        } else {
          console.log('⏭️ Skipping artist import as requested');
        }

        // === POST-PROCESSING: ASSIGN GENRES (exactly like local script) ===
        if (eventId && bannedGenreIds.length > 0) {
          try {
            console.log('\n🏷️ Assigning event genres...');
            const assignedGenres = await assignEventGenres(supabase, eventId, bannedGenreIds, festivalDetection.isFestival);
            console.log(`✅ Assigned ${assignedGenres.length} genres to event.`);
          } catch (err) {
            console.error("Error assigning event genres:", err);
          }
        }

        if (promoterIds.length > 0 && bannedGenreIds.length > 0) {
          for (const promoterId of promoterIds) {
            if (!promoterId) continue;
            try {
              console.log(`🏷️ Assigning genres for promoter id=${promoterId}...`);
              const assignedGenres = await assignPromoterGenres(supabase, promoterId, bannedGenreIds, festivalDetection.isFestival);
              console.log(`✅ Assigned ${assignedGenres.length} genres to promoter id=${promoterId}.`);
            } catch (err) {
              console.error(`Error assigning genres for promoter id=${promoterId}:`, err);
            }
          }
        }

        // === SUCCESS MESSAGE (exactly like local script) ===
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
        console.log(`⏱️ Total execution time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        console.log('🎉 ============================================\n');

        return {
          success: true,
          eventId: eventId,
          eventName: eventName,
          importStrategy: importStrategy,
          isFestival: festivalDetection.isFestival,
          artistsProcessed: totalArtists,
          promotersProcessed: promoterIds.length,
          venueId: venueId,
          processingTime: Date.now() - startTime
        };
      },
      240000, // Timeout de 4 minutes 
      supabase,
      queueId
    );

    // Marquer comme terminé
    await updateQueueStatus(supabase, queueId, 'completed', result.eventId || undefined, result.artistsProcessed);

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('❌ Error processing event:', error);
    
    // Update queue status to error
    try {
      if (queueId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, serviceKey);
        
        const errorMsg = error.message || 'Internal server error';
        await updateQueueStatus(supabase, queueId, 'error', undefined, 0, errorMsg);
      }
    } catch (updateError) {
      console.error('Failed to update queue status on error:', updateError);
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message || 'Unknown error',
        queueId 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
