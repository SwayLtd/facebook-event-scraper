/**
 * models/artist.ts
 * 
 * Artist model with enrichment from SoundCloud, OpenAI, and other sources
 * Ported from original Node.js models/artist.js to Deno/TypeScript
 * 
 * COMPLETE IMPLEMENTATION matching local script functionality
 */

// Edge Functions runtime globals
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

// Regex patterns for email extraction
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// Supported social media platforms
const SUPPORTED_PLATFORMS: Record<string, string> = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    twitter: 'Twitter',
    x: 'Twitter',
    spotify: 'Spotify',
    youtube: 'YouTube',
    soundcloud: 'SoundCloud'
};

/**
 * Simple database retry wrapper
 */
async function withDatabaseRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error as Error;
            if (i < maxRetries - 1) {
                console.log(`Database operation failed, retrying... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // exponential backoff
            }
        }
    }
    
    throw lastError || new Error('Database operation failed after retries');
}

/**
 * Genre utility functions
 */

/**
 * Refines a genre name for better display
 */
function refineGenreName(name: string): string {
    let refined = name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(Techno)/i, '$1 Techno');
    }
    return refined;
}

/**
 * Splits a compound tag containing known delimiters into sub-tags
 */
function splitCompoundTags(tag: string): string[] {
    const delimiters = [" x ", " & ", " + "];
    for (const delim of delimiters) {
        if (tag.includes(delim)) {
            return tag.split(delim).map(t => t.trim());
        }
    }
    return [tag];
}

/**
 * Removes all non-alphanumeric characters to get a condensed version
 */
function slugifyGenre(name: string): string {
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * Cleans description by removing HTML tags and fixing links
 */
function cleanGenreDescription(rawSummary: string): string {
    if (!rawSummary) return "";
    
    return rawSummary
        .replace(/<a href="[^"]*"[^>]*>([^<]+)<\/a>/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Checks via Last.fm if the tag corresponds to a musical genre
 */
async function verifyGenreWithLastFM(tagName: string): Promise<{
    valid: boolean;
    name?: string;
    description?: string;
    lastfmUrl?: string;
}> {
    const lastfmApiKey = Deno.env.get('LASTFM_API_KEY');
    if (!lastfmApiKey) {
        console.warn('Last.fm API key not found');
        return { valid: false };
    }

    if (tagName.length === 1) {
        return { valid: false };
    }

    try {
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodeURIComponent(tagName)}&api_key=${lastfmApiKey}&format=json`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!data?.tag) return { valid: false };

        const rawSummary = data.tag.wiki?.summary || "";
        const description = cleanGenreDescription(rawSummary);
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
        console.error(`Error verifying genre with Last.fm for tag "${tagName}":`, error);
        return { valid: false };
    }
}

/**
 * Inserts a genre into the "genres" table if it does not already exist
 */
async function insertGenreIfNew(supabase: any, genreObject: {
    name: string;
    description: string;
    lastfmUrl?: string;
}): Promise<number> {
    const { name, description, lastfmUrl } = genreObject;
    const normalizedName = name.toLowerCase();
    const genreSlug = slugifyGenre(normalizedName);

    try {
        // Check if genre already exists
        let { data: existingGenres, error: selectError } = await supabase
            .from('genres')
            .select('id, name, external_links');
        
        if (selectError) {
            console.error("Error selecting genres:", selectError);
            throw selectError;
        }

        let duplicateGenre: any = null;
        if (lastfmUrl && existingGenres) {
            duplicateGenre = existingGenres.find((g: any) => g.external_links &&
                g.external_links.lastfm &&
                g.external_links.lastfm.link === lastfmUrl);
        }
        if (!duplicateGenre && existingGenres) {
            duplicateGenre = existingGenres.find((g: any) => slugifyGenre(g.name) === genreSlug);
        }
        
        if (duplicateGenre) {
            console.log(`Genre "${name}" already exists with ID ${duplicateGenre.id}`);
            return duplicateGenre.id;
        }

        // Insert new genre
        let externalLinks: any = null;
        if (lastfmUrl) {
            externalLinks = { lastfm: { link: lastfmUrl } };
        }
        
        const finalName = refineGenreName(name);
        const { data: newGenre, error: insertError } = await supabase
            .from('genres')
            .insert({ 
                name: finalName, 
                description, 
                external_links: externalLinks 
            })
            .select();
            
        if (insertError || !newGenre) {
            console.error("Error inserting genre:", insertError);
            throw insertError || new Error("Genre insertion failed");
        }
        
        console.log(`Genre inserted: ${finalName} (id=${newGenre[0].id})`);
        return newGenre[0].id;
        
    } catch (error) {
        console.error(`Error inserting genre "${name}":`, error);
        throw error;
    }
}

/**
 * Links an artist to a genre in the "artist_genre" pivot table
 */
async function linkArtistGenre(supabase: any, artistId: number, genreId: number): Promise<void> {
    try {
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
            console.log(`Linked artist (id=${artistId}) to genre (id=${genreId})`);
        } else {
            console.log(`Artist (id=${artistId}) already linked to genre (id=${genreId})`);
        }
    } catch (error) {
        console.error(`Error linking artist ${artistId} to genre ${genreId}:`, error);
        throw error;
    }
}

