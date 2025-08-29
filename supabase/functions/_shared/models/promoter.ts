// Promoter model pour Edge Functions
// Adaptation complète du modèle promoter JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { normalizeNameEnhanced } from '../utils/name.ts';
import { FUZZY_THRESHOLD, MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL } from '../utils/constants.ts';
import { Promoter } from '../types/index.ts';

// String similarity utility (simplified version)
function compareTwoStrings(first: string, second: string): number {
  const firstBigrams = new Set();
  const secondBigrams = new Set();
  
  for (let i = 0; i < first.length - 1; i++) {
    firstBigrams.add(first.substring(i, i + 2));
  }
  
  for (let i = 0; i < second.length - 1; i++) {
    secondBigrams.add(second.substring(i, i + 2));
  }
  
  const intersection = [...firstBigrams].filter(x => secondBigrams.has(x)).length;
  const union = firstBigrams.size + secondBigrams.size;
  
  if (union === 0) return 0;
  return (2 * intersection) / union;
}

export interface PromoterSource {
  id?: string;
  name: string;
  url?: string;
  photo?: {
    imageUri?: string;
  };
}

export interface ExternalLinks {
  facebook?: {
    id: string;
    link: string;
  };
  [key: string]: any;
}

/**
 * Fetches a high-resolution image from Facebook Graph API
 * @param objectId - The Facebook object ID (e.g., page or event ID)
 * @returns Promise with URL of the high-resolution image or null
 */
