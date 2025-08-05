// models/event.js
// Event-related utility functions

import { logMessage } from '../utils/logger.js';
import { validateTimestamp } from '../utils/date.js';

/**
 * Finds an event in Supabase by Facebook URL, then by title if not found.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} params
 * @param {string} params.facebookUrl - Facebook event URL
 * @param {string} params.title - Event title
 * @returns {Promise<object|null>} Event object or null if not found
 */
export async function findEvent(supabase, { facebookUrl, title }) {
    // Try by Facebook URL
    if (facebookUrl) {
        const { data: eventsByUrl, error: urlError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .ilike('metadata->>facebook_url', facebookUrl);
        if (urlError) throw urlError;
        if (eventsByUrl && eventsByUrl.length > 0) {
            return eventsByUrl[0];
        }
    }
    // Try by title
    if (title) {
        const { data: eventsByTitle, error: titleError } = await supabase
            .from('events')
            .select('id, title, metadata, date_time')
            .eq('title', title);
        if (titleError) throw titleError;
        if (eventsByTitle && eventsByTitle.length > 0) {
            return eventsByTitle[0];
        }
    }
    return null;
}

/**
 * Updates event metadata with stages and festival days
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} event - Event object
 * @param {Array} newStages - Array of stage objects
 * @param {Array} newFestivalDays - Array of festival day objects
 * @param {boolean} dryRun - Whether to perform actual database updates
 * @returns {Promise<Object>} Updated metadata object
 */
export async function updateEventMetadata(supabase, event, newStages, newFestivalDays, dryRun = false) {
    let metadata = event.metadata || {};
    
    // Parse if string
    if (typeof metadata === 'string') {
        try { 
            metadata = JSON.parse(metadata); 
        } catch { 
            metadata = {}; 
        }
    }
    
    // Merge stages
    metadata.stages = newStages;
    
    // Merge festival_days
    metadata.festival_days = newFestivalDays;
    
    // Optionally preserve other keys (ticket_link, facebook_url, etc)
    // Add timetable if not present
    if (!('timetable' in metadata)) metadata.timetable = true;
    
    // Update in DB
    if (!dryRun) {
        const { error } = await supabase
            .from('events')
            .update({ metadata })
            .eq('id', event.id);
        if (error) throw error;
    }
    
    logMessage(`[INFO] Event metadata updated with stages and festival_days`);
    logMessage(`[INFO] stages: ${JSON.stringify(metadata.stages)}`);
    logMessage(`[INFO] festival_days: ${JSON.stringify(metadata.festival_days)}`);
    
    return metadata;
}

/**
 * Creates a relationship between an event and multiple artists for B2B performances
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} eventId - Event ID
 * @param {Array} artistIds - Array of artist IDs
 * @param {Object} performanceData - Performance details
 * @param {boolean} dryRun - Whether to perform actual database updates
 * @returns {Promise<Object>} Created link object
 */
export async function linkArtistsToEvent(supabase, eventId, artistIds, performanceData, dryRun = false) {
    try {
        if (dryRun) {
            logMessage(`[DRY_RUN] Would have linked artists ${artistIds.join(', ')} to event ${eventId} (stage: ${performanceData.stage}, time: ${performanceData.time}, end_time: ${performanceData.end_time})`);
            return { id: `dryrun_link_${artistIds.join('_')}_${eventId}` };
        }
        
        const artistIdStrs = artistIds.map(String);
        
        // Validate and clean timestamps using utility function
        let startTime = null;
        let endTime = null;
        
        if (performanceData.time && performanceData.time.trim() !== "") {
            startTime = validateTimestamp(performanceData.time, 'start_time');
        }
        if (performanceData.end_time && performanceData.end_time.trim() !== "") {
            endTime = validateTimestamp(performanceData.end_time, 'end_time');
        }
        
        // Check if link already exists with the same details
        let query = supabase
            .from('event_artist')
            .select('id')
            .eq('event_id', eventId);
            
        if (performanceData.stage === null || performanceData.stage === "") {
            query = query.is('stage', null);
        } else {
            query = query.eq('stage', performanceData.stage);
        }
        
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
        
        // Check if artist_id array contains all our artists
        query = query.contains('artist_id', artistIdStrs);
        
        const { data: existing, error: fetchError } = await query;
        if (fetchError) { 
            throw fetchError; 
        }
        
        if (existing && existing.length > 0) {
            logMessage(`➡️ Artist-event link already exists for artist_ids=${artistIdStrs.join(',')} with same performance details`);
            return existing[0];
        }
        
        // Create new link with format compatible with existing system
        const linkRecord = {
            event_id: eventId,
            artist_id: artistIdStrs, // Array format
            start_time: startTime,
            end_time: endTime,
            status: 'confirmed',
            stage: performanceData.stage || null,
            custom_name: performanceData.custom_name || null,
            created_at: new Date().toISOString(),
        };
        
        const { data, error } = await supabase
            .from('event_artist')
            .insert(linkRecord)
            .select()
            .single();
            
        if (error) throw error;
        
        logMessage(`✅ Created artist-event link for artist_ids=${artistIdStrs.join(',')} (ID: ${data.id})`);
        return data;
        
    } catch (error) {
        logMessage(`Error linking artists to event: ${error.message}`);
        throw error;
    }
}

export default {
    findEvent,
    updateEventMetadata,
    linkArtistsToEvent
};