/**
 * Gets banned genre IDs from the database
 */
async function getBannedGenreIds(supabase: any): Promise<number[]> {
    try {
        const { data: bannedGenres, error } = await supabase
            .from('genres')
            .select('id')
            .eq('banned', true);
            
        if (error) {
            console.error("Error fetching banned genres:", error);
            return [];
        }
        
        return bannedGenres ? bannedGenres.map((g: any) => g.id) : [];
    } catch (error) {
        console.error("Error getting banned genre IDs:", error);
        return [];
    }
}

/**
 * Processes an artist's genres by fetching their tracks and validating tags
 */
async function processArtistGenres(supabase: any, artistId: number, artistName: string, tags: string[] = [], isFestival: boolean = false): Promise<void> {
    if (tags.length === 0) {
        console.log(`No tags provided for artist ${artistName}`);
        return;
    }

    console.log(`Processing genres for artist ${artistName} with ${tags.length} tags`);
    
    try {
        // Get banned genres
        const bannedGenreIds = await getBannedGenreIds(supabase);
        
        // Split compound tags and filter
        let allTags: string[] = [];
        for (const tag of tags) {
            const splitted = splitCompoundTags(tag);
            allTags = allTags.concat(splitted.filter(t => /[a-zA-Z]/.test(t)));
        }
        
        allTags = Array.from(new Set(allTags.map(t => t.toLowerCase().trim())));
        console.log(`Processing ${allTags.length} unique tags for ${artistName}`);

        // Handle special aliases (like DnB)
        const aliasTagIds: { [key: string]: number } = {
            'dnb': 437,
            'drumnbass': 437,
            "drum'n'bass": 437,
            'drumandbass': 437,
        };

        const genresFound: Array<{id?: number; name?: string; description?: string; lastfmUrl?: string}> = [];

        // Process each tag
        for (const rawTag of allTags) {
            const tag = rawTag.toLowerCase().trim();

            // Check for aliases first
            if (aliasTagIds[tag]) {
                const id = aliasTagIds[tag];
                console.log(`Alias DnB detected ("${tag}") → forcing genre_id ${id}`);
                if (!genresFound.some(g => g.id === id)) {
                    genresFound.push({ id });
                }
                continue;
            }

            // Verify with Last.fm
            console.log(`Verifying "${tag}" via Last.fm…`);
            const verification = await verifyGenreWithLastFM(tag);
            
            if (verification.valid && verification.description) {
                const slug = slugifyGenre(verification.name!);
                
                // Check if it's not banned by slug comparison
                const { data: existingGenres } = await supabase
                    .from('genres')
                    .select('id, name')
                    .eq('banned', true);
                    
                const isBannedBySlug = existingGenres?.some((g: any) => 
                    slugifyGenre(g.name) === slug
                ) || false;
                
                if (!isBannedBySlug) {
                    console.log(`Valid genre found: "${verification.name}"`);
                    genresFound.push({
                        name: verification.name!,
                        description: verification.description,
                        lastfmUrl: verification.lastfmUrl
                    });
                } else {
                    console.log(`Skipping banned genre "${verification.name}"`);
                }
            } else {
                console.log(`Skipping invalid or too-short tag "${tag}"`);
            }
        }

        // Insert genres and link to artist
        for (const genreData of genresFound) {
            try {
                let genreId: number;
                
                if (genreData.id) {
                    // Use existing ID for aliases
                    genreId = genreData.id;
                } else {
                    // Insert new genre
                    genreId = await insertGenreIfNew(supabase, {
                        name: genreData.name!,
                        description: genreData.description!,
                        lastfmUrl: genreData.lastfmUrl
                    });
                }
                
                // Link artist to genre
                await linkArtistGenre(supabase, artistId, genreId);
                
            } catch (error) {
                console.error(`Error processing genre for ${artistName}:`, error);
                // Continue with other genres
            }
        }

        console.log(`Completed genre processing for ${artistName}: ${genresFound.length} genres processed`);
        
    } catch (error) {
        console.error(`Error processing genres for artist ${artistName}:`, error);
    }
}

/**
 * Simple retry wrappers
 */
async function withSoundCloudRetry<T>(operation: () => Promise<T>): Promise<T> {
    return await operation();
}

async function withOpenAIRetry<T>(operation: () => Promise<T>): Promise<T> {
    return await operation();
}

async function clearArtistGenres(supabase: any, artistId: number): Promise<void> {
    try {
        const { error } = await supabase
            .from('artist_genre')
            .delete()
            .eq('artist_id', artistId);
            
        if (error) {
            console.error(`Error clearing genres for artist ${artistId}:`, error);
            throw error;
        }
        
        console.log(`Cleared all genres for artist ${artistId}`);
    } catch (error) {
        console.error(`Failed to clear genres for artist ${artistId}:`, error);
        throw error;
    }
}

