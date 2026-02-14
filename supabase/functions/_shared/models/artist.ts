// Artist model pour Edge Functions
// Adaptation complète du modèle artist JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { soundCloudApi, openAiApi } from '../utils/api.ts';
import { tokenManager } from '../utils/token.ts';
import { normalizeNameEnhanced, cleanArtistName, areNamesSimilar } from '../utils/name.ts';
import { enrichArtistData, applyEnrichmentToArtist } from '../utils/enrichment.ts';
import { normalizeExternalLinks } from '../utils/social.ts';
import { withRetry } from '../utils/retry.ts';
import genreModel from './genre.ts';
import { Artist, SoundCloudUser, SoundCloudTrack, EnrichmentResult } from '../types/index.ts';

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

export interface ParsedArtist {
  name: string;
  time?: string;
  soundcloud?: string;
  stage?: string;
  performance_mode?: string;
}

/**
 * Gets best quality image URL from SoundCloud avatar
 * @param avatarUrl - Original avatar URL
 * @returns Promise with best quality URL or null
 */
export async function getBestImageUrl(avatarUrl?: string): Promise<string | null> {
  if (!avatarUrl) return null;
  
  // SoundCloud uses '-large.jpg' for 100x100, and '-t500x500.jpg' for 500x500
  if (!avatarUrl.includes('-large')) return avatarUrl;
  
  const t500Url = avatarUrl.replace('-large', '-t500x500');
  return t500Url;
}

/**
 * Searches for an artist on SoundCloud using robust scoring
 * @param artistName - Name of the artist
 * @returns Promise with best match or null
 */
export async function searchArtist(artistName: string): Promise<SoundCloudUser | null> {
  try {
    logger.info(`Searching SoundCloud for artist: ${artistName}`);
    
    const normName = normalizeNameEnhanced(artistName);
    const response = await soundCloudApi<SoundCloudUser[]>(
      `/users?q=${encodeURIComponent(normName)}&limit=10`
    );
    
    if (!response.success || !response.data || response.data.length === 0) {
      logger.debug(`No SoundCloud artist found for: ${artistName}`);
      return null;
    }
    
    const data = response.data;
    
    // Composite scoring
    let bestMatch: SoundCloudUser | null = null;
    let bestScore = 0;
    const maxFollowers = Math.max(...data.map(u => u.followers_count || 0), 1);
    
    data.forEach((user, idx) => {
      const userNorm = normalizeNameEnhanced(user.username);
      const nameScore = compareTwoStrings(normName.toLowerCase(), userNorm.toLowerCase());
      const followers = user.followers_count || 0;
      const followersScore = Math.log10(followers + 1) / Math.log10(maxFollowers + 1);
      const positionScore = 1 - (idx / data.length);
      const score = (nameScore * 0.6) + (followersScore * 0.3) + (positionScore * 0.1);
      
      logger.debug(`SoundCloud candidate: ${user.username}`, {
        nameScore: nameScore.toFixed(2),
        followers,
        followersScore: followersScore.toFixed(2),
        position: idx + 1,
        totalScore: score.toFixed(3)
      });
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = user;
      }
    });
    
    if (bestMatch && bestScore > 0.6) {
      logger.info(`Best SoundCloud match for "${artistName}": ${bestMatch.username} (score: ${bestScore.toFixed(3)})`);
      return bestMatch;
    } else {
      logger.debug(`No sufficient match found for "${artistName}" (best score: ${bestScore.toFixed(3)})`);
      return null;
    }
    
  } catch (error) {
    logger.error('Error searching for artist on SoundCloud', error, { artistName });
    return null;
  }
}

/**
 * Extracts structured information from SoundCloud artist
 * @param artist - SoundCloud artist object
 * @returns Promise with structured artist data
 */
