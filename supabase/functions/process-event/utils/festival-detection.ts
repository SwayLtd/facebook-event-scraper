/**
 * utils/festival-detection.ts
 * 
 * Festival detection logic based on event duration and other criteria
 * Ported from original Node.js utils/festival-detection.js to Deno/TypeScript
 */

import { KNOWN_FESTIVALS } from './constants.ts';

/**
 * Festival detection result
 */
export interface FestivalDetectionResult {
    isFestival: boolean;
    confidence: number;
    reasons: string[];
    duration: number | null;
    festivalName: string | null;
}

/**
 * Detection options
 */
export interface DetectionOptions {
    forceFestival?: boolean;
    minDurationHours?: number;
    confidenceThreshold?: number;
}

/**
 * Event data for detection
 */
export interface EventData {
    name: string;
    startTimestamp?: number;
    endTimestamp?: number;
    start_time?: string;
    end_time?: string;
    description?: string;
}

/**
 * Detects if an event is a festival based on duration and other criteria
 */
export function detectFestival(
    eventData: EventData, 
    options: DetectionOptions = {}
): FestivalDetectionResult {
    const { 
        forceFestival = false, 
        minDurationHours = 24,
        confidenceThreshold = 70 
    } = options;
    
    const result: FestivalDetectionResult = {
        isFestival: false,
        confidence: 0,
        reasons: [],
        duration: null,
        festivalName: null
    };

    if (!eventData || !eventData.name) {
        result.reasons.push('No event data or name provided');
        return result;
    }

    // If festival mode is forced, set high confidence
    if (forceFestival) {
        result.isFestival = true;
        result.confidence = 95;
        result.reasons.push('Festival mode FORCED by --festival flag');
        return result;
    }

    const eventName = eventData.name.toLowerCase().trim();
    let confidence = 0;

    // 1. Check for known festival names
    const matchedFestival = checkKnownFestival(eventName);
    if (matchedFestival) {
        confidence += 40;
        result.festivalName = matchedFestival;
        result.reasons.push(`Matches known festival: "${matchedFestival}"`);
    }

    // 2. Check event duration
    const duration = calculateEventDuration(eventData);
    result.duration = duration;
    
    if (duration !== null) {
        if (duration >= minDurationHours) {
            const durationScore = Math.min(30, Math.floor(duration / 24) * 10);
            confidence += durationScore;
            result.reasons.push(`Long duration: ${duration.toFixed(1)} hours (+${durationScore} confidence)`);
        } else {
            result.reasons.push(`Short duration: ${duration.toFixed(1)} hours (no bonus)`);
        }
    } else {
        result.reasons.push('Duration could not be determined');
    }

    // 3. Check event name patterns for festival indicators
    const nameScore = checkFestivalNamePatterns(eventName);
    if (nameScore > 0) {
        confidence += nameScore;
        result.reasons.push(`Festival name patterns detected (+${nameScore} confidence)`);
    }

    // 4. Check description for festival indicators
    if (eventData.description) {
        const descScore = checkDescriptionPatterns(eventData.description);
        if (descScore > 0) {
            confidence += descScore;
            result.reasons.push(`Festival description patterns detected (+${descScore} confidence)`);
        }
    }

    // 5. Final determination
    result.confidence = Math.min(100, confidence);
    result.isFestival = result.confidence >= confidenceThreshold;

    if (result.isFestival) {
        result.reasons.push(`DETECTED AS FESTIVAL (confidence: ${result.confidence}%)`);
    } else {
        result.reasons.push(`Not detected as festival (confidence: ${result.confidence}% < ${confidenceThreshold}%)`);
    }

    return result;
}

/**
 * Check if event name matches known festivals
 */
function checkKnownFestival(eventName: string): string | null {
    for (const festivalName of KNOWN_FESTIVALS) {
        if (eventName.includes(festivalName.toLowerCase())) {
            return festivalName;
        }
    }
    return null;
}

/**
 * Calculate event duration in hours
 */
function calculateEventDuration(eventData: EventData): number | null {
    let startTime: number | null = null;
    let endTime: number | null = null;

    // Try timestamp fields first
    if (eventData.startTimestamp && eventData.endTimestamp) {
        startTime = eventData.startTimestamp * 1000; // Convert to milliseconds
        endTime = eventData.endTimestamp * 1000;
    }
    // Try ISO string fields
    else if (eventData.start_time && eventData.end_time) {
        try {
            startTime = new Date(eventData.start_time).getTime();
            endTime = new Date(eventData.end_time).getTime();
        } catch (error) {
            console.warn('Error parsing date strings:', error);
        }
    }

    if (startTime && endTime && endTime > startTime) {
        const durationMs = endTime - startTime;
        return durationMs / (1000 * 60 * 60); // Convert to hours
    }

    return null;
}

/**
 * Check for festival-related patterns in event name
 */
