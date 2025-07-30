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

/**
 * Processes simple event artists using OpenAI parsing from description
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client
 * @param {Object} openai - OpenAI client instance
 * @param {number} eventId - The event ID in the database
 * @param {string} eventDescription - The event description to parse
 * @param {boolean} dryRun - Whether to perform actual database operations
 * @returns {Promise<Array>} Array of processed artist IDs
 */
async function processSimpleEventArtists(supabase, openai, eventId, eventDescription, dryRun = false) {
    console.log("\n💬 Processing simple event - calling OpenAI to parse artists from description...");
    let parsedArtists = [];
    
    if (eventDescription) {
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are an expert at extracting structured data from Facebook Event descriptions. Your task is to analyze the provided text and extract information solely about the artists. Assume that each line of the text (separated by line breaks) represents one artist's entry, unless it clearly contains a collaboration indicator (such as "B2B", "F2F", "B3B", or "VS"), in which case treat each artist separately. 

            For each artist identified, extract the following elements if they are present:
            - name: The name of the artist. IMPORTANT: Remove any trailing suffixes such as "A/V". In a line where the text starts with a numeric identifier followed by additional text (for example, "999999999 DOMINION A/V"), output only the numeric identifier. For other names, simply remove suffixes like " A/V" so that "I HATE MODELS A/V" becomes "I HATE MODELS".
            - time: The performance time, if mentioned.
            - soundcloud: The SoundCloud link for the artist, if provided.
            - stage: The stage associated with the artist (only one stage per artist).
            - performance_mode: The performance mode associated with the artist. Look for collaboration indicators (B2B, F2F, B3B, VS). If an artist is involved in a collaborative performance, record the specific mode here; otherwise leave this value empty.

            The output must be a valid JSON array where each artist is represented as an object with these keys. For example:
            [
            {
                "name": "Reinier Zonneveld",
                "time": "18:00",
                "soundcloud": "",
                "stage": "KARROSSERIE",
                "performance_mode": ""
            }
            ]

            Additional Instructions:
            - Use only the provided text for extraction.
            - Treat each line as a separate artist entry unless a collaboration indicator suggests multiple names.
            - If any piece of information (time, SoundCloud link, stage, performance_mode) is missing, use an empty string.
            - The generated JSON must be valid and strictly follow the structure requested.
            - The output should be in English.`
                    },
                    {
                        role: "user",
                        content: `Parse artist names from this event description:\n\n${eventDescription}`
                    }
                ],
                temperature: 0.1,
                max_tokens: 4000
            });

            const content = response.choices[0].message.content.trim();
            console.log("Raw OpenAI response:", content);

            // Extract JSON from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try {
                    parsedArtists = JSON.parse(jsonMatch[0]);
                    console.log(`✅ OpenAI parsed ${parsedArtists.length} artists with enhanced data:`);
                    parsedArtists.forEach((artist, i) => {
                        const extraInfo = [];
                        if (artist.time) extraInfo.push(`time: ${artist.time}`);
                        if (artist.stage) extraInfo.push(`stage: ${artist.stage}`);
                        if (artist.performance_mode) extraInfo.push(`mode: ${artist.performance_mode}`);
                        if (artist.soundcloud) extraInfo.push(`soundcloud: yes`);
                        
                        const infoStr = extraInfo.length > 0 ? ` (${extraInfo.join(', ')})` : '';
                        console.log(`  ${i + 1}. ${artist.name}${infoStr}`);
                    });
                } catch (jsonError) {
                    console.log("❌ JSON parsing failed, attempting to fix truncated response...");
                    // Try to fix truncated JSON by adding closing brackets
                    let fixedJson = jsonMatch[0];
                    
                    // If it ends with an incomplete object name, remove it
                    if (fixedJson.includes('"name":') && !fixedJson.endsWith('}]')) {
                        // Find last complete object
                        const lastCompleteIndex = fixedJson.lastIndexOf('}');
                        if (lastCompleteIndex > 0) {
                            fixedJson = fixedJson.substring(0, lastCompleteIndex + 1) + ']';
                        }
                    }
                    
                    if (!fixedJson.endsWith(']')) {
                        // Count unclosed objects
                        const openBraces = (fixedJson.match(/\{/g) || []).length;
                        const closeBraces = (fixedJson.match(/\}/g) || []).length;
                        const missingClosing = openBraces - closeBraces;
                        
                        // Add missing closing braces and array bracket
                        fixedJson += '}'.repeat(missingClosing) + ']';
                    }
                    
                    try {
                        parsedArtists = JSON.parse(fixedJson);
                        console.log(`✅ Fixed and parsed ${parsedArtists.length} artists with enhanced data:`);
                        parsedArtists.forEach((artist, i) => {
                            const extraInfo = [];
                            if (artist.time) extraInfo.push(`time: ${artist.time}`);
                            if (artist.stage) extraInfo.push(`stage: ${artist.stage}`);
                            if (artist.performance_mode) extraInfo.push(`mode: ${artist.performance_mode}`);
                            if (artist.soundcloud) extraInfo.push(`soundcloud: yes`);
                            
                            const infoStr = extraInfo.length > 0 ? ` (${extraInfo.join(', ')})` : '';
                            console.log(`  ${i + 1}. ${artist.name}${infoStr}`);
                        });
                    } catch (finalError) {
                        console.log("❌ Could not fix JSON, using empty array");
                        parsedArtists = [];
                    }
                }
            } else {
                console.log("❌ No valid JSON array found in OpenAI response");
                parsedArtists = [];
            }
        } catch (error) {
            console.error("❌ Error calling OpenAI:", error);
            parsedArtists = [];
        }
    } else {
        console.log("⚠️ No event description provided for parsing");
        parsedArtists = [];
    }

    // Import artists and create relations
    const processedArtistIds = [];
    if (!dryRun && eventId && parsedArtists.length > 0) {
        for (const artistObj of parsedArtists) {
            if (artistObj.name && artistObj.name.trim()) {
                try {
                    // Use the enhanced artist object with additional fields
                    const enhancedArtistObj = {
                        name: artistObj.name.trim(),
                        soundcloud: artistObj.soundcloud || null,
                        // Store additional metadata for potential future use
                        metadata: {
                            time: artistObj.time || null,
                            stage: artistObj.stage || null,
                            performance_mode: artistObj.performance_mode || null
                        }
                    };
                    
                    const artistId = await findOrInsertArtist(supabase, enhancedArtistObj);
                    if (artistId) {
                        processedArtistIds.push(artistId);
                        
                        // Link artist to event with performance details if available
                        const { linkArtistsToEvent } = await import('./event.js');
                        await linkArtistsToEvent(supabase, eventId, [artistId], {
                            stage: artistObj.stage || null,
                            time: artistObj.time || null,
                            end_time: null
                        }, dryRun);
                    }
                } catch (error) {
                    console.error(`❌ Error processing artist "${artistObj.name}": ${error.message}`);
                }
            }
        }
        console.log(`✅ Simple event import complete: ${processedArtistIds.length} artists processed`);
    } else if (dryRun) {
        console.log(`[DRY_RUN] Would have processed ${parsedArtists.length} artists for event ${eventId}`);
    } else {
        console.log("⚠️ No artists to process or missing event ID");
    }
    
    return processedArtistIds;
}

export default {
    getBestImageUrl,
    findOrInsertArtist,
    insertOrUpdateArtist,
    searchArtist,
    extractArtistInfo,
    processSimpleEventArtists,
};