export async function extractArtistInfo(artist: SoundCloudUser): Promise<Partial<Artist>> {
  const bestImageUrl = await getBestImageUrl(artist.avatar_url);
  
  let artistData: Partial<Artist> = {
    name: artist.username,
    image_url: bestImageUrl || undefined,
    description: artist.description || undefined,
    location_info: {
      country: artist.country || undefined,
      city: artist.city || undefined
    },
    external_links: {
      soundcloud: {
        link: artist.permalink_url,
        id: String(artist.id)
      }
    }
  };
  
  // Auto-enrichment with MusicBrainz and email extraction
  try {
    logger.debug(`Starting auto-enrichment for artist: ${artistData.name}`);
    const enrichmentResult = await enrichArtistData(artistData);
    
    if (enrichmentResult.success && enrichmentResult.data) {
      artistData = enrichmentResult.data;
      logger.info(`Auto-enrichment completed for "${artistData.name}" (score: ${enrichmentResult.score}%)`);
    } else {
      logger.warn(`Auto-enrichment failed for "${artistData.name}"`, enrichmentResult.errors);
    }
  } catch (error) {
    logger.warn(`Auto-enrichment failed for "${artistData.name}"`, error);
  }
  
  return artistData;
}

/**
 * Back-fills genres for an existing artist that has no artist_genre entries yet.
 * Only runs if the artist has a SoundCloud ID.
 */
async function backfillArtistGenres(artist: Artist): Promise<void> {
  if (!artist.id || !artist.external_links?.soundcloud?.id) return;

  try {
    // Check if artist already has genres
    const { data: existingGenres, error } = await db.client
      .from('artist_genre')
      .select('genre_id')
      .eq('artist_id', artist.id)
      .limit(1);

    if (error || (existingGenres && existingGenres.length > 0)) {
      return; // Already has genres or error checking
    }

    logger.info(`Back-filling genres for existing artist "${artist.name}" (id=${artist.id})`);
    const genres = await genreModel.processArtistGenres(artist);
    const genreIds: number[] = [];

    for (const genreObj of genres) {
      if (genreObj.id) {
        genreIds.push(genreObj.id);
      } else if (genreObj.name && genreObj.description) {
        const genreId = await genreModel.insertGenreIfNew({
          name: genreObj.name,
          description: genreObj.description,
          lastfmUrl: genreObj.lastfmUrl
        });
        genreIds.push(genreId);
      }
    }

    if (genreIds.length > 0) {
      await db.linkArtistGenres(artist.id, genreIds);
      logger.info(`Back-filled ${genreIds.length} genres for artist ${artist.id}`);
    }
  } catch (err) {
    logger.warn(`Failed to back-fill genres for artist ${artist.id}`, err);
  }
}

/**
 * Finds existing artist or inserts new one
 * @param artistObj - Artist object from parsing
 * @param enableGenreProcessing - Whether to process genres
 * @returns Promise with artist ID or null
 */
