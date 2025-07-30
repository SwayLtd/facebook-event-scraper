// Script pour récupérer le CSV de la timetable d'un festival via Clashfinder
// Usage: node get_clashfinder_timetable.js "nom du festival"

import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';

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

function findBestFestival(festivals, searchText) {
    const searchLower = searchText.toLowerCase();
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
        const score = stringSimilarity(searchText, base);
        if (score > bestScore) {
            best = fest;
            bestScore = score;
        }
    }
    return best;
}

async function fetchTimetableCSV(festivalId, publicKey) {
    const url = `https://clashfinder.com/data/event/${festivalId}.csv?authUsername=${USERNAME}&authPublicKey=${publicKey}`;
    const res = await axios.get(url);
    return res.data;
}

// Main function exported for use as module
export async function getClashfinderTimetable(searchText, options = {}) {
    const { saveFile = true, outputDir = '.', silent = false } = options;
    
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
    
    const bestFestival = findBestFestival(festivals, searchText);
    if (!bestFestival) {
        throw new Error('No festival found matching the search criteria');
    }
    
    if (!silent) {
        console.log(`[CLASHFINDER] Festival selected: ${bestFestival.name} (id: ${bestFestival.id})`);
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
        clashfinderUrl: `https://clashfinder.com/s/${bestFestival.id}/`
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
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('get_clashfinder_timetable.js')) {
    main();
}
