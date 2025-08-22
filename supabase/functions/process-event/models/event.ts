/**
 * models/event.ts
 * 
 * Event model with full Facebook data processing and enrichment
 * Ported from original Node.js models/event.js to Deno/TypeScript
 */

// Edge Functions runtime globals
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

import { createOrUpdateVenue, type FacebookVenueData } from './venue.ts';
import { createOrUpdateArtist } from './artist.ts';
import { detectFestival, type EventData, type FestivalDetectionResult } from '../utils/festival-detection.ts';
import { extractArtistNamesFromTitle } from '../utils/name.ts';
import { withDatabaseRetry } from '../utils/retry.ts';

/**
 * Event interface
 */
export interface Event {
    id?: number;
    facebook_id: string;
    name: string;
    description?: string;
    start_time: string;
    end_time?: string;
    timezone?: string;
    is_online?: boolean;
    is_cancelled?: boolean;
    venue_id?: number;
    promoter_id?: number;
    cover_image_url?: string;
    ticket_url?: string;
    attending_count?: number;
    interested_count?: number;
    maybe_count?: number;
    is_festival?: boolean;
    festival_confidence?: number;
    created_at?: string;
    updated_at?: string;
}

/**
 * Facebook event data structure
 */
export interface FacebookEventData {
    id: string;
    name: string;
    description?: string;
    start_time: string;
    end_time?: string;
    timezone?: string;
    is_online?: boolean;
    is_cancelled?: boolean;
    cover?: {
        source?: string;
        id?: string;
    };
    place?: FacebookVenueData;
    attending_count?: number;
    interested_count?: number;
    maybe_count?: number;
    ticket_uri?: string;
    owner?: {
        id?: string;
        name?: string;
    };
}

/**
 * Event artist relationship
 */
export interface EventArtist {
    event_id: number;
    artist_id: number;
    is_headliner?: boolean;
    stage?: string;
    time_slot?: string;
}

/**
 * Create or update event from Facebook data
 */
export async function createEventFromFacebook(
    supabase: any,
    facebookEventData: FacebookEventData,
    forceFestival: boolean = false
): Promise<Event | null> {
    if (!facebookEventData.id || !facebookEventData.name || !facebookEventData.start_time) {
        console.error('Invalid Facebook event data: missing required fields');
        return null;
    }

    try {
        console.log(`Processing Facebook event: "${facebookEventData.name}" (ID: ${facebookEventData.id})`);

        // Check if event already exists
        const existingEvent = await findEventByFacebookId(supabase, facebookEventData.id);
        if (existingEvent) {
            console.log(`Event already exists with ID ${existingEvent.id}`);
            return existingEvent;
        }

        // Festival detection
        const festivalDetection = detectFestival({
            name: facebookEventData.name,
            start_time: facebookEventData.start_time,
            end_time: facebookEventData.end_time,
            description: facebookEventData.description
        }, { forceFestival });

        console.log(`Festival detection for "${facebookEventData.name}": ${festivalDetection.isFestival} (${festivalDetection.confidence}%)`);

        // Create or find venue
        let venueId: number | null = null;
        if (facebookEventData.place) {
            const venue = await createOrUpdateVenue(supabase, facebookEventData.place);
            if (venue?.id) {
                venueId = venue.id;
                console.log(`Associated with venue: ${venue.name} (ID: ${venueId})`);
            }
        }

        // Create event record
        const event = await createEventRecord(supabase, facebookEventData, festivalDetection, venueId);
        if (!event) {
            console.error('Failed to create event record');
            return null;
        }

        console.log(`Created event: "${event.name}" (ID: ${event.id})`);

        // Process artists from event name
        await processEventArtists(supabase, event, facebookEventData.name, festivalDetection.isFestival);

        return event;

    } catch (error) {
        console.error(`Error creating event from Facebook data:`, error);
        return null;
    }
}

/**
 * Find event by Facebook ID
 */
async function findEventByFacebookId(supabase: any, facebookId: string): Promise<Event | null> {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('facebook_id', facebookId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            throw error;
        }

        return data;
    } catch (error) {
        console.error(`Error finding event by Facebook ID ${facebookId}:`, error);
        return null;
    }
}

/**
 * Create event database record
 */
