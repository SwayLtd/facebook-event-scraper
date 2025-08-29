// Date utilities pour Edge Functions Supabase
// Adaptation des utilitaires de date JavaScript locaux

/**
 * Validates and sanitizes a timestamp value for database insertion
 * @param timestampValue - The timestamp value to validate
 * @param fieldName - Name of the field for logging purposes  
 * @returns Valid ISO timestamp or null if invalid
 */
export function validateTimestamp(timestampValue: string | null | undefined, fieldName = 'timestamp'): string | null {
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
  
  // Try to parse as JavaScript Date first (more compatible)
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

/**
 * Convert a date string to UTC ISO format
 * @param dateStr - Date string to convert
 * @param timezone - Source timezone (optional, defaults to UTC)
 * @returns UTC ISO string
 */
export function toUtcIso(dateStr: string, timezone?: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  
  return date.toISOString();
}

/**
 * Calculate duration between two dates in hours
 * @param startTime - Start time ISO string
 * @param endTime - End time ISO string
 * @returns Duration in hours, or null if invalid
 */
export function calculateDurationHours(startTime: string, endTime: string): number | null {
  try {
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return null;
    }
    
    if (end <= start) {
      return null;
    }
    
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    return Math.round(diffHours * 100) / 100; // Round to 2 decimal places
  } catch {
    return null;
  }
}

/**
 * Check if a date is in the past
 * @param dateStr - Date string to check
 * @returns True if date is in the past
 */
export function isInPast(dateStr: string): boolean {
  try {
    const date = new Date(dateStr);
    return date.getTime() < Date.now();
  } catch {
    return false;
  }
}

/**
 * Format date for display
 * @param dateStr - Date string to format
 * @returns Formatted date string
 */
export function formatDisplayDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Get current timestamp as ISO string
 * @returns Current timestamp in ISO format
 */
export function now(): string {
  return new Date().toISOString();
}

export default {
  validateTimestamp,
  toUtcIso,
  calculateDurationHours,
  isInPast,
  formatDisplayDate,
  now
};
