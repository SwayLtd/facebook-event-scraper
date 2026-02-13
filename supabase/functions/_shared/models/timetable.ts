// Timetable model pour Edge Functions
// Adaptation complète du modèle timetable JavaScript local

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { EventArtist } from '../types/index.ts';

// NOTE: This model references 'event_artist' table (not 'timetables' which does not exist).
// The EventArtist type replaces the old Timetable type.
// This module is currently not imported/used by process-event.
type Timetable = EventArtist;

// Luxon alternative using native Date for timezone handling
interface ParsedDateTime {
  toUTC(): { toISO(options?: { suppressSeconds?: boolean; suppressMilliseconds?: boolean }): string };
  diff(other: ParsedDateTime, unit: 'hours'): { hours: number };
}

class SimpleDateTime {
  private date: Date;

  constructor(dateStr: string, timezone = 'Europe/Brussels') {
    // Simple timezone offset handling (Brussels = UTC+1/+2)
    const utcDate = new Date(dateStr);
    this.date = utcDate;
  }

  static fromISO(dateStr: string, options?: { zone?: string }): SimpleDateTime {
    return new SimpleDateTime(dateStr, options?.zone);
  }

  toUTC() {
    return {
      toISO: (options?: { suppressSeconds?: boolean; suppressMilliseconds?: boolean }) => {
        let iso = this.date.toISOString();
        if (options?.suppressSeconds || options?.suppressMilliseconds) {
          iso = iso.split('.')[0] + 'Z';
        }
        return iso;
      }
    };
  }

  diff(other: SimpleDateTime, unit: 'hours') {
    const diffMs = this.date.getTime() - other.date.getTime();
    return { hours: diffMs / (1000 * 60 * 60) };
  }

  static compare(a: SimpleDateTime, b: SimpleDateTime): number {
    return a.date.getTime() - b.date.getTime();
  }
}

export interface PerformanceData {
  name: string;
  stage?: string;
  time?: string;
  end_time?: string;
  performance_mode?: string;
  soundcloud?: string;
  [key: string]: any;
}

export interface StageInfo {
  name: string;
}

export interface FestivalDay {
  name: string;
  start: string;
  end: string;
}

export interface TimetableStatistics {
  uniqueArtists: Set<string>;
  artistPerformances: Record<string, PerformanceData[]>;
  stagesSet: Set<string>;
  performanceModes: Set<string>;
  timeSlots: Record<string, number>;
  withSoundCloud: number;
  totalPerformances: number;
}

/**
 * Groups performances by time slot and stage for B2B detection
 * @param jsonData - Array of performance objects
 * @returns Array of grouped performances
 */
