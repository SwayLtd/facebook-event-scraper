// Event model pour Edge Functions
// Adaptation complète du modèle event JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { validateTimestamp } from '../utils/date.ts';
import { Event, Artist } from '../types/index.ts';

export interface EventMetadata {
  facebook_url?: string;
  ticket_link?: string;
  timetable?: boolean;
  stages?: string[];
  festival_days?: string[];
  [key: string]: any;
}

export interface PerformanceData {
  stage?: string | null;
  time?: string;
  end_time?: string;
  custom_name?: string | null;
}

/**
 * Finds an event in Supabase by Facebook URL, then by title if not found
 * @param params - Search parameters
 * @returns Promise with Event object or null if not found
 */
export async function findEvent(params: {
  facebookUrl?: string;
  title?: string;
}): Promise<Event | null> {
  const { facebookUrl, title } = params;
  
  // Try by Facebook URL
  if (facebookUrl) {
    logger.debug(`Searching event by Facebook URL: ${facebookUrl}`);
    const eventsByUrl = await db.getEventsByFacebookUrl(facebookUrl);
    if (eventsByUrl.length > 0) {
      logger.info(`Found event by Facebook URL: ${eventsByUrl[0].title}`);
      return eventsByUrl[0];
    }
  }
  
  // Try by title
  if (title) {
    logger.debug(`Searching event by title: ${title}`);
    const eventsByTitle = await db.getEventsByName(title);
    if (eventsByTitle.length > 0) {
      logger.info(`Found event by title: ${eventsByTitle[0].title}`);
      return eventsByTitle[0];
    }
  }
  
  return null;
}

/**
 * Updates event metadata with stages and festival days
 * @param event - Event object
 * @param newStages - Array of stage names
 * @param newFestivalDays - Array of festival day strings
 * @param dryRun - Whether to perform actual database updates
 * @returns Promise with updated metadata object
 */
export async function updateEventMetadata(
  event: Event,
  newStages: string[],
  newFestivalDays: string[],
  dryRun = false
): Promise<EventMetadata> {
  let metadata: EventMetadata = {};
  
  // Parse existing metadata
  if (event.metadata) {
    if (typeof event.metadata === 'string') {
      try {
        metadata = JSON.parse(event.metadata);
      } catch {
        metadata = {};
      }
    } else {
      metadata = { ...event.metadata };
    }
  }
  
  // Merge stages
  metadata.stages = newStages;
  
  // Merge festival_days
  metadata.festival_days = newFestivalDays;
  
  // Add timetable flag if not present
  if (!('timetable' in metadata)) {
    metadata.timetable = true;
  }
  
  // Update in DB
  if (!dryRun && event.id) {
    try {
      await db.updateEvent(event.id, { metadata });
      logger.info(`Event metadata updated with stages and festival_days`);
      logger.debug(`Stages: ${JSON.stringify(metadata.stages)}`);
      logger.debug(`Festival days: ${JSON.stringify(metadata.festival_days)}`);
    } catch (error) {
      logger.error('Error updating event metadata', error);
      throw error;
    }
  } else if (dryRun) {
    logger.info(`[DRY_RUN] Would have updated event ${event.id} metadata`);
  }
  
  return metadata;
}

/**
 * Creates a relationship between an event and multiple artists for B2B performances
 * @param eventId - Event ID
 * @param artistIds - Array of artist IDs
 * @param performanceData - Performance details
 * @param dryRun - Whether to perform actual database updates
 * @returns Promise with created link object
 */
