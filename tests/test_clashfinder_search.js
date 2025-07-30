// Test file for Clashfinder search improvements
// This demonstrates the multi-variant search process with similarity validation and year matching

import { getClashfinderTimetable } from '../get_data/get_clashfinder_timetable.js';
import { extractFestivalName } from '../utils/festival-detection.js';

const testCases = [
    {
        name: 'Exact match - high similarity',
        input: 'Tomorrowland 2024',
        expected: { shouldFind: true, attempts: 1, minSimilarity: 95 }
    },
    {
        name: 'Weekend event with year matching',
        input: 'Tomorrowland Belgium 2025 - Weekend 2',
        expected: { shouldFind: true, attempts: 2, minSimilarity: 100, expectedId: 'tml2025w2' }
    },
    {
        name: 'Requires truncation',
        input: 'Dour Festival 2024 - 18th Edition',
        expected: { shouldFind: true, attempts: 2, minSimilarity: 70 }
    },
    {
        name: 'False positive rejection',
        input: 'Voodoo Village 2025',
        expected: { shouldFind: false, reason: 'No similar festival exists' }
    },
    {
        name: 'Complex name with success',
        input: 'Ultra Music Festival 2024',
        expected: { shouldFind: true, attempts: 1, minSimilarity: 95 }
    }
];

async function runTests() {
    console.log('🧪 Testing Enhanced Clashfinder Search with Multi-Variant Support\n');

    for (const testCase of testCases) {
        console.log(`--- Test: ${testCase.name} ---`);
        console.log(`Input: "${testCase.input}"`);
        
        // Test name extraction
        const extractedName = extractFestivalName(testCase.input);
        console.log(`Extracted name: "${extractedName}"`);
        
        try {
            const result = await getClashfinderTimetable(testCase.input, {
                saveFile: false,
                silent: true,
                minSimilarity: 70
            });
            
            if (testCase.expected.shouldFind) {
                console.log(`✅ Found: ${result.festival.name}`);
                console.log(`   Similarity: ${result.similarity}%`);
                console.log(`   Search attempts: ${result.searchAttempts}`);
                console.log(`   URL: ${result.clashfinderUrl}`);
                
                if (result.similarity >= testCase.expected.minSimilarity) {
                    console.log(`✅ Similarity check passed (${result.similarity}% >= ${testCase.expected.minSimilarity}%)`);
                } else {
                    console.log(`❌ Similarity too low (${result.similarity}% < ${testCase.expected.minSimilarity}%)`);
                }
                
                if (testCase.expected.expectedId && result.festival.name === testCase.expected.expectedId) {
                    console.log(`✅ Expected festival ID matched (${result.festival.name})`);
                } else if (testCase.expected.expectedId) {
                    console.log(`⚠️ Different festival found (got ${result.festival.name}, expected ${testCase.expected.expectedId})`);
                }
                
                if (result.searchAttempts <= testCase.expected.attempts) {
                    console.log(`✅ Search attempts efficient (${result.searchAttempts} <= ${testCase.expected.attempts})`);
                } else {
                    console.log(`⚠️ More search attempts than expected (${result.searchAttempts} > ${testCase.expected.attempts})`);
                }
            } else {
                console.log(`❌ Unexpected success - should have failed: ${result.festival.name}`);
            }
            
        } catch (error) {
            if (!testCase.expected.shouldFind) {
                console.log(`✅ Correctly rejected: ${error.message}`);
            } else {
                console.log(`❌ Unexpected failure: ${error.message}`);
            }
        }
        
        console.log('');
    }
    
    console.log('🎯 Test Summary:');
    console.log('- Multi-variant search with year detection');
    console.log('- Weekend pattern recognition for Tomorrowland');
    console.log('- False positive rejection with similarity thresholds');
    console.log('- Year matching bonus for festival prioritization');
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(console.error);
}

export { runTests };
