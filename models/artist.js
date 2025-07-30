// utils/artist.js
// Utility functions for artists

import { normalizeNameEnhanced } from '../utils/name.js';
import { normalizeExternalLinks } from '../utils/social.js';
import { getAccessToken } from '../utils/token.js';
import genreModel from './genre.js';
import fetch from 'node-fetch';
import stringSimilarity from 'string-similarity';

async function getBestImageUrl(avatarUrl) {
    if (!avatarUrl) return null;
    // SoundCloud uses '-large.jpg' for 100x100, and '-t500x500.jpg' for 500x500
    if (!avatarUrl.includes('-large')) return avatarUrl;
    const t500Url = avatarUrl.replace('-large', '-t500x500');
    // For simplicity, we assume the t500x500 exists if the large one does.
    // A more robust implementation could use fetch to check if the URL is valid.
    return t500Url;
}

/**
 * Searches for an artist on SoundCloud using robust scoring (name similarity, followers, position).
 * @param {string} artistName - The name of the artist.
 * @param {string} accessToken - The SoundCloud access token.
 * @returns {Promise<object|null>} Best match artist object or null.
 */
async function searchArtist(artistName, accessToken) {
    try {
        const normName = normalizeNameEnhanced(artistName);
        const url = `https://api.soundcloud.com/users?q=${encodeURIComponent(normName)}&limit=10`;
        const response = await fetch(url, {
            headers: { "Authorization": `OAuth ${accessToken}` }
        });
        const data = await response.json();
        if (!data || data.length === 0) {
            console.log(`No SoundCloud artist found for: ${artistName}`);
            return null;
        }
        // --- Composite scoring ---
        let bestMatch = null;
        let bestScore = 0;
        const maxFollowers = Math.max(...data.map(u => u.followers_count || 0), 1);
        data.forEach((user, idx) => {
            const userNorm = normalizeNameEnhanced(user.username);
            const nameScore = stringSimilarity.compareTwoStrings(normName.toLowerCase(), userNorm.toLowerCase());
            const followers = user.followers_count || 0;
            const followersScore = Math.log10(followers + 1) / Math.log10(maxFollowers + 1);
            const positionScore = 1 - (idx / data.length);
            const score = (nameScore * 0.6) + (followersScore * 0.3) + (positionScore * 0.1);
            // Debug log (optional)
            // console.log(`Candidate: ${user.username} | name: ${nameScore.toFixed(2)} | followers: ${followers} | followersScore: ${followersScore.toFixed(2)} | pos: ${idx + 1} | score: ${score.toFixed(3)}`);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = user;
            }
        });
        if (bestMatch && bestScore > 0.6) {
            // console.log(`Best SoundCloud match for "${artistName}": ${bestMatch.username} (score: ${bestScore.toFixed(3)})`);
            return bestMatch;
        } else {
            // console.log(`No sufficient match found for "${artistName}" (best score: ${bestScore.toFixed(3)})`);
            return null;
        }
    } catch (error) {
        console.error("Error searching for artist on SoundCloud:", error);
        return null;
    }
}

/**
 * Extracts structured information from a SoundCloud artist object.
 * @param {object} artist - The artist object from SoundCloud API.
 * @returns {Promise<object>}
 */
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

/**
 * Finds an existing artist or inserts a new one into the database.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {object} artistObj - The artist object from parsing.
 * @returns {Promise<number|null>} The artist ID.
 */
/**
 * Finds an existing artist or inserts a new one into the database.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {object} artistObj - The artist object from parsing.
 * @returns {Promise<number|null>} The artist ID.
 */
