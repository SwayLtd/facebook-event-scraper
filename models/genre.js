// utils/genre.js
// Utility functions for genres

import fetch from 'node-fetch';
import databaseUtils from '../utils/database.js';
import { MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL, FESTIVAL_FALLBACK_GENRES } from '../utils/constants.js';
import { getAccessToken } from '../utils/token.js';

/**
 * refineGenreName
 *
 * This function takes a genre name (as retrieved from Last.fm or another source)
 * and reformats it for more readable display. It first applies word-by-word capitalization,
 * then detects and corrects certain special cases (for example, if the name does not contain spaces and contains
 * the word "techno", it inserts a space before "Techno"). This refinement allows for genre names such as
 * "Hard Techno" instead of "Hardtechno" for better visual clarity and uniformity in the database.
 *
 * @param {string} name - The genre name to refine.
 * @returns {string} - The reformatted genre name for display (e.g., "Hard Techno").
 */
function refineGenreName(name) {
    let refined = name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(Techno)/i, '$1 Techno');
    }
    return refined;
}

/**
 * Splits a compound tag containing known delimiters (" x ", " & ", " + ") into sub-tags.
 * @param {string} tag - The tag to split.
 * @returns {string[]} - Array of sub-tags.
 */
function splitCompoundTags(tag) {
    const delimiters = [" x ", " & ", " + "];
    for (const delim of delimiters) {
        if (tag.includes(delim)) {
            return tag.split(delim).map(t => t.trim());
        }
    }
    return [tag];
}

/**
 * Removes all non-alphanumeric characters to get a condensed version.
 * @param {string} name - The genre name.
 * @returns {string} - The slugified genre name.
 */
function slugifyGenre(name) {
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * Cleans a description by removing HTML tags, the "Read more on Last.fm" part,
 * and removes a possible " ." at the end of the string.
 * If, after cleaning, the description is too short (less than 30 characters), returns "".
 * @param {string} desc - The description to clean.
 * @returns {string} - The cleaned description or empty string.
 */
function cleanDescription(desc) {
    if (!desc) return "";
    let text = desc.replace(/<[^>]*>/g, '').trim();
    text = text.replace(/read more on last\.fm/gi, '').trim();
    text = text.replace(/\s+\.\s*$/, '');
    return text.length < 30 ? "" : text;
}

/**
 * Load banned genre IDs into memory.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {string[]} bannedGenres - Array of banned genre names.
 * @returns {Promise<number[]>}
 */
async function getBannedGenreIds(supabase, bannedGenres) {
    const { data: bannedGenreRecords, error: bannedError } = await supabase
        .from('genres')
        .select('id')
        .in('name', bannedGenres.map(g => refineGenreName(g)));
    if (bannedError) throw bannedError;
    return bannedGenreRecords.map(r => r.id);
}

/**
 * Fetches artist tracks from SoundCloud based on the SoundCloud user ID.
 * @param {string} soundcloudUserId - The SoundCloud user ID.
 * @param {string} token - The SoundCloud access token.
 * @returns {Promise<any[]>}
 */
async function fetchArtistTracks(soundcloudUserId, token) {
    try {
        const url = `https://api.soundcloud.com/users/${soundcloudUserId}/tracks?limit=10`;
        const response = await fetch(url, {
            headers: { "Authorization": `OAuth ${token}` }
        });
        const data = await response.json();
        if (!Array.isArray(data)) {
            console.error(`[Genres] Expected tracks to be an array but got: ${JSON.stringify(data)}`);
            return [];
        }
        return data;
    } catch (error) {
        console.error("[Genres] Error fetching artist tracks from SoundCloud:", error);
        return [];
    }
}

/**
 * Checks via Last.fm if the tag corresponds to a musical genre.
 * @param {string} tagName - The tag to verify.
 * @param {string} lastfmApiKey - The Last.fm API key.
 * @returns {Promise<{valid: boolean, name?: string, description?: string, lastfmUrl?: string}>}
 */
async function verifyGenreWithLastFM(tagName, lastfmApiKey) {
    if (tagName.length === 1) {
        return { valid: false };
    }

    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodeURIComponent(tagName)}&api_key=${lastfmApiKey}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data?.tag) return { valid: false };

        const rawSummary = data.tag.wiki?.summary || "";
        const description = cleanDescription(rawSummary);
        if (!description) return { valid: false };

        const lowerDesc = description.toLowerCase();
        const lowerTag = tagName.toLowerCase();

        // More flexible validation for electronic music genres
        const hasGenreWord = /(genre|sub-genre|subgenre|style|type)/.test(lowerDesc);
        const hasMusicPhrase = new RegExp(`${lowerTag}\\s+music`).test(lowerDesc);
        const isElectronicMusic = /electronic|dance|techno|house|trance|drum|bass/.test(lowerDesc);
        const isUmbrella = /umbrella term/.test(lowerDesc);

        // Accept if it's an umbrella term OR has music-related keywords OR mentions electronic music
        if (isUmbrella || !(hasGenreWord || hasMusicPhrase || isElectronicMusic)) {
            return { valid: false };
        }

        let lastfmUrl = data.tag.url || "";
        const linkMatch = rawSummary.match(/<a href="([^"]+)"/);
        if (linkMatch?.[1]) lastfmUrl = linkMatch[1];

        return {
            valid: true,
            name: data.tag.name.toLowerCase(),
            description,
            lastfmUrl
        };
    } catch (error) {
        console.error("[Genres] Error verifying genre with Last.fm for tag:", tagName, error);
        return { valid: false };
    }
}