function checkFestivalNamePatterns(eventName: string): number {
    let score = 0;
    
    // Festival keywords
    const festivalKeywords = [
        'festival', 'fest', 'gathering', 'conference', 'summit',
        'experience', 'weekend', 'celebration', 'carnival'
    ];
    
    for (const keyword of festivalKeywords) {
        if (eventName.includes(keyword)) {
            score += keyword === 'festival' ? 15 : 10;
            break; // Only count one festival keyword
        }
    }

    // Multi-day indicators
    const multiDayPatterns = [
        /\d+\s*days?/, // "3 days", "2-day"
        /day\s*\d+/, // "day 1", "day 2" 
        /\d+\s*-\s*\d+/, // "2-4", "1-3"
        /(weekend|week-end)/
    ];

    for (const pattern of multiDayPatterns) {
        if (pattern.test(eventName)) {
            score += 10;
            break; // Only count one multi-day pattern
        }
    }

    // Year indicators (often used in festival names)
    if (/20\d{2}/.test(eventName)) {
        score += 5;
    }

    // Edition numbers
    if (/\d+(th|st|nd|rd)\s*(edition|annual)/.test(eventName)) {
        score += 10;
    }

    return score;
}

/**
 * Check for festival-related patterns in description
 */
function checkDescriptionPatterns(description: string): number {
    let score = 0;
    const descLower = description.toLowerCase();
    
    // Festival-specific terms
    const festivalTerms = [
        'lineup', 'stages', 'multiple stages', 'main stage',
        'camping', 'campsite', 'accommodation', 'tickets',
        'multi-day', 'weekend', 'festival', 'experience',
        'artists', 'performers', 'headliners'
    ];

    let termCount = 0;
    for (const term of festivalTerms) {
        if (descLower.includes(term)) {
            termCount++;
        }
    }

    // Score based on number of festival terms
    if (termCount >= 3) {
        score += 15;
    } else if (termCount >= 2) {
        score += 10;
    } else if (termCount >= 1) {
        score += 5;
    }

    // Specific high-value patterns
    if (descLower.includes('lineup') || descLower.includes('stages')) {
        score += 10;
    }

    if (descLower.includes('camping') || descLower.includes('accommodation')) {
        score += 8;
    }

    return Math.min(20, score); // Cap description score
}

/**
 * Get festival name suggestions based on event name
 */
export function suggestFestivalName(eventName: string): string[] {
    const suggestions: string[] = [];
    const eventLower = eventName.toLowerCase();

    // Check partial matches with known festivals
    for (const festival of KNOWN_FESTIVALS) {
        const festivalWords = festival.toLowerCase().split(' ');
        const eventWords = eventLower.split(' ');
        
        let matchCount = 0;
        for (const festivalWord of festivalWords) {
            if (eventWords.some(eventWord => 
                eventWord.includes(festivalWord) || festivalWord.includes(eventWord)
            )) {
                matchCount++;
            }
        }
        
        // If at least half the festival words match
        if (matchCount >= Math.ceil(festivalWords.length / 2)) {
            suggestions.push(festival);
        }
    }

    return suggestions;
}

/**
 * Validate festival detection result
 */
export function validateDetectionResult(result: FestivalDetectionResult): {
    isValid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];
    let isValid = true;

    // Check confidence level
    if (result.confidence < 0 || result.confidence > 100) {
        warnings.push('Confidence score is out of range (0-100)');
        isValid = false;
    }

    // Check duration reasonableness
    if (result.duration !== null) {
        if (result.duration < 0) {
            warnings.push('Event duration is negative');
            isValid = false;
        } else if (result.duration > 24 * 7) { // More than a week
            warnings.push('Event duration is unusually long (>1 week)');
        }
    }

    // Check consistency
    if (result.isFestival && result.confidence < 50) {
        warnings.push('Marked as festival but confidence is below 50%');
    }

    if (!result.isFestival && result.confidence > 80) {
        warnings.push('Not marked as festival but confidence is above 80%');
    }

    // Check reasons
    if (result.reasons.length === 0) {
        warnings.push('No detection reasons provided');
        isValid = false;
    }

    return { isValid, warnings };
}

/**
 * Get detailed festival analysis report
 */
export function getFestivalAnalysisReport(eventData: EventData, options: DetectionOptions = {}): string {
    const result = detectFestival(eventData, options);
    const validation = validateDetectionResult(result);
    
    let report = `FESTIVAL DETECTION ANALYSIS\n`;
    report += `==========================\n\n`;
    report += `Event: "${eventData.name}"\n`;
    report += `Result: ${result.isFestival ? 'FESTIVAL' : 'NOT FESTIVAL'}\n`;
    report += `Confidence: ${result.confidence}%\n\n`;
    
    if (result.duration !== null) {
        report += `Duration: ${result.duration.toFixed(1)} hours\n`;
    }
    
    if (result.festivalName) {
        report += `Matched Festival: ${result.festivalName}\n`;
    }
    
    report += `\nDetection Reasons:\n`;
    for (const reason of result.reasons) {
        report += `- ${reason}\n`;
    }
    
    if (validation.warnings.length > 0) {
        report += `\nValidation Warnings:\n`;
        for (const warning of validation.warnings) {
            report += `⚠️  ${warning}\n`;
        }
    }
    
    const suggestions = suggestFestivalName(eventData.name);
    if (suggestions.length > 0) {
        report += `\nSimilar Known Festivals:\n`;
        for (const suggestion of suggestions) {
            report += `- ${suggestion}\n`;
        }
    }
    
    return report;
}
