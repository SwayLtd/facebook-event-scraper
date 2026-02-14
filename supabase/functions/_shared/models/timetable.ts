// Timetable model pour Edge Functions
// Full port of models/timetable.js with Clashfinder + festival timetable pipeline

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { db } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';
import { tokenManager } from '../utils/token.ts';
import { soundCloudApi } from '../utils/api.ts';
import { normalizeNameEnhanced } from '../utils/name.ts';
import { EventArtist } from '../types/index.ts';
import { downloadAndUploadEntityImage } from '../utils/r2.ts';
import { searchArtist, extractArtistInfo, insertOrUpdateArtist } from './artist.ts';
import { updateEventMetadata, linkArtistsToEvent } from './event.ts';
import genreModel from './genre.ts';

type Timetable = EventArtist;

// ─── SimpleDateTime (timezone-aware via offset table) ───────────────────────

/**
 * Minimal Luxon-like DateTime wrapper using native Date.
 * Applies a fixed UTC offset per well-known timezone so that
 * day-boundary detection (gap > 4 h) stays correct.
 */
class SimpleDateTime {
  private date: Date;

  /** Known UTC offsets (standard / summer – we pick summer for festival season) */
  private static OFFSETS: Record<string, number> = {
    'Europe/Brussels': 2,
    'Europe/Paris': 2,
    'Europe/Berlin': 2,
    'Europe/Amsterdam': 2,
    'Europe/London': 1,
    'UTC': 0,
  };

