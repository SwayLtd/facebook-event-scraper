// Promoter model pour Edge Functions
// Adaptation complète du modèle promoter JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { normalizeNameEnhanced } from '../utils/name.ts';
import { downloadAndUploadEntityImage } from '../utils/r2.ts';
import { FUZZY_THRESHOLD, BANNED_GENRES_SLUGS, MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL, FESTIVAL_FALLBACK_GENRES } from '../utils/constants.ts';
import { Promoter } from '../types/index.ts';

// String similarity utility (Dice coefficient with proper bigram counting)
function compareTwoStrings(first: string, second: string): number {
  first = first.replace(/\s+/g, '');
  second = second.replace(/\s+/g, '');

  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! + 1 : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram)! : 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
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
 * Scrapes a high-quality image from a Facebook page by extracting the og:image meta tag.
 * This approach doesn't require any API token and provides high-resolution images.
 * @param facebookUrl - The Facebook page URL (e.g., https://www.facebook.com/pagename)
 * @returns Promise with URL of the high-quality image or null
 */
export async function scrapePromoterImage(facebookUrl: string): Promise<string | null> {
  if (!facebookUrl) return null;

  try {
    logger.debug(`Scraping og:image from Facebook page: ${facebookUrl}`);

    const response = await fetch(facebookUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      logger.warn(`Failed to fetch Facebook page: HTTP ${response.status}`, { url: facebookUrl });
      return null;
    }

    const html = await response.text();

    // Extract og:image content from meta tag
    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
      || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);

    if (!ogImageMatch || !ogImageMatch[1]) {
      logger.warn('No og:image meta tag found on Facebook page', { url: facebookUrl });
      return null;
    }

    // Decode HTML entities in the URL
    let imageUrl = ogImageMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'");

    // Validate it looks like a real image URL
    if (!imageUrl.startsWith('http')) {
      logger.warn('og:image URL is not a valid HTTP URL', { imageUrl, url: facebookUrl });
      return null;
    }

    logger.info(`Found og:image for Facebook page`, { url: facebookUrl, imageUrl: imageUrl.substring(0, 100) + '...' });
    return imageUrl;

  } catch (error) {
    logger.error('Error scraping promoter image from Facebook page', error, { url: facebookUrl });
    return null;
  }
}

/**
 * Checks if an image URL is likely a low-quality Facebook thumbnail.
 * Common patterns: small profile pictures (p50x50, p100x100), scontent with small dimensions.
 */
function isLowQualityImage(imageUrl: string): boolean {
  if (!imageUrl) return true;
  // Typical low-quality Facebook profile picture patterns
  const lowQualityPatterns = [
    /p\d{2,3}x\d{2,3}\//i,   // p50x50/, p100x100/ etc.
    /\/s\d{2,3}x\d{2,3}\//i, // /s100x100/ etc.
    /\.jpg\?.*_nc_cat.*oh=/i, // Old-style small thumbnails
    /\/t1\.0-0\/p/i,          // Profile picture thumbnails
  ];
  return lowQualityPatterns.some(p => p.test(imageUrl));
}

/**
 * Tries to get the best quality image using multiple strategies, in order:
 * 1. Scrape og:image from the Facebook page URL
 * 2. Fetch via Facebook Graph API (if objectId available)
 * 3. Fallback to the event host photo.imageUri (thumbnail)
 * @param promoterSource - The host data from the event
 * @param existingExternalLinks - Existing external_links (for promoters already in DB)
 * @returns The best image URL found, or null
 */
