// models/event.js
// Robust event search utility

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
