/**
 * Timetable processing for Edge Functions
 * Replicates functionality from models/timetable.js and import_timetable.js
 */

import { findOrInsertArtist } from '../models/artist.ts';
import { normalizeNameEnhanced } from './name.ts';

/**
 * Groups performances by time slot and stage for B2B detection
 * @param jsonData - Array of performance objects
 * @returns Array of grouped performances
 */
export function groupPerformancesForB2B(jsonData: any[]): any[][] {
    // Key: stage|time|end_time|performance_mode
    const groups: Record<string, any[]> = {};
    
    for (const perf of jsonData) {
        const stage = perf.stage || 'Unknown';
        const time = perf.time || '';
        const endTime = perf.end_time || '';
        const performanceMode = perf.performance_mode || '';
        
        const key = `${stage}|${time}|${endTime}|${performanceMode}`;
        
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(perf);
    }
    
    return Object.values(groups);
}

/**
 * Extracts unique stages and festival days from performances
 * @param performances - Array of performance objects
 * @param timezone - Timezone for date calculations (default: 'Europe/Brussels')
 * @returns Object with stages and festival_days arrays
 */
export function extractStagesAndDaysFromPerformances(performances: any[], timezone: string = 'Europe/Brussels'): {
    stages: Array<{ name: string }>;
    festival_days: Array<{ day: number; date: string; start_time: string; end_time: string }>;
} {
    // Extract unique stages
    const stagesSet = new Set<string>();
    performances.forEach(p => {
        if (p.stage && p.stage.trim()) {
            stagesSet.add(p.stage.trim());
        }
    });
    const stages = Array.from(stagesSet).map(name => ({ name }));

    // Automatic detection of effective days with timezone management
    function parseInZone(dateStr: string): Date {
        if (!dateStr) return new Date();
        // For Edge Functions, we'll use a simpler approach
        return new Date(dateStr);
    }
    
    const slots = performances
        .filter(p => p.time && p.end_time)
        .map(p => ({
            start: parseInZone(p.time),
            end: parseInZone(p.end_time),
            raw: p
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    
    const festival_days: Array<{ day: number; date: string; start_time: string; end_time: string }> = [];
    
    if (slots.length > 0) {
        let currentDay = 1;
        let dayStart = slots[0].start;
        let dayEnd = slots[0].end;
        
        // Group slots by day
        for (let i = 1; i < slots.length; i++) {
            const slot = slots[i];
            const prevSlot = slots[i - 1];
            
            // If more than 12 hours gap, it's a new day
            const hoursDiff = (slot.start.getTime() - prevSlot.end.getTime()) / (1000 * 60 * 60);
            
            if (hoursDiff > 12) {
                // Save current day
                festival_days.push({
                    day: currentDay,
                    date: dayStart.toISOString().split('T')[0],
                    start_time: dayStart.toISOString(),
                    end_time: dayEnd.toISOString()
                });
                
                // Start new day
                currentDay++;
                dayStart = slot.start;
                dayEnd = slot.end;
            } else {
                // Extend current day
                dayEnd = new Date(Math.max(dayEnd.getTime(), slot.end.getTime()));
            }
        }
        
        // Add last day
        festival_days.push({
            day: currentDay,
            date: dayStart.toISOString().split('T')[0],
            start_time: dayStart.toISOString(),
            end_time: dayEnd.toISOString()
        });
    }
    
    return { stages, festival_days };
}

/**
 * Generates comprehensive statistics from timetable data
 * @param jsonData - Array of performance objects
 * @returns Statistics object with detailed analysis
 */
export function generateTimetableStatistics(jsonData: any[]): {
    uniqueArtists: Set<string>;
    artistPerformances: Record<string, any[]>;
    stagesSet: Set<string>;
    performanceModes: Set<string>;
    timeSlots: Record<string, number>;
    withSoundCloud: number;
    totalPerformances: number;
} {
    const uniqueArtists = new Set<string>();
    const artistPerformances: Record<string, any[]> = {};
    const stagesSet = new Set<string>();
    const performanceModes = new Set<string>();
    const timeSlots: Record<string, number> = {};
    let withSoundCloud = 0;

    // Fill stats from raw JSON (before B2B)
    for (const perf of jsonData) {
        if (perf.name) {
            uniqueArtists.add(perf.name);
            if (!artistPerformances[perf.name]) {
                artistPerformances[perf.name] = [];
            }
            artistPerformances[perf.name].push(perf);
        }
        
        if (perf.stage) stagesSet.add(perf.stage);
        if (perf.performance_mode) performanceModes.add(perf.performance_mode);
        if (perf.soundcloud) withSoundCloud++;
        
        if (perf.time) {
            const hour = new Date(perf.time).getHours();
            timeSlots[hour] = (timeSlots[hour] || 0) + 1;
        }
    }

    return {
        uniqueArtists,
        artistPerformances,
        stagesSet,
        performanceModes,
        timeSlots,
        withSoundCloud,
        totalPerformances: jsonData.length
    };
}

/**
 * Logs detailed timetable statistics in a formatted way
 * @param stats - Statistics object from generateTimetableStatistics
 * @param logFunction - Logging function to use (defaults to console.log)
 */
export function logTimetableStatistics(stats: any, logFunction: (message: string) => void = console.log): void {
    const {
        uniqueArtists,
        artistPerformances,
        stagesSet,
        performanceModes,
        timeSlots,
        withSoundCloud,
        totalPerformances
    } = stats;

    logFunction(`\n📊 Detailed statistics:`);
    logFunction(`   Total performances: ${totalPerformances}`);
    logFunction(`   Unique artists: ${uniqueArtists.size}`);
    
    // Stages
    logFunction(`\n🎪 Stages (${stagesSet.size}):`);
    Array.from(stagesSet).sort().forEach((stage: any) => {
        const stagePerfs = totalPerformances; // Simplified for now
        logFunction(`   - ${stage}`);
    });
    
    // Performance modes
    if (performanceModes.size > 0) {
        logFunction(`\n🎵 Performance modes (${performanceModes.size}):`);
        Array.from(performanceModes).sort().forEach((mode: any) => {
            logFunction(`   - ${mode}`);
        });
    }
    
    // Artists with multiple performances
    const multiplePerformances = Object.entries(artistPerformances)
        .filter(([, performances]) => (performances as any[]).length > 1)
        .sort((a, b) => (b[1] as any[]).length - (a[1] as any[]).length);
    
    if (multiplePerformances.length > 0) {
        logFunction(`\n🎭 Artists with multiple performances (${multiplePerformances.length}):`);
        multiplePerformances.slice(0, 10).forEach(([artist, performances]) => {
            const stages = (performances as any[]).map((p: any) => p.stage).filter(Boolean);
            logFunction(`   - ${artist}: ${(performances as any[]).length} performances (${[...new Set(stages)].join(', ')})`);
        });
        if (multiplePerformances.length > 10) {
            logFunction(`   ... and ${multiplePerformances.length - 10} more artists with multiple performances`);
        }
    }
    
    // Distribution by hour
    logFunction(`\n⏰ Distribution by hour:`);
    Object.entries(timeSlots)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .forEach(([hour, count]) => {
            logFunction(`   ${hour}h: ${count} performances`);
        });
    
    // SoundCloud links already provided
    logFunction(`\n🎵 SoundCloud Links:`);
    logFunction(`   Already provided: ${withSoundCloud}/${totalPerformances} (${((withSoundCloud / totalPerformances) * 100).toFixed(1)}%)`);
    
    // Artist sample
    logFunction(`\n📝 Artist Sample:`);
    const sampleArtists = Array.from(uniqueArtists).slice(0, 10);
    sampleArtists.forEach((artist, index) => {
        logFunction(`   ${index + 1}. ${artist}`);
    });
    if (uniqueArtists.size > 10) {
        logFunction(`   ... and ${uniqueArtists.size - 10} more artists`);
    }
}

/**
 * Updates event metadata with stages and festival days
 * @param supabase - Supabase client
 * @param event - Event object
 * @param newStages - Array of stage objects
 * @param newFestivalDays - Array of festival day objects
 * @param dryRun - Whether to perform actual database updates
 * @returns Updated metadata object
 */
export async function updateEventMetadata(
    supabase: any, 
    event: any, 
    newStages: Array<{ name: string }>, 
    newFestivalDays: Array<{ day: number; date: string; start_time: string; end_time: string }>, 
    dryRun: boolean = false
): Promise<any> {
    let metadata = event.metadata || {};
    
    // Parse if string
    if (typeof metadata === 'string') {
        try { 
            metadata = JSON.parse(metadata); 
        } catch { 
            metadata = {}; 
        }
    }
    
    // Merge stages
    metadata.stages = newStages;
    
    // Merge festival_days
    metadata.festival_days = newFestivalDays;
    
    // Optionally preserve other keys (ticket_link, facebook_url, etc)
    // Add timetable if not present
    if (!('timetable' in metadata)) metadata.timetable = true;
    
    // Update in DB
    if (!dryRun) {
        const { error } = await supabase
            .from('events')
            .update({ metadata })
            .eq('id', event.id);
        if (error) throw error;
    }
    
    console.log(`[INFO] Event metadata updated with stages and festival_days`);
    console.log(`[INFO] stages: ${JSON.stringify(metadata.stages)}`);
    console.log(`[INFO] festival_days: ${JSON.stringify(metadata.festival_days)}`);
    
    return metadata;
}

/**
 * Creates a relationship between an event and multiple artists for B2B performances
 * @param supabase - Supabase client
 * @param eventId - Event ID
 * @param artistIds - Array of artist IDs
 * @param performanceData - Performance details
 * @param dryRun - Whether to perform actual database updates
 * @returns Created link object
 */
export async function linkArtistsToEvent(
    supabase: any, 
    eventId: number, 
    artistIds: number[], 
    performanceData: any, 
    dryRun: boolean = false
): Promise<any> {
    try {
        if (dryRun) {
            console.log(`[DRY_RUN] Would have linked artists ${artistIds.join(', ')} to event ${eventId} (stage: ${performanceData.stage}, time: ${performanceData.time}, end_time: ${performanceData.end_time})`);
            return { id: `dryrun_link_${artistIds.join('_')}_${eventId}` };
        }
        
        const artistIdStrs = artistIds.map(String);
        
        // Validate and clean timestamps 
        let startTime: string | null = null;
        let endTime: string | null = null;
        
        if (performanceData.time && performanceData.time.trim() !== "") {
            startTime = new Date(performanceData.time).toISOString();
        }
        if (performanceData.end_time && performanceData.end_time.trim() !== "") {
            endTime = new Date(performanceData.end_time).toISOString();
        }
        
        // Check if link already exists with the same details
        let query = supabase
            .from('event_artist')
            .select('id')
            .eq('event_id', eventId);
            
        if (performanceData.stage === null || performanceData.stage === "") {
            query = query.is('stage', null);
        } else {
            query = query.eq('stage', performanceData.stage);
        }
        
        if (startTime === null) {
            query = query.is('start_time', null);
        } else {
            query = query.eq('start_time', startTime);
        }
        
        if (endTime === null) {
            query = query.is('end_time', null);
        } else {
            query = query.eq('end_time', endTime);
        }
        
        // Check if artist_id array contains all our artists
        query = query.contains('artist_id', artistIdStrs);
        
        const { data: existing, error: fetchError } = await query;
        if (fetchError) { 
            throw fetchError; 
        }
        
        if (existing && existing.length > 0) {
            console.log(`➡️ Artist-event link already exists for artist_ids=${artistIdStrs.join(',')} with same performance details`);
            return existing[0];
        }
        
        // Create new link with format compatible with existing system
        const linkRecord = {
            event_id: eventId,
            artist_id: artistIdStrs, // Array format
            start_time: startTime,
            end_time: endTime,
            status: 'confirmed',
            stage: performanceData.stage || null,
            custom_name: performanceData.custom_name || null,
            created_at: new Date().toISOString(),
        };
        
        const { data, error } = await supabase
            .from('event_artist')
            .insert(linkRecord)
            .select()
            .single();
            
        if (error) throw error;
        
        console.log(`✅ Created artist-event link for artist_ids=${artistIdStrs.join(',')} (ID: ${data.id})`);
        return data;
        
    } catch (error) {
        console.log(`Error linking artists to event: ${(error as Error).message}`);
        throw error;
    }
}

/**
 * Converts dates to UTC for the database
 * @param dateStr - Date string in local time
 * @param timezone - Timezone (for compatibility, not used in Edge Function)
 * @returns UTC ISO string
 */
export function toUtcIso(dateStr: string, timezone: string = 'Europe/Brussels'): string {
    if (!dateStr) return '';
    
    try {
        const date = new Date(dateStr);
        return date.toISOString();
    } catch (error) {
        console.warn(`Failed to convert date ${dateStr} to UTC:`, error);
        return dateStr;
    }
}

/**
 * Processes festival timetable data and imports artists with timing information
 * @param supabase - The Supabase client
 * @param eventId - The event ID in the database
 * @param timetableData - Array of performance objects from Clashfinder
 * @param clashfinderResult - Original Clashfinder result with metadata
 * @param options - Processing options
 * @returns Processing results with statistics
 */
export async function processFestivalTimetable(
    supabase: any, 
    eventId: number, 
    timetableData: any[], 
    clashfinderResult: any, 
    options: {
        dryRun?: boolean;
        soundCloudClientId?: string;
        soundCloudClientSecret?: string;
        logMessage?: (message: string) => void;
        delay?: (ms: number) => Promise<void>;
    } = {}
): Promise<{
    processedCount: number;
    successCount: number;
    soundCloudFoundCount: number;
    errors: string[];
}> {
    const {
        dryRun = false,
        logMessage = console.log,
        delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    } = options;

    if (dryRun) {
        logMessage('[DRY_RUN] Festival timetable processing - no actual database changes will be made');
    }

    console.log(`\n🎪 Processing festival timetable with ${timetableData.length} performances...`);
    logMessage(`Starting festival timetable import for event ${eventId}`);
    
    // Set default timezone
    const timezone = 'Europe/Brussels';
    
    // Generate statistics and extract metadata
    const stats = generateTimetableStatistics(timetableData);
    const { stages, festival_days } = extractStagesAndDaysFromPerformances(timetableData, timezone);
    
    // Log statistics
    logTimetableStatistics(stats, logMessage);
    
    // Update event metadata
    const event = { id: eventId, metadata: {} }; // Simplified for Edge Function
    await updateEventMetadata(supabase, event, stages, festival_days, dryRun);
    
    // Process B2B performances
    const groupedPerformances = groupPerformancesForB2B(timetableData);
    const artistNameToId: Record<string, number> = {};
    let processedCount = 0;
    let successCount = 0;
    let soundCloudFoundCount = 0;
    const errors: string[] = [];
    const dryRunLinks: any[] = [];
    
    try {
        for (const group of groupedPerformances) {
            const artistIds: number[] = [];
            const artistNames: string[] = [];
            
            for (const perf of group) {
                // Convert dates to UTC for the database
                if (perf.time) {
                    perf.time = toUtcIso(perf.time, timezone);
                }
                if (perf.end_time) {
                    perf.end_time = toUtcIso(perf.end_time, timezone);
                }
                
                const artistName = perf.name.trim();
                artistNames.push(artistName);
                
                if (!artistNameToId[artistName]) {
                    logMessage(`🎵 Processing artist: "${artistName}"`);
                    
                    try {
                        // Use the complete artist processing with SoundCloud enrichment
                        const artistId = await findOrInsertArtist(supabase, { name: artistName });
                        
                        if (artistId) {
                            artistNameToId[artistName] = artistId;
                            soundCloudFoundCount++; // Simplified counting for now
                        } else {
                            errors.push(`Failed to process artist: ${artistName}`);
                            continue;
                        }
                    } catch (error) {
                        const errorMsg = `Error processing artist ${artistName}: ${(error as Error).message}`;
                        errors.push(errorMsg);
                        logMessage(`❌ ${errorMsg}`);
                        continue;
                    }
                }
                
                artistIds.push(artistNameToId[artistName]);
            }
            
            if (artistIds.length > 0) {
                const refPerf = group[0];
                try {
                    const linkResult = await linkArtistsToEvent(supabase, eventId, artistIds, refPerf, dryRun);
                    if (dryRun) {
                        dryRunLinks.push({ artists: artistNames, performance: refPerf, linkResult });
                    }
                    successCount += group.length;
                    logMessage(`Successfully processed: ${artistNames.join(' & ')} (${group.length} performance(s))`);
                } catch (error) {
                    const errorMsg = `Error linking artists to event: ${(error as Error).message}`;
                    errors.push(errorMsg);
                    logMessage(`❌ ${errorMsg}`);
                }
            }
            
            processedCount += group.length;
            
            // Rate limiting
            await delay(500);
        }
        
        logMessage("\n=== Import Summary ===");
        logMessage(`Total artists processed: ${processedCount}`);
        logMessage(`Successfully imported: ${successCount}`);
        logMessage(`Found on SoundCloud: ${soundCloudFoundCount}`);
        logMessage(`SoundCloud success rate: ${((soundCloudFoundCount / successCount) * 100).toFixed(1)}%`);
        logMessage(`Event ID: ${eventId}`);
        
        if (errors.length > 0) {
            logMessage(`\n⚠️ Errors encountered: ${errors.length}`);
            errors.slice(0, 5).forEach(error => logMessage(`   - ${error}`));
            if (errors.length > 5) {
                logMessage(`   ... and ${errors.length - 5} more errors`);
            }
        }
        
        if (dryRun) {
            logMessage(`\n[DRY_RUN] Number of simulated artist-event links: ${dryRunLinks.length}`);
            dryRunLinks.slice(0, 10).forEach(l => {
                logMessage(`[DRY_RUN] Example: ${l.artists.join(' & ')} on stage ${l.performance.stage} at ${l.performance.time}`);
            });
            if (dryRunLinks.length > 10) {
                logMessage(`[DRY_RUN] ...and ${dryRunLinks.length - 10} other simulated links.`);
            }
        }
        
        logMessage("=== Import Complete ===");
        
        return {
            processedCount,
            successCount,
            soundCloudFoundCount,
            errors
        };
        
    } catch (error) {
        const errorMsg = `Fatal error during timetable processing: ${(error as Error).message}`;
        logMessage(errorMsg);
        errors.push(errorMsg);
        throw error;
    }
}
