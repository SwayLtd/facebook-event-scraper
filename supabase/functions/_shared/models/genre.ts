// Genre model pour Edge Functions
// Adaptation complète du modèle genre JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { lastFmApi, soundCloudApi } from '../utils/api.ts';
import { tokenManager } from '../utils/token.ts';
import { BANNED_GENRES, BANNED_GENRES_SLUGS, MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL, FESTIVAL_FALLBACK_GENRES } from '../utils/constants.ts';
import { Genre, Artist, GenreAssignmentResult, SoundCloudTrack } from '../types/index.ts';

export interface GenreValidationResult {
  valid: boolean;
  name?: string;
  description?: string;
  lastfmUrl?: string;
}

export interface ProcessedGenre {
  id?: number;
  name?: string;
  description?: string;
  lastfmUrl?: string;
}

/**
 * Refines genre name for better display
 * @param name - Genre name to refine
 * @returns Refined genre name
 */
export function refineGenreName(name: string): string {
  if (!name) return '';
  
  let refined = name.replace(/\w\S*/g, (txt) => 
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
  
  // Special case for techno genres
  if (!refined.includes(' ') && /techno/i.test(refined)) {
    refined = refined.replace(/(.*)(Techno)/i, '$1 $2');
  }
  
  return refined;
}

/**
 * Splits compound tags containing delimiters
 * @param tag - Tag to split
 * @returns Array of sub-tags
 */
export function splitCompoundTags(tag: string): string[] {
  const delimiters = [' x ', ' & ', ' + ', ' / '];
  
  for (const delim of delimiters) {
    if (tag.includes(delim)) {
      return tag.split(delim).map(t => t.trim());
    }
  }
  
  return [tag];
}

/**
 * Removes non-alphanumeric characters for comparison
 * @param name - Genre name
 * @returns Slugified genre name
 */
export function slugifyGenre(name: string): string {
  return name.replace(/\W/g, '').toLowerCase();
}

/**
 * Cleans description by removing HTML and Last.fm references
 * @param desc - Description to clean
 * @returns Cleaned description or empty string
 */
export function cleanDescription(desc: string): string {
  if (!desc) return '';
  
  let text = desc.replace(/<[^>]*>/g, '').trim();
  text = text.replace(/read more on last\.fm/gi, '').trim();
  text = text.replace(/\s+\.\s*$/, '');
  
  return text.length < 30 ? '' : text;
}

/**
 * Fetches artist tracks from SoundCloud
 * @param soundcloudUserId - SoundCloud user ID
 * @returns Promise with array of tracks
 */
export async function fetchArtistTracks(soundcloudUserId: string): Promise<SoundCloudTrack[]> {
  try {
    logger.debug(`Fetching SoundCloud tracks for user ID: ${soundcloudUserId}`);
    
    const response = await soundCloudApi<SoundCloudTrack[]>(
      `/users/${soundcloudUserId}/tracks?limit=10`
    );
    
    if (!response.success || !response.data) {
      logger.warn(`Failed to fetch SoundCloud tracks for user ${soundcloudUserId}`, response.error);
      return [];
    }
    
    if (!Array.isArray(response.data)) {
      logger.error(`Expected tracks array but got:`, response.data);
      return [];
    }
    
    logger.info(`Fetched ${response.data.length} tracks for SoundCloud user ${soundcloudUserId}`);
    return response.data;
    
  } catch (error) {
    logger.error('Error fetching SoundCloud tracks', error, { soundcloudUserId });
    return [];
  }
}

/**
 * Verifies if a tag is a valid musical genre using Last.fm
 * @param tagName - Tag to verify
 * @returns Promise with validation result
 */
export async function verifyGenreWithLastFM(tagName: string): Promise<GenreValidationResult> {
  if (tagName.length === 1) {
    return { valid: false };
  }
  
  try {
    logger.debug(`Verifying genre with Last.fm: ${tagName}`);
    
    const response = await lastFmApi<any>('', {
      method: 'tag.getinfo',
      tag: tagName
    });
    
    if (!response.success || !response.data?.tag) {
      return { valid: false };
    }
    
    const tagData = response.data.tag;
    const rawSummary = tagData.wiki?.summary || '';
    const description = cleanDescription(rawSummary);
    
    if (!description) {
      return { valid: false };
    }
    
    const lowerDesc = description.toLowerCase();
    const lowerTag = tagName.toLowerCase();
    
    // More flexible validation for electronic music genres
    const hasGenreWord = /(genre|sub-genre|subgenre|style|type)/.test(lowerDesc);
    const hasMusicPhrase = new RegExp(`${lowerTag}\\s+music`).test(lowerDesc);
    const isElectronicMusic = /electronic|dance|techno|house|trance|drum|bass/.test(lowerDesc);
    const isUmbrella = /umbrella term/.test(lowerDesc);
    
    // Accept if it's an umbrella term OR has music-related keywords OR mentions electronic music
    if (!isUmbrella && !(hasGenreWord || hasMusicPhrase || isElectronicMusic)) {
      return { valid: false };
    }
    
    let lastfmUrl = tagData.url || '';
    const linkMatch = rawSummary.match(/<a href="([^"]+)"/);
    if (linkMatch?.[1]) {
      lastfmUrl = linkMatch[1];
    }
    
    logger.debug(`Genre verified successfully: ${tagName}`);
    
    return {
      valid: true,
      name: tagData.name.toLowerCase(),
      description,
      lastfmUrl
    };
    
  } catch (error) {
    logger.error('Error verifying genre with Last.fm', error, { tagName });
    return { valid: false };
  }
}

