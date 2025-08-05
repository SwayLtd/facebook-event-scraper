import { DateTime } from 'luxon';

export function toUtcIso(dateStr, timezone) {
    return DateTime.fromISO(dateStr, { zone: timezone }).toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true });
}

/**
 * Validates and sanitizes a timestamp value for database insertion
 * @param {string|null} timestampValue - The timestamp value to validate
 * @param {string} fieldName - Name of the field for logging purposes  
 * @returns {string|null} Valid ISO timestamp or null if invalid
 */
export function validateTimestamp(timestampValue, fieldName = 'timestamp') {
    // Return null for empty or null values
    if (!timestampValue || timestampValue.trim() === '') {
        return null;
    }
    
    const value = timestampValue.trim();
    
    // Check for obvious duration descriptions that should not be timestamps
    const durationPatterns = [
        /^\d+\s*(hrs?|hours?|min|minutes?|sec|seconds?)\s*(long|duration)?$/i,
        /^\d+:\d+\s*(hrs?|hours?|long|duration)?$/i,
        /^(long|duration|extended|brief|short)\s/i,
        /\b(long|duration|extended|brief|short)$/i
    ];
    
    for (const pattern of durationPatterns) {
        if (pattern.test(value)) {
            console.warn(`⚠️ Detected duration description in ${fieldName}: "${value}" - setting to null`);
            return null;
        }
    }
    
    // Try to parse as ISO timestamp
    try {
        const parsed = DateTime.fromISO(value);
        if (parsed.isValid) {
            return parsed.toISO();
        }
    } catch (error) {
        // Fall through to other validation attempts
    }
    
    // Try to parse as JavaScript Date
    try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }
    } catch (error) {
        // Fall through to rejection
    }
    
    // If we get here, the value is not a valid timestamp
    console.warn(`⚠️ Invalid timestamp format in ${fieldName}: "${value}" - setting to null`);
    return null;
}
