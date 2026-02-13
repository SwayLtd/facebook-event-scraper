/**
 * backfill_promoter_links.js
 * 
 * Re-scrape les events importés pour récupérer les hosts Facebook
 * et backfill les external_links des promoteurs existants.
 * 
 * Usage:
 *   node backfill_promoter_links.js              # Mode normal (met à jour la DB)
 *   node backfill_promoter_links.js --dry-run    # Mode test (affiche sans modifier)
 *   node backfill_promoter_links.js --limit=50   # Limiter le nombre d'events scrapés
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { scrapeFbEvent } from 'facebook-event-scraper';

import { delay } from '../../utils/delay.js';

// --- Configuration ---
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : 0;
const DELAY_BETWEEN_SCRAPES = 3000; // 3s entre chaque scrape

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Normalize name for matching
 */
function normalizeName(name) {
    return name.trim().toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * String similarity (Dice coefficient)
 */
function similarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams1 = new Set();
    const bigrams2 = new Set();
    for (let i = 0; i < a.length - 1; i++) bigrams1.add(a.substring(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bigrams2.add(b.substring(i, i + 2));
    const intersection = [...bigrams1].filter(x => bigrams2.has(x)).length;
    return (2 * intersection) / (bigrams1.size + bigrams2.size);
}

async function main() {
    console.log('=== Backfill Promoter Facebook Links ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    if (LIMIT) console.log(`Limite: ${LIMIT} events`);
    console.log('');

    // 1. Charger tous les promoteurs
    const { data: allPromoters } = await supabase
        .from('promoters')
        .select('id, name, external_links');

    const promotersWithoutFb = allPromoters.filter(p => !p.external_links?.facebook?.link);
    const promotersWithFb = allPromoters.filter(p => p.external_links?.facebook?.link);
    console.log(`Promoteurs total: ${allPromoters.length}`);
    console.log(`Avec lien FB: ${promotersWithFb.length}`);
    console.log(`Sans lien FB: ${promotersWithoutFb.length}`);

    if (promotersWithoutFb.length === 0) {
        console.log('\nTous les promoteurs ont déjà un lien Facebook!');
        return;
    }

    // 2. Trouver les events liés aux promoteurs sans lien FB
    const promoterIdsWithoutFb = promotersWithoutFb.map(p => p.id);

    // Récupérer les relations event_promoter pour ces promoteurs
    const { data: epRelations } = await supabase
        .from('event_promoter')
        .select('event_id, promoter_id')
        .in('promoter_id', promoterIdsWithoutFb);

    if (!epRelations || epRelations.length === 0) {
        console.log('\nAucun event lié aux promoteurs sans lien FB.');
        return;
    }

    const eventIds = [...new Set(epRelations.map(ep => ep.event_id))];
    console.log(`\nEvents liés à des promoteurs sans FB: ${eventIds.length}`);

    // 3. Récupérer les facebook_url de ces events depuis facebook_events_imports
    const { data: imports } = await supabase
        .from('facebook_events_imports')
        .select('id, facebook_url, event_id')
        .in('event_id', eventIds)
        .eq('status', 'completed');

    if (!imports || imports.length === 0) {
        console.log('Aucun import trouvé pour ces events.');
        return;
    }

    console.log(`Imports avec facebook_url: ${imports.length}`);

    // Map event_id -> facebook_url
    const eventUrlMap = new Map();
    for (const imp of imports) {
        if (imp.event_id && imp.facebook_url) {
            eventUrlMap.set(imp.event_id, { url: imp.facebook_url, importId: imp.id });
        }
    }

    // 4. Construire la liste des events à scraper
    // Grouper par event pour ne scraper qu'une fois
    const eventsToScrape = [];
    for (const [eventId, { url, importId }] of eventUrlMap) {
        const linkedPromoterIds = epRelations
            .filter(ep => ep.event_id === eventId)
            .map(ep => ep.promoter_id)
            .filter(pid => promoterIdsWithoutFb.includes(pid));

        if (linkedPromoterIds.length > 0) {
            eventsToScrape.push({ eventId, url, importId, linkedPromoterIds });
        }
    }

    const toProcess = LIMIT ? eventsToScrape.slice(0, LIMIT) : eventsToScrape;
    console.log(`Events à scraper: ${toProcess.length}${LIMIT ? ` (limité à ${LIMIT})` : ''}`);
    console.log('');

    // 5. Scraper et matcher
    let updated = 0;
    let errors = 0;
    let newLinksFound = 0;
    const discoveredLinks = new Map(); // promoterId -> { id, link, name }

    for (let i = 0; i < toProcess.length; i++) {
        const { eventId, url, importId, linkedPromoterIds } = toProcess[i];
        const progress = `[${i + 1}/${toProcess.length}]`;

        try {
            console.log(`${progress} Scraping ${url}...`);
            const eventData = await scrapeFbEvent(url);

            // Stocker facebook_event_data dans l'import (pour ne plus avoir à re-scraper)
            if (!DRY_RUN) {
                await supabase
                    .from('facebook_events_imports')
                    .update({ facebook_event_data: eventData })
                    .eq('id', importId);
            }

            const hosts = eventData?.hosts;
            if (!hosts || hosts.length === 0) {
                console.log(`  → Pas de hosts dans cet event`);
                if (i < toProcess.length - 1) await delay(DELAY_BETWEEN_SCRAPES);
                continue;
            }

            console.log(`  → ${hosts.length} hosts trouvés: ${hosts.map(h => h.name).join(', ')}`);

            // Pour chaque promoteur lié sans FB link, essayer de matcher avec les hosts
            for (const promoterId of linkedPromoterIds) {
                const promoter = promotersWithoutFb.find(p => p.id === promoterId);
                if (!promoter || discoveredLinks.has(promoterId)) continue;

                const normalizedPromoterName = normalizeName(promoter.name);

                for (const host of hosts) {
                    if (!host.url || !host.id) continue;

                    const normalizedHostName = normalizeName(host.name);
                    const sim = similarity(normalizedPromoterName, normalizedHostName);

                    if (normalizedPromoterName === normalizedHostName || sim >= 0.85) {
                        console.log(`  ✅ Match: "${promoter.name}" ↔ "${host.name}" (sim=${sim.toFixed(2)})`);
                        discoveredLinks.set(promoterId, {
                            id: host.id,
                            link: host.url,
                            name: promoter.name
                        });
                        newLinksFound++;

                        if (!DRY_RUN) {
                            const { error: updateError } = await supabase
                                .from('promoters')
                                .update({
                                    external_links: {
                                        ...promoter.external_links,
                                        facebook: { id: host.id, link: host.url }
                                    }
                                })
                                .eq('id', promoterId);

                            if (updateError) {
                                console.log(`  ❌ Erreur update promoter ${promoterId}: ${updateError.message}`);
                            } else {
                                updated++;
                                console.log(`  → Updated external_links for promoter ${promoterId}`);
                            }
                        }
                        break;
                    }
                }
            }
        } catch (err) {
            console.log(`${progress} ❌ Erreur scraping: ${err.message}`);
            errors++;
        }

        if (i < toProcess.length - 1) await delay(DELAY_BETWEEN_SCRAPES);
    }

    // 6. Résumé
    console.log('\n=== Résumé ===');
    console.log(`Events scrapés: ${toProcess.length}`);
    console.log(`Erreurs: ${errors}`);
    console.log(`Nouveaux liens FB découverts: ${newLinksFound}`);
    if (!DRY_RUN) {
        console.log(`Promoteurs mis à jour en DB: ${updated}`);
    } else {
        console.log('(DRY RUN - aucune modification en DB)');
        if (discoveredLinks.size > 0) {
            console.log('\nLiens qui seraient ajoutés:');
            for (const [pid, data] of discoveredLinks) {
                console.log(`  ${data.name} (id=${pid}) → ${data.link}`);
            }
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