export async function findOrInsertArtist(
  artistObj: { name: string; soundcloud?: string | null },
  enableGenreProcessing = true
): Promise<number | null> {
  let artistName = (artistObj.name || '').trim();
  if (!artistName) return null;

  logger.info(`Processing artist: ${artistName}`);

  // Name normalization
  artistName = normalizeNameEnhanced(artistName);

  // Search on SoundCloud
  let scArtist: SoundCloudUser | null = null;
  try {
    scArtist = await searchArtist(artistName);
  } catch (error) {
    logger.warn('Failed to search SoundCloud', error);
    return null;
  }

  // Build artist data
  let artistData: Partial<Artist>;
  if (scArtist) {
    artistData = await extractArtistInfo(scArtist);
  } else {
    artistData = {
      name: artistName,
      external_links: artistObj.soundcloud
        ? { soundcloud: { link: artistObj.soundcloud } }
        : undefined,
    };
  }

  // Normalize external links before duplicate detection
  if (artistData.external_links) {
    artistData.external_links = normalizeExternalLinks(artistData.external_links) ?? undefined;
  }

  // Check for duplicates via SoundCloud ID
  if (artistData.external_links?.soundcloud?.id) {
    const existing = await db.getArtistBySoundCloudId(artistData.external_links.soundcloud.id);
    if (existing) {
      logger.info(`Artist exists by SoundCloud ID: "${artistName}" (id=${existing.id})`);
      // Back-fill genres if missing
      if (enableGenreProcessing) {
        await backfillArtistGenres(existing);
      }
      return existing.id!;
    }
  }

  // Check for duplicates by name
  const existingByName = await db.searchArtistByName(artistName);
  if (existingByName.length > 0) {
    const match = existingByName.find(artist => 
      areNamesSimilar(artist.name, artistName, 0.9)
    );
    if (match) {
      logger.info(`Artist exists by name: "${artistName}" (id=${match.id})`);
      // Back-fill genres if missing
      if (enableGenreProcessing) {
        await backfillArtistGenres(match);
      }
      return match.id!;
    }
  }

  // Insert new artist
  try {
    if (!artistData.name) {
      throw new Error('Artist name is required');
    }
    
    const newArtist = await db.createArtist(artistData as Omit<Artist, "id" | "created_at" | "updated_at">);
    logger.info(`Artist inserted: "${artistName}" (id=${newArtist.id})`);

    // Process and link genres
    if (enableGenreProcessing) {
      try {
        const genres = await genreModel.processArtistGenres(newArtist);
        const genreIds: number[] = [];
        
        for (const genreObj of genres) {
          if (genreObj.id) {
            genreIds.push(genreObj.id);
          } else if (genreObj.name && genreObj.description) {
            const genreId = await genreModel.insertGenreIfNew({
              name: genreObj.name,
              description: genreObj.description,
              lastfmUrl: genreObj.lastfmUrl
            });
            genreIds.push(genreId);
          }
        }
        
        if (genreIds.length > 0) {
          await db.linkArtistGenres(newArtist.id!, genreIds);
          logger.info(`Linked ${genreIds.length} genres to artist ${newArtist.id}`);
        }
      } catch (error) {
        logger.error('Error processing genres for artist', error, { artistName });
      }
    }

    return newArtist.id!;
  } catch (error) {
    logger.error('Error inserting artist', error, { artistName });
    throw error;
  }
}

/**
 * Enhanced version for timetable imports
 * @param artistData - Basic artist data
 * @param soundCloudData - Optional SoundCloud data
 * @param dryRun - Whether to perform actual operations
 * @returns Promise with artist info
 */