// String similarity function (simple implementation)
function compareTwoStrings(a: string, b: string): number {
    const normalize = (str: string) => str.toLowerCase().trim();
    const normA = normalize(a);
    const normB = normalize(b);
    
    if (normA === normB) return 1;
    if (normA.length < 2 || normB.length < 2) return 0;
    
    const bigrams1 = getBigrams(normA);
    const bigrams2 = getBigrams(normB);
    const intersection = bigrams1.filter(x => bigrams2.includes(x));
    
    return (2.0 * intersection.length) / (bigrams1.length + bigrams2.length);
}

function getBigrams(str: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
        bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
}

// SoundCloud API functions
async function getAccessToken(): Promise<string | null> {
    const clientId = Deno.env.get('SOUNDCLOUD_CLIENT_ID');
    const clientSecret = Deno.env.get('SOUNDCLOUD_CLIENT_SECRET');
    
    if (!clientId || !clientSecret) {
        console.log('ℹ️ SoundCloud credentials not found, skipping SoundCloud enrichment');
        return null;
    }

    try {
        const response = await fetch(`https://api.soundcloud.com/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Token request failed: ${response.status}`);
        }
        
        const data = await response.json();
        return data.access_token || null;
    } catch (error) {
        console.error('Error getting SoundCloud access token:', error);
        return null;
    }
}

