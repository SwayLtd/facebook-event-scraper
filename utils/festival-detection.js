// utils/festival-detection.js
// Festival detection logic based on event duration and other criteria

import { DateTime } from 'luxon';

/**
 * Detects if an event is a festival based on duration (>24h) and other criteria
 * @param {object} eventData - Facebook event data with startTimestamp and endTimestamp
 * @returns {object} Detection result with confidence score and details
 */
export function detectFestival(eventData) {
    const result = {
        isFestival: false,
        confidence: 0,
        reasons: [],
        duration: null,
        festivalName: null
    };

    if (!eventData) {
        result.reasons.push('No event data provided');
        return result;
    }

    // Check if we have valid timestamps
    if (!eventData.startTimestamp || !eventData.endTimestamp) {
        result.reasons.push('Missing start or end timestamp');
        return result;
    }

    // Calculate duration
    const startTime = DateTime.fromSeconds(eventData.startTimestamp);
    const endTime = DateTime.fromSeconds(eventData.endTimestamp);
    const durationHours = endTime.diff(startTime, 'hours').hours;
    
    result.duration = {
        hours: durationHours,
        days: Math.floor(durationHours / 24),
        startTime: startTime.toISO(),
        endTime: endTime.toISO()
    };

    // Primary criterion: Duration > 24 hours
    if (durationHours > 24) {
        result.isFestival = true;
        result.confidence += 70; // High confidence for duration
        result.reasons.push(`Duration: ${durationHours.toFixed(1)}h (>${24}h threshold)`);
    } else {
        result.reasons.push(`Duration: ${durationHours.toFixed(1)}h (<${24}h threshold)`);
    }

    // Secondary criteria for confidence boosting
    const eventName = eventData.name || '';
    const eventDescription = eventData.description || '';
    const combinedText = `${eventName} ${eventDescription}`.toLowerCase();

    // Festival-like keywords in name/description
    const festivalKeywords = [
        'festival', 'fest', 'open air', 'openair', 'rave', 
        'gathering', 'weekender', 'marathon', 'edition',
        'day 1', 'day 2', 'jour 1', 'jour 2', 'stage',
        'lineup', 'timetable', 'horaire', 'programme'
    ];

    const foundKeywords = festivalKeywords.filter(keyword => 
        combinedText.includes(keyword)
    );

    if (foundKeywords.length > 0) {
        result.confidence += Math.min(foundKeywords.length * 5, 20); // Max 20 points
        result.reasons.push(`Festival keywords found: ${foundKeywords.join(', ')}`);
    }

    // Multi-day indicators
    const multiDayKeywords = [
        '2 days', '3 days', '4 days', '2 jours', '3 jours', '4 jours',
        'weekend', 'multiple days', 'plusieurs jours'
    ];

    const foundMultiDay = multiDayKeywords.filter(keyword => 
        combinedText.includes(keyword)
    );

    if (foundMultiDay.length > 0) {
        result.confidence += 10;
        result.reasons.push(`Multi-day indicators: ${foundMultiDay.join(', ')}`);
    }

    // Check for stage/venue diversity (if location data available)
    if (eventData.location && eventData.location.name) {
        const locationName = eventData.location.name.toLowerCase();
        const venueKeywords = ['park', 'field', 'grounds', 'complex', 'site', 'terrain'];
        
        if (venueKeywords.some(keyword => locationName.includes(keyword))) {
            result.confidence += 5;
            result.reasons.push('Festival-type venue detected');
        }
    }

    // Extract potential festival name for Clashfinder search
    result.festivalName = extractFestivalName(eventName);

    // Ensure confidence doesn't exceed 100
    result.confidence = Math.min(result.confidence, 100);

    return result;
}

/**
 * Extracts a clean festival name for searching in Clashfinder
 * @param {string} eventName - Original event name
 * @returns {string} Cleaned festival name
 */
