import 'dotenv/config';  // Load environment variables from a .env file if present

import stringSimilarity from 'string-similarity';
import { getNormalizedName } from '../utils/name.js';
import databaseUtils from '../utils/database.js';
import { FUZZY_THRESHOLD, MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL, FESTIVAL_FALLBACK_GENRES } from '../utils/constants.js';

const longLivedToken = process.env.LONG_LIVED_TOKEN;  // Facebook Graph API token

/**
 * Fetches a high-resolution image from Facebook Graph API.
 * @param {string} objectId - The Facebook object ID (e.g., page or event ID).
 * @param {string} longLivedToken - The Facebook Graph API token.
 * @returns {Promise<string|null>} The URL of the high-resolution image.
 */
async function fetchHighResImage(objectId, longLivedToken) {
    try {
        const response = await fetch(`https://graph.facebook.com/${objectId}?fields=picture.width(720).height(720)&access_token=${longLivedToken}`);
        const data = await response.json();
        if (data.picture && data.picture.data && data.picture.data.url) {
            return data.picture.data.url;
        }
    } catch (err) {
        console.error("Error fetching high resolution image:", err);
    }
    return null;
}

/**
 * Finds or inserts a promoter, then returns { id, name, image_url }.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {string} promoterName - The name of the promoter.
 * @param {object} eventData - The event data from scraping.
 * @returns {Promise<{id: number, name: string, image_url: string|null}>}
 */
async function findOrInsertPromoter(supabase, promoterName, eventData) {
    const normalizedName = getNormalizedName(promoterName);

    // 1) Exact match on the name
    const { data: exactMatches, error: exactError } = await supabase
        .from('promoters')
        .select('id, name, image_url, external_links')
        .eq('name', normalizedName);
    if (exactError) throw exactError;

    const promoterSource = eventData.hosts.find(h => h.name === promoterName);
    // Prépare l'objet external_links Facebook
    let facebookLinks = null;
    if (promoterSource?.id && promoterSource?.url) {
        facebookLinks = {
            facebook: {
                id: promoterSource.id,
                link: promoterSource.url
            }
        };
    }

    if (exactMatches && exactMatches.length > 0) {
        const p = exactMatches[0];
        // Si external_links n'a pas les infos Facebook, on les ajoute
        if (facebookLinks && (!p.external_links || !p.external_links.facebook)) {
            const { error: updateError } = await supabase
                .from('promoters')
                .update({ external_links: { ...p.external_links, ...facebookLinks } })
                .eq('id', p.id);
            if (updateError) {
                console.error('Error updating promoter external_links:', updateError);
            } else {
                console.log(`✅ Updated promoter external_links for id=${p.id}`);
            }
        }
        console.log(`➡️ Promoter "${promoterName}" found (exact) → id=${p.id}`);
        return { id: p.id, name: p.name, image_url: p.image_url };
    }

    // 2) Fuzzy match against all existing promoters
    const { data: allPromoters, error: allError } = await supabase
        .from('promoters')
        .select('id, name, image_url, external_links');
    if (allError) throw allError;

    if (allPromoters && allPromoters.length > 0) {
        const names = allPromoters.map(p => p.name.toLowerCase());
        const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(
            normalizedName.toLowerCase(),
            names
        );
        if (bestMatch.rating >= FUZZY_THRESHOLD) {
            const p = allPromoters[bestMatchIndex];
            // Si external_links n'a pas les infos Facebook, on les ajoute
            if (facebookLinks && (!p.external_links || !p.external_links.facebook)) {
                const { error: updateError } = await supabase
                    .from('promoters')
                    .update({ external_links: { ...p.external_links, ...facebookLinks } })
                    .eq('id', p.id);
                if (updateError) {
                    console.error('Error updating promoter external_links:', updateError);
                } else {
                    console.log(`✅ Updated promoter external_links for id=${p.id}`);
                }
            }
            console.log(
                `➡️ Promoter "${promoterName}" similar to "${p.name}" → id=${p.id}`
            );
            return { id: p.id, name: p.name, image_url: p.image_url };
        }
    }

    // 3) Insertion of a new promoter
    console.log(`➡️ Inserting a new promoter "${promoterName}"…`);
    const newPromoterData = { name: normalizedName };

    // try to get a high-resolution image via Facebook Graph
    if (promoterSource?.id) {
        const highRes = await fetchHighResImage(promoterSource.id, longLivedToken);
        if (highRes) newPromoterData.image_url = highRes;
    }

    // fallback to photo.imageUri if available
    if (!newPromoterData.image_url && promoterSource?.photo?.imageUri) {
        newPromoterData.image_url = promoterSource.photo.imageUri;
    }

    // Ajoute external_links Facebook si dispo
    if (facebookLinks) {
        newPromoterData.external_links = facebookLinks;
    }

    const { data: inserted, error: insertError } = await supabase
        .from('promoters')
        .insert(newPromoterData)
        .select('id, name, image_url');
    if (insertError || !inserted || inserted.length === 0) {
        throw insertError || new Error('Promoter insertion failed');
    }

    const created = inserted[0];
    console.log(
        `✅ Promoter inserted: "${promoterName}" → id=${created.id}`
    );
    return {
        id: created.id,
        name: created.name,
        image_url: created.image_url ?? null
    };
}

/**
 * For a promoter, deduces their genres via their events.
 * Only occurrences reaching MIN_GENRE_OCCURRENCE and not banned
 * will be assigned; otherwise, fallback to the top 5.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - The Supabase client.
 * @param {number} promoterId - The ID of the promoter.
 * @param {number[]} bannedGenreIds - Array of banned genre IDs.
 * @param {boolean} isFestival - Whether the main event is a festival (allows more genres)
 * @returns {Promise<number[]>}
 */
async function assignPromoterGenres(supabase, promoterId, bannedGenreIds, isFestival = false) {
    // 1) Get the promoter's events
    const { data: promoterEvents, error: peError } = await supabase
        .from('event_promoter')
        .select('event_id')
        .eq('promoter_id', promoterId);
    if (peError) throw peError;

    // 2) Count the genres of these events
    const genreCounts = {};
    for (const { event_id } of promoterEvents) {
        const { data: eventGenres, error: egError } = await supabase
            .from('event_genre')
            .select('genre_id')
            .eq('event_id', event_id);
        if (egError) throw egError;
        eventGenres.forEach(g => {
            genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
        });
    }

    // 3) First filter: threshold + exclusion of banned genres
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

    // 4) More permissive fallback
    if (topGenreIds.length === 0) {
        topGenreIds = Object.entries(genreCounts)
            .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
            .sort(([, a], [, b]) => b - a)
            .slice(0, fallbackGenres)
            .map(([genreId]) => Number(genreId));

        console.log(
            `[Genres] No genre ≥ ${MIN_GENRE_OCCURRENCE} non-banned occurrences for promoter ${promoterId}, ` +
            `fallback top ${fallbackGenres} without threshold${isFestival ? ' (festival)' : ''}:`,
            topGenreIds
        );
    } else {
        console.log(
            `[Genres] Top genres for promoter ${promoterId} (threshold ${MIN_GENRE_OCCURRENCE}${isFestival ? ', festival - max ' + maxGenres : ''}):`,
            topGenreIds
        );
    }

    // 5) Save in promoter_genre
    for (const genreId of topGenreIds) {
        await databaseUtils.ensureRelation(
            supabase,
            "promoter_genre",
            { promoter_id: promoterId, genre_id: genreId },
            "promoter_genre"
        );
    }

    return topGenreIds;
}

export default {
    fetchHighResImage,
    findOrInsertPromoter,
    assignPromoterGenres,
};