async function searchArtist(artistName: string, token: string): Promise<any> {
    if (!artistName || !token) return null;
    
    const normName = normalizeNameEnhanced(artistName);
    const encodedName = encodeURIComponent(artistName);
    
    try {
        const response = await fetch(`https://api.soundcloud.com/users?q=${encodedName}&limit=10&client_id=${Deno.env.get('SOUNDCLOUD_CLIENT_ID')}`, {
            headers: {
                'Authorization': `OAuth ${token}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Search request failed: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data || data.length === 0) {
            console.log(`No SoundCloud artist found for: ${artistName}`);
            return null;
        }
        
        // Composite scoring to find best match
        let bestMatch = null;
        let bestScore = 0;
        const maxFollowers = Math.max(...data.map((u: any) => u.followers_count || 0), 1);
        
        data.forEach((user: any, idx: number) => {
            const userNorm = normalizeNameEnhanced(user.username);
            const nameScore = compareTwoStrings(normName.toLowerCase(), userNorm.toLowerCase());
            const followers = user.followers_count || 0;
            const followersScore = Math.log10(followers + 1) / Math.log10(maxFollowers + 1);
            const positionScore = 1 - (idx / data.length);
            const score = (nameScore * 0.6) + (followersScore * 0.3) + (positionScore * 0.1);
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = user;
            }
        });
        
        if (bestMatch && bestScore > 0.6) {
            return bestMatch;
        } else {
            console.log(`No sufficient SoundCloud match found for "${artistName}" (best score: ${bestScore.toFixed(3)})`);
            return null;
        }
    } catch (error) {
        console.error("Error searching for artist on SoundCloud:", error);
        return null;
    }
}

async function extractArtistInfo(artist: any): Promise<any> {
    const bestImageUrl = await getBestImageUrl(artist.avatar_url);
    
    let artistData = {
        name: artist.username,
        image_url: bestImageUrl,
        description: artist.description,
        location_info: artist.city ? { city: artist.city, country: artist.country } : null,
        follower_count: artist.followers_count || 0,
        external_links: {
            soundcloud: {
                id: artist.id?.toString(),
                link: artist.permalink_url,
                follower_count: artist.followers_count || 0
            }
        }
    };

    // Clean description from emails and URLs
    if (artistData.description) {
        artistData.description = artistData.description
            .replace(EMAIL_REGEX, '')
            .replace(/https?:\/\/[^\s]+/g, '')
            .replace(/\n\s*\n/g, '\n')
            .trim();
            
        if (!artistData.description) {
            artistData.description = null;
        }
    }

    return artistData;
}

async function getBestImageUrl(avatarUrl: string | null): Promise<string | null> {
    if (!avatarUrl) return null;
    
    // Try to get higher quality version
    const highQualityUrl = avatarUrl.replace('-large.jpg', '-t500x500.jpg');
    
    try {
        const response = await fetch(highQualityUrl, { method: 'HEAD' });
        if (response.ok) {
            return highQualityUrl;
        }
    } catch (error) {
        console.log('High quality image not available, using original');
    }
    
    return avatarUrl;
}

function normalizeExternalLinks(externalLinks: any): any {
    if (!externalLinks) return null;
    
    const normalized: any = {};
    const supportedPlatformKeys = Object.keys(SUPPORTED_PLATFORMS);
    
    for (const platform of Object.keys(externalLinks)) {
        if (supportedPlatformKeys.includes(platform)) {
            const link = externalLinks[platform];
            if (link && typeof link === 'object' && link.link) {
                normalized[platform] = link;
            }
        }
    }
    
    return Object.keys(normalized).length > 0 ? normalized : null;
}

// Enhanced name normalization 
function normalizeNameEnhanced(name: string): string {
    if (!name) return '';
    
    return name
        .trim()
        .toLowerCase()
        .replace(/[^\w\s&-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

import { normalizeArtistName, areNamesSimilar } from '../utils/name.ts';


/**
 * Artist interface
 */
export interface Artist {
    id?: number;
    name: string;
    normalized_name?: string;
    description?: string;
    soundcloud_url?: string;
    soundcloud_id?: string;
    instagram_url?: string;
    facebook_url?: string;
    twitter_url?: string;
    spotify_url?: string;
    website_url?: string;
    booking_email?: string;
    contact_email?: string;
    image_url?: string;
    follower_count?: number;
    verified?: boolean;
    created_at?: string;
    updated_at?: string;
}

/**
 * Contact information
 */
export interface ContactInfo {
    address: string;
    type: 'booking' | 'press' | 'management' | 'contact' | 'general';
}

/**
 * Social media link
 */
export interface SocialLink {
    platform: string;
    url: string;
    username?: string;
    verified?: boolean;
}

/**
 * SoundCloud track data
 */
interface SoundCloudTrack {
    id: number;
    title: string;
    tag_list?: string;
    description?: string;
    genre?: string;
    user?: {
        id: number;
        username: string;
        description?: string;
        followers_count?: number;
        avatar_url?: string;
    };
}

/**
 * Create or update artist with enrichment
 */
export async function createOrUpdateArtist(
    supabase: any,
    artistName: string,
    isFestival: boolean = false
): Promise<Artist | null> {
    if (!artistName || artistName.trim().length === 0) {
        console.warn('Artist name is required');
        return null;
    }

    const normalizedName = normalizeArtistName(artistName);

    try {
        // Check if artist already exists
        let existingArtist = await findArtistByName(supabase, normalizedName, artistName);
        
        if (existingArtist && !shouldEnrichArtist(existingArtist)) {
            console.log(`Artist "${artistName}" already exists and is sufficiently enriched (ID: ${existingArtist.id})`);
            return existingArtist;
        }

        // Create new artist or enrich existing one
        const artist = existingArtist || await createBasicArtist(supabase, artistName, normalizedName);
        
        if (!artist) {
            console.error(`Failed to create artist: ${artistName}`);
            return null;
        }

        // Enrich artist data
        const enrichedArtist = await enrichArtistData(supabase, artist, isFestival);
        return enrichedArtist;
        
    } catch (error) {
        console.error(`Error creating/updating artist "${artistName}":`, error);
        return null;
    }
}

/**
 * Find artist by name with fuzzy matching
 */
async function findArtistByName(supabase: any, normalizedName: string, originalName: string): Promise<Artist | null> {
    try {
        // First try exact match on normalized name
        const { data: exactMatch } = await supabase
            .from('artists')
            .select('*')
            .eq('normalized_name', normalizedName)
            .single();

        if (exactMatch) {
            return exactMatch;
        }

        // Try fuzzy matching on both name and normalized_name
        const { data: allArtists } = await supabase
            .from('artists')
            .select('*')
            .or(`name.ilike.%${originalName}%,normalized_name.ilike.%${normalizedName}%`);

        if (allArtists && allArtists.length > 0) {
            // Find best match using similarity
            for (const artist of allArtists) {
                if (areNamesSimilar(artist.name, originalName) || 
                    areNamesSimilar(artist.normalized_name, normalizedName)) {
                    return artist;
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`Error finding artist "${originalName}":`, error);
        return null;
    }
}

/**
 * Create basic artist record
 */
async function createBasicArtist(supabase: any, artistName: string, normalizedName: string): Promise<Artist | null> {
    try {
        const { data, error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('artists')
                .insert([{
                    name: artistName,
                    normalized_name: normalizedName
                }])
                .select()
                .single();
        });

        if (error) {
            throw error;
        }

        console.log(`Created basic artist record: "${artistName}" (ID: ${data.id})`);
        return data;
        
    } catch (error) {
        console.error(`Error creating basic artist "${artistName}":`, error);
        return null;
    }
}

/**
 * Check if artist needs enrichment
 */
function shouldEnrichArtist(artist: Artist): boolean {
    // Artist needs enrichment if missing key data
    return !artist.soundcloud_url || 
           !artist.description || 
           !artist.image_url;
}

/**
 * Enrich artist data from multiple sources
 */
async function enrichArtistData(supabase: any, artist: Artist, isFestival: boolean): Promise<Artist | null> {
    console.log(`Enriching artist: ${artist.name}`);
    
    const enrichmentData: Partial<Artist> = {};
    let soundcloudTags: string[] = [];

    try {
        // 1. SoundCloud enrichment
        const soundcloudData = await enrichFromSoundCloud(artist.name);
        if (soundcloudData) {
            Object.assign(enrichmentData, soundcloudData.artistData);
            soundcloudTags = soundcloudData.tags;
        }

        // 2. OpenAI description enrichment
        if (!artist.description && !enrichmentData.description) {
            const aiDescription = await generateAIDescription(artist.name);
            if (aiDescription) {
                enrichmentData.description = aiDescription;
            }
        }

        // 3. Update artist record with enriched data
        if (Object.keys(enrichmentData).length > 0) {
            const { data: updatedArtist, error } = await withDatabaseRetry(async () => {
                return await supabase
                    .from('artists')
                    .update({
                        ...enrichmentData,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', artist.id)
                    .select()
                    .single();
            });

            if (error) {
                throw error;
            }

            Object.assign(artist, updatedArtist);
            console.log(`Updated artist enrichment data for: ${artist.name}`);
        }

        // 4. Process genres from tags
        await processArtistGenres(supabase, artist.id!, artist.name, soundcloudTags, isFestival);

        return artist;
        
    } catch (error) {
        console.error(`Error enriching artist "${artist.name}":`, error);
        return artist; // Return artist even if enrichment fails
    }
}

/**
 * Enrich artist data from SoundCloud
 */
async function enrichFromSoundCloud(artistName: string): Promise<{
    artistData: Partial<Artist>;
    tags: string[];
} | null> {
    const soundcloudClientId = Deno.env.get('SOUND_CLOUD_CLIENT_ID');
    if (!soundcloudClientId) {
        console.warn('SoundCloud client ID not found');
        return null;
    }

    try {
        console.log(`Searching SoundCloud for: ${artistName}`);
        
        // Search for artist on SoundCloud
        const searchResponse = await withSoundCloudRetry(async () => {
            const searchUrl = `https://api.soundcloud.com/users?q=${encodeURIComponent(artistName)}&client_id=${soundcloudClientId}`;
            return await fetch(searchUrl);
        });

        const searchResults = await searchResponse.json();
        
        if (!Array.isArray(searchResults) || searchResults.length === 0) {
            console.log(`No SoundCloud results for: ${artistName}`);
            return null;
        }

        // Find best matching user
        const bestMatch = findBestSoundCloudMatch(artistName, searchResults);
        if (!bestMatch) {
            console.log(`No good SoundCloud match for: ${artistName}`);
            return null;
        }

        // Get artist tracks for tags
        const tracks = await fetchSoundCloudTracks(bestMatch.id.toString(), soundcloudClientId);
        const tags = extractTagsFromTracks(tracks);

        // Build artist data
        const artistData: Partial<Artist> = {
            soundcloud_url: bestMatch.permalink_url,
            soundcloud_id: bestMatch.id.toString(),
            follower_count: bestMatch.followers_count || 0,
            image_url: bestMatch.avatar_url
        };

        if (bestMatch.description) {
            artistData.description = cleanDescription(bestMatch.description);
        }

        // Extract social links and emails from description
        if (bestMatch.description) {
            const socialLinks = extractSocialLinks(bestMatch.description);
            const emails = extractEmails(bestMatch.description);
            
            // Add social links to artist data
            for (const link of socialLinks) {
                switch (link.platform) {
                    case 'instagram':
                        artistData.instagram_url = link.url;
                        break;
                    case 'facebook':
                        artistData.facebook_url = link.url;
                        break;
                    case 'twitter':
                        artistData.twitter_url = link.url;
                        break;
                    case 'spotify':
                        artistData.spotify_url = link.url;
                        break;
                }
            }
            
            // Add contact emails
            const bookingEmail = emails.find(e => e.type === 'booking');
            if (bookingEmail) {
                artistData.booking_email = bookingEmail.address;
            }
            
            const contactEmail = emails.find(e => e.type === 'contact');
            if (contactEmail) {
                artistData.contact_email = contactEmail.address;
            }
        }

        console.log(`SoundCloud enrichment successful for: ${artistName}`);
        return { artistData, tags };
        
    } catch (error) {
        console.error(`Error enriching from SoundCloud for "${artistName}":`, error);
        return null;
    }
}

/**
 * Find best matching SoundCloud user
 */
function findBestSoundCloudMatch(artistName: string, users: any[]): any | null {
    const normalizedSearch = normalizeArtistName(artistName);
    let bestMatch = null;
    let bestScore = 0;

    for (const user of users) {
        if (!user.username) continue;
        
        const normalizedUsername = normalizeArtistName(user.username);
        
        // Simple scoring based on name similarity and follower count
        const nameScore = areNamesSimilar(normalizedSearch, normalizedUsername) ? 1 : 0;
        const followerScore = Math.min(1, (user.followers_count || 0) / 1000);
        const totalScore = nameScore * 0.8 + followerScore * 0.2;
        
        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMatch = user;
        }
    }

    return bestScore > 0.5 ? bestMatch : null;
}