export function extractFestivalName(eventName) {
    if (!eventName) return '';

    let cleanName = eventName.trim();

    // Preserve important weekend/day indicators before other cleaning
    const weekendPattern = /\b(weekend\s*\d+|w\d+)\b/gi;
    const weekendMatches = cleanName.match(weekendPattern);
    
    // Remove common year patterns
    cleanName = cleanName.replace(/\b20\d{2}\b/g, '').trim();

    // Remove edition indicators (but preserve weekend/day info)
    cleanName = cleanName.replace(/\b\d+(st|nd|rd|th)?\s*(edition|ed\.?)\b/gi, '').trim();

    // Remove generic day indicators (but preserve weekend X)
    cleanName = cleanName.replace(/\b(day|jour)\s*\d+\b/gi, '').trim();

    // Remove time indicators
    cleanName = cleanName.replace(/\b\d{1,2}(h|:)\d{0,2}\b/g, '').trim();

    // Remove common prefixes/suffixes
    const cleanupPatterns = [
        /^(the\s+)/i,
        /\s+(festival|fest|rave|party|event)$/i,
        /\s*-\s*(official|officiel)\s*/i,
        /\s*\|\s*.*/,  // Remove everything after |
        /\s*\(\s*.*\s*\)\s*/,  // Remove content in parentheses
        /\s*-\s*$/,  // Remove trailing dash
        /^\s*-\s*/,  // Remove leading dash
    ];

    cleanupPatterns.forEach(pattern => {
        cleanName = cleanName.replace(pattern, '').trim();
    });

    // Restore weekend indicators if they were removed and rearrange optimally
    if (weekendMatches && weekendMatches.length > 0) {
        // Remove any existing weekend indicators from current position
        cleanName = cleanName.replace(weekendPattern, '').trim();
        
        // Add weekend indicator at the end for better Clashfinder matching
        const weekendInfo = weekendMatches[0];
        cleanName = `${cleanName} ${weekendInfo}`.trim();
    }

    // Remove extra whitespace and normalize
    cleanName = cleanName.replace(/\s+/g, ' ').trim();
    
    // Remove trailing/leading punctuation
    cleanName = cleanName.replace(/^[^\w]+|[^\w]+$/g, '');

    return cleanName;
}

/**
 * Analyzes festival days from event duration (simplified version)
 * @param {object} eventData - Facebook event data
 * @param {string} timezone - Timezone for analysis (default: 'Europe/Brussels')
 * @returns {Array} Array of estimated festival days
 */
export function analyzeFestivalDays(eventData, timezone = 'Europe/Brussels') {
    if (!eventData.startTimestamp || !eventData.endTimestamp) {
        return [];
    }

    const startTime = DateTime.fromSeconds(eventData.startTimestamp, { zone: timezone });
    const endTime = DateTime.fromSeconds(eventData.endTimestamp, { zone: timezone });
    
    const durationHours = endTime.diff(startTime, 'hours').hours;
    
    if (durationHours <= 24) {
        // Single day event
        return [{
            name: 'Day 1',
            start: startTime.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
            end: endTime.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
        }];
    }

    // Multi-day event - create estimated days
    const days = [];
    let currentStart = startTime;
    let dayNumber = 1;

    while (currentStart < endTime) {
        const dayEnd = DateTime.min(
            currentStart.plus({ days: 1 }).startOf('day').plus({ hours: 7 }), // Typical festival end time
            endTime
        );

        days.push({
            name: `Day ${dayNumber}`,
            start: currentStart.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
            end: dayEnd.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
        });

        // Next day typically starts in the evening
        currentStart = dayEnd.startOf('day').plus({ hours: 20 });
        dayNumber++;

        // Safety check to prevent infinite loops
        if (dayNumber > 10) break;
    }

    return days;
}

/**
 * Validates festival detection confidence
 * @param {number} confidence - Confidence score 0-100
 * @returns {string} Confidence level description
 */
export function getConfidenceLevel(confidence) {
    if (confidence >= 80) return 'very_high';
    if (confidence >= 60) return 'high';
    if (confidence >= 40) return 'medium';
    if (confidence >= 20) return 'low';
    return 'very_low';
}

export default {
    detectFestival,
    extractFestivalName,
    analyzeFestivalDays,
    getConfidenceLevel
};
