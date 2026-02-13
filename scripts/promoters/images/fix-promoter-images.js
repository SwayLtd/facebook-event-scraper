/**
 * Update ALL promoter images: fetch high-res profile pictures via Graph API
 * public redirect, download, upload to Supabase storage, and update DB.
 *
 * Uses graph.facebook.com/{slug}/picture?width=960&height=960 which works
 * without authentication for public pages.
 *
 * Processes ALL promoters with a Facebook link.
 *
 * Usage:
 *   node scripts/promoters/images/fix-promoter-images.js [--dry-run] [--ids=417,419,420] [--start=0]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --ids=N,M    Only process specific promoter IDs (comma-separated)
 *   --start=N    Start from index N (for resuming after interruption)
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- CLI args ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const idsArg = args.find(a => a.startsWith('--ids='));
const specificIds = idsArg ? idsArg.split('=')[1].split(',').map(Number) : null;
const startArg = args.find(a => a.startsWith('--start='));
const START_INDEX = startArg ? parseInt(startArg.split('=')[1]) : 0;

// --- Supabase setup ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STORAGE_BUCKET = 'promoter-images';
const DELAY_MS = 2000;           // 2s between requests
const BATCH_SIZE = 40;            // Pause after N requests
const BATCH_PAUSE_MS = 30000;     // 30s pause every BATCH_SIZE requests
const MAX_RETRIES = 3;            // Max retries per promoter
const PROGRESS_FILE = join(__dirname, 'fix-progress.json');

/**
 * Extract Facebook page slug from URL
 */
function extractSlug(url) {
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/$/, '');
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'people' && parts.length >= 3) {
            // /people/Name/ID → use the numeric ID
            return parts[2];
        }
        return parts[parts.length - 1] || null;
    } catch {
        return null;
    }
}

/**
 * Fetch a high-res profile picture using the Graph API public redirect.
 * Works without authentication for public Facebook pages.
 * Returns { imageUrl, buffer, contentType, rateLimited } or null.
 */
async function fetchProfilePicture(slug) {
    const url = `https://graph.facebook.com/${slug}/picture?width=960&height=960`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
        });
        clearTimeout(timeout);

        // Rate-limit detection
        if (response.status === 429 || response.status === 503) {
            return { rateLimited: true };
        }

        if (!response.ok) {
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';

        // If FB returns HTML instead of an image, it might be a soft block
        if (contentType.includes('text/html')) {
            const text = await response.text();
            if (text.includes('checkpoint') || text.includes('rate limit')) {
                return { rateLimited: true };
            }
            return null;
        }

        // Check if it's the Facebook default silhouette image
        if (response.url.includes('84628273') || response.url.includes('176159830')) {
            return null; // Default profile picture
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Minimum 5KB to be a real profile picture
        if (buffer.length < 5000) {
            return null;
        }

        return { imageUrl: response.url, buffer, contentType, rateLimited: false };
    } catch {
        clearTimeout(timeout);
        return null;
    }
}

/**
 * Upload image buffer to Supabase storage.
 * Returns the public URL.
 */