/**
 * Inserts genre into database if it doesn't exist
 * @param genreObject - Genre object to insert
 * @returns Promise with genre ID
 */
export async function insertGenreIfNew(genreObject: {
  name: string;
  description: string;
  lastfmUrl?: string;
}): Promise<number> {
  const { name, description, lastfmUrl } = genreObject;
  const normalizedName = name.toLowerCase();
  const genreSlug = slugifyGenre(normalizedName);
  
  // Check for existing genre
  const existingGenres = await db.getAllGenres();
  
  let duplicateGenre: Genre | undefined = undefined;
  
  // Check by Last.fm URL first (stored in external_links.lastfm.link)
  if (lastfmUrl) {
    duplicateGenre = existingGenres.find(g => 
      g.external_links?.lastfm?.link === lastfmUrl
    );
  }
  
  // Check by slug if not found by URL
  if (!duplicateGenre) {
    duplicateGenre = existingGenres.find(g => 
      slugifyGenre(g.name) === genreSlug
    );
  }
  
  if (duplicateGenre && duplicateGenre.id) {
    logger.debug(`Genre "${name}" already exists with ID ${duplicateGenre.id}`);
    return duplicateGenre.id;
  }
  
  // Create new genre
  const finalName = refineGenreName(name).trim();
  const newGenreData: Omit<Genre, 'id' | 'created_at' | 'updated_at'> = {
    name: finalName,
    description,
    external_links: lastfmUrl ? { lastfm: { link: lastfmUrl } } : undefined
  };
  
  const newGenre = await db.createGenre(newGenreData);
  logger.info(`Genre inserted: ${finalName} (id=${newGenre.id})`);
  
  return newGenre.id!;
}

/**
 * Extracts and normalizes tags from a track
 * @param track - SoundCloud track object
 * @returns Array of normalized tags
 */
