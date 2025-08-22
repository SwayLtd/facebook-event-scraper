/**
 * Clashfinder integration for Edge Functions
 * Converts CSV data to JSON format for timetable processing
 * Replicates functionality from get_data/get_clashfinder_timetable.js
 */

import { normalizeNameEnhanced } from '../utils/name.ts';

// Clashfinder credentials
const USERNAME = 'clashfinder_sway';
const PRIVATE_KEY = 'sxsgiq9xdck7tiky';

interface Festival {
    id: string;
    name: string;
    desc?: string;
}

interface ClashfinderResult {
    festival: Festival;
    csv: string;
    clashfinderUrl: string;
    similarity: number;
    searchAttempts: number;
}

/**
 * Generates public key for Clashfinder API authentication
 */
async function generatePublicKey(username: string, privateKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashInput = username + privateKey;
    
    // Using Web Crypto API available in Deno
    const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(hashInput));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch all available festivals from Clashfinder
 */
async function fetchAllClashfinders(publicKey: string): Promise<Festival[]> {
    const url = `https://clashfinder.com/data/events/all.json?authUsername=${USERNAME}&authPublicKey=${publicKey}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch festivals: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Adapt to actual API response structure
        if (Array.isArray(data)) {
            return data;
        } else if (Array.isArray(data.events)) {
            return data.events;
        } else if (data.data && Array.isArray(data.data)) {
            return data.data;
        } else {
            throw new Error('Unexpected API response format');
        }
    } catch (error) {
        console.error('Error fetching Clashfinder festivals:', error);
        throw error;
    }
}

/**
 * String similarity calculation (Levenshtein-based)
 */
function stringSimilarity(a: string, b: string): number {
    a = a.toLowerCase();
    b = b.toLowerCase();
    
    if (a === b) return 100;
    if (!a.length || !b.length) return 0;
    
    const matrix: number[][] = [];
    
    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    
    // Convert distance to similarity percentage
    const distance = matrix[b.length][a.length];
    return 100 - Math.floor(100 * distance / Math.max(a.length, b.length));
}

/**
 * Extract festival name from search text (replicated from local script)
 */
function extractFestivalName(searchText: string): string {
    return searchText
        .replace(/\b(20\d{2}|festival|fest|open\s*air|gathering)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Generate search variants for better matching (replicated from local script)
 */
function generateSearchVariants(searchText: string): string[] {
    const variants: string[] = [];
    
    // Extract year from original text for prioritization
    const yearMatch = searchText.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;
    
    // 1. Original text
    variants.push(searchText);
    
    // 2. For weekend events, try different formats
    if (searchText.toLowerCase().includes('weekend')) {
        const weekendMatch = searchText.match(/^(.+?)\s*[-\s]*\s*(weekend\s*\d+)/i);
        if (weekendMatch) {
            let baseName = weekendMatch[1].trim();
            const weekendPart = weekendMatch[2];
            const weekendNum = weekendPart.match(/\d+/)?.[0];
            
            // Clean base name: remove year and trailing punctuation
            baseName = baseName.replace(/\b20\d{2}\b/g, '').replace(/[-\s,]+$/, '').trim();
            
            // Try specific Tomorrowland patterns if it's Tomorrowland
            if (baseName.toLowerCase().includes('tomorrowland')) {
                variants.push(`Tomorrowland Weekend ${weekendNum} ${year}`);
                variants.push(`Tomorrowland W${weekendNum} ${year}`);
                variants.push(`TomorrowlandW${weekendNum}${year}`);
            }
            
            // General weekend format variations
            variants.push(`${baseName} ${weekendPart}`);
            variants.push(`${baseName} ${weekendPart.replace('weekend', 'W').replace(/\s+/g, '')}`);
            variants.push(`${baseName}${weekendPart.replace('weekend', 'W').replace(/\s+/g, '')}`);
        }
    }
    
    // 3. Extracted/cleaned name
    const cleanedName = extractFestivalName(searchText);
    if (cleanedName && cleanedName !== searchText) {
        variants.push(cleanedName);
    }
    
    // 4. Try without location qualifiers
    const withoutLocation = searchText.replace(/\b(belgium|miami|brazil|usa|uk|netherlands|germany|france|spain|italy)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (withoutLocation && withoutLocation !== searchText) {
        variants.push(withoutLocation);
        
        const cleanedLocation = extractFestivalName(withoutLocation);
        if (cleanedLocation && cleanedLocation !== withoutLocation) {
            variants.push(cleanedLocation);
        }
    }
    
    // Remove duplicates and empty strings
    return [...new Set(variants.filter(v => v && v.trim()))];
}

/**
 * Find best matching festival with year validation (replicated from local script)
 */
function findBestFestival(festivals: Festival[], searchText: string, minSimilarity: number = 30, originalSearchText: string = ''): {
    festival: Festival;
    score: number;
} | null {
    const searchLower = searchText.toLowerCase();
    
    // Extract year from original search for year matching bonus
    const yearMatch = originalSearchText.match(/\b(20\d{2})\b/);
    const searchYear = yearMatch ? yearMatch[1] : null;
    
    // Priority: description contains the keyword
    const filtered = festivals.filter(fest =>
        fest.desc && fest.desc.toLowerCase().includes(searchLower)
    );
    const candidates = filtered.length > 0 ? filtered : festivals;
    
    let best: Festival | null = null;
    let bestScore = -1;
    
    for (const fest of candidates) {
        // Compare on desc if available, otherwise on name
        const base = fest.desc ? fest.desc : fest.name;
        let score = stringSimilarity(searchText, base);
        
        // STRICT YEAR VALIDATION: Reject festivals from different years
        if (searchYear) {
            const festYear = base.match(/\b(20\d{2})\b/)?.[1];
            if (festYear && festYear !== searchYear) {
                console.log(`Rejecting festival "${fest.name}" (year ${festYear} != ${searchYear})`);
                continue;
            } else if (festYear === searchYear) {
                score += 10; // Year match bonus
            }
        }
        
        // Additional validation: check if main keywords are present
        if (score >= minSimilarity) {
            // Extract main words from search text (ignoring common words)
            const searchWords = searchText.toLowerCase()
                .replace(/\b(20\d{2}|festival|fest|rave|party|event|edition|ed)\b/g, '')
                .split(/\s+/)
                .filter(word => word.length > 2);
            
            const baseWords = base.toLowerCase().split(/\s+/);
            const baseFull = base.toLowerCase();
            
            let matchingWords = 0;
            for (const word of searchWords) {
                if (baseFull.includes(word) || baseWords.some(bw => bw.includes(word) || word.includes(bw))) {
                    matchingWords++;
                }
            }
            
            if (searchWords.length > 0 && matchingWords === 0) {
                console.log(`Rejecting festival "${fest.name}" (no keyword match)`);
                continue;
            }
        }
        
        if (score > bestScore) {
            bestScore = score;
            best = fest;
        }
    }
    
    // Return result with score for validation
    return best ? { festival: best, score: bestScore } : null;
}

/**
 * Fetch timetable CSV from Clashfinder
 */
async function fetchTimetableCSV(festivalId: string, publicKey: string): Promise<string> {
    const url = `https://clashfinder.com/data/event/${festivalId}.csv?authUsername=${USERNAME}&authPublicKey=${publicKey}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch timetable CSV: ${response.status} ${response.statusText}`);
        }
        
        return await response.text();
    } catch (error) {
        console.error('Error fetching timetable CSV:', error);
        throw error;
    }
}