async function uploadToStorage(promoterId, buffer, contentType) {
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filePath = `${promoterId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, buffer, {
            contentType,
            upsert: false,
        });

    if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

    return publicUrl;
}

/**
 * Update the promoter's image_url in the database.
 */
async function updatePromoterImageUrl(promoterId, storageUrl) {
    const { error } = await supabase
        .from('promoters')
        .update({ image_url: storageUrl })
        .eq('id', promoterId);

    if (error) {
        throw new Error(`DB update failed: ${error.message}`);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all promoters with a Facebook link from the DB.
 */
async function getPromotersToProcess() {
    let query = supabase
        .from('promoters')
        .select('id, name, image_url, external_links');

    if (specificIds) {
        query = query.in('id', specificIds);
    } else {
        // All promoters that have a Facebook link
        query = query.not('external_links->>facebook', 'is', null);
    }

    const { data, error } = await query.order('id');

    if (error) {
        console.error('❌ Failed to fetch promoters:', error.message);
        process.exit(1);
    }

    // Only filter out those without a FB link (for --ids mode)
    return data.filter(p => {
        const fbLink = p.external_links?.facebook;
        if (!fbLink) {
            console.log(`⏭ ID ${p.id} (${p.name}): no Facebook link, skipping`);
            return false;
        }
        return true;
    });
}

/**
 * Extract FB page URL from external_links
 */
function getFbUrl(promoter) {
    const fb = promoter.external_links?.facebook;
    if (!fb) return null;
    if (typeof fb === 'string') return fb;
    if (fb.link) return fb.link;
    return null;
}

async function main() {
    console.log('🔧 Update ALL Promoter Images — Download HD + Upload to Storage');
    console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    if (START_INDEX > 0) console.log(`   Starting from index: ${START_INDEX}`);
    console.log('');

    const promoters = await getPromotersToProcess();

    if (promoters.length === 0) {
        console.log('✅ No promoters to process!');
        return;
    }

    console.log(`Found ${promoters.length} promoter(s) with Facebook links`);
    if (START_INDEX > 0) console.log(`Skipping first ${START_INDEX}, processing ${promoters.length - START_INDEX}`);
    console.log('');

    let success = 0;
    let failed = 0;
    let skipped = 0;
    let rateLimitHits = 0;
    let requestsSincePause = 0;
    const startTime = Date.now();

    for (let i = START_INDEX; i < promoters.length; i++) {
        const p = promoters[i];
        const fbUrl = getFbUrl(p);
        const slug = extractSlug(fbUrl);
        const progress = `[${i + 1}/${promoters.length}]`;

        // Skip if already updated recently (timestamp >= 2026-02-12)
        if (p.image_url && p.image_url.includes('supabase.co/storage')) {
            const tsMatch = p.image_url.match(/\/(\d{13})\.\w+$/);
            if (tsMatch && parseInt(tsMatch[1]) >= 1770900000000) {
                skipped++;
                continue;
            }
        }

        console.log(`${progress} Processing ID ${p.id} — ${p.name}...`);

        if (!slug) {
            console.log(`  ✗ Could not extract slug from ${fbUrl}`);
            failed++;
            continue;
        }

        // Batch pause: take a longer break every BATCH_SIZE requests
        if (requestsSincePause >= BATCH_SIZE) {
            console.log(`\n⏸ Pausing ${BATCH_PAUSE_MS / 1000}s after ${BATCH_SIZE} requests...`);
            await delay(BATCH_PAUSE_MS);
            requestsSincePause = 0;
        }

        // Retry loop with exponential backoff
        let result = null;
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
            if (retry > 0) {
                const backoff = DELAY_MS * Math.pow(2, retry);
                console.log(`  ↻ Retry ${retry}/${MAX_RETRIES}, waiting ${backoff}ms...`);
                await delay(backoff);
            }

            result = await fetchProfilePicture(slug);
            requestsSincePause++;

            if (result?.rateLimited) {
                rateLimitHits++;
                const rateLimitPause = 60000 * (retry + 1); // 1min, 2min, 3min, 4min
                console.log(`  ⚠ Rate-limited! Waiting ${rateLimitPause / 1000}s...`);
                await delay(rateLimitPause);
                requestsSincePause = 0;
                result = null;
                continue;
            }

            break; // Got a result (success or no image), stop retrying
        }

        if (!result) {
            console.log(`  ✗ No profile picture available (default, missing, or blocked)`);
            failed++;
            await delay(DELAY_MS);
            continue;
        }

        const { buffer, contentType } = result;
        console.log(`  ✓ Got ${(buffer.length / 1024).toFixed(1)}KB image (${contentType})`);

        if (dryRun) {
            console.log(`  [DRY RUN] Would upload to storage and update DB`);
            success++;
            await delay(DELAY_MS);
            continue;
        }

        // Upload to Supabase storage + update DB
        try {
            console.log(`  → Uploading to storage...`);
            const storageUrl = await uploadToStorage(p.id, buffer, contentType);
            console.log(`  ✓ Uploaded: ${storageUrl}`);

            console.log(`  → Updating database...`);
            await updatePromoterImageUrl(p.id, storageUrl);
            console.log(`  ✓ DB updated!`);

            success++;
        } catch (err) {
            console.error(`  ✗ Error: ${err.message}`);
            failed++;
        }

        // Save progress every 10 promoters
        if ((success + failed) % 10 === 0) {
            const progress = { lastIndex: i, success, failed, skipped, rateLimitHits };
            writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        }

        await delay(DELAY_MS);
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n--- Results (${elapsed} min) ---`);
    console.log(`✓ Success: ${success}`);
    console.log(`✗ Failed:  ${failed}`);
    console.log(`⏭ Skipped: ${skipped}`);
    if (rateLimitHits) console.log(`⚠ Rate-limit hits: ${rateLimitHits}`);
    console.log(`Progress saved to ${PROGRESS_FILE}`);
    console.log('');

    // Final progress save
    writeFileSync(PROGRESS_FILE, JSON.stringify({
        completed: true, success, failed, skipped, rateLimitHits, elapsedMin: elapsed
    }, null, 2));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