/**
 * Fetch SoundCloud tracks for an artist
 */
async function fetchSoundCloudTracks(userId: string, clientId: string): Promise<SoundCloudTrack[]> {
    try {
        const response = await withSoundCloudRetry(async () => {
            const url = `https://api.soundcloud.com/users/${userId}/tracks?limit=10&client_id=${clientId}`;
            return await fetch(url);
        });

        const tracks = await response.json();
        
        if (!Array.isArray(tracks)) {
            console.error('Expected tracks to be an array but got:', typeof tracks);
            return [];
        }

        return tracks;
    } catch (error) {
        console.error(`Error fetching SoundCloud tracks for user ${userId}:`, error);
        return [];
    }
}

/**
 * Extract tags from SoundCloud tracks
 */
function extractTagsFromTracks(tracks: SoundCloudTrack[]): string[] {
    const tags = new Set<string>();

    for (const track of tracks) {
        // Extract from tag_list
        if (track.tag_list) {
            const trackTags = track.tag_list
                .split(/[,\s]+/)
                .map(tag => tag.replace(/"/g, '').trim())
                .filter(tag => tag.length > 0);
                
            trackTags.forEach(tag => tags.add(tag));
        }

        // Extract from genre
        if (track.genre && track.genre.trim().length > 0) {
            tags.add(track.genre.trim());
        }
    }

    return Array.from(tags);
}

/**
 * Generate AI description for artist
 */
async function generateAIDescription(artistName: string): Promise<string | null> {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
        console.warn('OpenAI API key not found');
        return null;
    }

    try {
        const prompt = `Write a brief, professional description (2-3 sentences) for the electronic music artist "${artistName}". Focus on their musical style and significance in the electronic music scene. Do not include biographical details unless widely known.`;

        const response = await withOpenAIRetry(async () => {
            return await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 150,
                    temperature: 0.7,
                }),
            });
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]?.message?.content) {
            const description = data.choices[0].message.content.trim();
            console.log(`Generated AI description for ${artistName}: ${description.substring(0, 100)}...`);
            return description;
        }

        return null;
    } catch (error) {
        console.error(`Error generating AI description for "${artistName}":`, error);
        return null;
    }
}

