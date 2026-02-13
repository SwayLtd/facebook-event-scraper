/**
 * Scrape Promoter Events — Edge Function
 * 
 * Scrape les pages Facebook des promoteurs (depuis la table facebook_promoters_imports)
 * pour trouver de nouveaux events et les ajouter à facebook_events_imports.
 * 
 * Appelée par pg_cron toutes les 10 min avec un batch de 10 promoteurs.
 * Rotation automatique via last_scraped_at (les plus anciens d'abord).
 * 
 * Sécurités :
 * - Time guard (120s) pour éviter le timeout Edge Function (150s)
 * - Circuit breaker : arrêt si 3+ erreurs consécutives dans un run (Facebook bloque ?)
 * - Timeout par scrape individuel (15s) pour éviter les hangs
 * - ON CONFLICT DO NOTHING pour dédup safe en concurrence
 * - Try/catch à chaque niveau pour ne jamais bloquer le batch
 * - Auto-disable après 10 erreurs consécutives sur un target
 * 
 * Scalabilité (batch 10, cron every 10min) :
 *   600 targets → ~2.4x/jour
 *  1000 targets → ~1.4x/jour
 *  1500 targets → ~1x/jour
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from '@supabase/supabase-js';
import { scrapeFbEventList, EventType } from 'facebook-event-scraper';

declare const Deno: {
    env: { get(key: string): string | undefined };
    serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// --- Configuration ---
const DEFAULT_BATCH_SIZE = 10;
const DELAY_MS = 3000;
const DEFAULT_PRIORITY = 5;
const MAX_CONSECUTIVE_ERRORS = 10; // Désactive auto après X erreurs consécutives par target
const MAX_EXECUTION_TIME_MS = 120_000; // 120s guard (Edge Function timeout = 150s)
const MAX_RUN_CONSECUTIVE_ERRORS = 3; // Circuit breaker : arrêt du run si 3 erreurs de suite
const SCRAPE_TIMEOUT_MS = 15_000; // Timeout par scrape individuel (15s)
const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year max for past events

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Helpers ---

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
        )
    ]);
}

/** Extract page name from URL for logging */
function getPageName(url: string): string {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'people' && parts.length >= 2) return parts[1];
        if (parts[0] === 'groups') return `group:${parts[1]}`;
        return parts[0] || url;
    } catch {
        return url;
    }
}

/** Normalize FB URL for duplicate checking */
function normalizeFbUrl(url: string): string {
    return url
        .replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://www.facebook.com')
        .replace(/\/$/, '')
        .split('?')[0];
}

/** Get event URL from scraped event data */
function getEventUrl(event: any): string | null {
    if (event.url) return event.url;
    if (event.id) return `https://www.facebook.com/events/${event.id}/`;
    return null;
}