async function createEventRecord(
    supabase: any,
    facebookData: FacebookEventData,
    festivalDetection: FestivalDetectionResult,
    venueId: number | null
): Promise<Event | null> {
    try {
        const eventData: Omit<Event, 'id' | 'created_at' | 'updated_at'> = {
            facebook_id: facebookData.id,
            name: facebookData.name,
            description: facebookData.description,
            start_time: facebookData.start_time,
            end_time: facebookData.end_time,
            timezone: facebookData.timezone,
            is_online: facebookData.is_online || false,
            is_cancelled: facebookData.is_cancelled || false,
            venue_id: venueId || undefined,
            cover_image_url: facebookData.cover?.source,
            ticket_url: facebookData.ticket_uri,
            attending_count: facebookData.attending_count || 0,
            interested_count: facebookData.interested_count || 0,
            maybe_count: facebookData.maybe_count || 0,
            is_festival: festivalDetection.isFestival,
            festival_confidence: festivalDetection.confidence
        };

        const { data, error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('events')
                .insert([eventData])
                .select()
                .single();
        });

        if (error) {
            throw error;
        }

        return data;

    } catch (error) {
        console.error('Error creating event record:', error);
        return null;
    }
}

/**
 * Process and create artists from event name
 */
async function processEventArtists(
    supabase: any,
    event: Event,
    eventName: string,
    isFestival: boolean
): Promise<void> {
    try {
        console.log(`Processing artists for event: "${eventName}"`);

        // Extract artist names from event title
        const artistNames = extractArtistNamesFromTitle(eventName);
        
        if (artistNames.length === 0) {
            console.log(`No artists detected in event name: "${eventName}"`);
            return;
        }

        console.log(`Detected ${artistNames.length} artists: ${artistNames.join(', ')}`);

        // Process each artist
        const artistPromises = artistNames.map(async (artistName, index) => {
            try {
                // Create or update artist with enrichment
                const artist = await createOrUpdateArtist(supabase, artistName, isFestival);
                
                if (artist?.id) {
                    // Link artist to event
                    await linkArtistToEvent(supabase, event.id!, artist.id, {
                        is_headliner: index === 0, // First artist is usually headliner
                        stage: undefined,
                        time_slot: undefined
                    });
                    
                    console.log(`Linked artist "${artistName}" to event (ID: ${artist.id})`);
                } else {
                    console.warn(`Failed to create/update artist: "${artistName}"`);
                }
            } catch (error) {
                console.error(`Error processing artist "${artistName}":`, error);
            }
        });

        await Promise.all(artistPromises);

    } catch (error) {
        console.error(`Error processing artists for event "${eventName}":`, error);
    }
}

/**
 * Link artist to event
 */
async function linkArtistToEvent(
    supabase: any,
    eventId: number,
    artistId: number,
    options: Partial<EventArtist> = {}
): Promise<boolean> {
    try {
        // Check if relationship already exists
        const { data: existing } = await supabase
            .from('events_artists')
            .select('*')
            .eq('event_id', eventId)
            .eq('artist_id', artistId)
            .single();

        if (existing) {
            console.log(`Artist-event relationship already exists: ${artistId} - ${eventId}`);
            return true;
        }

        // Create relationship
        const { error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('events_artists')
                .insert([{
                    event_id: eventId,
                    artist_id: artistId,
                    is_headliner: options.is_headliner || false,
                    stage: options.stage,
                    time_slot: options.time_slot
                }]);
        });

        if (error) {
            throw error;
        }

        return true;

    } catch (error) {
        console.error(`Error linking artist ${artistId} to event ${eventId}:`, error);
        return false;
    }
}

/**
 * Update event data from Facebook
 */