export function extractTagsFromTrack(track: SoundCloudTrack): string[] {
  const tags: string[] = [];
  
  // Add genre if available
  if (track.genre) {
    tags.push(track.genre.toLowerCase().trim());
  }
  
  // Add tags from tag_list
  if (track.tag_list) {
    const rawTags = track.tag_list.split(/\s+/);
    rawTags.forEach(tag => {
      tag = tag.replace(/^#/, '').toLowerCase().trim();
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    });
  }
  
  logger.debug(`Extracted tags from track "${track.title || 'unknown'}":`, tags);
  return tags;
}

/**
 * Processes an artist's genres by fetching tracks and validating tags
 * @param artistData - Artist data from database
 * @returns Promise with array of processed genres
 */
export async function processArtistGenres(artistData: Partial<Artist>): Promise<ProcessedGenre[]> {
  const genresFound: ProcessedGenre[] = [];
  
  const soundcloudId = artistData.external_links?.soundcloud?.id;
  if (!soundcloudId) {
    logger.debug(`No SoundCloud ID for "${artistData.name}"`);
    return genresFound;
  }
  
  logger.info(`Processing genres for artist: ${artistData.name}`);
  
  // Fetch tracks from SoundCloud
  const tracks = await fetchArtistTracks(soundcloudId);
  logger.debug(`Found ${tracks.length} tracks for ${artistData.name}`);
  
  // Extract all tags from tracks
  let allTags: string[] = [];
  for (const track of tracks) {
    const tags = extractTagsFromTrack(track);
    let splitted: string[] = [];
    tags.forEach(t => {
      splitted = splitted.concat(splitCompoundTags(t));
    });
    allTags = allTags.concat(splitted.filter(t => /[a-zA-Z]/.test(t)));
  }
  
  // Remove duplicates
  allTags = Array.from(new Set(allTags));
  logger.debug(`Extracted ${allTags.length} unique tags:`, allTags.slice(0, 5));
  
  // Special aliases for common genres
  const aliasGenreIds: { [key: string]: number } = {
    'dnb': 437,
    'drumnbass': 437,
    "drum'n'bass": 437,
    'drumandbass': 437,
  };
  
  // Process each tag
  for (const rawTag of allTags) {
    const tag = rawTag.toLowerCase().trim();
    
    // Check for aliases first
    if (aliasGenreIds[tag]) {
      const id = aliasGenreIds[tag];
      logger.debug(`Alias detected for "${tag}" → genre_id ${id}`);
      if (!genresFound.some(g => g.id === id)) {
        genresFound.push({ id });
      }
      continue;
    }
    
    // Verify with Last.fm
    const validation = await verifyGenreWithLastFM(tag);
    if (validation.valid && validation.description) {
      const slug = slugifyGenre(validation.name!);
      if (!BANNED_GENRES_SLUGS.has(slug)) {
        logger.debug(`Valid genre found: "${validation.name}"`);
        genresFound.push({
          name: validation.name,
          description: validation.description,
          lastfmUrl: validation.lastfmUrl
        });
      } else {
        logger.debug(`Skipping banned genre "${validation.name}"`);
      }
    } else {
      logger.debug(`Skipping invalid tag "${tag}"`);
    }
  }
  
  logger.info(`Genre processing completed for ${artistData.name}: ${genresFound.length} genres found`);
  return genresFound;
}

/**
 * Assigns genres to an event based on participating artists
 * @param eventId - ID of the event
 * @param isFestival - Whether the event is a festival
 * @returns Promise with genre assignment result
 */
export async function assignEventGenres(eventId: number, isFestival = false): Promise<GenreAssignmentResult> {
  logger.info(`Assigning genres to event ${eventId} (festival: ${isFestival})`);
  
  try {
    // Get event's artists from event_artist table (like local script)
    const { data: eventArtists, error: eaError } = await db.client
      .from('event_artist')
      .select('artist_id')
      .eq('event_id', eventId);
    if (eaError) throw eaError;

    // Handle artist_id as array field (local DB schema stores it as int[])
    let artistIds: number[] = [];
    if (eventArtists) {
      for (const ea of eventArtists) {
        if (Array.isArray(ea.artist_id)) {
          artistIds.push(...ea.artist_id.map(Number));
        } else if (ea.artist_id) {
          artistIds.push(Number(ea.artist_id));
        }
      }
      artistIds = [...new Set(artistIds)];
    }
    
    if (artistIds.length === 0) {
      logger.warn(`No artists found for event ${eventId}`);
      return {
        genres: [],
        confidence: 0,
        source: 'festival',
        raw_genres: [],
        filtered_genres: []
      };
    }
    
    // Count genre occurrences from all artists
    const genreCounts: { [genreId: number]: number } = {};
    
    for (const artistId of artistIds) {
      const artistGenres = await db.client
        .from('artist_genre')
        .select('genre_id')
        .eq('artist_id', artistId);
        
      if (artistGenres.data) {
        artistGenres.data.forEach(ag => {
          genreCounts[ag.genre_id] = (genreCounts[ag.genre_id] || 0) + 1;
        });
      }
    }
    
    // Get banned genre IDs (using pre-computed slugified set for correct comparison)
    const allGenres = await db.getAllGenres();
    const bannedGenreIds = allGenres
      .filter(g => BANNED_GENRES_SLUGS.has(slugifyGenre(g.name)))
      .map(g => g.id!);
    
    // Determine max genres based on festival status
    const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
    const fallbackGenres = isFestival ? FESTIVAL_FALLBACK_GENRES : 3;
    
    // Get top genres meeting minimum occurrence threshold
    let topGenreIds = Object.entries(genreCounts)
      .filter(([genreId, count]) =>
        count >= MIN_GENRE_OCCURRENCE &&
        !bannedGenreIds.includes(Number(genreId))
      )
      .sort(([, a], [, b]) => b - a)
      .slice(0, maxGenres)
      .map(([genreId]) => Number(genreId));
    
    // Fallback: use top genres even without minimum threshold
    if (topGenreIds.length === 0) {
      topGenreIds = Object.entries(genreCounts)
        .filter(([genreId]) => !bannedGenreIds.includes(Number(genreId)))
        .sort(([, a], [, b]) => b - a)
        .slice(0, fallbackGenres)
        .map(([genreId]) => Number(genreId));
        
      logger.warn(`No genres met minimum threshold for event ${eventId}, using fallback genres`);
    }
    
    // Get genre names
    const genreNames = topGenreIds.map(id => {
      const genre = allGenres.find(g => g.id === id);
      return genre ? genre.name : `Unknown (ID: ${id})`;
    });
    
    // Link genres to event
    if (topGenreIds.length > 0) {
      await db.linkEventGenres(eventId, topGenreIds);
    }
    
    logger.info(`Assigned ${topGenreIds.length} genres to event ${eventId}:`, genreNames);
    
    return {
      genres: genreNames,
      confidence: topGenreIds.length > 0 ? 80 : 20,
      source: isFestival ? 'festival' : 'lastfm',
      raw_genres: Object.keys(genreCounts).map(id => 
        allGenres.find(g => g.id === Number(id))?.name || `Unknown (${id})`
      ),
      filtered_genres: genreNames
    };
    
  } catch (error) {
    logger.error('Error assigning event genres', error, { eventId, isFestival });
    return {
      genres: [],
      confidence: 0,
      source: 'default',
      raw_genres: [],
      filtered_genres: []
    };
  }
}

export default {
  refineGenreName,
  slugifyGenre,
  splitCompoundTags,
  cleanDescription,
  fetchArtistTracks,
  verifyGenreWithLastFM,
  insertGenreIfNew,
  extractTagsFromTrack,
  processArtistGenres,
  assignEventGenres
};
