// Script pour récupérer le CSV de la timetable d'un festival via Clashfinder
// Usage: node get_clashfinder_timetable.js "nom du festival"

import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import { extractFestivalName } from '../utils/festival-detection.js';

const USERNAME = 'clashfinder_sway';
const PRIVATE_KEY = 'sxsgiq9xdck7tiky';

function generatePublicKey(username, privateKey) {
    const hashInput = username + privateKey;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
}

async function fetchAllClashfinders(publicKey) {
    const url = `https://clashfinder.com/data/events/all.json?authUsername=${USERNAME}&authPublicKey=${publicKey}`;
    const res = await axios.get(url);
    return res.data;
}

function stringSimilarity(a, b) {
    // Levenshtein distance (simple implementation)
    a = a.toLowerCase();
    b = b.toLowerCase();
    if (a === b) return 100;
    if (!a.length || !b.length) return 0;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    // Similarity score: 100 - normalized distance
    const distance = matrix[b.length][a.length];
    return 100 - Math.floor(100 * distance / Math.max(a.length, b.length));
}

function generateSearchVariants(searchText) {
    const variants = [];
    
    // Extract year from original text for prioritization
    const yearMatch = searchText.match(/\b(20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : null;
    
    // 1. Original text
    variants.push(searchText);
    
    // 2. For weekend events, try different formats
    if (searchText.toLowerCase().includes('weekend')) {
        // Better pattern to capture festival name and weekend
        const weekendMatch = searchText.match(/^(.+?)\s*[-\s]*\s*(weekend\s*\d+)/i);
        if (weekendMatch) {
            let baseName = weekendMatch[1].trim();
            const weekendPart = weekendMatch[2];
            const weekendNum = weekendPart.match(/\d+/)?.[0];
            
            // Clean base name: remove year and trailing punctuation
            baseName = baseName.replace(/\b20\d{2}\b/g, '').replace(/[-\s,]+$/, '').trim();
            
            // Try specific Tomorrowland patterns if it's Tomorrowland
            if (baseName.toLowerCase().includes('tomorrowland')) {
                const baseClean = baseName.replace(/\b(belgium|miami|brasil)\b/gi, '').trim();
                if (year && weekendNum) {
                    // Key patterns that should work for Tomorrowland
                    variants.push(`${baseClean} Weekend ${weekendNum} ${year}`);  // "Tomorrowland Weekend 2 2025"
                    variants.push(`${baseClean} ${year} W${weekendNum}`);         // "Tomorrowland 2025 W2"
                    variants.push(`${baseClean}${year}w${weekendNum}`);           // "Tomorrowland2025w2"
                    variants.push(`tml${year}w${weekendNum}`);                    // "tml2025w2"
                }
                variants.push(`${baseClean} W${weekendNum} ${year || ''}`);
                variants.push(`${baseClean} Weekend ${weekendNum} ${year || ''}`);
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

function findBestFestival(festivals, searchText, minSimilarity = 30, originalSearchText = '') {
    const searchLower = searchText.toLowerCase();
    
    // Extract year from original search for year matching bonus
    const yearMatch = originalSearchText.match(/\b(20\d{2})\b/);
    const searchYear = yearMatch ? yearMatch[1] : null;
    
    // Priorité : description contient le mot-clé
    const filtered = festivals.filter(fest =>
        fest.desc && fest.desc.toLowerCase().includes(searchLower)
    );
    const candidates = filtered.length > 0 ? filtered : festivals;
    
    let best = null;
    let bestScore = -1;
    
    for (const fest of candidates) {
        // Compare sur desc si dispo, sinon sur name
        const base = fest.desc ? fest.desc : fest.name;
        let score = stringSimilarity(searchText, base);
        
        // STRICT YEAR VALIDATION: Reject festivals from different years
        if (searchYear) {
            const festYear = base.match(/\b(20\d{2})\b/)?.[1];
            if (festYear && festYear !== searchYear) {
                // Completely reject festivals from different years
                console.log(`🚫 Rejecting ${fest.name} (${festYear}) - year mismatch with search (${searchYear})`);
                continue; // Skip this festival entirely
            } else if (festYear === searchYear) {
                score += 10; // Bonus for exact year match
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
            
            // More strict keyword matching: require significant portion of words to match
            let matchCount = 0;
            for (const searchWord of searchWords) {
                const hasExactMatch = baseWords.some(baseWord => baseWord === searchWord);
                const hasPartialMatch = baseWords.some(baseWord => 
                    (baseWord.includes(searchWord) && searchWord.length >= 4) ||
                    (searchWord.includes(baseWord) && baseWord.length >= 4)
                );
                const hasInlineMatch = baseFull.includes(searchWord) && searchWord.length >= 4;
                
                if (hasExactMatch || hasPartialMatch || hasInlineMatch) {
                    matchCount++;
                }
            }
            
            const matchRatio = searchWords.length > 0 ? matchCount / searchWords.length : 0;
            
            // Require at least 70% of search words to have some match for high confidence
            // Or require very high similarity (90+) if few words match
            let effectiveThreshold = minSimilarity;
            if (matchRatio < 0.7) {
                effectiveThreshold = Math.max(minSimilarity + 20, 90);
            }
            
            if (score >= effectiveThreshold && score > bestScore) {
                best = fest;
                bestScore = score;
            }
        }
    }
    
    // Return result with score for validation
    return best ? { festival: best, score: bestScore } : null;
}

async function fetchTimetableCSV(festivalId, publicKey) {
    const url = `https://clashfinder.com/data/event/${festivalId}.csv?authUsername=${USERNAME}&authPublicKey=${publicKey}`;
    const res = await axios.get(url);
    return res.data;
}

// Main function exported for use as module
export async function getClashfinderTimetable(searchText, options = {}) {
    const { saveFile = true, outputDir = '.', silent = false, minSimilarity = 30 } = options;
    
    if (!silent) console.log(`[CLASHFINDER] Searching for festival: ${searchText}`);
    
    const publicKey = generatePublicKey(USERNAME, PRIVATE_KEY);
    let festivalsRaw;
    try {
        festivalsRaw = await fetchAllClashfinders(publicKey);
    } catch (e) {
        throw new Error(`Failed to fetch clashfinders: ${e.message}`);
    }
    
    // Adapt to actual API response structure
    let festivals;
    if (Array.isArray(festivalsRaw)) {
        festivals = festivalsRaw;
    } else if (Array.isArray(festivalsRaw.events)) {
        festivals = festivalsRaw.events;
    } else if (Array.isArray(festivalsRaw.data)) {
        festivals = festivalsRaw.data;
    } else if (typeof festivalsRaw === 'object' && festivalsRaw !== null) {
        // Convert object to array of festival objects, adding the id as a property
        festivals = Object.entries(festivalsRaw).map(([id, fest]) => ({ id, ...fest }));
    } else {
        throw new Error('Unknown API response format for festivals');
    }
    
    let bestResult = null;
    let searchAttempt = 1;
    
    // Generate search variants for better matching
    const searchVariants = generateSearchVariants(searchText);
    
    // Try each search variant
    for (const variant of searchVariants) {
        if (!silent) console.log(`[CLASHFINDER] Searching (attempt ${searchAttempt}/${searchVariants.length}) with name: "${variant}"`);
        bestResult = findBestFestival(festivals, variant, minSimilarity, searchText);
        
        if (bestResult) {
            break; // Found a good match, stop searching
        }
        searchAttempt++;
    }
    
    if (!bestResult) {
        throw new Error(`No festival found matching "${searchText}" with minimum similarity of ${minSimilarity}%`);
    }
    
    const { festival: bestFestival, score } = bestResult;
    
    if (!silent) {
        console.log(`[CLASHFINDER] Festival selected: ${bestFestival.name} (id: ${bestFestival.id}, similarity: ${score}%)`);
        console.log(`[CLASHFINDER] Clashfinder link: https://clashfinder.com/s/${bestFestival.id}/`);
    }
    
    let csv;
    try {
        csv = await fetchTimetableCSV(bestFestival.id, publicKey);
    } catch (e) {
        throw new Error(`Failed to fetch CSV: ${e.message}`);
    }
    
    let filename = null;
    if (saveFile) {
        filename = `${outputDir}/clashfinder_${bestFestival.id}_timetable.csv`;
        fs.writeFileSync(filename, csv);
        if (!silent) console.log(`[CLASHFINDER] CSV saved to ${filename}`);
    }
    
    return {
        festival: bestFestival,
        csv: csv,
        filename: filename,
        clashfinderUrl: `https://clashfinder.com/s/${bestFestival.id}/`,
        similarity: score,
        searchAttempts: searchAttempt
    };
}

// CLI usage when run directly
async function main() {
    const searchText = process.argv[2];
    if (!searchText) {
        console.error('Usage: node get_clashfinder_timetable.js "nom du festival"');
        process.exit(1);
    }
    
    try {
        await getClashfinderTimetable(searchText);
        console.log(`[SUCCESS] Festival data retrieved successfully!`);
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        process.exit(1);
    }
}

// Run main if called directly
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith('get_clashfinder_timetable.js'))) {
    main();
}
