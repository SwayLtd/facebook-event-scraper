/**
 * Clashfinder Timetable Processing Module
 * Adapted from get_clashfinder_timetable.js for Deno Edge Functions
 * 
 * Processes Clashfinder.com timetables to extract structured event data
 * and link it to festival events in the database.
 */

import { withApiRetry } from '../utils/retry.ts';
import { normalizeNameEnhanced, extractArtistNamesFromTitle, areNamesSimilar } from '../utils/name.ts';
import { KNOWN_FESTIVALS } from '../utils/constants.ts';

/**
 * Clashfinder event data structure
 */
interface ClashfinderEvent {
  id: string;
  name: string;
  venue: string;
  start: string; // ISO timestamp
  end: string;   // ISO timestamp
  day: string;
  artists?: string[];
}

/**
 * Clashfinder timetable response structure
 */
interface ClashfinderTimetable {
  events: ClashfinderEvent[];
  festival: {
    name: string;
    year: number;
    startDate: string;
    endDate: string;
    venues: string[];
  };
}

/**
 * Configuration for timetable processing
 */
interface TimetableConfig {
  supabase: any; // Supabase client
  festivalEventId?: string;
  enrichmentConfig?: {
    soundcloudClientId?: string;
    soundcloudSecret?: string;
    openAIApiKey?: string;
    lastFmApiKey?: string;
  };
}

/**
 * Processing results
 */
interface TimetableProcessingResult {
  success: boolean;
  eventsProcessed: number;
  artistsFound: number;
  venuesProcessed: number;
  errors: string[];
}

/**
 * Fetch timetable data from Clashfinder.com
 */
async function fetchClashfinderTimetable(festivalName: string, year?: number): Promise<ClashfinderTimetable | null> {
  try {
    // Normalize festival name for Clashfinder URL
    const normalizedName = festivalName
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    const currentYear = year || new Date().getFullYear();
    const url = `https://clashfinder.com/${normalizedName}${currentYear}/data.json`;
    
    console.log(`Fetching Clashfinder timetable: ${url}`);
    
    const response = await withApiRetry(
      () => fetch(url),
      { maxRetries: 3, baseDelay: 1000, maxDelay: 5000 }
    );
    
    if (!response.ok) {
      console.log(`Clashfinder data not found for ${festivalName} ${currentYear}`);
      return null;
    }
    
    const data = await response.json();
    
    // Transform data to our expected format
    const timetable: ClashfinderTimetable = {
      events: data.events?.map((event: any) => ({
        id: event.id,
        name: event.name,
        venue: event.venue,
        start: event.start,
        end: event.end,
        day: event.day,
        artists: event.artists || extractArtistNamesFromTitle(event.name)
      })) || [],
      festival: {
        name: data.festival?.name || festivalName,
        year: currentYear,
        startDate: data.festival?.startDate || '',
        endDate: data.festival?.endDate || '',
        venues: data.festival?.venues || [...new Set(data.events?.map((e: any) => e.venue) || [])]
      }
    };
    
    console.log(`Retrieved ${timetable.events.length} events from Clashfinder`);
    return timetable;
    
  } catch (error) {
    console.error('Error fetching Clashfinder timetable:', error);
    return null;
  }
}

/**
 * Process a single timetable event
 */
async function processTimetableEvent(
  event: ClashfinderEvent,
  config: TimetableConfig
): Promise<{ eventId?: string; artistIds: string[]; errors: string[] }> {
  const errors: string[] = [];
  const artistIds: string[] = [];
  
  try {
    // Create event in database
    const eventData = {
      name: event.name,
      start_time: event.start,
      end_time: event.end,
      clashfinder_id: event.id,
      clashfinder_venue: event.venue,
      clashfinder_day: event.day,
      parent_event_id: config.festivalEventId || null,
      event_type: 'timetable_slot'
    };
    
    const { data: dbEvent, error: eventError } = await config.supabase
      .from('events')
      .upsert(eventData, {
        onConflict: 'clashfinder_id',
        ignoreDuplicates: false
      })
      .select('id')
      .single();
    
    if (eventError) {
      errors.push(`Failed to create event: ${eventError.message}`);
      return { artistIds, errors };
    }
    
    const eventId = dbEvent.id;
    
    // Process artists if enrichment is configured
    if (event.artists && config.enrichmentConfig) {
      for (const artistName of event.artists) {
        try {
          // Import artist model function
          const { createOrUpdateArtist } = await import('../models/artist.ts');
          
          const artistResult = await createOrUpdateArtist(
            config.supabase,
            artistName,
            false // isFestival
          );
          
          if (artistResult && artistResult.id) {
            artistIds.push(artistResult.id.toString());
            
            // Link artist to timetable event
            await config.supabase
              .from('event_artists')
              .upsert({
                event_id: eventId,
                artist_id: artistResult.id
              }, {
                onConflict: 'event_id,artist_id',
                ignoreDuplicates: true
              });
          }
          
        } catch (error) {
          errors.push(`Error processing artist ${artistName}: ${error.message}`);
        }
      }
    }
    
    return { eventId, artistIds, errors };
    
  } catch (error) {
    errors.push(`Error processing event ${event.name}: ${error.message}`);
    return { artistIds, errors };
  }
}