// --- Main handler ---

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const startTime = Date.now();
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    try {
        // Parse batch size
        let batchSize = DEFAULT_BATCH_SIZE;
        try {
            const body = await req.json();
            if (body.batchSize) batchSize = Math.min(Math.max(body.batchSize, 1), 50);
        } catch { /* no body or invalid JSON, use default */ }

        // 1. Get targets to scrape (oldest first, enabled only)
        const { data: targets, error: fetchError } = await supabase
            .from('facebook_promoters_imports')
            .select('id, facebook_url, name, promoter_id')
            .eq('enabled', true)
            .order('last_scraped_at', { ascending: true, nullsFirst: true })
            .limit(batchSize);

        if (fetchError) throw fetchError;
        if (!targets || targets.length === 0) {
            return new Response(
                JSON.stringify({ message: 'No scrape targets available', eventsFound: 0 }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[scrape-promoter-events] Processing ${targets.length} targets`);

        // 2. Build duplicate check sets (with fallback if queries fail)
        let existingImportUrls = new Set<string>();
        let existingEventUrls = new Set<string>();

        try {
            const { data: existingImports } = await supabase
                .from('facebook_events_imports')
                .select('facebook_url');
            existingImportUrls = new Set(
                (existingImports || []).map((i: any) => normalizeFbUrl(i.facebook_url))
            );
        } catch (err: any) {
            console.warn('[scrape-promoter-events] Failed to load existing imports for dedup:', err.message);
        }

        try {
            const { data: existingEvents } = await supabase
                .from('events')
                .select('metadata')
                .not('metadata->facebook_url', 'is', null);
            existingEventUrls = new Set(
                (existingEvents || [])
                    .filter((e: any) => e.metadata?.facebook_url)
                    .map((e: any) => normalizeFbUrl(e.metadata.facebook_url))
            );
        } catch (err: any) {
            console.warn('[scrape-promoter-events] Failed to load existing events for dedup:', err.message);
        }

        // 3. Scrape each target
        let totalEventsFound = 0;
        let totalNewEvents = 0;
        let totalErrors = 0;
        let consecutiveRunErrors = 0; // Circuit breaker counter
        const results: any[] = [];

        for (let i = 0; i < targets.length; i++) {
            // Time guard: stop before Edge Function timeout
            if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
                console.warn(`[scrape-promoter-events] Time guard: stopping after ${i} targets (${Date.now() - startTime}ms)`);
                results.push({ _stopped: 'time_guard', afterTargets: i });
                break;
            }

            // Circuit breaker: stop if too many consecutive errors (Facebook may be blocking)
            if (consecutiveRunErrors >= MAX_RUN_CONSECUTIVE_ERRORS) {
                console.warn(`[scrape-promoter-events] Circuit breaker: ${consecutiveRunErrors} consecutive errors, stopping run`);
                results.push({ _stopped: 'circuit_breaker', consecutiveErrors: consecutiveRunErrors });
                break;
            }

            const target = targets[i];
            const pageName = target.name || getPageName(target.facebook_url);

            try {
                console.log(`[${i + 1}/${targets.length}] Scraping: ${pageName}`);

                // Scrape upcoming events
                const upcomingEvents = await withTimeout(
                    scrapeFbEventList(target.facebook_url, EventType.Upcoming),
                    SCRAPE_TIMEOUT_MS,
                    `${pageName} (upcoming)`
                );

                // Scrape past events (up to 1 year)
                let pastEvents: any[] = [];
                try {
                    pastEvents = await withTimeout(
                        scrapeFbEventList(target.facebook_url, EventType.Past),
                        SCRAPE_TIMEOUT_MS,
                        `${pageName} (past)`
                    );
                } catch (pastErr: any) {
                    console.warn(`  ⚠ Past events scrape failed for ${pageName}: ${pastErr.message}`);
                }

                // Merge and deduplicate by event URL
                const allEvents = [...(upcomingEvents || []), ...(pastEvents || [])];
                const seenUrls = new Set<string>();
                const dedupedEvents = allEvents.filter((e: any) => {
                    const url = getEventUrl(e);
                    if (!url) return true;
                    const norm = normalizeFbUrl(url);
                    if (seenUrls.has(norm)) return false;
                    seenUrls.add(norm);
                    return true;
                });

                // Filter: not cancelled, and past events max 1 year old
                const oneYearAgo = Date.now() - MAX_EVENT_AGE_MS;
                const activeEvents = dedupedEvents.filter((e: any) => {
                    if (e.isCanceled) return false;
                    // If event has a start timestamp, check it's within 1 year
                    if (e.startTimestamp) {
                        const eventTime = e.startTimestamp * 1000; // FB timestamps are in seconds
                        if (eventTime < oneYearAgo) return false;
                    }
                    return true;
                });
                totalEventsFound += activeEvents.length;

                let newCount = 0;
                for (const event of activeEvents) {
                    const eventUrl = getEventUrl(event);
                    if (!eventUrl) continue;

                    const normalizedUrl = normalizeFbUrl(eventUrl);

                    // Quick in-memory check (avoid unnecessary DB calls)
                    if (existingImportUrls.has(normalizedUrl) || existingEventUrls.has(normalizedUrl)) {
                        continue;
                    }

                    // Insert with ON CONFLICT DO NOTHING (safe for concurrent runs)
                    const { data: inserted, error: insertError } = await supabase
                        .from('facebook_events_imports')
                        .upsert({
                            facebook_url: eventUrl,
                            status: 'pending',
                            priority: DEFAULT_PRIORITY,
                            metadata: {
                                source: 'promoter_scraper',
                                source_page: target.facebook_url,
                                source_page_name: pageName,
                                promoter_id: target.promoter_id,
                                event_name: event.name,
                                event_date: event.date,
                                scraped_at: new Date().toISOString()
                            }
                        }, { onConflict: 'facebook_url', ignoreDuplicates: true })
                        .select('id');

                    if (!insertError && inserted && inserted.length > 0) {
                        existingImportUrls.add(normalizedUrl);
                        newCount++;
                        totalNewEvents++;
                    }
                }

                console.log(`  → ${activeEvents.length} events found, ${newCount} new`);
                consecutiveRunErrors = 0; // Reset circuit breaker on success

                // Update target: success
                await supabase
                    .from('facebook_promoters_imports')
                    .update({
                        last_scraped_at: new Date().toISOString(),
                        events_found_last: activeEvents.length,
                        error_count: 0,
                        last_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', target.id);

                results.push({ target: pageName, found: activeEvents.length, new: newCount });

            } catch (err: any) {
                console.error(`  ✗ Error: ${err.message}`);
                totalErrors++;
                consecutiveRunErrors++;

                // Update target: error, increment error_count
                try {
                    const { data: currentTarget } = await supabase
                        .from('facebook_promoters_imports')
                        .select('error_count')
                        .eq('id', target.id)
                        .single();

                    const newErrorCount = (currentTarget?.error_count || 0) + 1;
                    const shouldDisable = newErrorCount >= MAX_CONSECUTIVE_ERRORS;

                    await supabase
                        .from('facebook_promoters_imports')
                        .update({
                            last_scraped_at: new Date().toISOString(),
                            error_count: newErrorCount,
                            last_error: err.message,
                            enabled: shouldDisable ? false : true,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', target.id);

                    if (shouldDisable) {
                        console.warn(`  ⚠ Target ${pageName} disabled after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
                    }
                } catch (updateErr: any) {
                    console.error(`  ✗ Failed to update error state for ${pageName}:`, updateErr.message);
                }

                results.push({ target: pageName, error: err.message });
            }

            // Delay between scrapes (skip last)
            if (i < targets.length - 1) {
                await delay(DELAY_MS);
            }
        }

        // 4. Return summary
        const processingTime = Date.now() - startTime;
        const summary = {
            targetsProcessed: targets.length,
            totalEventsFound,
            totalNewEvents,
            errors: totalErrors,
            processingTimeMs: processingTime,
            results
        };

        console.log(`[scrape-promoter-events] Done: ${targets.length} targets, ${totalEventsFound} events, ${totalNewEvents} new, ${totalErrors} errors (${processingTime}ms)`);

        return new Response(
            JSON.stringify(summary),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error: any) {
        console.error('[scrape-promoter-events] Fatal error:', error.message);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