async function tryGetBestImage(
  promoterSource?: PromoterSource,
  existingExternalLinks?: ExternalLinks | null
): Promise<string | null> {
  // Determine the Facebook page URL from source or existing external_links
  const facebookPageUrl = promoterSource?.url
    || existingExternalLinks?.facebook?.link
    || null;

  let imageUrl: string | null = null;

  // 1) Try og:image scraping (best quality, no token needed)
  if (facebookPageUrl) {
    try {
      const ogImage = await scrapePromoterImage(facebookPageUrl);
      if (ogImage) {
        logger.info('Got high-quality image via og:image scraping');
        imageUrl = ogImage;
      }
    } catch (error) {
      logger.warn('og:image scraping failed, trying fallbacks', error);
    }
  }

  // 2) Try Facebook Graph API (needs LONG_LIVED_TOKEN)
  if (!imageUrl) {
    const objectId = promoterSource?.id || existingExternalLinks?.facebook?.id || null;
    if (objectId) {
      try {
        const graphImage = await fetchHighResImage(objectId);
        if (graphImage) {
          logger.info('Got high-quality image via Facebook Graph API');
          imageUrl = graphImage;
        }
      } catch (error) {
        logger.warn('Graph API image fetch failed', error);
      }
    }
  }

  // 3) Fallback to thumbnail from event host data
  if (!imageUrl && promoterSource?.photo?.imageUri) {
    logger.info('Using thumbnail fallback from event host data');
    imageUrl = promoterSource.photo.imageUri;
  }

  // Return raw image URL — R2 upload happens at call site with entity ID
  return imageUrl;
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

      // Upgrade image if missing or low-quality (small thumbnail)
      if (!promoter.image_url || isLowQualityImage(promoter.image_url)) {
        let upgradedImage = await tryGetBestImage(promoterSource, promoter.external_links);
        if (upgradedImage) {
          // Upload to R2 with structured path: promoters/{id}/cover/
          try {
            upgradedImage = await downloadAndUploadEntityImage(upgradedImage, 'promoters', promoter.id);
          } catch (r2Error) {
            logger.warn(`Failed to upload promoter image to R2 for id=${promoter.id}`, r2Error);
          }
          try {
            const { error: imgError } = await db.client
              .from('promoters')
              .update({ image_url: upgradedImage })
              .eq('id', promoter.id);
            if (!imgError) {
              promoter.image_url = upgradedImage;
              logger.info(`Upgraded image for promoter id=${promoter.id}`);
            }
          } catch (error) {
            logger.warn('Failed to upgrade promoter image', error);
          }
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

        // Upgrade image if missing or low-quality (small thumbnail)
        if (!bestMatch.image_url || isLowQualityImage(bestMatch.image_url)) {
          let upgradedImage = await tryGetBestImage(promoterSource, bestMatch.external_links);
          if (upgradedImage) {
            // Upload to R2 with structured path: promoters/{id}/cover/
            try {
              upgradedImage = await downloadAndUploadEntityImage(upgradedImage, 'promoters', bestMatch.id);
            } catch (r2Error) {
              logger.warn(`Failed to upload promoter image to R2 for id=${bestMatch.id}`, r2Error);
            }
            try {
              const { error: imgError } = await db.client
                .from('promoters')
                .update({ image_url: upgradedImage })
                .eq('id', bestMatch.id);
              if (!imgError) {
                bestMatch.image_url = upgradedImage;
                logger.info(`Upgraded image for promoter id=${bestMatch.id}`);
              }
            } catch (error) {
              logger.warn('Failed to upgrade promoter image', error);
            }
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

  // Try to get the best quality image (og:image scraping → Graph API → thumbnail fallback)
  const bestImage = await tryGetBestImage(promoterSource);
  if (bestImage) {
    newPromoterData.image_url = bestImage;
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

    // Upload image to R2 with structured path: promoters/{id}/cover/
    if (createdPromoter.id && createdPromoter.image_url && !createdPromoter.image_url.includes('assets.sway.events')) {
      try {
        const r2Url = await downloadAndUploadEntityImage(createdPromoter.image_url, 'promoters', createdPromoter.id);
        if (r2Url !== createdPromoter.image_url) {
          await db.client.from('promoters').update({ image_url: r2Url }).eq('id', createdPromoter.id);
          createdPromoter.image_url = r2Url;
          logger.info(`Promoter image uploaded to R2: ${r2Url}`);
        }
      } catch (imgError) {
        logger.warn(`Failed to upload promoter image to R2 for "${promoterName}"`, imgError);
      }
    }
    
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

    // Auto-compute bannedGenreIds if not provided
    if (bannedGenreIds.length === 0) {
      const { data: allGenres, error: gError } = await db.client
        .from('genres')
        .select('id, name');
      if (!gError && allGenres) {
        bannedGenreIds = allGenres
          .filter(g => BANNED_GENRES_SLUGS.has(g.name.replace(/\W/g, '').toLowerCase()))
          .map(g => g.id);
      }
    }

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
    const fallbackGenres = isFestival ? FESTIVAL_FALLBACK_GENRES : 3;

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

    // 5) Save promoter-genre relationships (upsert to avoid duplicates)
    if (topGenreIds.length > 0) {
      const links = topGenreIds.map(genreId => ({
        promoter_id: promoterId,
        genre_id: genreId
      }));

      const { error: upsertError } = await db.client
        .from('promoter_genre')
        .upsert(links, { onConflict: 'promoter_id,genre_id', ignoreDuplicates: true });

      if (upsertError) {
        logger.error('Error upserting promoter-genre relationships', upsertError);
      } else {
        logger.info(`Upserted ${topGenreIds.length} genre links for promoter ${promoterId}`);
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
  scrapePromoterImage,
  fetchHighResImage,
  findOrInsertPromoter,
  assignPromoterGenres,
  getPromoter,
  searchPromoters
};