/**
 * Process venues from timetable
 */
async function processVenues(
  venues: string[],
  config: TimetableConfig
): Promise<{ venueIds: string[]; errors: string[] }> {
  const venueIds: string[] = [];
  const errors: string[] = [];
  
  for (const venueName of venues) {
    try {
      // Import venue model function
      const { createOrUpdateVenue } = await import('../models/venue.ts');
      
      const venueData = {
        name: venueName
      };
      
      const venueResult = await createOrUpdateVenue(
        venueData,
        config.supabase
      );
      
      if (venueResult && venueResult.id) {
        venueIds.push(venueResult.id.toString());
      }
      
    } catch (error) {
      errors.push(`Error processing venue ${venueName}: ${error.message}`);
    }
  }
  
  return { venueIds, errors };
}

/**
 * Process complete Clashfinder timetable
 */
export async function processClashfinderTimetable(
  festivalName: string,
  config: TimetableConfig,
  year?: number
): Promise<TimetableProcessingResult> {
  console.log(`Processing Clashfinder timetable for ${festivalName}`);
  
  const result: TimetableProcessingResult = {
    success: false,
    eventsProcessed: 0,
    artistsFound: 0,
    venuesProcessed: 0,
    errors: []
  };
  
  try {
    // Fetch timetable data
    const timetable = await fetchClashfinderTimetable(festivalName, year);
    
    if (!timetable) {
      result.errors.push('No timetable data found on Clashfinder');
      return result;
    }
    
    console.log(`Processing ${timetable.events.length} timetable events`);
    
    // Process venues first
    if (timetable.festival.venues.length > 0) {
      const venueResult = await processVenues(timetable.festival.venues, config);
      result.venuesProcessed = venueResult.venueIds.length;
      result.errors.push(...venueResult.errors);
    }
    
    // Process each timetable event
    for (const event of timetable.events) {
      const eventResult = await processTimetableEvent(event, config);
      
      if (eventResult.eventId) {
        result.eventsProcessed++;
      }
      
      result.artistsFound += eventResult.artistIds.length;
      result.errors.push(...eventResult.errors);
    }
    
    result.success = result.eventsProcessed > 0;
    
    console.log(`Timetable processing completed:`);
    console.log(`- Events processed: ${result.eventsProcessed}`);
    console.log(`- Artists found: ${result.artistsFound}`);
    console.log(`- Venues processed: ${result.venuesProcessed}`);
    console.log(`- Errors: ${result.errors.length}`);
    
    return result;
    
  } catch (error) {
    console.error('Error processing Clashfinder timetable:', error);
    result.errors.push(`Processing failed: ${error.message}`);
    return result;
  }
}

/**
 * Check if a festival has Clashfinder data available
 */
export async function hasClashfinderData(festivalName: string, year?: number): Promise<boolean> {
  try {
    const normalizedName = festivalName
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    
    const currentYear = year || new Date().getFullYear();
    const url = `https://clashfinder.com/${normalizedName}${currentYear}/data.json`;
    
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
    
  } catch (error) {
    return false;
  }
}

/**
 * Get available years for a festival on Clashfinder
 */
export async function getAvailableYears(festivalName: string): Promise<number[]> {
  const years: number[] = [];
  const currentYear = new Date().getFullYear();
  
  // Check last 5 years and next year
  for (let year = currentYear - 4; year <= currentYear + 1; year++) {
    if (await hasClashfinderData(festivalName, year)) {
      years.push(year);
    }
  }
  
  return years.sort((a, b) => b - a); // Most recent first
}
