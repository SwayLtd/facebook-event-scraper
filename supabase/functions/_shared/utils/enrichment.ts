// Artist enrichment utilities pour Edge Functions
// Adaptation complète du système d'enrichissement JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { delay } from './delay.ts';
import { logger } from './logger.ts';
import { withApiRetry, createMusicBrainzApiCall } from './retry.ts';
import { EnrichmentResult, MusicBrainzArtist, Artist } from '../types/index.ts';

// Email extraction
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export interface ExtractedEmail {
  address: string;
  type: 'booking' | 'management' | 'press' | 'general' | 'contact' | 'ar' | 'radio' | 'distribution' | 'touring' | 'label' | 'publisher';
}

export interface PlatformLink {
  platform: string;
  link: string;
}

export interface ExternalLinks {
  [platform: string]: { link: string } | ExtractedEmail[];
}

// Supported platforms mapping
const SUPPORTED_PLATFORMS: { [key: string]: string } = {
  // Music platforms
  'spotify': 'spotify',
  'soundcloud': 'soundcloud', 
  'youtube': 'youtube',
  'apple_music': 'apple_music',
  'deezer': 'deezer',
  'bandcamp': 'bandcamp',
  'tidal': 'tidal',
  'discogs': 'discogs',
  // Social platforms
  'instagram': 'instagram',
  'tiktok': 'tiktok',
  'facebook': 'facebook',
  'twitter': 'twitter',
  'x': 'twitter', // X is the new Twitter
  // Other
  'wikipedia': 'wikipedia',
  'website': 'website'
};

/**
 * Extract and categorize emails from text
 * @param text - Text to extract emails from
 * @returns Array of extracted and categorized emails
 */
export function extractEmails(text = ''): ExtractedEmail[] {
  if (!text) return [];
  
  const emails: ExtractedEmail[] = [];
  let match;
  
  EMAIL_REGEX.lastIndex = 0; // Reset regex state
  while ((match = EMAIL_REGEX.exec(text)) !== null) {
    const email = match[0].toLowerCase();
    const type = categorizeEmail(email, text);
    emails.push({ address: email, type });
  }
  
  return emails;
}

/**
 * Categorize email based on local part and context
 * @param email - Email address
 * @param context - Context text
 * @returns Email category
 */
function categorizeEmail(email: string, context = ''): ExtractedEmail['type'] {
  const local = email.split('@')[0].toLowerCase();
  const contextLower = context.toLowerCase();
  
  // Check local part patterns
  if (local.startsWith('booking') || local.includes('booking')) return 'booking';
  if (local.startsWith('press') || local.includes('press')) return 'press';
  if (local.startsWith('management') || local.includes('mgmt') || local.includes('manager')) return 'management';
  if (local.startsWith('contact') || local === 'info' || local === 'hello') return 'contact';
  if (local.includes('ar') || local.includes('a&r')) return 'ar';
  if (local.includes('radio')) return 'radio';
  if (local.includes('distribution') || local.includes('distro')) return 'distribution';
  if (local.includes('touring') || local.includes('tour')) return 'touring';
  if (local.includes('label')) return 'label';
  if (local.includes('publisher') || local.includes('publishing')) return 'publisher';
  
  // Check context for keywords
  if (contextLower.includes('booking') && contextLower.indexOf('booking') < contextLower.indexOf(email)) return 'booking';
  if (contextLower.includes('press') && contextLower.indexOf('press') < contextLower.indexOf(email)) return 'press';
  if (contextLower.includes('management') && contextLower.indexOf('management') < contextLower.indexOf(email)) return 'management';
  
  return 'general';
}

/**
 * Search MusicBrainz for artist by SoundCloud URL
 * @param soundCloudUrl - SoundCloud URL to search with
 * @returns MusicBrainz artist ID or null
 */
