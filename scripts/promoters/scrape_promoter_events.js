/**
 * scrape_promoter_events.js
 * 
 * Scrape les pages Facebook d'organisateurs pour trouver leurs événements upcoming
 * et les ajouter à la queue d'import facebook_events_imports.
 * 
 * Usage:
 *   node scrape_promoter_events.js                    # Mode normal (ajoute à la queue)
 *   node scrape_promoter_events.js --dry-run          # Mode test (affiche sans ajouter)
 *   node scrape_promoter_events.js --file=custom.txt  # Fichier custom d'URLs
 * 
 * Le fichier promoters_urls.txt contient les URLs des pages Facebook (une par ligne).
 * Les lignes commençant par # sont ignorées.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeFbEventList, EventType } from 'facebook-event-scraper';
import { createClient } from '@supabase/supabase-js';

import { logMessage } from '../../utils/logger.js';
import { delay } from '../../utils/delay.js';

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URLS_FILE = path.join(__dirname, 'promoters_urls.txt');
const DELAY_BETWEEN_PAGES_MS = 3000; // 3s entre chaque page pour éviter le rate-limit FB
const DEFAULT_PRIORITY = 5;

// --- Parse CLI arguments ---
function parseArgs() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const fileArg = args.find(a => a.startsWith('--file='));
    const urlsFile = fileArg ? fileArg.split('=')[1] : DEFAULT_URLS_FILE;
    return { dryRun, urlsFile };
}

// --- Read promoter URLs from file ---
function readPromoterUrls(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Fichier introuvable: ${filePath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

    if (urls.length === 0) {
        console.error('❌ Aucune URL trouvée dans le fichier');
        process.exit(1);
    }

    return urls;
}

// --- Extract page name from URL for display ---
function getPageName(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        // Handle /profile.php?id=xxx
        if (parts[0] === 'profile.php') {
            const id = u.searchParams.get('id');
            return `profile:${id}`;
        }
        // Handle /groups/xxx
        if (parts[0] === 'groups') return `group:${parts[1]}`;
        // Handle /pagename or /pagename/events
        return parts[0];
    } catch {
        return url;
    }
}

// --- Scrape one promoter page ---
async function scrapePromoterPage(url) {
    const pageName = getPageName(url);
    console.log(`\n🔍 Scraping: ${pageName} (${url})`);

    try {
        const events = await scrapeFbEventList(url, EventType.Upcoming);

        if (!events || events.length === 0) {
            console.log(`   ℹ️  Aucun événement upcoming trouvé`);
            return [];
        }

        // Filtrer les annulés
        const activeEvents = events.filter(e => !e.isCanceled);
        console.log(`   ✅ ${activeEvents.length} événement(s) upcoming trouvé(s)${events.length !== activeEvents.length ? ` (${events.length - activeEvents.length} annulé(s))` : ''}`);

        for (const event of activeEvents) {
            console.log(`      📅 ${event.name} — ${event.date} — ${event.url}`);
        }

        return activeEvents.map(e => ({
            ...e,
            sourcePageUrl: url,
            sourcePageName: pageName,
        }));
    } catch (error) {
        console.error(`   ❌ Erreur scraping ${pageName}: ${error.message}`);
        return [];
    }
}

// --- Check if event already exists in queue ---
async function checkExistingInQueue(supabase, facebookUrl) {
    const { data, error } = await supabase
        .from('facebook_events_imports')
        .select('id, status')
        .eq('facebook_url', facebookUrl)
        .maybeSingle();

    if (error) {
        console.error(`   ⚠️  Erreur vérification queue: ${error.message}`);
        return null;
    }
    return data;
}

// --- Add event to import queue ---
async function addToQueue(supabase, event, dryRun = false) {
    const facebookUrl = event.url;

    // Vérifier si déjà dans la queue
    const existing = await checkExistingInQueue(supabase, facebookUrl);
    if (existing) {
        console.log(`      ⏭️  Déjà en queue (id=${existing.id}, status=${existing.status}): ${event.name}`);
        return { action: 'skipped', reason: 'already_in_queue' };
    }

    // Vérifier si l'événement a déjà été importé (via metadata.facebook_url dans events)
    const { data: existingEvent } = await supabase
        .from('events')
        .select('id, title')
        .ilike('metadata->>facebook_url', `%${event.id}%`)
        .maybeSingle();

    if (existingEvent) {
        console.log(`      ⏭️  Événement déjà importé (event_id=${existingEvent.id}): ${existingEvent.title}`);
        return { action: 'skipped', reason: 'already_imported' };
    }

    if (dryRun) {
        console.log(`      🧪 [DRY-RUN] Serait ajouté: ${event.name}`);
        return { action: 'dry_run' };
    }

    // Ajouter à la queue
    const { data: inserted, error: insertError } = await supabase
        .from('facebook_events_imports')
        .insert({
            facebook_url: facebookUrl,
            priority: DEFAULT_PRIORITY,
            status: 'pending',
            metadata: {
                source: 'promoter_scraper',
                source_page: event.sourcePageUrl,
                source_page_name: event.sourcePageName,
                event_name: event.name,
                event_date: event.date,
            }
        })
        .select('id')
        .single();

    if (insertError) {
        console.error(`      ❌ Erreur insertion: ${insertError.message}`);
        return { action: 'error', error: insertError.message };
    }

    console.log(`      ✅ Ajouté à la queue (id=${inserted.id}): ${event.name}`);
    logMessage(`[PromoterScraper] Event added to queue (id=${inserted.id}): ${event.name} from ${event.sourcePageName}`);
    return { action: 'added', id: inserted.id };
}

// --- Main ---
async function main() {
    const { dryRun, urlsFile } = parseArgs();

    console.log('🎵 Scraper de pages d\'organisateurs Facebook');
    console.log('=============================================');
    console.log(`📂 Fichier d'URLs: ${urlsFile}`);
    console.log(`🧪 Mode: ${dryRun ? 'DRY-RUN (aucune modification DB)' : 'PRODUCTION (ajout à la queue)'}`);
    console.log('');

    // Init Supabase (toujours, pour vérifier les doublons même en dry-run)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error('❌ Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requises');
        process.exit(1);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // Lire les URLs
    const urls = readPromoterUrls(urlsFile);
    console.log(`📋 ${urls.length} page(s) d'organisateurs à scraper\n`);

    // Scraping
    const stats = {
        pagesScraped: 0,
        pagesWithErrors: 0,
        totalEventsFound: 0,
        eventsAdded: 0,
        eventsSkipped: 0,
        eventsError: 0,
    };

    const allEvents = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        console.log(`\n[${i + 1}/${urls.length}]`);

        const events = await scrapePromoterPage(url);
        stats.pagesScraped++;

        if (events.length === 0 && !events.error) {
            // Page scrapée mais pas d'événements
        }

        allEvents.push(...events);
        stats.totalEventsFound += events.length;

        // Delay entre chaque page
        if (i < urls.length - 1) {
            console.log(`   ⏳ Attente ${DELAY_BETWEEN_PAGES_MS / 1000}s avant la prochaine page...`);
            await delay(DELAY_BETWEEN_PAGES_MS);
        }
    }

    // Ajouter les événements trouvés à la queue
    if (allEvents.length > 0) {
        console.log('\n\n📥 Traitement des événements trouvés...');
        console.log('=========================================');

        for (const event of allEvents) {
            const result = await addToQueue(supabase, event, dryRun);
            if (result.action === 'added' || result.action === 'dry_run') {
                stats.eventsAdded++;
            } else if (result.action === 'skipped') {
                stats.eventsSkipped++;
            } else if (result.action === 'error') {
                stats.eventsError++;
            }
        }
    }

    // Résumé
    console.log('\n\n📊 Résumé');
    console.log('=========');
    console.log(`   Pages scrapées:       ${stats.pagesScraped}/${urls.length}`);
    console.log(`   Événements trouvés:   ${stats.totalEventsFound}`);
    console.log(`   Ajoutés à la queue:   ${stats.eventsAdded}`);
    console.log(`   Déjà existants:       ${stats.eventsSkipped}`);
    console.log(`   Erreurs:              ${stats.eventsError}`);
    console.log('');

    if (dryRun) {
        console.log('🧪 Mode DRY-RUN — Aucune modification n\'a été effectuée.');
        console.log('   Relancez sans --dry-run pour ajouter les événements à la queue.');
    } else if (stats.eventsAdded > 0) {
        console.log(`🎉 ${stats.eventsAdded} nouveaux événement(s) ajouté(s) à la queue d'import !`);
        console.log('   Le système process-event les traitera automatiquement.');
    }
}

main().catch(error => {
    console.error('💥 Erreur fatale:', error);
    process.exit(1);
});