  constructor(dateStr: string, timezone = 'Europe/Brussels') {
    // If the string already contains a TZ offset (±HH:MM or Z), parse as-is
    if (/[Z+-]\d{2}:\d{2}$/.test(dateStr) || dateStr.endsWith('Z')) {
      this.date = new Date(dateStr);
    } else {
      // Treat as local time in the given timezone → apply known offset
      const offsetHours = SimpleDateTime.OFFSETS[timezone] ?? 2;
      const sign = offsetHours >= 0 ? '+' : '-';
      const abs = Math.abs(offsetHours).toString().padStart(2, '0');
      this.date = new Date(`${dateStr}${sign}${abs}:00`);
    }
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

  diff(other: SimpleDateTime, _unit: 'hours') {
    const diffMs = this.date.getTime() - other.date.getTime();
    return { hours: diffMs / (1000 * 60 * 60) };
  }

  getTime() { return this.date.getTime(); }

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
 * Creates or updates timetable entries for an event.
 * artistIds must be resolved BEFORE calling this function.
 * @param eventId - Event ID
 * @param performances - Array of performance data (each must have resolved artist IDs)
 * @param artistIdMap - Map of artist name → artist DB id
 * @param dryRun - Whether to perform actual database operations
 * @returns Promise with array of created/updated timetable entries
 */
export async function createTimetableEntries(
  eventId: number,
  performances: PerformanceData[],
  artistIdMap: Record<string, number>,
  dryRun = false
): Promise<Timetable[]> {
  logger.info(`Creating ${performances.length} timetable entries for event ${eventId}`);

  if (dryRun) {
    logger.info(`[DRY_RUN] Would have created ${performances.length} timetable entries`);
    return performances.map((perf, index) => ({
      id: 999999 + index,
      event_id: eventId,
      artist_id: [artistIdMap[perf.name] || 999999 + index],
      start_time: perf.time || new Date().toISOString(),
      end_time: perf.end_time,
      stage: perf.stage
    } as unknown as Timetable));
  }

  const createdEntries: Timetable[] = [];

  for (const performance of performances) {
    try {
      const resolvedId = artistIdMap[performance.name];
      if (!resolvedId) {
        logger.warn(`No artist ID resolved for "${performance.name}", skipping timetable entry`);
        continue;
      }

      const entryData = {
        event_id: eventId,
        artist_id: [resolvedId],
        start_time: performance.time || null,
        end_time: performance.end_time || null,
        status: 'confirmed',
        stage: performance.stage || null,
        custom_name: performance.custom_name || null
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

/**
 * Detects the event end time from timetable data by finding the latest performance.
 * Ported from models/timetable.js detectEventEndTimeFromTimetable().
 * @param timetableData - Array of performance objects with time/end_time
 * @returns ISO 8601 date string of latest end time, or null
 */
export function detectEventEndTimeFromTimetable(timetableData: PerformanceData[]): string | null {
  try {
    if (!timetableData || timetableData.length === 0) {
      return null;
    }

    let latestEndTime: string | null = null;
    let latestMs = 0;

    for (const performance of timetableData) {
      let endTime: string | null = null;

      if (performance.end_time && performance.end_time.trim() !== '') {
        endTime = performance.end_time;
      } else if (performance.time && performance.time.trim() !== '') {
        const startTime = new Date(performance.time);
        if (!isNaN(startTime.getTime())) {
          endTime = new Date(startTime.getTime() + 60 * 60 * 1000).toISOString();
        }
      }

      if (endTime) {
        const endTimeDate = new Date(endTime);
        if (!isNaN(endTimeDate.getTime()) && endTimeDate.getTime() > latestMs) {
          latestMs = endTimeDate.getTime();
          latestEndTime = endTime;
        }
      }
    }

    if (latestEndTime) {
      logger.info(`Event end time detected from timetable: ${latestEndTime}`);
    }
    return latestEndTime;
  } catch (error) {
    logger.error('Error detecting event end time from timetable', error);
    return null;
  }
}

// ─── Clashfinder integration ────────────────────────────────────────────────

const CF_USERNAME = 'clashfinder_sway';
const CF_PRIVATE_KEY = 'sxsgiq9xdck7tiky';

function cfGeneratePublicKey(username: string, privateKey: string): string {
  // SHA-256 in Web Crypto (Deno supports this natively)
  // We need a synchronous hash for simplicity – compute it async once and cache
  // For Edge Functions we'll use the SubtleCrypto API
  const hashInput = username + privateKey;
  // Fallback to a manual implementation since we need sync
  // Use crypto.subtle in an async wrapper
  return hashInput; // placeholder – actual impl below
}

async function cfGeneratePublicKeyAsync(): Promise<string> {
  const hashInput = CF_USERNAME + CF_PRIVATE_KEY;
  const encoder = new TextEncoder();
  const data = encoder.encode(hashInput);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function cfStringSimilarity(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 100;
  if (!a.length || !b.length) return 0;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
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
  const distance = matrix[b.length][a.length];
  return 100 - Math.floor(100 * distance / Math.max(a.length, b.length));
}

interface ClashfinderFestival {
  id: string;
  name: string;
  desc?: string;
  [key: string]: any;
}

interface ClashfinderResult {
  festival: ClashfinderFestival;
  csv: string;
  clashfinderUrl: string;
  similarity: number;
}

/**
 * Searches Clashfinder for a festival and returns the timetable CSV.
 * Ported from get_data/get_clashfinder_timetable.js.
 */
export async function getClashfinderTimetable(
  searchText: string,
  options: { minSimilarity?: number } = {}
): Promise<ClashfinderResult> {
  const { minSimilarity = 70 } = options;

  const publicKey = await cfGeneratePublicKeyAsync();

  // Fetch all clashfinders
  const url = `https://clashfinder.com/data/events/all.json?authUsername=${CF_USERNAME}&authPublicKey=${publicKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Clashfinder API error: ${res.status}`);
  const festivalsRaw = await res.json();

  // Normalize to array
  let festivals: ClashfinderFestival[];
  if (Array.isArray(festivalsRaw)) {
    festivals = festivalsRaw;
  } else if (Array.isArray(festivalsRaw?.events)) {
    festivals = festivalsRaw.events;
  } else if (Array.isArray(festivalsRaw?.data)) {
    festivals = festivalsRaw.data;
  } else if (typeof festivalsRaw === 'object' && festivalsRaw !== null) {
    festivals = Object.entries(festivalsRaw).map(([id, fest]: [string, any]) => ({ id, ...fest }));
  } else {
    throw new Error('Unknown Clashfinder API response format');
  }

  // Extract year from search text
  const yearMatch = searchText.match(/\b(20\d{2})\b/);
  const searchYear = yearMatch ? yearMatch[1] : null;

  // Search with the clean name
  const searchLower = searchText.toLowerCase();
  let best: ClashfinderFestival | null = null;
  let bestScore = -1;

  for (const fest of festivals) {
    const base = fest.desc || fest.name || fest.id;
    let score = cfStringSimilarity(searchText, base);

    // Year validation
    if (searchYear) {
      const festYear = base.match(/\b(20\d{2})\b/)?.[1];
      if (festYear && festYear !== searchYear) continue;
      if (festYear === searchYear) score += 10;
    }

    if (score >= minSimilarity && score > bestScore) {
      best = fest;
      bestScore = score;
    }
  }

  if (!best) {
    throw new Error(`No Clashfinder festival found matching "${searchText}" (min similarity: ${minSimilarity}%)`);
  }

  logger.info(`Clashfinder match: ${best.name} (id: ${best.id}, similarity: ${bestScore}%)`);

  // Fetch CSV
  const csvUrl = `https://clashfinder.com/data/event/${best.id}.csv?authUsername=${CF_USERNAME}&authPublicKey=${publicKey}`;
  const csvRes = await fetch(csvUrl);
  if (!csvRes.ok) throw new Error(`Clashfinder CSV fetch failed: ${csvRes.status}`);
  const csv = await csvRes.text();

  return {
    festival: best,
    csv,
    clashfinderUrl: `https://clashfinder.com/s/${best.id}/`,
    similarity: bestScore
  };
}

// ─── CSV → JSON conversion (from extract_events_timetable.js) ───────────────

const MODE_PATTERN = /\s+(?:B2B|B3B|F2F|VS|b2b|b3b|f2f|vs|meet|w\/|feat|ft)\s+/i;
const PRESENTS_PATTERN = /\s+(presents|pres)\s+/i;
const SUFFIX_PATTERN = /\s+(A\/V|\(live\))$/i;

function cfParseDatetime(dtStr: string): string {
  if (!dtStr || !dtStr.trim()) return '';
  const parts = dtStr.trim().split(' ');
  if (parts.length !== 2) return '';
  const [datePart, timePart] = parts;
  const [yyyy, mm, dd] = datePart.split('/');
  if (!yyyy || !mm || !dd) return '';
  return `${yyyy}-${mm}-${dd}T${timePart}`;
}

function cfCleanName(name: string): string {
  return name.replace(SUFFIX_PATTERN, '').trim();
}

function cfDetectMode(name: string): string {
  const match = name.match(MODE_PATTERN);
  return match ? match[1] : '';
}

/**
 * Converts Clashfinder CSV data into an array of PerformanceData.
 * Ported from extract_events_timetable.js convertClashfinderToJSON().
 */
export function convertClashfinderCSV(csvData: string): PerformanceData[] {
  const lines = csvData.split('\n').filter(l => l.trim());
  if (lines.length <= 1) return [];

  // Find header line
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.replace(/^\/\/\s*/, '').startsWith('Start,')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    logger.warn('No valid header found in Clashfinder CSV');
    return [];
  }

  const headerLine = lines[headerIndex].replace(/^\/\/\s*/, '');
  const headers = headerLine.split(',').map(h => h.trim().replace(/"/g, ''));
  const performances: PerformanceData[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;

    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const perf: any = {};

    headers.forEach((header, idx) => {
      const value = values[idx] || '';
      switch (header.toLowerCase()) {
        case 'start':
          perf.time = cfParseDatetime(value);
          break;
        case 'end':
          perf.end_time = cfParseDatetime(value);
          break;
        case 'name':
          perf.name = cfCleanName(value);
          perf.performance_mode = cfDetectMode(value);
          break;
        case 'location':
        case 'stage':
          perf.stage = value;
          break;
        case 'soundcloud':
          perf.soundcloud = value;
          break;
      }
    });

    if (perf.name && perf.stage) {
      if (!perf.soundcloud) perf.soundcloud = '';
      performances.push(perf as PerformanceData);
    }
  }

  // Handle B2B splitting
  const processed: PerformanceData[] = [];
  for (const perf of performances) {
    const nonAmpSplit = perf.name.split(MODE_PATTERN).map(cfCleanName).filter(Boolean);
    if (nonAmpSplit.length > 1) {
      for (const name of nonAmpSplit) {
        processed.push({
          ...perf,
          name,
          performance_mode: 'B2B',
          custom_name: perf.name
        });
      }
    } else if (perf.name.includes(' & ')) {
      const parts = perf.name.split(/\s+&\s+/).map(cfCleanName).filter(Boolean);
      if (parts.length > 1) {
        for (const name of parts) {
          processed.push({
            ...perf,
            name,
            performance_mode: 'B2B',
            custom_name: perf.name
          });
        }
      } else {
        processed.push(perf);
      }
    } else {
      processed.push(perf);
    }
  }

  logger.info(`Converted Clashfinder CSV: ${processed.length} performances`);
  return processed;
}

// ─── Full festival timetable pipeline ───────────────────────────────────────

/**
 * Processes a complete festival timetable.
 * Ported from models/timetable.js processFestivalTimetable().
 *
 * Steps:
 * 1. Generate stats + extract stages/days
 * 2. Update event metadata (stages, festival_days)
 * 3. Pre-load existing artists + event_artist links (optimization)
 * 4. For each performance group: search SoundCloud, insert/update artist, link to event
 * 5. Process genres for newly created artists
 * 6. Auto-detect event end time
 */
export async function processFestivalTimetable(
  eventId: number,
  timetableData: PerformanceData[],
  clashfinderResult: ClashfinderResult | null,
  dryRun = false
): Promise<{
  processedCount: number;
  successCount: number;
  soundCloudFoundCount: number;
  artistNameToId: Record<string, number>;
  stages: StageInfo[];
  festival_days: FestivalDay[];
  detectedEndTime: string | null;
}> {
  if (dryRun) {
    logger.info(`[DRY_RUN] Would process festival timetable with ${timetableData.length} performances`);
    return { processedCount: 0, successCount: 0, soundCloudFoundCount: 0, artistNameToId: {}, stages: [], festival_days: [], detectedEndTime: null };
  }

  logger.info(`Processing festival timetable: ${timetableData.length} performances for event ${eventId}`);
  const timezone = 'Europe/Brussels';

  // 1. Stats + metadata
  const stats = generateTimetableStatistics(timetableData);
  const { stages, festival_days } = extractStagesAndDaysFromPerformances(timetableData, timezone);
  logTimetableStatistics(stats);

  // 2. Update event metadata
  try {
    await updateEventMetadata({ id: eventId }, stages, festival_days, dryRun);
  } catch (err) {
    logger.error('Failed to update event metadata for festival', err);
  }

  // 3. Group performances for B2B
  const groupedPerformances = groupPerformancesForB2B(timetableData);

  // 4. Pre-load existing data for optimization
  const allArtistNames = [...new Set(timetableData.map(e => e.name))];
  const { data: existingArtists } = await db.client
    .from('artists')
    .select('id, name, external_links')
    .in('name', allArtistNames);

  const existingArtistMap = new Map<string, number>();
  const artistsNeedingSoundCloud = new Map<string, number>();
  if (existingArtists) {
    for (const artist of existingArtists) {
      existingArtistMap.set(artist.name.toLowerCase(), artist.id);
      if (!artist.external_links) {
        artistsNeedingSoundCloud.set(artist.name.toLowerCase(), artist.id);
      }
    }
  }
  logger.info(`Pre-loaded ${existingArtistMap.size} existing artists, ${artistsNeedingSoundCloud.size} need SoundCloud enrichment`);

  // Check existing event_artist links
  const { data: existingEventArtists } = await db.client
    .from('event_artist')
    .select('artist_id, stage, start_time, end_time')
    .eq('event_id', eventId);

  const existingPerfMap = new Set<string>();
  if (existingEventArtists) {
    for (const link of existingEventArtists) {
      const ids = Array.isArray(link.artist_id) ? link.artist_id : [link.artist_id];
      for (const aid of ids) {
        existingPerfMap.add(`${aid}_${link.stage || 'null'}_${link.start_time || 'null'}_${link.end_time || 'null'}`);
      }
    }
  }

  // Filter groups that need processing
  const toProcess: PerformanceData[][] = [];
  const artistNameToId: Record<string, number> = {};
  const newlyCreatedArtists: Record<string, number> = {};

  for (const group of groupedPerformances) {
    let allExist = true;
    for (const perf of group) {
      const aid = existingArtistMap.get(perf.name.toLowerCase());
      if (!aid) { allExist = false; break; }
      const startTime = perf.time ? perf.time + ':00+00:00' : 'null';
      const endTime = perf.end_time ? perf.end_time + ':00+00:00' : 'null';
      const key = `${aid}_${perf.stage || 'null'}_${startTime}_${endTime}`;
      if (!existingPerfMap.has(key)) { allExist = false; break; }
    }
    if (allExist) {
      // Already fully linked, just record IDs
      for (const perf of group) {
        const aid = existingArtistMap.get(perf.name.toLowerCase());
        if (aid) artistNameToId[perf.name] = aid;
      }
    } else {
      toProcess.push(group);
    }
  }

  logger.info(`Optimization: processing ${toProcess.length} groups, skipping ${groupedPerformances.length - toProcess.length} existing`);

  let processedCount = 0;
  let successCount = 0;
  let soundCloudFoundCount = 0;

  // 5. Process each group
  for (const group of toProcess) {
    const artistIds: number[] = [];
    const artistNames: string[] = [];

    for (const perf of group) {
      let artistId: number | null = null;
      const existingId = existingArtistMap.get(perf.name.toLowerCase());

      if (existingId && !artistsNeedingSoundCloud.has(perf.name.toLowerCase())) {
        artistId = existingId;
      } else {
        // Search SoundCloud
        let soundCloudData: any = null;
        try {
          const scArtist = await searchArtist(perf.name);
          if (scArtist) {
            soundCloudData = await extractArtistInfo(scArtist);
            soundCloudFoundCount++;
          }
        } catch (err) {
          logger.warn(`SoundCloud search failed for ${perf.name}`, err);
        }

        if (existingId) {
          // Enrich existing artist
          if (soundCloudData?.external_links) {
            // Upload image to R2 with structured path before updating DB
            let imageUrl = soundCloudData.image_url;
            if (imageUrl && !imageUrl.includes('assets.sway.events')) {
              try {
                imageUrl = await downloadAndUploadEntityImage(imageUrl, 'artists', existingId);
              } catch (r2Error) {
                logger.warn(`Failed to upload artist image to R2 for ${perf.name}`, r2Error);
              }
            }
            await db.client
              .from('artists')
              .update({
                external_links: soundCloudData.external_links,
                ...(imageUrl ? { image_url: imageUrl } : {}),
                ...(soundCloudData.description ? { description: soundCloudData.description } : {})
              })
              .eq('id', existingId);
            logger.info(`Enriched existing artist: ${perf.name} (ID: ${existingId})`);
          }
          artistId = existingId;
        } else {
          // Create new artist
          const result = await insertOrUpdateArtist(
            { name: perf.name },
            soundCloudData,
            dryRun
          );
          if (result) {
            artistId = result.id;
            newlyCreatedArtists[perf.name] = result.id;
          }
        }
      }

      if (artistId) {
        artistIds.push(artistId);
        artistNames.push(perf.name);
        artistNameToId[perf.name] = artistId;
        existingArtistMap.set(perf.name.toLowerCase(), artistId);
      }
    }

    // Link to event
    if (artistIds.length > 0) {
      const refPerf = group[0];
      await linkArtistsToEvent(eventId, artistIds, refPerf, dryRun);
      successCount += group.length;
    }

    processedCount += group.length;

    // Small delay for rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  logger.info(`Festival timetable: ${processedCount} processed, ${successCount} linked, ${soundCloudFoundCount} SoundCloud`);

  // 6. Process genres for newly created artists
  if (Object.keys(newlyCreatedArtists).length > 0) {
    logger.info(`Processing genres for ${Object.keys(newlyCreatedArtists).length} new festival artists`);
    await processFestivalArtistGenres(newlyCreatedArtists);
  }

  // 7. Auto-detect end time
  let detectedEndTime: string | null = null;
  detectedEndTime = detectEventEndTimeFromTimetable(timetableData);
  if (detectedEndTime) {
    const { data: eventData } = await db.client
      .from('events')
      .select('end_date_time')
      .eq('id', eventId)
      .single();
    if (eventData && !eventData.end_date_time) {
      await db.client.from('events').update({ end_date_time: detectedEndTime }).eq('id', eventId);
      logger.info(`Event end time auto-set to: ${detectedEndTime}`);
    }
  }

  return {
    processedCount,
    successCount,
    soundCloudFoundCount,
    artistNameToId,
    stages,
    festival_days,
    detectedEndTime
  };
}

/**
 * Processes genres for newly created festival artists in batches.
 * Each artist gets individual Last.fm analysis via genreModel.processArtistGenres().
 */
async function processFestivalArtistGenres(
  artistNameToId: Record<string, number>
): Promise<void> {
  const artistIds = Object.values(artistNameToId);
  const batchSize = 8;
  let processedCount = 0;
  let genresAssigned = 0;

  logger.info(`[Genres] Processing ${artistIds.length} festival artists in batches of ${batchSize}`);

  for (let i = 0; i < artistIds.length; i += batchSize) {
    const batch = artistIds.slice(i, i + batchSize);

    const { data: artistsData, error: fetchError } = await db.client
      .from('artists')
      .select('*')
      .in('id', batch);

    if (fetchError || !artistsData) {
      logger.error('[Genres] Error fetching batch', fetchError);
      continue;
    }

    for (const artistData of artistsData) {
      try {
        const genres = await genreModel.processArtistGenres(artistData);

        for (const genreObj of genres) {
          let genreId: number | null = null;
          if (genreObj.id) {
            genreId = genreObj.id;
          } else if (genreObj.name && genreObj.description) {
            genreId = await genreModel.insertGenreIfNew({
              name: genreObj.name,
              description: genreObj.description,
              lastfmUrl: genreObj.lastfmUrl
            });
          }
          if (genreId) {
            await db.linkArtistGenres(artistData.id, [genreId]);
            genresAssigned++;
          }
        }
        processedCount++;
      } catch (err) {
        logger.error(`[Genres] Error for ${artistData.name}`, err);
      }
    }

    // Rate limiting between batches
    if (i + batchSize < artistIds.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  logger.info(`[Genres] Complete: ${processedCount} artists, ${genresAssigned} genre assignments`);
}

export default {
  groupPerformancesForB2B,
  extractStagesAndDaysFromPerformances,
  generateTimetableStatistics,
  logTimetableStatistics,
  createTimetableEntries,
  getTimetableByEvent,
  detectEventEndTimeFromTimetable,
  getClashfinderTimetable,
  convertClashfinderCSV,
  processFestivalTimetable
};