export async function insertOrUpdateArtist(
  artistData: { name: string },
  soundCloudData: Partial<Artist> | null = null,
  dryRun = false
): Promise<{ id: number | string }> {
  try {
    const normName = normalizeNameEnhanced(artistData.name);
    
    logger.info(`Processing artist for timetable: ${artistData.name}`);

    // Check for duplicates by SoundCloud ID if available
    if (soundCloudData?.external_links?.soundcloud?.id) {
      const existingByExternal = await db.getArtistBySoundCloudId(soundCloudData.external_links.soundcloud.id);
      if (existingByExternal) {
        logger.info(`Existing artist found by SoundCloud ID: "${artistData.name}" (id=${existingByExternal.id})`);
        return { id: existingByExternal.id! };
      }
    }

    // Check for duplicates by name
    const existingByName = await db.searchArtistByName(normName);
    let existingArtist: Artist | null = null;
    
    if (existingByName.length > 0) {
      existingArtist = existingByName.find(artist => 
        areNamesSimilar(artist.name, normName, 0.8)
      ) || null;
    }

    if (dryRun) {
      logger.info(`[DRY_RUN] Would have inserted/updated artist: ${artistData.name}`);
      return { id: `dryrun_artist_${normName}` };
    }

    // Build artist record
    let artistRecord: Partial<Artist> = {
      name: normName,
      image_url: soundCloudData?.image_url,
      description: soundCloudData?.description,
      external_links: soundCloudData?.external_links
    };

    // Auto-enrichment for new artists or artists without much data
    const shouldEnrich = !existingArtist || 
                        !existingArtist.external_links?.soundcloud ||
                        !existingArtist.external_links?.spotify;

    if (shouldEnrich) {
      try {
        const enrichmentResult = await enrichArtistData(artistRecord);
        if (enrichmentResult.success && enrichmentResult.data) {
          artistRecord = enrichmentResult.data;
          logger.info(`Auto-enrichment completed for "${artistRecord.name}" (score: ${enrichmentResult.score}%)`);
        }
      } catch (error) {
        logger.warn(`Auto-enrichment failed for "${artistRecord.name}"`, error);
      }
    }

    if (existingArtist) {
      // Update existing artist
      const updated = await db.updateArtist(existingArtist.id!, artistRecord);
      logger.info(`Updated artist: ${updated.name} (ID: ${updated.id})`);
      return { id: updated.id! };
    } else {
      // Insert new artist
      if (!artistRecord.name) {
        throw new Error('Artist name is required');
      }
      
      const inserted = await db.createArtist(artistRecord as Omit<Artist, "id" | "created_at" | "updated_at">);
      logger.info(`Inserted new artist: ${inserted.name} (ID: ${inserted.id})`);
      return { id: inserted.id! };
    }

  } catch (error) {
    logger.error(`Error inserting/updating artist "${artistData.name}"`, error);
    throw error;
  }
}

/**
 * Processes simple event artists using OpenAI parsing
 * @param eventId - Event ID in database
 * @param eventDescription - Event description to parse
 * @param dryRun - Whether to perform actual operations
 * @returns Promise with array of processed artist IDs
 */