/**
 * Inserts the genre into the "genres" table if it does not already exist.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {object} genreObject - The genre object to insert.
 * @returns {Promise<number>} The genre ID.
 */
async function insertGenreIfNew(supabase, genreObject) {
    const { name, description, lastfmUrl } = genreObject;
    const normalizedName = name.toLowerCase();
    const genreSlug = slugifyGenre(normalizedName);

    let { data: existingGenres, error: selectError } = await supabase
        .from('genres')
        .select('id, name, external_links');
    if (selectError) {
        console.error("[Genres] Error selecting genre:", selectError);
        throw selectError;
    }

    let duplicateGenre = null;
    if (lastfmUrl) {
        duplicateGenre = existingGenres.find(g => g.external_links &&
            g.external_links.lastfm &&
            g.external_links.lastfm.link === lastfmUrl);
    }
    if (!duplicateGenre) {
        duplicateGenre = existingGenres.find(g => slugifyGenre(g.name) === genreSlug);
    }
    if (duplicateGenre) {
        console.log(`[Genres] Genre "${name}" already exists with ID ${duplicateGenre.id}`);
        return duplicateGenre.id;
    }

    let externalLinks = null;
    if (lastfmUrl) {
        externalLinks = { lastfm: { link: lastfmUrl } };
    }
    const finalName = refineGenreName(name);
    const { data: newGenre, error: insertError } = await supabase
        .from('genres')
        .insert({ name: finalName, description, external_links: externalLinks })
        .select();
    if (insertError || !newGenre) {
        console.error("[Genres] Error inserting genre:", insertError);
        throw insertError || new Error("Genre insertion failed");
    }
    console.log(`[Genres] Genre inserted: ${finalName} (id=${newGenre[0].id}) with description: ${description} and external_links: ${JSON.stringify(externalLinks)}`);
    return newGenre[0].id;
}

/**
 * Links an artist to a genre in the "artist_genre" pivot table.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {number} artistId - The artist ID.
 * @param {number} genreId - The genre ID.
 */
async function linkArtistGenre(supabase, artistId, genreId) {
    const { data, error } = await supabase
        .from('artist_genre')
        .select('*')
        .match({ artist_id: artistId, genre_id: genreId });
    if (error) throw error;
    if (!data || data.length === 0) {
        const { error: insertError } = await supabase
            .from('artist_genre')
            .insert({ artist_id: artistId, genre_id: genreId });
        if (insertError) throw insertError;
        console.log(`[Genres] Linked artist (id=${artistId}) to genre (id=${genreId}).`);
    } else {
        console.log(`[Genres] Artist (id=${artistId}) already linked to genre (id=${genreId}).`);
    }
}

/**
 * Extracts and normalizes tags from a track.
 * @param {object} track - The track object from SoundCloud.
 * @returns {string[]}
 */
