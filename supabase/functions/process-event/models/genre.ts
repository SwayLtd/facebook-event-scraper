/**
 * models/genre.ts
 * 
 * Genre classification and management model
 * Ported from original Node.js models/genre.js to Deno/TypeScript
 */

// Edge Functions runtime globals
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

import { BANNED_GENRES, MIN_GENRE_OCCURRENCE, MAX_GENRES_REGULAR, MAX_GENRES_FESTIVAL, FESTIVAL_FALLBACK_GENRES } from '../utils/constants.ts';
import { withLastFmRetry, withDatabaseRetry } from '../utils/retry.ts';

/**
 * Genre interface
 */
export interface Genre {
    id?: number;
    name: string;
    description?: string;
    slug?: string;
    created_at?: string;
    updated_at?: string;
}

/**
 * Artist-Genre relationship
 */
export interface ArtistGenre {
    artist_id: number;
    genre_id: number;
    confidence?: number;
    source?: string;
}

/**
 * Genre occurrence for ranking
 */
interface GenreOccurrence {
    genre: string;
    count: number;
    refined_name: string;
    description?: string;
}

/**
 * Refine genre name for display
 * Formats genre names for better readability
 */
export function refineGenreName(name: string): string {
    if (!name) return '';
    
    // Capitalize each word
    let refined = name.replace(/\w\S*/g, (txt) => 
        txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
    
    // Special case: insert space before "Techno" if not already present
    if (!refined.includes(' ') && /techno/i.test(refined)) {
        refined = refined.replace(/(.*)(Techno)/i, '$1 Techno');
    }
    
    return refined;
}

/**
 * Split compound tags containing known delimiters
 */
export function splitCompoundTags(tag: string): string[] {
    const delimiters = [" x ", " & ", " + ", " and ", " / "];
    
    for (const delim of delimiters) {
        if (tag.includes(delim)) {
            return tag.split(delim).map(t => t.trim());
        }
    }
    
    return [tag];
}

/**
 * Create slugified version of genre name
 */
export function slugifyGenre(name: string): string {
    return name.replace(/\W/g, "").toLowerCase();
}

/**
 * Clean description by removing HTML tags and common suffixes
 */
export function cleanDescription(desc: string): string {
    if (!desc) return "";
    
    // Remove HTML tags
    let text = desc.replace(/<[^>]*>/g, '').trim();
    
    // Remove "Read more on Last.fm" and similar
    text = text.replace(/read more on last\.fm/gi, '').trim();
    text = text.replace(/\s+\.\s*$/, ''); // Remove trailing " ."
    
    return text.length < 30 ? "" : text;
}

/**
 * Load banned genre IDs from database
 */
async function getBannedGenreIds(supabase: any): Promise<number[]> {
    try {
        const refinedBannedGenres = BANNED_GENRES.map(g => refineGenreName(g));
        
        const { data: bannedGenreRecords, error } = await supabase
            .from('genres')
            .select('id')
            .in('name', refinedBannedGenres);
            
        if (error) throw error;
        
        return bannedGenreRecords.map((r: any) => r.id);
    } catch (error) {
        console.error('Error loading banned genre IDs:', error);
        return [];
    }
}

/**
 * Fetch artist top tags from Last.fm
 */
async function fetchArtistTopTags(artistName: string): Promise<string[]> {
    const lastFmApiKey = Deno.env.get('LASTFM_API_KEY');
    if (!lastFmApiKey) {
        console.warn('Last.fm API key not found');
        return [];
    }

    try {
        const encodedArtist = encodeURIComponent(artistName);
        const url = `http://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodedArtist}&api_key=${lastFmApiKey}&format=json`;
        
        const response = await withLastFmRetry(async () => {
            return await fetch(url);
        });
        
        const data = await response.json();
        
        if (data.toptags?.tag) {
            return data.toptags.tag
                .slice(0, 10) // Top 10 tags
                .map((tag: any) => tag.name)
                .filter((name: string) => name && name.trim().length > 0);
        }
        
        return [];
    } catch (error) {
        console.error(`Error fetching Last.fm tags for "${artistName}":`, error);
        return [];
    }
}

/**
 * Process and classify genres from tags
 */
export async function processArtistGenres(
    supabase: any,
    artistId: number,
    artistName: string,
    soundcloudTags: string[] = [],
    isFestival: boolean = false
): Promise<boolean> {
    try {
        console.log(`Processing genres for artist: ${artistName}`);
        
        // Collect tags from multiple sources
        const lastFmTags = await fetchArtistTopTags(artistName);
        const allTags = [...soundcloudTags, ...lastFmTags];
        
        if (allTags.length === 0) {
            console.log(`No tags found for artist: ${artistName}`);
            return false;
        }
        
        // Expand compound tags
        const expandedTags: string[] = [];
        for (const tag of allTags) {
            const splitTags = splitCompoundTags(tag);
            expandedTags.push(...splitTags);
        }
        
        // Count genre occurrences
        const genreOccurrences = countGenreOccurrences(expandedTags);
        
        // Filter by minimum occurrence threshold
        const filteredGenres = genreOccurrences.filter(g => g.count >= MIN_GENRE_OCCURRENCE);
        
        if (filteredGenres.length === 0) {
            // Use fallback genres for festivals
            if (isFestival && genreOccurrences.length > 0) {
                const fallbackGenres = genreOccurrences
                    .slice(0, FESTIVAL_FALLBACK_GENRES)
                    .filter(g => g.count > 0);
                    
                if (fallbackGenres.length > 0) {
                    await assignGenresToArtist(supabase, artistId, fallbackGenres, 'lastfm_fallback');
                    return true;
                }
            }
            
            console.log(`No genres meet minimum threshold for: ${artistName}`);
            return false;
        }
        
        // Limit number of genres based on event type
        const maxGenres = isFestival ? MAX_GENRES_FESTIVAL : MAX_GENRES_REGULAR;
        const finalGenres = filteredGenres.slice(0, maxGenres);
        
        // Assign genres to artist
        await assignGenresToArtist(supabase, artistId, finalGenres, 'lastfm');
        
        console.log(`Assigned ${finalGenres.length} genres to ${artistName}`);
        return true;
        
    } catch (error) {
        console.error(`Error processing genres for ${artistName}:`, error);
        return false;
    }
}

/**
 * Count and rank genre occurrences
 */
function countGenreOccurrences(tags: string[]): GenreOccurrence[] {
    const genreMap = new Map<string, number>();
    
    // Count occurrences of each refined genre name
    for (const tag of tags) {
        if (!tag || tag.trim().length === 0) continue;
        
        const refined = refineGenreName(tag.trim());
        const slug = slugifyGenre(refined);
        
        // Skip banned genres
        if (BANNED_GENRES.some(banned => slugifyGenre(refineGenreName(banned)) === slug)) {
            continue;
        }
        
        genreMap.set(refined, (genreMap.get(refined) || 0) + 1);
    }
    
    // Convert to array and sort by count
    const occurrences: GenreOccurrence[] = [];
    for (const [genre, count] of genreMap.entries()) {
        occurrences.push({
            genre: genre.toLowerCase(),
            refined_name: genre,
            count
        });
    }
    
    return occurrences.sort((a, b) => b.count - a.count);
}

/**
 * Assign genres to artist in database
 */
async function assignGenresToArtist(
    supabase: any,
    artistId: number,
    genres: GenreOccurrence[],
    source: string
): Promise<void> {
    const bannedGenreIds = await getBannedGenreIds(supabase);
    
    for (const genreOcc of genres) {
        try {
            // Find or create genre
            const genre = await findOrCreateGenre(supabase, genreOcc.refined_name, genreOcc.genre);
            
            if (!genre || bannedGenreIds.includes(genre.id!)) {
                console.log(`Skipping banned genre: ${genreOcc.refined_name}`);
                continue;
            }
            
            // Check if artist-genre relationship already exists
            const { data: existing } = await supabase
                .from('artists_genres')
                .select('*')
                .eq('artist_id', artistId)
                .eq('genre_id', genre.id)
                .single();
                
            if (existing) {
                console.log(`Artist-genre relationship already exists: ${artistId} - ${genre.id}`);
                continue;
            }
            
            // Create artist-genre relationship
            const confidence = Math.min(100, Math.round((genreOcc.count / genres.length) * 100));
            
            const { error } = await withDatabaseRetry(async () => {
                return await supabase
                    .from('artists_genres')
                    .insert([{
                        artist_id: artistId,
                        genre_id: genre.id,
                        confidence,
                        source
                    }]);
            });
            
            if (error) {
                console.error(`Error assigning genre ${genre.name} to artist ${artistId}:`, error);
            } else {
                console.log(`Assigned genre "${genre.name}" to artist ${artistId} (confidence: ${confidence}%)`);
            }
            
        } catch (error) {
            console.error(`Error processing genre "${genreOcc.refined_name}":`, error);
        }
    }
}

/**
 * Find existing genre or create new one
 */
async function findOrCreateGenre(supabase: any, refinedName: string, originalName: string): Promise<Genre | null> {
    try {
        // Try to find existing genre by name
        const { data: existing, error: findError } = await supabase
            .from('genres')
            .select('*')
            .eq('name', refinedName)
            .single();
            
        if (findError && findError.code !== 'PGRST116') { // PGRST116 = not found
            throw findError;
        }
        
        if (existing) {
            return existing;
        }
        
        // Create new genre
        const slug = slugifyGenre(refinedName);
        
        // Try to get description from Last.fm
        const description = await fetchGenreDescription(originalName);
        
        const { data: newGenre, error: createError } = await withDatabaseRetry(async () => {
            return await supabase
                .from('genres')
                .insert([{
                    name: refinedName,
                    slug,
                    description: cleanDescription(description)
                }])
                .select()
                .single();
        });
        
        if (createError) {
            console.error(`Error creating genre "${refinedName}":`, createError);
            return null;
        }
        
        console.log(`Created new genre: "${refinedName}" (ID: ${newGenre.id})`);
        return newGenre;
        
    } catch (error) {
        console.error(`Error finding/creating genre "${refinedName}":`, error);
        return null;
    }
}

/**
 * Fetch genre description from Last.fm
 */
async function fetchGenreDescription(genreName: string): Promise<string> {
    const lastFmApiKey = Deno.env.get('LASTFM_API_KEY');
    if (!lastFmApiKey) {
        return '';
    }

    try {
        const encodedGenre = encodeURIComponent(genreName);
        const url = `http://ws.audioscrobbler.com/2.0/?method=tag.getinfo&tag=${encodedGenre}&api_key=${lastFmApiKey}&format=json`;
        
        const response = await withLastFmRetry(async () => {
            return await fetch(url);
        });
        
        const data = await response.json();
        
        if (data.tag?.wiki?.summary) {
            return data.tag.wiki.summary;
        }
        
        return '';
    } catch (error) {
        console.error(`Error fetching description for genre "${genreName}":`, error);
        return '';
    }
}

/**
 * Get genres for an artist
 */
export async function getArtistGenres(supabase: any, artistId: number): Promise<Genre[]> {
    try {
        const { data, error } = await supabase
            .from('artists_genres')
            .select(`
                genre_id,
                confidence,
                source,
                genres (
                    id,
                    name,
                    description,
                    slug
                )
            `)
            .eq('artist_id', artistId)
            .order('confidence', { ascending: false });
            
        if (error) throw error;
        
        return data.map((ag: any) => ag.genres);
    } catch (error) {
        console.error(`Error getting genres for artist ${artistId}:`, error);
        return [];
    }
}

/**
 * Remove all genres for an artist (for re-processing)
 */
export async function clearArtistGenres(supabase: any, artistId: number): Promise<boolean> {
    try {
        const { error } = await withDatabaseRetry(async () => {
            return await supabase
                .from('artists_genres')
                .delete()
                .eq('artist_id', artistId);
        });
        
        if (error) throw error;
        
        console.log(`Cleared genres for artist ${artistId}`);
        return true;
    } catch (error) {
        console.error(`Error clearing genres for artist ${artistId}:`, error);
        return false;
    }
}