export async function processSimpleEventArtists(
  eventId: number,
  eventDescription: string,
  dryRun = false
): Promise<(number | string)[]> {
  logger.info("Processing simple event - calling OpenAI to parse artists from description", {
    eventId,
    hasDescription: !!eventDescription,
    descriptionLength: eventDescription?.length || 0,
    dryRun
  });
  
  let parsedArtists: ParsedArtist[] = [];

  if (eventDescription) {
    try {
      const systemPrompt = `You are an expert at extracting structured data from Facebook Event descriptions. Your task is to analyze the provided text and extract information solely about the artists. Assume that each line of the text (separated by line breaks) represents one artist's entry, unless it clearly contains a collaboration indicator (such as "B2B", "F2F", "B3B", or "VS"), in which case treat each artist separately. 

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
- CRITICAL: Include ALL artist names, even very short ones (1-3 characters). Names like "séa", "sa", "DJ A", "X", "A", "B", "C", etc. are all valid artist names in electronic music.
- Short names are VERY COMMON in electronic music - do not exclude them based on length.
- Even single letters, numbers, or short combinations can be artist stage names.
- Focus on detecting actual performer/artist names that appear in lineups, not generic words like "tickets", "venue", "doors", etc.
- If any piece of information (time, SoundCloud link, stage, performance_mode) is missing, use an empty string.
- The generated JSON must be valid and strictly follow the structure requested.
- The output should be in English.`;

      const response = await openAiApi<any>('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4o-mini', // GPT-5 mini not yet available, using enhanced GPT-4o mini
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Parse artist names from this event description:\n\n${eventDescription}`
            }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (!response.success || !response.data?.choices?.[0]?.message?.content) {
        logger.error('OpenAI API failed', { response });
        throw new Error('No response from OpenAI');
      }

      const content = response.data.choices[0].message.content.trim();
      logger.info('OpenAI response received', { 
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });

      // Extract JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          parsedArtists = JSON.parse(jsonMatch[0]);
          logger.info(`OpenAI parsed ${parsedArtists.length} artists with enhanced data`);
          parsedArtists.forEach((artist, i) => {
            const extraInfo: string[] = [];
            if (artist.time) extraInfo.push(`time: ${artist.time}`);
            if (artist.stage) extraInfo.push(`stage: ${artist.stage}`);
            if (artist.performance_mode) extraInfo.push(`mode: ${artist.performance_mode}`);
            if (artist.soundcloud) extraInfo.push(`soundcloud: yes`);
            
            const infoStr = extraInfo.length > 0 ? ` (${extraInfo.join(', ')})` : '';
            logger.debug(`  ${i + 1}. ${artist.name}${infoStr}`);
          });
        } catch (jsonError) {
          logger.warn('JSON parsing failed, attempting to fix truncated response');
          // Try to fix truncated JSON
          let fixedJson = jsonMatch[0];
          
          if (fixedJson.includes('"name":') && !fixedJson.endsWith('}]')) {
            const lastCompleteIndex = fixedJson.lastIndexOf('}');
            if (lastCompleteIndex > 0) {
              fixedJson = fixedJson.substring(0, lastCompleteIndex + 1) + ']';
            }
          }
          
          if (!fixedJson.endsWith(']')) {
            const openBraces = (fixedJson.match(/\{/g) || []).length;
            const closeBraces = (fixedJson.match(/\}/g) || []).length;
            const missingClosing = openBraces - closeBraces;
            
            fixedJson += '}'.repeat(missingClosing) + ']';
          }
          
          try {
            parsedArtists = JSON.parse(fixedJson);
            logger.info(`Fixed and parsed ${parsedArtists.length} artists`);
          } catch (finalError) {
            logger.error('Could not fix JSON, using empty array', finalError);
            parsedArtists = [];
          }
        }
      } else {
        logger.warn('No valid JSON array found in OpenAI response');
        parsedArtists = [];
      }
    } catch (error) {
      logger.error('Error calling OpenAI', error);
      // No fallback - same behavior as local system
      parsedArtists = [];
    }
  } else {
    logger.warn('No event description provided for parsing');
    parsedArtists = [];
  }

  // Import artists and create relations
  const processedArtistIds: (number | string)[] = [];
  
  if (!dryRun && eventId && parsedArtists.length > 0) {
    for (const artistObj of parsedArtists) {
      if (artistObj.name && artistObj.name.trim()) {
        try {
          const enhancedArtistObj = {
            name: artistObj.name.trim(),
            soundcloud: artistObj.soundcloud || null
          };
          
          const artistResult = await findOrInsertArtist(enhancedArtistObj);
          if (artistResult) {
            processedArtistIds.push(artistResult);
            
            // Link artist to event WITH performance data (stage, time) — like local script  
            if (typeof artistResult === 'number') {
              try {
                await db.createEventArtistRelation(eventId, [artistResult], {
                  stage: artistObj.stage || null,
                  start_time: artistObj.time || null,
                  end_time: null
                });
                logger.info(`Created event_artist relation for "${artistObj.name}" (ID: ${artistResult})`);
              } catch (relError: any) {
                logger.error(`Error creating event_artist relation for "${artistObj.name}": ${relError?.message || relError}`);
              }
            } else {
              logger.warn(`artistResult is not a number for "${artistObj.name}": type=${typeof artistResult}`);
            }
          }
        } catch (error) {
          logger.error(`Error processing artist "${artistObj.name}"`, error);
        }
      }
    }
    
    logger.info(`Simple event import complete: ${processedArtistIds.length} artists processed`);
  } else if (dryRun) {
    logger.info(`[DRY_RUN] Would have processed ${parsedArtists.length} artists for event ${eventId}`);
  } else {
    logger.warn('No artists to process or missing event ID');
  }

  return processedArtistIds;
}

export default {
  getBestImageUrl,
  findOrInsertArtist,
  insertOrUpdateArtist,
  searchArtist,
  extractArtistInfo,
  processSimpleEventArtists
};
