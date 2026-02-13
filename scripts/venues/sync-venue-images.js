/**
 * One-shot script: sync venue images from matching promoters.
 *
 * For each venue without an image (or with a Google Maps image),
 * find a promoter with the same name (case-insensitive) that has
 * a high-quality storage image, and copy it to the venue.
 *
 * Usage:
 *   node scripts/venues/sync-venue-images.js [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const dryRun = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Check if a venue image is missing or low-quality (Google Maps)
 */
function needsImageUpgrade(imageUrl) {
    if (!imageUrl) return true;
    if (imageUrl.includes('googleapis.com')) return true;
    if (imageUrl.includes('googleusercontent.com')) return true;
    if (imageUrl.includes('lh3.google')) return true;
    if (imageUrl.includes('maps.google')) return true;
    return false;
}

/**
 * Check if a promoter image is high-quality (in Supabase storage)
 */
function isStorageImage(imageUrl) {
    return imageUrl && imageUrl.includes('supabase.co/storage');
}

async function main() {
    console.log('🔗 Venue ← Promoter Image Sync (one-shot)');
    console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

    // Fetch all venues
    const { data: venues, error: venueErr } = await supabase
        .from('venues')
        .select('id, name, image_url')
        .order('name');

    if (venueErr) {
        console.error('❌ Failed to fetch venues:', venueErr.message);
        process.exit(1);
    }

    // Fetch all promoters with images
    const { data: promoters, error: promErr } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .not('image_url', 'is', null)
        .order('name');

    if (promErr) {
        console.error('❌ Failed to fetch promoters:', promErr.message);
        process.exit(1);
    }

    // Build a case-insensitive lookup: normalized name → promoter
    const promoterByName = new Map();
    for (const p of promoters) {
        const key = p.name.trim().toLowerCase();
        // Only keep promoters with storage images
        if (isStorageImage(p.image_url)) {
            promoterByName.set(key, p);
        }
    }

    console.log(`Loaded ${venues.length} venues, ${promoterByName.size} promoters with storage images\n`);

    let updated = 0;
    let noMatch = 0;
    const updates = [];

    for (const v of venues) {
        const key = v.name.trim().toLowerCase();
        const matchingPromoter = promoterByName.get(key);

        if (!matchingPromoter) {
            noMatch++;
            continue;
        }

        updates.push({
            venueId: v.id,
            venueName: v.name,
            currentImage: v.image_url,
            promoterId: matchingPromoter.id,
            promoterImage: matchingPromoter.image_url,
        });
    }

    if (updates.length === 0) {
        console.log('✅ No venues match a promoter name — nothing to sync!');
        return;
    }

    console.log(`Found ${updates.length} venue(s) matching a promoter:\n`);

    for (const u of updates) {
        const same = u.currentImage === u.promoterImage;
        if (same) {
            console.log(`  • Venue #${u.venueId} "${u.venueName}" — already same image, skipping`);
            continue;
        }

        console.log(`  • Venue #${u.venueId} "${u.venueName}"`);
        console.log(`    ← Promoter #${u.promoterId} image: ${u.promoterImage.substring(0, 80)}...`);

        if (!dryRun) {
            const { error } = await supabase
                .from('venues')
                .update({ image_url: u.promoterImage })
                .eq('id', u.venueId);

            if (error) {
                console.error(`    ✗ DB error: ${error.message}`);
            } else {
                console.log(`    ✓ Updated!`);
                updated++;
            }
        } else {
            console.log(`    [DRY RUN] Would update`);
            updated++;
        }
    }

    console.log(`\n--- Results ---`);
    console.log(`✓ Updated: ${updated}`);
    console.log(`⏭ No matching promoter: ${noMatch}`);
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