/**
 * Extract social media links from text
 */
function extractSocialLinks(text: string): SocialLink[] {
    const links: SocialLink[] = [];
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = text.match(urlRegex) || [];

    for (const url of matches) {
        const platform = detectSocialPlatform(url);
        if (platform && SUPPORTED_PLATFORMS[platform]) {
            links.push({
                platform: SUPPORTED_PLATFORMS[platform],
                url: url.replace(/[.,;]$/, ''), // Remove trailing punctuation
                username: extractUsernameFromUrl(url, platform)
            });
        }
    }

    return links;
}

/**
 * Detect social media platform from URL
 */
function detectSocialPlatform(url: string): string | null {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes('instagram.com')) return 'instagram';
    if (lowerUrl.includes('facebook.com')) return 'facebook';
    if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter';
    if (lowerUrl.includes('spotify.com')) return 'spotify';
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
    if (lowerUrl.includes('soundcloud.com')) return 'soundcloud';
    
    return null;
}

/**
 * Extract username from social media URL
 */
function extractUsernameFromUrl(url: string, platform: string): string | undefined {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
        
        if (pathParts.length > 0) {
            return pathParts[0];
        }
    } catch {
        // Invalid URL
    }
    
    return undefined;
}

/**
 * Extract emails from text with categorization
 */
function extractEmails(text: string): ContactInfo[] {
    const emails: ContactInfo[] = [];
    let match;
    
    while ((match = EMAIL_REGEX.exec(text)) !== null) {
        const address = match[0].toLowerCase();
        const type = categorizeEmail(address, text);
        emails.push({ address, type });
    }
    
    return emails;
}

/**
 * Categorize email based on local part and context
 */
function categorizeEmail(email: string, context: string): ContactInfo['type'] {
    const local = email.split('@')[0].toLowerCase();
    const contextLower = context.toLowerCase();
    
    // Check local part patterns
    if (local.includes('booking')) return 'booking';
    if (local.includes('press')) return 'press';
    if (local.includes('management') || local.includes('mgmt') || local.includes('manager')) return 'management';
    if (local === 'contact' || local === 'info' || local === 'hello') return 'contact';
    
    // Check context for keywords
    if (contextLower.includes('booking') && contextLower.indexOf('booking') < contextLower.indexOf(email)) return 'booking';
    if (contextLower.includes('press') && contextLower.indexOf('press') < contextLower.indexOf(email)) return 'press';
    if (contextLower.includes('management') && contextLower.indexOf('management') < contextLower.indexOf(email)) return 'management';
    
    return 'general';
}

/**
 * Clean description text
 */
function cleanDescription(desc: string): string {
    if (!desc) return '';
    
    // Remove excessive whitespace and line breaks
    let cleaned = desc.replace(/\s+/g, ' ').trim();
    
    // Remove common prefixes/suffixes
    cleaned = cleaned.replace(/^(artist|musician|producer|dj)\s*[-:]?\s*/i, '');
    
    // Limit length
    if (cleaned.length > 500) {
        cleaned = cleaned.substring(0, 497) + '...';
    }
    
    return cleaned;
}

/**
 * Re-enrich artist (clear existing data and re-process)
 */
export async function reEnrichArtist(supabase: any, artistId: number, isFestival: boolean = false): Promise<boolean> {
    try {
        // Get artist
        const { data: artist, error } = await supabase
            .from('artists')
            .select('*')
            .eq('id', artistId)
            .single();
            
        if (error || !artist) {
            throw error || new Error('Artist not found');
        }

        // Clear existing genres
        await clearArtistGenres(supabase, artistId);

        // Re-enrich
        const enrichedArtist = await enrichArtistData(supabase, artist, isFestival);
        
        console.log(`Re-enriched artist: ${artist.name}`);
        return !!enrichedArtist;
        
    } catch (error) {
        console.error(`Error re-enriching artist ${artistId}:`, error);
        return false;
    }
}

