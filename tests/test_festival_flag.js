#!/usr/bin/env node

// Test for --festival flag functionality
import { detectFestival } from '../utils/festival-detection.js';

console.log('🧪 Testing festival detection with --festival flag\n');

// Test data for event without end date (like Let It Roll 2025)
const eventWithoutEndDate = {
    name: "Test Event Without End Date",
    description: "A regular event with no end time",
    startTimestamp: 1722441600, // July 31, 2025 14:00 UTC
    endTimestamp: null // No end date
};

// Test data for known festival
const letItRollEvent = {
    name: "Let It Roll 2025",
    description: "The biggest drum & bass festival",
    startTimestamp: 1722441600,
    endTimestamp: null
};

// Test 1: Regular event without --festival flag
console.log('📋 Test 1: Regular event without --festival flag');
const result1 = detectFestival(eventWithoutEndDate);
console.log(`Result: ${result1.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (${result1.confidence}%)`);
console.log(`Reasons: ${result1.reasons.join(', ')}\n`);

// Test 2: Regular event WITH --festival flag
console.log('📋 Test 2: Regular event WITH --festival flag');
const result2 = detectFestival(eventWithoutEndDate, { forceFestival: true });
console.log(`Result: ${result2.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (${result2.confidence}%)`);
console.log(`Reasons: ${result2.reasons.join(', ')}\n`);

// Test 3: Known festival without --festival flag
console.log('📋 Test 3: Known festival without --festival flag');
const result3 = detectFestival(letItRollEvent);
console.log(`Result: ${result3.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (${result3.confidence}%)`);
console.log(`Reasons: ${result3.reasons.join(', ')}\n`);

// Test 4: Known festival WITH --festival flag
console.log('📋 Test 4: Known festival WITH --festival flag');
const result4 = detectFestival(letItRollEvent, { forceFestival: true });
console.log(`Result: ${result4.isFestival ? 'FESTIVAL' : 'SIMPLE EVENT'} (${result4.confidence}%)`);
console.log(`Reasons: ${result4.reasons.join(', ')}\n`);

console.log('✅ All tests completed!');