/**
 * Convert CSV to JSON format (parsing logic replicated from local script)
 */
function parseClashfinderCSV(csv: string): any[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('Invalid CSV format: insufficient data');
    }
    
    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    // Parse data rows
    const performances: any[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;
        
        // Handle CSV parsing with quotes
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim()); // Add last value
        
        // Create performance object
        const performance: any = {};
        headers.forEach((header, index) => {
            performance[header] = values[index] || '';
        });
        
        // Clean up and standardize field names
        if (performance.name || performance.Name || performance.artist) {
            performance.name = performance.name || performance.Name || performance.artist;
            performance.stage = performance.stage || performance.Stage || '';
            performance.time = performance.time || performance.Time || performance.start_time || '';
            performance.end_time = performance.end_time || performance.End_time || performance.endTime || '';
            
            // Clean empty fields
            Object.keys(performance).forEach(key => {
                if (performance[key] === '') {
                    performance[key] = null;
                }
            });
            
            performances.push(performance);
        }
    }
    
    return performances;
}

/**
 * Main function to get Clashfinder timetable
 * Replicates functionality from get_data/get_clashfinder_timetable.js
 */
export async function getClashfinderTimetable(searchText: string, options: {
    minSimilarity?: number;
} = {}): Promise<ClashfinderResult> {
    const { minSimilarity = 30 } = options;
    
    console.log(`[CLASHFINDER] Searching for festival: ${searchText}`);
    
    const publicKey = await generatePublicKey(USERNAME, PRIVATE_KEY);
    let festivalsRaw;
    
    try {
        festivalsRaw = await fetchAllClashfinders(publicKey);
    } catch (e) {
        throw new Error(`Failed to fetch clashfinders: ${(e as Error).message}`);
    }
    
    let bestResult: { festival: Festival; score: number; } | null = null;
    let searchAttempt = 1;
    
    // Generate search variants for better matching
    const searchVariants = generateSearchVariants(searchText);
    
    // Try each search variant
    for (const variant of searchVariants) {
        console.log(`[CLASHFINDER] Search attempt ${searchAttempt}: "${variant}"`);
        bestResult = findBestFestival(festivalsRaw, variant, minSimilarity, searchText);
        
        if (bestResult) {
            console.log(`[CLASHFINDER] Match found with similarity ${bestResult.score}%`);
            break;
        }
        searchAttempt++;
    }
    
    if (!bestResult) {
        throw new Error(`No festival found matching "${searchText}" with minimum similarity of ${minSimilarity}%`);
    }
    
    const { festival: bestFestival, score } = bestResult;
    
    console.log(`[CLASHFINDER] Festival selected: ${bestFestival.name} (id: ${bestFestival.id}, similarity: ${score}%)`);
    console.log(`[CLASHFINDER] Clashfinder link: https://clashfinder.com/s/${bestFestival.id}/`);
    
    let csv;
    try {
        csv = await fetchTimetableCSV(bestFestival.id, publicKey);
    } catch (e) {
        throw new Error(`Failed to fetch CSV: ${(e as Error).message}`);
    }
    
    return {
        festival: bestFestival,
        csv: csv,
        clashfinderUrl: `https://clashfinder.com/s/${bestFestival.id}/`,
        similarity: score,
        searchAttempts: searchAttempt
    };
}

/**
 * Parse Clashfinder CSV and convert to JSON format
 * Returns array of performance objects ready for timetable processing
 */
export async function parseClashfinderData(clashfinderResult: ClashfinderResult): Promise<any[]> {
    console.log('[CLASHFINDER] Parsing CSV data to JSON format...');
    
    try {
        const performances = parseClashfinderCSV(clashfinderResult.csv);
        console.log(`[CLASHFINDER] Parsed ${performances.length} performances from CSV`);
        
        return performances;
    } catch (error) {
        console.error('[CLASHFINDER] Error parsing CSV:', error);
        throw new Error(`Failed to parse Clashfinder CSV: ${(error as Error).message}`);
    }
}
