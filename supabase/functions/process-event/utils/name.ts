/**
 * utils/name.ts
 * 
 * Name normalization utilities for artists, venues, etc.
 * Ported from original Node.js utils/name.js to Deno/TypeScript
 */

import { GEOCODING_EXCEPTIONS } from './constants.ts';

/**
 * Normalize name using exceptions file and advanced Unicode normalization
 * Removes accents and special characters while preserving alphanumeric content
 */
export function normalizeNameEnhanced(name: string): string {
    if (!name) return '';
    
    // Unicode normalization (NFD = decomposed form) 
    let normalized = name.normalize('NFD');
    
    // Remove diacritics (accents, etc.)
    normalized = normalized.replace(/[\u0300-\u036f]/g, "");
    
    // Remove leading/trailing non-alphanumeric characters but preserve content
    normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    
    return normalized;
}

/**
 * Get normalized name using geocoding exceptions lookup
 * If the original name has an exception defined, use that instead
 */
export function getNormalizedName(originalName: string, geocodingExceptions: Record<string, string> = GEOCODING_EXCEPTIONS): string {
    // Check if there's a specific exception for this name
    if (geocodingExceptions[originalName]) {
        return geocodingExceptions[originalName];
    }
    
    // Otherwise return the original name
    return originalName;
}

/**
 * Normalize artist name for matching/comparison
 * More aggressive normalization for fuzzy matching
 */
export function normalizeArtistName(name: string): string {
    if (!name) return '';
    
    let normalized = name.toLowerCase().trim();
    
    // Remove common prefixes/suffixes
    normalized = normalized.replace(/^(dj\s+|mc\s+|the\s+)/i, '');
    normalized = normalized.replace(/(\s+live|\s+dj\s+set|\s+\(live\)|\s+\(dj\s+set\))$/i, '');
    
    // Normalize Unicode and remove diacritics
    normalized = normalizeNameEnhanced(normalized);
    
    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
}

/**
 * Normalize venue name for geocoding and matching
 */
export function normalizeVenueName(name: string): string {
    if (!name) return '';
    
    // First check for geocoding exceptions
    const exceptionName = getNormalizedName(name);
    if (exceptionName !== name) {
        return exceptionName;
    }
    
    // Apply standard normalization
    return normalizeNameEnhanced(name).trim();
}

/**
 * Clean and normalize event name
 * Remove common patterns that don't help with identification
 */
export function normalizeEventName(name: string): string {
    if (!name) return '';
    
    let normalized = name.trim();
    
    // Remove dates and years in various formats
    normalized = normalized.replace(/\b(20\d{2})\b/g, ''); // Years 2000-2099
    normalized = normalized.replace(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, ''); // Dates
    
    // Remove common event indicators
    normalized = normalized.replace(/\b(presents?|pres\.|featuring|feat\.|ft\.)\b/gi, '');
    
    // Remove ticket/venue info
    normalized = normalized.replace(/\b(tickets?|at|@|live\s+at|free\s+entry)\b/gi, '');
    
    // Clean up extra spaces and normalize
    normalized = normalized.replace(/\s+/g, ' ').trim();
    normalized = normalizeNameEnhanced(normalized);
    
    return normalized;
}

/**
 * Check if two names are potentially the same after normalization
 * Uses fuzzy matching threshold
 */
export function areNamesSimilar(name1: string, name2: string, threshold: number = 0.8): boolean {
    if (!name1 || !name2) return false;
    
    const norm1 = normalizeNameEnhanced(name1.toLowerCase().trim());
    const norm2 = normalizeNameEnhanced(name2.toLowerCase().trim());
    
    if (norm1 === norm2) return true;
    
    // Simple similarity check (can be enhanced with Levenshtein distance if needed)
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    
    if (shorter.length === 0) return false;
    
    // Check if shorter name is contained in longer name
    const similarity = longer.includes(shorter) ? shorter.length / longer.length : 0;
    
    return similarity >= threshold;
}

/**
 * Extract artist names from event title
 * Handles various formats: "Artist 1 x Artist 2", "Artist 1 & Artist 2", etc.
 */
export function extractArtistNamesFromTitle(title: string): string[] {
    if (!title) return [];
    
    // Common separators for multiple artists
    const separators = [' x ', ' X ', ' & ', ' and ', ' feat. ', ' feat ', ' ft. ', ' ft ', ' vs. ', ' vs ', ' + '];
    
    let artists = [title];
    
    // Try each separator to split the title
    for (const separator of separators) {
        if (title.includes(separator)) {
            artists = title.split(separator);
            break;
        }
    }
    
    // Clean up each artist name
    return artists
        .map(artist => normalizeArtistName(artist))
        .filter(artist => artist.length > 0)
        .filter(artist => !isCommonEventWord(artist));
}

/**
 * Check if a word/phrase is a common event-related term rather than an artist name
 */
function isCommonEventWord(word: string): boolean {
    const commonWords = [
        'presents', 'pres', 'featuring', 'feat', 'live', 'dj', 'set',
        'party', 'night', 'event', 'show', 'concert', 'festival',
        'club', 'venue', 'music', 'dance', 'electronic', 'techno',
        'house', 'trance', 'dubstep', 'drum', 'bass'
    ];
    
    return commonWords.some(common => 
        word.toLowerCase().includes(common) || common.includes(word.toLowerCase())
    );
}