export function groupPerformancesForB2B(jsonData: PerformanceData[]): PerformanceData[][] {
  logger.debug(`Grouping ${jsonData.length} performances for B2B detection`);

  // Key: stage|time|end_time|performance_mode
  const groups: Record<string, PerformanceData[]> = {};
  
  for (const perf of jsonData) {
    if (!perf.name || !perf.stage || !perf.time || !perf.end_time) continue;
    
    const key = `${perf.stage}|${perf.time}|${perf.end_time}|${perf.performance_mode || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(perf);
  }

  const groupedPerformances = Object.values(groups);
  logger.info(`Created ${groupedPerformances.length} performance groups for B2B detection`);
  
  return groupedPerformances;
}

/**
 * Extracts unique stages and festival days from performances
 * @param performances - Array of performance objects
 * @param timezone - Timezone for date calculations (default: 'Europe/Brussels')
 * @returns Object with stages and festival_days arrays
 */
export function extractStagesAndDaysFromPerformances(
  performances: PerformanceData[],
  timezone = 'Europe/Brussels'
): { stages: StageInfo[]; festival_days: FestivalDay[] } {
  logger.debug(`Extracting stages and days from ${performances.length} performances`);

  // Extract unique stages
  const stagesSet = new Set<string>();
  performances.forEach(p => {
    if (p.stage && p.stage.trim() !== "") {
      stagesSet.add(p.stage.trim());
    }
  });
  
  const stages: StageInfo[] = Array.from(stagesSet).map(name => ({ name }));
  logger.info(`Found ${stages.length} unique stages: ${stages.map(s => s.name).join(', ')}`);

  // Automatic detection of effective days with timezone management
  function parseInZone(dateStr: string): SimpleDateTime {
    return SimpleDateTime.fromISO(dateStr, { zone: timezone });
  }
  
  const slots = performances
    .filter(p => p.time && p.end_time)
    .map(p => ({
      start: parseInZone(p.time!),
      end: parseInZone(p.end_time!),
      raw: p
    }))
    .sort((a, b) => SimpleDateTime.compare(a.start, b.start));
  
  const festival_days: FestivalDay[] = [];
  
  if (slots.length > 0) {
    let currentDay: typeof slots = [];
    let lastEnd: SimpleDateTime | null = null;
    let dayIdx = 1;
    const MAX_GAP_HOURS = 4;
    
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      
      if (lastEnd) {
        const gap = slot.start.diff(lastEnd, 'hours').hours;
        if (gap > MAX_GAP_HOURS) {
          // End current day and start new one
          festival_days.push({
            name: `Day ${dayIdx}`,
            start: currentDay[0].start.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
            end: currentDay[currentDay.length - 1].end.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
          });
          dayIdx++;
          currentDay = [];
        }
      }
      
      currentDay.push(slot);
      lastEnd = slot.end;
    }
    
    // Add the last day
    if (currentDay.length > 0) {
      festival_days.push({
        name: `Day ${dayIdx}`,
        start: currentDay[0].start.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true }),
        end: currentDay[currentDay.length - 1].end.toUTC().toISO({ suppressSeconds: true, suppressMilliseconds: true })
      });
    }
  }

  logger.info(`Detected ${festival_days.length} festival days`);
  festival_days.forEach(day => {
    logger.debug(`${day.name}: ${day.start} → ${day.end}`);
  });

  return { stages, festival_days };
}

/**
 * Generates comprehensive statistics from timetable data
 * @param jsonData - Array of performance objects
 * @returns Statistics object with detailed analysis
 */
export function generateTimetableStatistics(jsonData: PerformanceData[]): TimetableStatistics {
  logger.debug(`Generating statistics for ${jsonData.length} performances`);

  const uniqueArtists = new Set<string>();
  const artistPerformances: Record<string, PerformanceData[]> = {};
  const stagesSet = new Set<string>();
  const performanceModes = new Set<string>();
  const timeSlots: Record<string, number> = {};
  let withSoundCloud = 0;

  // Fill stats from raw JSON (before B2B processing)
  for (const perf of jsonData) {
    const artistName = perf.name.trim();
    uniqueArtists.add(artistName);
    
    if (!artistPerformances[artistName]) {
      artistPerformances[artistName] = [];
    }
    artistPerformances[artistName].push(perf);
    
    if (perf.stage) stagesSet.add(perf.stage);
    if (perf.performance_mode) performanceModes.add(perf.performance_mode);
    
    if (perf.time) {
      const hour = perf.time.split(':')[0];
      timeSlots[hour] = (timeSlots[hour] || 0) + 1;
    }
    
    if (perf.soundcloud && perf.soundcloud.trim()) {
      withSoundCloud++;
    }
  }

  const stats: TimetableStatistics = {
    uniqueArtists,
    artistPerformances,
    stagesSet,
    performanceModes,
    timeSlots,
    withSoundCloud,
    totalPerformances: jsonData.length
  };

  logger.info(`Statistics: ${stats.totalPerformances} performances, ${stats.uniqueArtists.size} unique artists, ${stats.stagesSet.size} stages`);
  
  return stats;
}

/**
 * Logs detailed timetable statistics in a formatted way
 * @param stats - Statistics object from generateTimetableStatistics
 */
export function logTimetableStatistics(stats: TimetableStatistics): void {
  const {
    uniqueArtists,
    artistPerformances,
    stagesSet,
    performanceModes,
    timeSlots,
    withSoundCloud,
    totalPerformances
  } = stats;

  logger.info(`\n📊 Detailed statistics:`);
  logger.info(`   Total performances: ${totalPerformances}`);
  logger.info(`   Unique artists: ${uniqueArtists.size}`);
  logger.info(`   With SoundCloud links: ${withSoundCloud}`);
  
  // Stages
  logger.info(`\n🎪 Stages (${stagesSet.size}):`);
  Array.from(stagesSet).sort().forEach(stage => {
    const count = Object.values(artistPerformances)
      .flat()
      .filter(p => p.stage === stage).length;
    logger.info(`   • ${stage}: ${count} performances`);
  });
  
  // Performance modes
  if (performanceModes.size > 0) {
    logger.info(`\n🎭 Performance modes:`);
    Array.from(performanceModes).forEach(mode => {
      const count = Object.values(artistPerformances)
        .flat()
        .filter(p => p.performance_mode === mode).length;
      logger.info(`   • ${mode}: ${count} performances`);
    });
  }
  
  // Artists with multiple performances
  const multiplePerformances = Object.entries(artistPerformances)
    .filter(([, performances]) => performances.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  
  if (multiplePerformances.length > 0) {
    logger.info(`\n🔄 Artists with multiple performances (${multiplePerformances.length}):`);
    multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
      logger.info(`   • ${artist}: ${performances.length} performances`);
      performances.forEach(p => {
        logger.debug(`     - ${p.stage} at ${p.time} (${p.end_time})`);
      });
    });
    if (multiplePerformances.length > 10) {
      logger.info(`   ... and ${multiplePerformances.length - 10} others`);
    }
  }
  
  // Distribution by hour
  logger.info(`\n⏰ Distribution by hour:`);
  Object.entries(timeSlots)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([hour, count]) => {
      const bar = '█'.repeat(Math.ceil(count / 2));
      logger.info(`   ${hour}h: ${count.toString().padStart(2)} ${bar}`);
    });
}

/**
 * Creates or updates timetable entries for an event
 * @param eventId - Event ID
 * @param performances - Array of performance data
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with array of created/updated timetable entries
 */
export async function createTimetableEntries(
  eventId: number,
  performances: PerformanceData[],
  dryRun = false
): Promise<Timetable[]> {
  logger.info(`Creating ${performances.length} timetable entries for event ${eventId}`);

  if (dryRun) {
    logger.info(`[DRY_RUN] Would have created ${performances.length} timetable entries`);
    return performances.map((perf, index) => ({
      id: 999999 + index,
      event_id: eventId,
      artist_id: 999999 + index,
      start_time: perf.time || new Date().toISOString(),
      end_time: perf.end_time,
      stage: perf.stage
    } as Timetable));
  }

  const createdEntries: Timetable[] = [];

  for (const performance of performances) {
    try {
      // Create event_artist entry (artist_id should be resolved from the artist name)
      const entryData = {
        event_id: eventId,
        artist_id: ['1'], // This should be resolved from the artist name
        start_time: performance.time || null,
        end_time: performance.end_time || null,
        status: 'confirmed',
        stage: performance.stage || null,
        custom_name: null
      };

      const entry = await db.createEventArtistLink(entryData);
      createdEntries.push(entry);

    } catch (error) {
      logger.error('Error creating timetable entry', error, { performance: performance.name });
    }
  }

  logger.info(`Created ${createdEntries.length} timetable entries successfully`);
  return createdEntries;
}

/**
 * Gets timetable entries for an event
 * @param eventId - Event ID
 * @returns Promise with array of timetable entries
 */
export async function getTimetableByEvent(eventId: number): Promise<Timetable[]> {
  try {
    const { data, error } = await db.client
      .from('event_artist')
      .select('*')
      .eq('event_id', eventId)
      .order('start_time');

    if (error) throw error;

    logger.debug(`Retrieved ${data?.length || 0} timetable entries for event ${eventId}`);
    return data as Timetable[] || [];

  } catch (error) {
    logger.error('Error getting timetable by event', error);
    throw error;
  }
}

export default {
  groupPerformancesForB2B,
  extractStagesAndDaysFromPerformances,
  generateTimetableStatistics,
  logTimetableStatistics,
  createTimetableEntries,
  getTimetableByEvent
};
