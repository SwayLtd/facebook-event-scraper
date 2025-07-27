// utils/artist.js
// Utility functions for artists

import { normalizeNameEnhanced } from '../utils/name.js';
import { normalizeExternalLinks } from '../utils/social.js';
import { getAccessToken } from '../utils/token.js';
import { processArtistGenres, linkArtistGenre, insertGenreIfNew } from './genre.js';
import fetch from 'node-fetch';

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
 * Searches for an artist on SoundCloud.
 * @param {string} artistName - The name of the artist.
 * @param {string} accessToken - The SoundCloud access token.
 * @returns {Promise<object|null>}
 */
async function searchArtist(artistName, accessToken) {
    try {
        const url = `https://api.soundcloud.com/users?q=${encodeURIComponent(artistName)}&limit=1`;
        const response = await fetch(url, {
            headers: { "Authorization": `OAuth ${accessToken}` }
        });
        const data = await response.json();
        if (!data || data.length === 0) {
            console.log(`No SoundCloud artist found for: ${artistName}`);
            return null;
        }
        return data[0];
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
        const genres = await processArtistGenres(supabase, inserted[0]);
        for (const genreObj of genres) {
            if (genreObj.id) {
                await linkArtistGenre(supabase, newArtistId, genreObj.id);
                console.log(`   ↳ Linked artist to forced genre_id=${genreObj.id}`);
            } else {
                const genreId = await insertGenreIfNew(supabase, genreObj);
                await linkArtistGenre(supabase, newArtistId, genreId);
                console.log(`   ↳ Linked artist to genre_id=${genreId}`);
            }
        }
    } catch (err) {
        console.error("❌ Error processing genres for artist:", artistName, err);
    }

    return newArtistId;
}

export default {
    getBestImageUrl,
    findOrInsertArtist,
    searchArtist,
    extractArtistInfo,
};
