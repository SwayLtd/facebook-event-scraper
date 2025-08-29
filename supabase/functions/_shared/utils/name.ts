// Name normalization utilities pour Edge Functions
// Adaptation des utilitaires de normalisation JavaScript locaux

export interface GeoCodingExceptions {
  [originalName: string]: string;
}

/**
 * Normalize name using enhanced algorithm
 * @param name - Name to normalize
 * @returns Normalized name
 */
export function normalizeNameEnhanced(name: string | null | undefined): string {
  if (!name) return '';
  
  let normalized = name.normalize('NFD');
  // Remove diacritical marks
  normalized = normalized.replace(/[\u0300-\u036f]/g, "");
  // Remove leading/trailing non-alphanumeric characters
  normalized = normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  
  return normalized;
}

/**
 * Get normalized name using exceptions mapping
 * @param originalName - Original name
 * @param geocodingExceptions - Exceptions mapping
 * @returns Normalized name from exceptions or original
 */
export function getNormalizedName(
  originalName: string, 
  geocodingExceptions: GeoCodingExceptions = {}
): string {
  if (geocodingExceptions[originalName]) {
    return geocodingExceptions[originalName];
  }
  return originalName;
}

/**
 * Clean artist name by removing common suffixes and prefixes
 * @param name - Artist name to clean
 * @returns Cleaned artist name
 */
export function cleanArtistName(name: string): string {
  if (!name) return '';
  
  let cleaned = name.trim();
  
  // Remove common prefixes
  const prefixes = ['DJ ', 'dj ', 'Dj ', 'The ', 'THE '];
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.substring(prefix.length);
      break;
    }
  }
  
  // Remove common suffixes  
  const suffixes = [' (Live)', ' (DJ Set)', ' (DJ)', ' LIVE', ' live'];
  for (const suffix of suffixes) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.substring(0, cleaned.length - suffix.length);
      break;
    }
  }
  
  return cleaned.trim();
}

/**
 * Extract artist names from a string with multiple artists
 * @param artistsString - String containing multiple artist names
 * @returns Array of individual artist names
 */
export function extractMultipleArtists(artistsString: string): string[] {
  if (!artistsString) return [];
  
  // Common separators for multiple artists
  const separators = [' & ', ' and ', ' vs ', ' x ', ' feat ', ' ft ', ' with ', ', '];
  
  let artists = [artistsString];
  
  for (const separator of separators) {
    const newArtists: string[] = [];
    for (const artist of artists) {
      if (artist.includes(separator)) {
        newArtists.push(...artist.split(separator));
      } else {
        newArtists.push(artist);
      }
    }
    artists = newArtists;
  }
  
  return artists
    .map(artist => cleanArtistName(artist))
    .filter(artist => artist.length > 0)
    .filter((artist, index, array) => array.indexOf(artist) === index); // Remove duplicates
}

/**
 * Generate search variations of a name for fuzzy matching
 * @param name - Original name
 * @returns Array of name variations for searching
 */
export function generateNameVariations(name: string): string[] {
  if (!name) return [];
  
  const variations = new Set<string>();
  
  // Original name
  variations.add(name);
  
  // Normalized version
  const normalized = normalizeNameEnhanced(name);
  if (normalized !== name) {
    variations.add(normalized);
  }
  
  // Lowercase version
  variations.add(name.toLowerCase());
  variations.add(normalized.toLowerCase());
  
  // Cleaned version (without DJ, The, etc.)
  const cleaned = cleanArtistName(name);
  if (cleaned !== name) {
    variations.add(cleaned);
    variations.add(cleaned.toLowerCase());
  }
  
  // Replace special characters with spaces
  const spaced = name.replace(/[_\-\.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaced !== name) {
    variations.add(spaced);
    variations.add(spaced.toLowerCase());
  }
  
  return Array.from(variations).filter(v => v.length > 0);
}

/**
 * Check if two names are likely the same artist
 * @param name1 - First name
 * @param name2 - Second name  
 * @param threshold - Similarity threshold (0-1)
 * @returns True if names are likely the same
 */
export function areNamesSimilar(name1: string, name2: string, threshold = 0.8): boolean {
  if (!name1 || !name2) return false;
  
  // Exact match
  if (name1 === name2) return true;
  
  // Normalized match
  const norm1 = normalizeNameEnhanced(name1).toLowerCase();
  const norm2 = normalizeNameEnhanced(name2).toLowerCase();
  if (norm1 === norm2) return true;
  
  // Cleaned match
  const clean1 = cleanArtistName(name1).toLowerCase();
  const clean2 = cleanArtistName(name2).toLowerCase();
  if (clean1 === clean2) return true;
  
  // Simple similarity check (could be enhanced with Levenshtein distance)
  const longer = norm1.length > norm2.length ? norm1 : norm2;
  const shorter = norm1.length <= norm2.length ? norm1 : norm2;
  
  if (longer.includes(shorter)) {
    return shorter.length / longer.length >= threshold;
  }
  
  return false;
}

export default {
  normalizeNameEnhanced,
  getNormalizedName,
  cleanArtistName,
  extractMultipleArtists,
  generateNameVariations,
  areNamesSimilar
};