function extractTagsFromTrack(track) {
    let tags = [];
    if (track.genre) {
        tags.push(track.genre.toLowerCase().trim());
    }
    if (track.tag_list) {
        const rawTags = track.tag_list.split(/\s+/);
        rawTags.forEach(tag => {
            tag = tag.replace(/^#/, "").toLowerCase().trim();
            if (tag && !tags.includes(tag)) {
                tags.push(tag);
            }
        });
    }
    console.log(`[Genres] For track "${track.title || 'unknown'}", extracted tags: ${JSON.stringify(tags)}`);
    return tags;
}

/**
 * Processes an artist's genres by fetching their tracks and validating tags.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {object} artistData - The artist data from the database.
 * @param {string} lastfmApiKey - The Last.fm API key.
 * @param {string[]} bannedGenres - Array of banned genre names.
 * @returns {Promise<object[]>}
 */
async function processArtistGenres(supabase, artistData, lastfmApiKey, bannedGenres) {
    const genresFound = [];

    if (!artistData.external_links?.soundcloud?.id) {
        console.log(`[Genres] No SoundCloud external link for "${artistData.name}"`);
        return genresFound;
    }

    const soundcloudUserId = artistData.external_links.soundcloud.id;
    const token = await getAccessToken();
    if (!token) {
        console.log("[Genres] No SoundCloud token available");
        return genresFound;
    }

    console.log(`[Genres] DEBUG: Fetching tracks for ${artistData.name} (SC ID: ${soundcloudUserId})...`);
    const tracks = await fetchArtistTracks(soundcloudUserId, token);
    console.log(`[Genres] DEBUG: Found ${tracks.length} tracks for ${artistData.name}`);

    let allTags = [];
    for (const track of tracks) {
        const tags = extractTagsFromTrack(track);
        let splitted = [];
        tags.forEach(t => { splitted = splitted.concat(splitCompoundTags(t)); });
        allTags = allTags.concat(splitted.filter(t => /[a-zA-Z]/.test(t)));
    }
    allTags = Array.from(new Set(allTags));
    console.log(`[Genres] DEBUG: Extracted ${allTags.length} unique tags: ${allTags.slice(0, 5).join(', ')}${allTags.length > 5 ? '...' : ''}`);

    const aliasTagIds = {
        'dnb': 437, 'drumnbass': 437, "drum'n'bass": 437, 'drumandbass': 437,
    };

    for (const rawTag of allTags) {
        const tag = rawTag.toLowerCase().trim();

        if (aliasTagIds[tag]) {
            const id = aliasTagIds[tag];
            console.log(`[Genres] Alias DnB detected ("${tag}") → forcing genre_id ${id}`);
            if (!genresFound.some(g => g.id === id)) {
                genresFound.push({ id });
            }
            continue;
        }

        console.log(`[Genres] Verifying "${tag}" via Last.fm…`);
        const v = await verifyGenreWithLastFM(tag, lastfmApiKey);
        if (v.valid && v.description) {
            const slug = slugifyGenre(v.name);
            if (!bannedGenres.includes(slug)) {
                console.log(`[Genres] DEBUG: Valid genre found: "${v.name}"`);
                genresFound.push({
                    name: v.name,
                    description: v.description,
                    lastfmUrl: v.lastfmUrl
                });
            } else {
                console.log(`[Genres] Skipping generic genre "${v.name}".`);
            }
        } else {
            console.log(`[Genres] Skipping invalid or too-short tag "${tag}".`);
        }
    }

    console.log(`[Genres] DEBUG: Final result for ${artistData.name}: ${genresFound.length} genres found`);
    return genresFound;
}

/**
 * Deduces the genres of an event from the artists participating in it.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {number} eventId - The ID of the event.
 * @param {number[]} bannedGenreIds - Array of banned genre IDs.
 * @param {boolean} isFestival - Whether the event is a festival (allows more genres)
 * @returns {Promise<number[]>}
 */
async function assignEventGenres(supabase, eventId, bannedGenreIds, isFestival = false) {
    const { data: eventArtists, error: eaError } = await supabase
        .from('event_artist')
        .select('artist_id')
        .eq('event_id', eventId);
    if (eaError) throw eaError;

    const genreCounts = {};
    for (const { artist_id } of eventArtists) {
        for (const aid of artist_id) {
            const { data: artistGenres, error: agError } = await supabase
                .from('artist_genre')
                .select('genre_id')
                .eq('artist_id', parseInt(aid, 10));
            if (agError) throw agError;
            artistGenres.forEach(g => {
                genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
            });
        }
    }

    // Determine max genres based on festival status
    const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
    const fallbackGenres = isFestival ? FESTIVAL_FALLBACK_GENRES : 3;

    let topGenreIds = Object.entries(genreCounts)
        .filter(([genreId, count]) =>
            count >= MIN_GENRE_OCCURRENCE &&
            !bannedGenreIds.includes(Number(genreId))
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, maxGenres)
        .map(([genreId]) => Number(genreId));

    // Fallback: always attempt to assign top genres, even if genreCounts is empty
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, fallbackGenres)
            .map(([genreId]) => Number(genreId));

        if (topGenreIds.length === 0) {
            console.log(
                `[Genres] No artist genre found for event ${eventId}, fallback is empty.`
            );
        } else {
            console.log(
                `[Genres] No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for event ${eventId}, fallback to top ${fallbackGenres} non-banned genres${isFestival ? ' (festival)' : ''}:`,
                topGenreIds
            );
        }
    } else {
        console.log(
            `[Genres] Top genres for event ${eventId} (threshold ${MIN_GENRE_OCCURRENCE}${isFestival ? ', festival - max ' + maxGenres : ''}):`,
            topGenreIds
        );
    }

    for (const genreId of topGenreIds) {
        await databaseUtils.ensureRelation(
            supabase,
            "event_genre",
            { event_id: eventId, genre_id: genreId },
            "event_genre"
        );
    }

    return topGenreIds;
}

export default {
    refineGenreName,
    slugifyGenre,
    splitCompoundTags,
    cleanDescription,
    getBannedGenreIds,
    fetchArtistTracks,
    verifyGenreWithLastFM,
    insertGenreIfNew,
    linkArtistGenre,
    extractTagsFromTrack,
    processArtistGenres,
    assignEventGenres,
};