export async function updateEventFromFacebook(
    supabase: any,
    facebookEventData: FacebookEventData
): Promise<Event | null> {
    if (!facebookEventData.id) {
        console.error('Facebook event ID is required for update');
        return null;
    }

    try {
        const existingEvent = await findEventByFacebookId(supabase, facebookEventData.id);
        if (!existingEvent) {
            console.log('Event not found, creating new one');
            return await createEventFromFacebook(supabase, facebookEventData);
        }

        // Update event data
        const updateData: Partial<Event> = {
            name: facebookEventData.name,
            description: facebookEventData.description,
            start_time: facebookEventData.start_time,
            end_time: facebookEventData.end_time,
            timezone: facebookEventData.timezone,
            is_online: facebookEventData.is_online || false,
            is_cancelled: facebookEventData.is_cancelled || false,
            cover_image_url: facebookEventData.cover?.source,
            ticket_url: facebookEventData.ticket_uri,
            attending_count: facebookEventData.attending_count || 0,
            interested_count: facebookEventData.interested_count || 0,
            maybe_count: facebookEventData.maybe_count || 0,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('events')
                .update(updateData)
                .eq('id', existingEvent.id)
                .select()
                .single();
        });

        if (error) {
            throw error;
        }

        console.log(`Updated event: "${data.name}" (ID: ${data.id})`);
        return data;

    } catch (error) {
        console.error(`Error updating event from Facebook data:`, error);
        return null;
    }
}

/**
 * Get event with related data (venue, artists, genres)
 */
export async function getEventWithDetails(supabase: any, eventId: number): Promise<any | null> {
    try {
        const { data, error } = await supabase
            .from('events')
            .select(`
                *,
                venues (*),
                events_artists (
                    is_headliner,
                    stage,
                    time_slot,
                    artists (
                        *,
                        artists_genres (
                            confidence,
                            source,
                            genres (
                                name,
                                description
                            )
                        )
                    )
                )
            `)
            .eq('id', eventId)
            .single();

        if (error) {
            throw error;
        }

        return data;

    } catch (error) {
        console.error(`Error getting event details for ID ${eventId}:`, error);
        return null;
    }
}

/**
 * Get events by venue
 */
export async function getEventsByVenue(
    supabase: any,
    venueId: number,
    limit: number = 20
): Promise<Event[]> {
    try {
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('venue_id', venueId)
            .order('start_time', { ascending: false })
            .limit(limit);

        if (error) {
            throw error;
        }

        return data || [];

    } catch (error) {
        console.error(`Error getting events for venue ID ${venueId}:`, error);
        return [];
    }
}

/**
 * Get events by artist
 */
export async function getEventsByArtist(
    supabase: any,
    artistId: number,
    limit: number = 20
): Promise<Event[]> {
    try {
        const { data, error } = await supabase
            .from('events_artists')
            .select(`
                events (*)
            `)
            .eq('artist_id', artistId)
            .order('events(start_time)', { ascending: false })
            .limit(limit);

        if (error) {
            throw error;
        }

        return data?.map((ea: any) => ea.events) || [];

    } catch (error) {
        console.error(`Error getting events for artist ID ${artistId}:`, error);
        return [];
    }
}

/**
 * Get upcoming events
 */
export async function getUpcomingEvents(
    supabase: any,
    limit: number = 50
): Promise<Event[]> {
    try {
        const now = new Date().toISOString();
        
        const { data, error } = await supabase
            .from('events')
            .select('*')
            .gte('start_time', now)
            .eq('is_cancelled', false)
            .order('start_time', { ascending: true })
            .limit(limit);

        if (error) {
            throw error;
        }

        return data || [];

    } catch (error) {
        console.error('Error getting upcoming events:', error);
        return [];
    }
}

/**
 * Mark event as processed
 */
export async function markEventAsProcessed(
    supabase: any,
    facebookId: string
): Promise<boolean> {
    try {
        const { error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('events')
                .update({ updated_at: new Date().toISOString() })
                .eq('facebook_id', facebookId);
        });

        if (error) {
            throw error;
        }

        return true;

    } catch (error) {
        console.error(`Error marking event as processed (Facebook ID: ${facebookId}):`, error);
        return false;
    }
}

/**
 * Delete event and related data
 */
export async function deleteEvent(supabase: any, eventId: number): Promise<boolean> {
    try {
        // Delete related artist relationships first
        await supabase
            .from('events_artists')
            .delete()
            .eq('event_id', eventId);

        // Delete event
        const { error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('events')
                .delete()
                .eq('id', eventId);
        });

        if (error) {
            throw error;
        }

        console.log(`Deleted event ID ${eventId}`);
        return true;

    } catch (error) {
        console.error(`Error deleting event ID ${eventId}:`, error);
        return false;
    }
}