export async function linkArtistsToEvent(
  eventId: number,
  artistIds: number[],
  performanceData: PerformanceData,
  dryRun = false
): Promise<any> {
  try {
    if (dryRun) {
      logger.info(`[DRY_RUN] Would have linked artists ${artistIds.join(', ')} to event ${eventId} (stage: ${performanceData.stage}, time: ${performanceData.time}, end_time: ${performanceData.end_time})`);
      return { id: `dryrun_link_${artistIds.join('_')}_${eventId}` };
    }
    
    const artistIdNums = artistIds.map(Number);
    
    // Validate and clean timestamps using utility function
    let startTime: string | null = null;
    let endTime: string | null = null;
    
    if (performanceData.time && performanceData.time.trim() !== "") {
      startTime = validateTimestamp(performanceData.time, 'start_time');
    }
    if (performanceData.end_time && performanceData.end_time.trim() !== "") {
      endTime = validateTimestamp(performanceData.end_time, 'end_time');
    }
    
    // Check if link already exists with the same details
    const existingLinks = await db.getEventArtistLinks(eventId, {
      stage: performanceData.stage,
      start_time: startTime,
      end_time: endTime,
      artist_ids: artistIdNums
    });
    
    if (existingLinks.length > 0) {
      logger.info(`Artist-event link already exists for artist_ids=${artistIdNums.join(',')} with same performance details`);
      return existingLinks[0];
    }
    
    // Create new link with format compatible with existing system
    const linkRecord = {
      event_id: eventId,
      artist_id: artistIdNums, // Integer array for multiple artists (B2B)
      start_time: startTime,
      end_time: endTime,
      status: 'confirmed',
      stage: performanceData.stage || null,
      custom_name: performanceData.custom_name || null
    };
    
    const createdLink = await db.createEventArtistLink(linkRecord);
    logger.info(`Created artist-event link for artist_ids=${artistIdNums.join(',')} (ID: ${createdLink.id})`);
    
    return createdLink;
    
  } catch (error) {
    logger.error('Error linking artists to event', error);
    throw error;
  }
}

/**
 * Creates a new event with validation
 * @param eventData - Event data
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with created event
 */
export async function createEvent(
  eventData: Omit<Event, "id" | "created_at" | "updated_at">,
  dryRun = false
): Promise<Event> {
  try {
    if (dryRun) {
      logger.info(`[DRY_RUN] Would have created event: ${eventData.title}`);
      return { ...eventData, id: 999999 } as Event;
    }
    
    // Validate required fields
    if (!eventData.title) {
      throw new Error('Event title is required');
    }
    
    if (!eventData.date_time) {
      throw new Error('Event date_time is required');
    }
    
    // Create event in database
    const createdEvent = await db.createEvent(eventData);
    logger.info(`Created new event: ${createdEvent.title} (ID: ${createdEvent.id})`);
    
    return createdEvent;
    
  } catch (error) {
    logger.error('Error creating event', error);
    throw error;
  }
}

/**
 * Updates an existing event
 * @param eventId - Event ID
 * @param eventData - Updated event data
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with updated event
 */
export async function updateEvent(
  eventId: number,
  eventData: Partial<Event>,
  dryRun = false
): Promise<Event> {
  try {
    if (dryRun) {
      logger.info(`[DRY_RUN] Would have updated event ${eventId}`);
      const existing = await db.getEvent(eventId);
      if (!existing) throw new Error('Event not found');
      return { ...existing, ...eventData } as Event;
    }
    
    const updatedEvent = await db.updateEvent(eventId, eventData);
    logger.info(`Updated event: ${updatedEvent.title} (ID: ${updatedEvent.id})`);
    
    return updatedEvent;
    
  } catch (error) {
    logger.error('Error updating event', error);
    throw error;
  }
}

/**
 * Gets all events with optional filtering
 * @param filters - Optional filters
 * @returns Promise with array of events
 */
export async function getEvents(filters?: {
  status?: string;
  start_date?: string;
  end_date?: string;
}): Promise<Event[]> {
  try {
    const events = await db.getEvents(filters);
    logger.debug(`Retrieved ${events.length} events`);
    return events;
  } catch (error) {
    logger.error('Error getting events', error);
    throw error;
  }
}

export default {
  findEvent,
  updateEventMetadata,
  linkArtistsToEvent,
  createEvent,
  updateEvent,
  getEvents
};