/**
 * Processes simple event artists using OpenAI parsing from description
 * Matches import_event.js functionality exactly
 */
export async function processSimpleEventArtists(
    supabase: any,
    eventId: number,
    eventDescription: string,
    dryRun: boolean = false
): Promise<number[]> {
    console.log("\n💬 Processing simple event - calling OpenAI to parse artists from description...");
    let parsedArtists: any[] = [];
    
    if (eventDescription) {
        try {
            // Extract artists using OpenAI (exactly like local script)
            parsedArtists = await extractArtistsWithOpenAI(eventDescription);
            console.log(`✅ OpenAI extracted ${parsedArtists.length} artists:`, parsedArtists.map(a => a.name));
        } catch (error) {
            console.error("❌ OpenAI artist extraction failed:", error);
            // Fallback to simple extraction if OpenAI fails
            parsedArtists = extractArtistsFromDescription(eventDescription).map(name => ({ name }));
        }
    } else {
        console.log("⚠️ No event description provided for parsing");
        parsedArtists = [];
    }

    // Import artists and create relations
    const processedArtistIds: number[] = [];
    if (!dryRun && eventId && parsedArtists.length > 0) {
        for (const artistObj of parsedArtists) {
            try {
                const artistId = await findOrInsertArtist(supabase, artistObj);
                if (artistId) {
                    // Create event_artist relation using database utils
                    await createEventArtistRelation(supabase, eventId, artistId, artistObj);
                    processedArtistIds.push(artistId);
                }
            } catch (error) {
                console.error(`❌ Error processing artist "${artistObj.name}":`, error);
            }
        }
        console.log(`✅ Simple event import complete: ${processedArtistIds.length} artists processed`);
    } else if (dryRun) {
        console.log(`🏃 DRY RUN: Would process ${parsedArtists.length} artists: ${parsedArtists.map(a => a.name).join(', ')}`);
    } else {
        console.log("ℹ️ No artists to process");
    }
    
    return processedArtistIds;
}

/**
 * Extract artists using OpenAI (replicated from local script)
 */
async function extractArtistsWithOpenAI(eventDescription: string): Promise<any[]> {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
        throw new Error('OpenAI API key not found');
    }

    const prompt = `
Extract ONLY the artist/DJ names from this event description. Return a JSON array of objects with "name" property.

Rules:
- Only include performer names, not venues, organizers, or presenters
- Use artist stage names, not real names  
- Remove common words like "presents", "vs", "b2b"
- Split collaborations (e.g., "Artist A b2b Artist B" → ["Artist A", "Artist B"])
- Maximum 50 artists
- If no clear artists found, return empty array

Event description:
${eventDescription}

Return format: [{"name": "Artist 1"}, {"name": "Artist 2"}, ...]
Only return valid JSON, no additional text.`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();
        
        if (!content) {
            throw new Error('No content in OpenAI response');
        }

        // Parse the JSON response
        const parsedArtists = JSON.parse(content);
        
        if (!Array.isArray(parsedArtists)) {
            throw new Error('OpenAI response is not an array');
        }

        // Validate and clean the results
        return parsedArtists
            .filter(artist => artist && artist.name && typeof artist.name === 'string')
            .filter(artist => artist.name.trim().length > 1 && artist.name.trim().length < 100)
            .slice(0, 50); // Limit to 50 artists max
            
    } catch (error) {
        console.error('OpenAI extraction error:', error);
        throw error;
    }
}

/**
 * Simple artist name extraction from event description (fallback)
 */
function extractArtistsFromDescription(description: string): string[] {
    if (!description) return [];
    
    const artists: string[] = [];
    const text = description.toLowerCase();
    
    // Common patterns for artists in event descriptions
    const patterns = [
        /(?:featuring|ft\.?|with|lineup[:\s]+)(.*?)(?:\n|$|presented|tickets)/gi,
        /(?:artists?|djs?|performers?)[:\s]+(.*?)(?:\n|$|presented|tickets)/gi,
        /(?:headliners?)[:\s]+(.*?)(?:\n|$|presented|tickets)/gi
    ];
    
    patterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            matches.forEach(match => {
                // Extract artist names from the matched text
                const artistsText = match.replace(/^(?:featuring|ft\.?|with|lineup[:\s]+|artists?[:\s]+|djs?[:\s]+|performers?[:\s]+|headliners?[:\s]+)/i, '').trim();
                
                // Split by common separators
                const splitArtists = artistsText
                    .split(/[,&+\|\n]|(?:\s+(?:vs|b2b|and|with)\s+)/i)
                    .map(name => name.trim())
                    .filter(name => 
                        name.length > 1 && 
                        name.length < 50 &&
                        !name.match(/^(?:presents?|tickets?|doors?|info|more|www\.|http)/i)
                    );
                    
                artists.push(...splitArtists);
            });
        }
    });
    
    // Remove duplicates and clean up
    const uniqueArtists = Array.from(new Set(artists))
        .map(name => name.trim())
        .filter(name => name.length > 1)
        .slice(0, 20); // Limit to first 20 artists
        
    return uniqueArtists;
}

