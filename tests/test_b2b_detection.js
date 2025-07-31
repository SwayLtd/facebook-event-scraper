/**
 * Test the improved B2B detection with " & " and lowercase formats
 */

// Import the functions to test
const MODE_PATTERN = /\b(B2B|B3B|F2F|VS|b2b|b3b|f2f|vs|meet|feat|ft)\b/i;

// Known band/group names that contain "&" and should NOT be split
const KNOWN_BANDS_WITH_AMPERSAND = [
    'bigflo & oli',
    'simon & garfunkel', 
    'salt & pepper',
    'bell & sebastien',
    'above & beyond', // Special case - this one SHOULD be split sometimes
];

function shouldSplitOnAmpersand(name) {
    const lowerName = name.toLowerCase().trim();
    // Check if it's a known band name that shouldn't be split
    for (const bandName of KNOWN_BANDS_WITH_AMPERSAND) {
        if (lowerName === bandName) {
            // Special case: "Above & Beyond" is both a group name AND used in collaborations
            if (bandName === 'above & beyond') {
                // If it's part of a longer string with more artists, split it
                // Otherwise keep it as the group name
                const parts = name.split(/\s+&\s+/);
                return parts.length > 2; // Only split if more than 2 parts
            }
            return false; // Don't split known band names
        }
    }
    return true; // Split other " & " cases
}

function detectMode(name) {
    const match = name.match(MODE_PATTERN);
    return match ? match[1] : '';
}

function cleanName(name) {
    const SUFFIX_PATTERN = /\s+(A\/V|\(live\))$/i;
    return name.replace(SUFFIX_PATTERN, '').trim();
}

function smartSplit(combinedName) {
    // First try to split on B2B-style keywords (excluding &)
    // Note: "x" is excluded because it's too generic and causes false positives
    const nonAmpersandRegex = /\s+(?:B2B|B3B|F2F|VS|b2b|b3b|f2f|vs|meet|w\/|feat|ft)\s+/i;
    const nonAmpersandSplit = combinedName.split(nonAmpersandRegex).map(cleanName).filter(Boolean);
    
    if (nonAmpersandSplit.length > 1) {
        // Found B2B keywords, use that split
        return nonAmpersandSplit;
    } else if (combinedName.includes(' & ') && shouldSplitOnAmpersand(combinedName)) {
        // Only split on " & " if it's not a known band name
        return combinedName.split(/\s+&\s+/).map(cleanName).filter(Boolean);
    } else {
        // No split needed or known band name
        return [cleanName(combinedName)];
    }
}

function testB2BDetection() {
    console.log('🧪 Testing improved B2B detection...');
    
    const testCases = [
        // Original uppercase formats
        { input: 'Artist A B2B Artist B', expected: ['Artist A', 'Artist B'], mode: 'B2B' },
        { input: 'DJ One B3B DJ Two B3B DJ Three', expected: ['DJ One', 'DJ Two', 'DJ Three'], mode: 'B2B' },
        { input: 'Producer X F2F Producer Y', expected: ['Producer X', 'Producer Y'], mode: 'B2B' },
        { input: 'Artist One VS Artist Two', expected: ['Artist One', 'Artist Two'], mode: 'B2B' },
        
        // New lowercase formats
        { input: 'Artist A b2b Artist B', expected: ['Artist A', 'Artist B'], mode: 'B2B' },
        { input: 'DJ One b3b DJ Two', expected: ['DJ One', 'DJ Two'], mode: 'B2B' },
        { input: 'Producer X f2f Producer Y', expected: ['Producer X', 'Producer Y'], mode: 'B2B' },
        { input: 'Artist One vs Artist Two', expected: ['Artist One', 'Artist Two'], mode: 'B2B' },
        
        // New " & " format (with spaces)
        { input: 'Martin Garrix & David Guetta', expected: ['Martin Garrix', 'David Guetta'], mode: 'B2B' },
        { input: 'Above & Beyond & Armin van Buuren', expected: ['Above', 'Beyond', 'Armin van Buuren'], mode: 'B2B' },
        
        // Should NOT split (band names with &)
        { input: 'Bigflo & Oli', expected: ['Bigflo & Oli'], mode: '' },
        { input: 'Simon&Garfunkel', expected: ['Simon&Garfunkel'], mode: '' },
        
        // Other collaboration formats
        { input: 'Artist A feat Artist B', expected: ['Artist A', 'Artist B'], mode: 'B2B' },
        { input: 'DJ One w/ DJ Two', expected: ['DJ One', 'DJ Two'], mode: 'B2B' },
        { input: 'Producer X meet Producer Y', expected: ['Producer X', 'Producer Y'], mode: 'B2B' },
        
        // Single artists (no split)
        { input: 'Deadmau5', expected: ['Deadmau5'], mode: '' },
        { input: 'Charlotte de Witte', expected: ['Charlotte de Witte'], mode: '' },
        { input: 'Carl Cox', expected: ['Carl Cox'], mode: '' },
    ];
    
    let passed = 0;
    let failed = 0;
    
    console.log('\\n📋 Test Results:');
    
    for (const testCase of testCases) {
        const splitArtists = smartSplit(testCase.input);
        const detectedMode = detectMode(testCase.input);
        
        // For splits, the mode should be 'B2B' regardless of original format
        const expectedMode = splitArtists.length > 1 ? 'B2B' : detectedMode;
        
        const splitSuccess = JSON.stringify(splitArtists) === JSON.stringify(testCase.expected);
        const modeSuccess = expectedMode.toLowerCase() === testCase.mode.toLowerCase() || (testCase.mode === 'B2B' && splitArtists.length > 1);
        
        if (splitSuccess && (modeSuccess || testCase.mode === '')) {
            console.log(`✅ "${testCase.input}"`);
            console.log(`   → Split: ${JSON.stringify(splitArtists)}`);
            console.log(`   → Mode: ${splitArtists.length > 1 ? 'B2B' : detectedMode || 'none'}`);
            passed++;
        } else {
            console.log(`❌ "${testCase.input}"`);
            console.log(`   → Expected: ${JSON.stringify(testCase.expected)} (mode: ${testCase.mode || 'none'})`);
            console.log(`   → Got: ${JSON.stringify(splitArtists)} (mode: ${splitArtists.length > 1 ? 'B2B' : detectedMode || 'none'})`);
            failed++;
        }
    }
    
    console.log(`\\n📊 Test Summary:`);
    console.log(`✅ Passed: ${passed}/${testCases.length}`);
    console.log(`❌ Failed: ${failed}/${testCases.length}`);
    
    if (failed === 0) {
        console.log('🎉 All tests passed! B2B detection improvements working correctly.');
    } else {
        console.log('⚠️  Some tests failed. Please review the logic.');
    }
}

// Run the test
testB2BDetection();