export async function fetchHighResImage(objectId: string): Promise<string | null> {
  const longLivedToken = Deno.env.get('LONG_LIVED_TOKEN');
  if (!longLivedToken) {
    logger.warn('LONG_LIVED_TOKEN not available for high-res image fetch');
    return null;
  }

  try {
    logger.debug(`Fetching high-res Facebook image for object: ${objectId}`);

    const response = await fetch(
      `https://graph.facebook.com/${objectId}?fields=picture.width(720).height(720)&access_token=${longLivedToken}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.picture && data.picture.data && data.picture.data.url) {
      logger.info(`Found high-res Facebook image for object ${objectId}`);
      return data.picture.data.url;
    }

    return null;

  } catch (error) {
    logger.error('Error fetching high resolution image from Facebook', error, { objectId });
    return null;
  }
}

/**
 * Finds or inserts a promoter, then returns complete promoter object
 * @param promoterName - The name of the promoter
 * @param eventData - The event data containing hosts information
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with promoter object
 */
export async function findOrInsertPromoter(
  promoterName: string,
  eventData?: { hosts?: PromoterSource[] },
  dryRun = false
): Promise<Promoter> {
  const normalizedName = normalizeNameEnhanced(promoterName);
  
  logger.info(`Processing promoter: ${promoterName}`);

  if (dryRun) {
    logger.info(`[DRY_RUN] Would have processed promoter: ${promoterName}`);
    return {
      id: 999999,
      name: normalizedName,
      image_url: null
    } as Promoter;
  }

  // Find promoter source data from event hosts
  const promoterSource = eventData?.hosts?.find(h => h.name === promoterName);

  // Prepare Facebook external_links object
  let facebookLinks: ExternalLinks | null = null;
  if (promoterSource?.id && promoterSource?.url) {
    facebookLinks = {
      facebook: {
        id: promoterSource.id,
        link: promoterSource.url
      }
    };
  }

  // 1) Exact match on the name
  try {
    const { data: exactMatches, error: exactError } = await db.client
      .from('promoters')
      .select('id, name, image_url, external_links')
      .eq('name', normalizedName);

    if (exactError) throw exactError;

    if (exactMatches && exactMatches.length > 0) {
      const promoter = exactMatches[0] as Promoter;
      
      // Update external_links if Facebook info is missing
      if (facebookLinks && (!promoter.external_links || !promoter.external_links.facebook)) {
        try {
          const { error: updateError } = await db.client
            .from('promoters')
            .update({ 
              external_links: { 
                ...promoter.external_links, 
                ...facebookLinks 
              } 
            })
            .eq('id', promoter.id);

          if (updateError) {
            logger.error('Error updating promoter external_links', updateError);
          } else {
            logger.info(`Updated promoter external_links for id=${promoter.id}`);
          }
        } catch (error) {
          logger.error('Error updating promoter external_links', error);
        }
      }

      logger.info(`Promoter "${promoterName}" found (exact match) → id=${promoter.id}`);
      return promoter;
    }
  } catch (error) {
    logger.error('Error searching for exact promoter match', error);
  }

  // 2) Fuzzy match against all existing promoters
  try {
    const { data: allPromoters, error: allError } = await db.client
      .from('promoters')
      .select('id, name, image_url, external_links');

    if (allError) throw allError;

    if (allPromoters && allPromoters.length > 0) {
      let bestMatch: Promoter | null = null;
      let bestRating = 0;

      for (const promoter of allPromoters) {
        const rating = compareTwoStrings(
          normalizedName.toLowerCase(),
          promoter.name.toLowerCase()
        );
        
        if (rating > bestRating) {
          bestRating = rating;
          bestMatch = promoter as Promoter;
        }
      }

      if (bestMatch && bestRating >= FUZZY_THRESHOLD) {
        // Update external_links if Facebook info is missing
        if (facebookLinks && (!bestMatch.external_links || !bestMatch.external_links.facebook)) {
          try {
            const { error: updateError } = await db.client
              .from('promoters')
              .update({ 
                external_links: { 
                  ...bestMatch.external_links, 
                  ...facebookLinks 
                } 
              })
              .eq('id', bestMatch.id);

            if (updateError) {
              logger.error('Error updating promoter external_links', updateError);
            } else {
              logger.info(`Updated promoter external_links for id=${bestMatch.id}`);
            }
          } catch (error) {
            logger.error('Error updating promoter external_links', error);
          }
        }

        logger.info(`Promoter "${promoterName}" similar to "${bestMatch.name}" → id=${bestMatch.id} (similarity: ${bestRating.toFixed(3)})`);
        return bestMatch;
      }
    }
  } catch (error) {
    logger.error('Error performing fuzzy promoter search', error);
  }

  // 3) Insert new promoter
  logger.info(`Inserting new promoter "${promoterName}"`);

  const newPromoterData: Omit<Promoter, 'id' | 'created_at' | 'updated_at'> = {
    name: normalizedName
  };

  // Try to get high-resolution image via Facebook Graph
  if (promoterSource?.id) {
    try {
      const highResImage = await fetchHighResImage(promoterSource.id);
      if (highResImage) {
        newPromoterData.image_url = highResImage;
      }
    } catch (error) {
      logger.warn('Failed to fetch high-resolution Facebook image', error);
    }
  }

  // Fallback to photo.imageUri if available
  if (!newPromoterData.image_url && promoterSource?.photo?.imageUri) {
    newPromoterData.image_url = promoterSource.photo.imageUri;
  }

  // Add Facebook external_links if available
  if (facebookLinks) {
    newPromoterData.external_links = facebookLinks;
  }

  try {
    const { data: inserted, error: insertError } = await db.client
      .from('promoters')
      .insert([newPromoterData])
      .select('id, name, image_url')
      .single();

    if (insertError) throw insertError;

    const createdPromoter = inserted as Promoter;
    logger.info(`Promoter inserted: "${promoterName}" → id=${createdPromoter.id}`);
    
    return createdPromoter;

  } catch (error) {
    logger.error('Error inserting new promoter', error);
    throw error;
  }
}

/**
 * For a promoter, assigns genres based on their events
 * @param promoterId - The ID of the promoter
 * @param bannedGenreIds - Array of banned genre IDs
 * @param isFestival - Whether the main event is a festival (allows more genres)
 * @returns Promise with array of assigned genre IDs
 */
export async function assignPromoterGenres(
  promoterId: number,
  bannedGenreIds: number[] = [],
  isFestival = false
): Promise<number[]> {
  try {
    logger.info(`Assigning genres to promoter ${promoterId} (festival: ${isFestival})`);

    // 1) Get the promoter's events
    const { data: promoterEvents, error: peError } = await db.client
      .from('event_promoter')
      .select('event_id')
      .eq('promoter_id', promoterId);

    if (peError) throw peError;

    if (!promoterEvents || promoterEvents.length === 0) {
      logger.warn(`No events found for promoter ${promoterId}`);
      return [];
    }

    // 2) Count the genres of these events
    const genreCounts: Record<number, number> = {};
    
    for (const { event_id } of promoterEvents) {
      const { data: eventGenres, error: egError } = await db.client
        .from('event_genre')
        .select('genre_id')
        .eq('event_id', event_id);

      if (egError) throw egError;

      if (eventGenres) {
        eventGenres.forEach(g => {
          genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
        });
      }
    }

    // 3) Filter and sort genres
    const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
    const fallbackGenres = isFestival ? 8 : 3;

    let topGenreIds = Object.entries(genreCounts)
      .filter(([genreId, count]) =>
        count >= MIN_GENRE_OCCURRENCE &&
        !bannedGenreIds.includes(Number(genreId))
      )
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxGenres)
      .map(([genreId]) => Number(genreId));

    // 4) Fallback if no genres meet minimum occurrence
    if (topGenreIds.length === 0) {
      topGenreIds = Object.entries(genreCounts)
        .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
        .sort(([, a], [, b]) => b - a)
        .slice(0, fallbackGenres)
        .map(([genreId]) => Number(genreId));

      logger.warn(
        `No genre ≥ ${MIN_GENRE_OCCURRENCE} occurrences for promoter ${promoterId}, ` +
        `using fallback top ${fallbackGenres}${isFestival ? ' (festival)' : ''}`
      );
    } else {
      logger.info(
        `Top genres for promoter ${promoterId} (threshold ${MIN_GENRE_OCCURRENCE}${isFestival ? ', festival - max ' + maxGenres : ''}): ${topGenreIds.join(', ')}`
      );
    }

    // 5) Save promoter-genre relationships
    for (const genreId of topGenreIds) {
      try {
        // Check if relationship already exists
        const { data: existing } = await db.client
          .from('promoter_genre')
          .select('id')
          .eq('promoter_id', promoterId)
          .eq('genre_id', genreId)
          .single();

        if (!existing) {
          // Insert new relationship
          const { error: insertError } = await db.client
            .from('promoter_genre')
            .insert([{
              promoter_id: promoterId,
              genre_id: genreId
            }]);

          if (insertError) {
            logger.error('Error inserting promoter-genre relationship', insertError);
          }
        }
      } catch (error) {
        logger.error('Error managing promoter-genre relationship', error);
      }
    }

    return topGenreIds;

  } catch (error) {
    logger.error('Error assigning promoter genres', error);
    throw error;
  }
}

/**
 * Gets promoter by ID
 * @param id - Promoter ID
 * @returns Promise with promoter or null
 */
export async function getPromoter(id: number): Promise<Promoter | null> {
  try {
    const { data, error } = await db.client
      .from('promoters')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as Promoter;

  } catch (error) {
    logger.error('Error getting promoter', error);
    throw error;
  }
}

/**
 * Searches for promoters by name
 * @param searchTerm - Search term
 * @returns Promise with array of promoters
 */
export async function searchPromoters(searchTerm: string): Promise<Promoter[]> {
  try {
    logger.debug(`Searching promoters for: ${searchTerm}`);

    const { data, error } = await db.client
      .from('promoters')
      .select('*')
      .ilike('name', `%${searchTerm}%`)
      .limit(10);

    if (error) throw error;

    logger.debug(`Found ${data?.length || 0} promoters matching "${searchTerm}"`);
    return data as Promoter[] || [];

  } catch (error) {
    logger.error('Error searching promoters', error);
    throw error;
  }
}

export default {
  fetchHighResImage,
  findOrInsertPromoter,
  assignPromoterGenres,
  getPromoter,
  searchPromoters
};