async function searchMusicBrainzBySoundCloud(soundCloudUrl: string): Promise<string | null> {
  try {
    const encodedUrl = encodeURIComponent(soundCloudUrl);
    const searchUrl = `https://musicbrainz.org/ws/2/url?query=url:"${encodedUrl}"&fmt=json&inc=artist-rels`;
    
    const apiCall = createMusicBrainzApiCall(async () => {
      return await fetch(searchUrl, {
        headers: { 'User-Agent': 'FacebookEventScrapperEdgeFunction/1.0 (contact@sway-app.com)' }
      });
    });

    const response = await apiCall();
    
    if (!response.ok) return null;
    const data = await response.json();
    
    if (data.urls && data.urls.length > 0) {
      const urlEntry = data.urls[0];
      if (urlEntry.relations) {
        const artistRelation = urlEntry.relations.find((rel: any) => 
          rel.type === 'social network' || rel.type === 'streaming music'
        );
        if (artistRelation && artistRelation.artist) {
          return artistRelation.artist.id;
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error searching MusicBrainz for ${soundCloudUrl}`, error);
    return null;
  }
}

/**
 * Search MusicBrainz for artist by name (fallback)
 * @param artistName - Artist name to search
 * @returns MusicBrainz artist ID or null
 */
async function searchMusicBrainzByName(artistName: string): Promise<string | null> {
  try {
    const encodedName = encodeURIComponent(artistName);
    const searchUrl = `https://musicbrainz.org/ws/2/artist?query=artist:"${encodedName}"&fmt=json&limit=1`;
    
    const apiCall = createMusicBrainzApiCall(async () => {
      return await fetch(searchUrl, {
        headers: { 'User-Agent': 'FacebookEventScrapperEdgeFunction/1.0 (contact@sway-app.com)' }
      });
    });

    const response = await apiCall();
    
    if (!response.ok) return null;
    const data = await response.json();
    
    if (data.artists && data.artists.length > 0) {
      return data.artists[0].id;
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error searching MusicBrainz by name for ${artistName}`, error);
    return null;
  }
}

/**
 * Fetch MusicBrainz artist external links
 * @param artistId - MusicBrainz artist ID
 * @returns Array of relation objects
 */
async function fetchMusicBrainzLinks(artistId: string): Promise<any[]> {
  try {
    const url = `https://musicbrainz.org/ws/2/artist/${artistId}?inc=url-rels&fmt=json`;
    
    const apiCall = createMusicBrainzApiCall(async () => {
      return await fetch(url, {
        headers: { 'User-Agent': 'FacebookEventScrapperEdgeFunction/1.0 (contact@sway-app.com)' }
      });
    });

    const response = await apiCall();
    
    if (!response.ok) return [];
    const data = await response.json();
    return data.relations || [];
  } catch (error) {
    logger.warn(`Error fetching MusicBrainz links for ${artistId}`, error);
    return [];
  }
}

/**
 * Normalize platform name and URL to standard format
 * @param url - URL to normalize
 * @returns Normalized platform link or null
 */
function normalizePlatformLink(url: string): PlatformLink | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace('www.', '');
    
    const platformMap: { [key: string]: string } = {
      'open.spotify.com': 'spotify',
      'soundcloud.com': 'soundcloud',
      'youtube.com': 'youtube',
      'youtu.be': 'youtube', 
      'music.apple.com': 'apple_music',
      'deezer.com': 'deezer',
      'bandcamp.com': 'bandcamp',
      'tidal.com': 'tidal',
      'instagram.com': 'instagram',
      'tiktok.com': 'tiktok',
      'facebook.com': 'facebook',
      'twitter.com': 'twitter',
      'x.com': 'twitter',
      'wikipedia.org': 'wikipedia',
      'discogs.com': 'discogs'
    };
    
    const detectedPlatform = Object.keys(platformMap).find(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
    
    if (detectedPlatform) {
      return {
        platform: platformMap[detectedPlatform],
        link: url
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Process MusicBrainz relationships into standard format
 * @param relations - MusicBrainz relations array
 * @returns Array of normalized platform links
 */
function processMusicBrainzRelations(relations: any[]): PlatformLink[] {
  const links: PlatformLink[] = [];
  
  for (const relation of relations) {
    if (relation.url && relation.url.resource) {
      const normalized = normalizePlatformLink(relation.url.resource);
      if (normalized && SUPPORTED_PLATFORMS[normalized.platform]) {
        links.push(normalized);
      }
    }
  }
  
  return links;
}

/**
 * Apply enrichment data to artist object
 * @param artist - Original artist data
 * @param platformLinks - Platform links to add
 * @param emails - Emails to add
 * @returns Updated artist with enrichment data
 */
export function applyEnrichmentToArtist(
  artist: Partial<Artist>,
  platformLinks: PlatformLink[],
  emails: ExtractedEmail[]
): Partial<Artist> {
  const enriched = { ...artist };
  
  // Initialize external_links if not exists
  if (!enriched.external_links) {
    enriched.external_links = {};
  }
  
  // Add platform links
  for (const link of platformLinks) {
    const platform = link.platform;
    if (SUPPORTED_PLATFORMS[platform] && !enriched.external_links[platform]) {
      enriched.external_links[platform] = { link: link.link };
    }
  }
  
  // Add emails
  if (emails.length > 0 && !enriched.external_links.email) {
    enriched.external_links.email = emails;
  }
  
  return enriched;
}

/**
 * Enrich artist data with MusicBrainz platforms and email extraction
 * @param artistData - Artist data to enrich
 * @param enableMusicBrainz - Whether to enable MusicBrainz enrichment
 * @param enableEmails - Whether to enable email extraction
 * @returns Enriched artist data with metadata
 */
export async function enrichArtistData(
  artistData: Partial<Artist>, 
  enableMusicBrainz = true, 
  enableEmails = true
): Promise<EnrichmentResult> {
  const timer = logger.startTimer('enrichment');
  
  try {
    logger.info(`Auto-enriching artist: "${artistData.name}"`);
    
    const allLinks: PlatformLink[] = [];
    const emails = enableEmails ? extractEmails(artistData.description) : [];
    
    let musicbrainzId: string | null = null;
    
    // MusicBrainz enrichment if artist has SoundCloud link
    if (enableMusicBrainz && artistData.external_links?.soundcloud?.link) {
      // Search MusicBrainz by SoundCloud URL
      musicbrainzId = await searchMusicBrainzBySoundCloud(artistData.external_links.soundcloud.link);
      
      // Fallback to name search
      if (!musicbrainzId && artistData.name) {
        musicbrainzId = await searchMusicBrainzByName(artistData.name);
      }
      
      if (musicbrainzId) {
        logger.info(`Found MusicBrainz artist: ${musicbrainzId}`);
        const relations = await fetchMusicBrainzLinks(musicbrainzId);
        const mbLinks = processMusicBrainzRelations(relations);
        allLinks.push(...mbLinks);
        logger.info(`Found ${mbLinks.length} platform links from MusicBrainz`);
      }
    }
    
    // Apply enrichment
    const enrichedArtist = applyEnrichmentToArtist(artistData, allLinks, emails);
    
    // Calculate enrichment score
    const originalFieldCount = Object.keys(artistData).filter(key => 
      artistData[key as keyof Artist]
    ).length;
    
    const enrichedFieldCount = Object.keys(enrichedArtist).filter(key => 
      enrichedArtist[key as keyof Artist]
    ).length;
    
    const newFieldsAdded = enrichedFieldCount - originalFieldCount;
    const score = Math.min((newFieldsAdded / 10) * 100, 100); // Max 100 for 10+ new fields
    
    const duration = timer();
    
    const result: EnrichmentResult = {
      success: true,
      score: Math.round(score),
      source: 'musicbrainz',
      data: enrichedArtist,
      metadata: {
        new_platforms: allLinks.length,
        new_emails: emails.length,
        musicbrainz_id: musicbrainzId,
        duration_ms: duration,
        total_fields_before: originalFieldCount,
        total_fields_after: enrichedFieldCount
      }
    };
    
    logger.info(`Auto-enrichment completed: +${allLinks.length} platforms, +${emails.length} emails, score: ${result.score}%`);
    
    return result;
    
  } catch (error) {
    const duration = timer();
    logger.error(`Auto-enrichment failed for "${artistData.name}"`, error);
    
    return {
      success: false,
      score: 0,
      source: 'musicbrainz',
      data: artistData,
      errors: [error instanceof Error ? error.message : String(error)],
      metadata: {
        duration_ms: duration
      }
    };
  }
}

export default {
  extractEmails,
  applyEnrichmentToArtist,
  enrichArtistData
};