/**
 * Find or insert artist (matches local script logic)
 */
export async function findOrInsertArtist(supabase: any, artistObj: any): Promise<number | null> {
    const originalArtistName = (artistObj.name || '').trim();
    if (!originalArtistName) return null;

    // 1. Name normalization for search purposes only
    const normalizedSearchName = normalizeNameEnhanced(originalArtistName);

    // 2. Search on SoundCloud using normalized name
    const token = await getAccessToken();
    let scArtist = null;
    if (token) {
        scArtist = await searchArtist(normalizedSearchName, token);
    }

    // 3. Construction of the artistData object and get tracks for tags
    let artistData: any;
    let soundcloudTags: string[] = [];
    
    if (scArtist) {
        // When SoundCloud data is found, use the original SoundCloud username (preserves casing)
        artistData = await extractArtistInfo(scArtist);
        
        // Récupérer les tags des tracks SoundCloud pour l'enrichissement des genres
        if ((scArtist as any).id) {
            const soundcloudClientId = Deno.env.get('SOUND_CLOUD_CLIENT_ID');
            if (soundcloudClientId) {
                const tracks = await fetchSoundCloudTracks(((scArtist as any).id).toString(), soundcloudClientId);
                soundcloudTags = extractTagsFromTracks(tracks);
            }
        }
    } else {
        // When no SoundCloud data, use the ORIGINAL name (not normalized)
        artistData = {
            name: originalArtistName,  // Use original name to preserve casing!
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
            console.log(`➡️ Artist exists by SoundCloud ID: "${artistData.name}" (id=${existingByExternal[0].id})`);
            return existingByExternal[0].id;
        }
    }

    // 5. Duplicate detection via name (use normalized name for search)
    const { data: existingByName, error: nameError } = await supabase
        .from('artists')
        .select('id')
        .ilike('name', normalizedSearchName);
    if (nameError) throw nameError;
    if (existingByName.length > 0) {
        console.log(`➡️ Artist exists by name: "${artistData.name}" (id=${existingByName[0].id})`);
        return existingByName[0].id;
    }

    // 6. Insertion of the new artist
    const { data: inserted, error: insertError } = await supabase
        .from('artists')
        .insert(artistData)
        .select();
    if (insertError || !inserted) throw insertError || new Error("Could not insert artist");
    const newArtistId = inserted[0].id;
    console.log(`✅ Artist inserted: "${artistData.name}" (id=${newArtistId})`);

    // 7. Processing and linking genres
    try {
        const lastfmApiKey = Deno.env.get('LASTFM_API_KEY');
        if (lastfmApiKey) {
            await processArtistGenres(supabase, newArtistId, artistData.name, soundcloudTags, false);
        } else {
            console.log('ℹ️ LastFM API key not found, skipping genre processing');
        }
    } catch (err) {
        console.error("❌ Error processing genres for artist:", artistData.name, err);
    }

    return newArtistId;
}

/**
 * Create event_artist relation (matches database.js logic)
 */
async function createEventArtistRelation(supabase: any, eventId: number, artistId: number, artistObj: any): Promise<void> {
    if (!artistId) return;
    const artistIdStr = String(artistId);

    let startTime: string | null = null;
    let endTime: string | null = null;
    const stage = artistObj.stage || null;
    const customName = null;

    if (artistObj.time && artistObj.time.trim() !== "") {
        const match = artistObj.time.match(/(\d{1,2}:\d{2})-?(\d{1,2}:\d{2})?/);
        if (match) {
            const startStr = match[1];
            const endStr = match[2] || null;
            if (startStr) {
                startTime = `2025-06-27T${startStr}:00`;
            }
            if (endStr) {
                endTime = `2025-06-27T${endStr}:00`;
            }
        }
    }

    let query = supabase
        .from('event_artist')
        .select('*')
        .eq('event_id', eventId);

    if (stage === null) {
        query = query.is('stage', null);
    } else {
        query = query.eq('stage', stage);
    }
    query = query.is('custom_name', null);
    if (startTime === null) {
        query = query.is('start_time', null);
    } else {
        query = query.eq('start_time', startTime);
    }
    if (endTime === null) {
        query = query.is('end_time', null);
    } else {
        query = query.eq('end_time', endTime);
    }
    query = query.contains('artist_id', [artistIdStr]);

    const { data: existing, error } = await query;
    if (error) {
        console.error("Error during existence check:", error);
        throw error;
    }
    if (existing && existing.length > 0) {
        console.log(`➡️ A row already exists for artist_id=${artistIdStr} with the same performance details.`);
        return;
    }

    const row = {
        event_id: eventId,
        artist_id: [artistIdStr],
        start_time: startTime,
        end_time: endTime,
        status: 'confirmed',
        stage: stage,
        custom_name: customName
    };

    const { data, error: insertError } = await supabase
        .from('event_artist')
        .insert(row)
        .select();
    if (insertError) {
        console.error("Error creating event_artist relation:", insertError);
    } else {
        console.log(`➡️ Created event_artist relation for artist_id=${artistIdStr}`, data);
    }
}
