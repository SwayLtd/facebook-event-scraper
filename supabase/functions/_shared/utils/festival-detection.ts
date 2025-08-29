// Festival detection logic pour Edge Functions
// Adaptation complète de la logique de détection JavaScript locale

import { FestivalDetectionResult, FacebookEvent } from '../types/index.ts';
import { calculateDurationHours, now } from './date.ts';
import { logger } from './logger.ts';
import { FESTIVAL_DURATION_THRESHOLD_HOURS } from './constants.ts';

export interface FestivalDetectionOptions {
  forceFestival?: boolean;
  customThreshold?: number;
}

export interface FestivalDay {
  name: string;
  start: string;
  end: string;
}

/**
 * Detects if an event is a festival based on duration (>24h) and other criteria
 * @param eventData - Facebook event data with start_time and end_time
 * @param options - Detection options including forceFestival flag
 * @returns Detection result with confidence score and details
 */
export function detectFestival(
  eventData: Partial<FacebookEvent>, 
  options: FestivalDetectionOptions = {}
): FestivalDetectionResult {
  const { forceFestival = false, customThreshold } = options;
  const durationThreshold = customThreshold || FESTIVAL_DURATION_THRESHOLD_HOURS;
  
  const result: FestivalDetectionResult = {
    is_festival: false,
    duration_hours: 0,
    confidence: 0,
    reasons: [],
    metadata: {
      start_time: eventData.start_time || '',
      end_time: eventData.end_time,
      calculated_duration: 0,
      threshold_used: durationThreshold
    }
  };

  if (!eventData) {
    result.reasons.push('No event data provided');
    return result;
  }

  logger.debug('Starting festival detection', {
    eventName: eventData.name,
    startTime: eventData.start_time,
    endTime: eventData.end_time,
    forceFestival
  });

  // If festival mode is forced, set high confidence
  if (forceFestival) {
    result.is_festival = true;
    result.confidence = 95;
    result.reasons.push('Festival mode FORCED by options flag');
  }

  // Known festivals list (case-insensitive matching)
  const knownFestivals = [
    'let it roll', 'tomorrowland', 'ultra', 'coachella', 'burning man',
    'glastonbury', 'lollapalooza', 'bonnaroo', 'electric daisy carnival',
    'edc', 'defqon', 'qlimax', 'mysteryland', 'awakenings', 'dour',
    'rock werchter', 'pukkelpop', 'graspop', 'rampage', 'rampage open air',
    'nature one', 'love parade', 'fusion', 'boom festival', 'ozora',
    'psytrance', 'hadra', 'antaris', 'voov', 'garbicz', 'fusion festival',
    'timewarp', 'time warp', 'sonar', 'movement', 'dekmantel', 'kappa futur',
    'awakenings festival', 'dour festival', 'rampage weekend'
  ];

  // Check if event name matches known festivals
  const eventName = eventData.name || '';
  const eventNameLower = eventName.toLowerCase();
  
  for (const festivalName of knownFestivals) {
    if (eventNameLower.includes(festivalName)) {
      if (!forceFestival) { // Don't override forced mode
        result.is_festival = true;
        result.confidence = Math.max(result.confidence, 85);
      }
      result.reasons.push(`Known festival detected: "${festivalName}"`);
      break;
    }
  }

  // Check if we have valid timestamps for duration calculation
  if (!eventData.start_time) {
    if (!result.is_festival) {
      result.reasons.push('Missing start timestamp - unable to calculate duration');
    }
    return result;
  }

  // Calculate duration if end time is available
  if (eventData.end_time) {
    const durationHours = calculateDurationHours(eventData.start_time, eventData.end_time);
    
    if (durationHours !== null) {
      result.duration_hours = durationHours;
      result.metadata!.calculated_duration = durationHours;

      // Primary criterion: Duration > threshold hours
      if (durationHours > durationThreshold) {
        result.is_festival = true;
        result.confidence += 70; // High confidence for duration
        result.reasons.push(`Duration: ${durationHours.toFixed(1)}h (>${durationThreshold}h threshold)`);
      } else {
        result.reasons.push(`Duration: ${durationHours.toFixed(1)}h (<${durationThreshold}h threshold)`);
      }
    }
  } else {
    result.reasons.push('Missing end timestamp - unable to calculate duration');
  }

  // Secondary criteria for confidence boosting
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

  // Check for stage/venue diversity
  if (eventData.place?.name) {
    const locationName = eventData.place.name.toLowerCase();
    const venueKeywords = ['park', 'field', 'grounds', 'complex', 'site', 'terrain'];
    
    if (venueKeywords.some(keyword => locationName.includes(keyword))) {
      result.confidence += 5;
      result.reasons.push('Festival-type venue detected');
    }
  }

  // Ensure confidence doesn't exceed 100
  result.confidence = Math.min(result.confidence, 100);

  logger.info('Festival detection completed', {
    eventName: eventData.name,
    isFestival: result.is_festival,
    confidence: result.confidence,
    durationHours: result.duration_hours,
    reasons: result.reasons.length
  });

  return result;
}

/**
 * Extracts a clean festival name for searching in external services
 * @param eventName - Original event name
 * @returns Cleaned festival name
 */
export function extractFestivalName(eventName: string | undefined): string {
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
    
    // Add weekend indicator at the end for better matching
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
 * Analyzes festival days from event duration
 * @param eventData - Facebook event data
 * @returns Array of estimated festival days
 */
export function analyzeFestivalDays(eventData: Partial<FacebookEvent>): FestivalDay[] {
  if (!eventData.start_time || !eventData.end_time) {
    return [];
  }

  const startTime = new Date(eventData.start_time);
  const endTime = new Date(eventData.end_time);
  
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  
  if (durationHours <= 24) {
    // Single day event
    return [{
      name: 'Day 1',
      start: startTime.toISOString(),
      end: endTime.toISOString()
    }];
  }

  // Multi-day event - create estimated days
  const days: FestivalDay[] = [];
  let currentStart = new Date(startTime);
  let dayNumber = 1;

  while (currentStart < endTime) {
    // Calculate day end (next day at 7 AM or actual end time, whichever is earlier)
    const nextDayAt7AM = new Date(currentStart);
    nextDayAt7AM.setDate(nextDayAt7AM.getDate() + 1);
    nextDayAt7AM.setHours(7, 0, 0, 0);
    
    const dayEnd = nextDayAt7AM < endTime ? nextDayAt7AM : new Date(endTime);

    days.push({
      name: `Day ${dayNumber}`,
      start: currentStart.toISOString(),
      end: dayEnd.toISOString()
    });

    // Next day typically starts at 8 PM
    currentStart = new Date(dayEnd);
    currentStart.setDate(currentStart.getDate());
    currentStart.setHours(20, 0, 0, 0);
    dayNumber++;

    // Safety check to prevent infinite loops
    if (dayNumber > 10) break;
  }

  return days;
}

/**
 * Validates festival detection confidence
 * @param confidence - Confidence score 0-100
 * @returns Confidence level description
 */
export function getConfidenceLevel(confidence: number): string {
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