async function findOrInsertArtist(supabase, artistObj) {
    let artistName = (artistObj.name || '').trim();
    if (!artistName) return null;

    // 1. Name normalization
    artistName = normalizeNameEnhanced(artistName);

    // 2. Search on SoundCloud
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(artistName, token);
    }

    // 3. Construction of the artistData object
    let artistData;
    if (scArtist) {
        artistData = await extractArtistInfo(scArtist);
    } else {
        artistData = {
            name: artistName,
            external_links: artistObj.soundcloud
                ? { soundcloud: { link: artistObj.soundcloud } }
                : null,
        };
    }
    if (artistData.external_links) {
        artistData.external_links = normalizeExternalLinks(artistData.external_links);
    }

    // 4. Duplicate detection via SoundCloud link
    if (artistData.external_links?.soundcloud?.id) {
        const { data: existingByExternal, error: extError } = await supabase
            .from('artists')
            .select('id')
            .eq('external_links->soundcloud->>id', artistData.external_links.soundcloud.id);
        if (extError) throw extError;
        if (existingByExternal.length > 0) {
            console.log(`➡️ Artist exists by external link: "${artistName}" (id=${existingByExternal[0].id})`);
            return existingByExternal[0].id;
        }
    }

    // 5. Duplicate detection via name
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('id')
        .ilike('name', artistName);
    if (nameError) throw nameError;
    if (existingByName.length > 0) {
        console.log(`➡️ Artist exists by name: "${artistName}" (id=${existingByName[0].id})`);
        return existingByName[0].id;
    }

    // 6. Insertion of the new artist
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    const newArtistId = inserted[0].id;
    console.log(`✅ Artist inserted: "${artistName}" (id=${newArtistId})`);

    // 7. Processing and linking genres
    try {
        const genres = await genreModel.processArtistGenres(supabase, inserted[0]);
        for (const genreObj of genres) {
            if (genreObj.id) {
                await genreModel.linkArtistGenre(supabase, newArtistId, genreObj.id);
                console.log(`   ↳ Linked artist to forced genre_id=${genreObj.id}`);
            } else {
                const genreId = await genreModel.insertGenreIfNew(supabase, genreObj);
                await genreModel.linkArtistGenre(supabase, newArtistId, genreId);
                console.log(`   ↳ Linked artist to genre_id=${genreId}`);
            }
        }
    } catch (err) {
        console.error("❌ Error processing genres for artist:", artistName, err);
    }

    return newArtistId;
}

/**
 * Enhanced version of insertOrUpdateArtist for timetable imports
 * Inserts or updates an artist in the database with SoundCloud data
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client
 * @param {object} artistData - Basic artist data with name
 * @param {object} soundCloudData - Optional SoundCloud data for enrichment
 * @param {boolean} dryRun - Whether to perform actual database operations
 * @returns {Promise<object>} Object with artist ID
 */
async function insertOrUpdateArtist(supabase, artistData, soundCloudData = null, dryRun = false) {
    try {
        // Advanced name normalization for search
        const normName = normalizeNameEnhanced(artistData.name);
        
        // Check for duplicates by SoundCloud ID if available
        if (soundCloudData && soundCloudData.soundcloud_id) {
            const { data: existingByExternal, error: extError } = await supabase
                .from('artists')
                .select('id')
                .eq('external_links->soundcloud->>id', String(soundCloudData.soundcloud_id));
            if (extError) throw extError;
            if (existingByExternal && existingByExternal.length > 0) {
                console.log(`➡️ Existing artist found by SoundCloud ID: "${artistData.name}" (id=${existingByExternal[0].id})`);
                return { id: existingByExternal[0].id };
            }
        }
        
        // Otherwise, check for duplicates by name (normalized)
        console.log(`🔍 Checking if artist "${artistData.name}" already exists...`);
        const { data: existingArtist, error: fetchError } = await supabase
            .from('artists')
            .select('id, name, external_links')
            .ilike('name', normName)
            .single();
        if (fetchError && fetchError.code !== 'PGRST116') {
            console.log(`❌ Error while searching for artist: ${fetchError.message}`);
            throw fetchError;
        }
        
        if (dryRun) {
            console.log(`[DRY_RUN] Would have inserted/updated artist: ${artistData.name}`);
            return { id: `dryrun_artist_${normName}` };
        }
        
        // Prepare SoundCloud external links for JSONB
        let external_links = existingArtist && existingArtist.external_links ? { ...existingArtist.external_links } : {};
        if (soundCloudData) {
            external_links.soundcloud = {
                link: soundCloudData.soundcloud_permalink,
                id: String(soundCloudData.soundcloud_id)
            };
        }
        
        // Build the enriched artist object
        const artistRecord = {
            name: normName,
            image_url: soundCloudData ? soundCloudData.image_url : undefined,
            description: soundCloudData ? soundCloudData.description : undefined,
            external_links: Object.keys(external_links).length > 0 ? external_links : undefined
        };
        
        if (existingArtist) {
            // Update
            const { error: updateError } = await supabase
                .from('artists')
                .update(artistRecord)
                .eq('id', existingArtist.id)
                .select();
            if (updateError) throw updateError;
            console.log(`✅ Updated artist: ${artistRecord.name} (ID: ${existingArtist.id})`);
            return { id: existingArtist.id };
        } else {
            // Insertion
            const { data: inserted, error: insertError } = await supabase
                .from('artists')
                .insert(artistRecord)
                .select();
            if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
            console.log(`✅ Inserted new artist: ${artistRecord.name} (ID: ${inserted[0].id})`);
            return { id: inserted[0].id };
        }
    } catch (error) {
        console.log(`❌ Error inserting/updating artist "${artistData.name}": ${error.message}`);
        throw error;
    }
}

export default {
    getBestImageUrl,
    findOrInsertArtist,
    insertOrUpdateArtist,
    searchArtist,
    extractArtistInfo,
};
