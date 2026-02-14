/**
 * Local migration script: Migrate all images from Supabase Storage to Cloudflare R2.
 * 
 * Usage:
 *   node migrate_images_to_r2.js                   # migrate everything
 *   node migrate_images_to_r2.js events             # migrate only events
 *   node migrate_images_to_r2.js artists             # migrate only artists
 *   node migrate_images_to_r2.js --dry-run           # preview without uploading
 * 
 * Arborescence R2 (bucket: content-files):
 *   events/{id}/cover/{uuid}.{ext}
 *   artists/{id}/cover/{uuid}.{ext}
 *   venues/{id}/cover/{uuid}.{ext}
 *   promoters/{id}/cover/{uuid}.{ext}
 *   users/{supabase_id}/avatar/{uuid}.{ext}
 *   users/default.png
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { AwsClient } from 'aws4fetch';
import cliProgress from 'cli-progress';

// ─── Config ──────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = 'content-files';
const R2_CUSTOM_DOMAIN = 'https://assets.sway.events';

const DRY_RUN = process.argv.includes('--dry-run');
const ENTITY_FILTER = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);

const BATCH_SIZE = 500;
const CONCURRENCY = 2; // Parallel downloads (kept low to avoid Supabase rate limits)
const DB_UPDATE_DELAY = 50; // ms between DB updates to avoid rate limiting

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing R2 credentials in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const r2Client = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

// ─── Helpers ─────────────────────────────────────────────

const VALID_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'];

function isR2Url(url) {
  return url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com') || url.includes('assets.sway.events');
}

function isDownloadable(url) {
  if (!url || url === 'null' || url === '') return false;
  if (url.startsWith('data:')) return false;
  return true;
}

function getExtension(url, contentType) {
  // From URL path
  const urlPath = url.split('?')[0];
  const urlExt = urlPath.split('.').pop()?.toLowerCase();
  if (urlExt && VALID_EXTS.includes(urlExt)) return urlExt;
  // From content-type
  const ctExt = contentType?.split('/')?.pop()?.split(';')[0]?.trim();
  if (ctExt && VALID_EXTS.includes(ctExt)) return ctExt;
  return 'jpg';
}

async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SwayBot/1.0', 'Accept': 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, contentType };
  } catch (err) {
    return null;
  }
}

async function uploadToR2(buffer, objectName, contentType) {
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${objectName}`;
  const res = await r2Client.fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 PUT ${res.status}: ${text.substring(0, 200)}`);
  }
  return `${R2_CUSTOM_DOMAIN}/${objectName}`;
}

async function downloadAndUploadToR2(sourceUrl, folder, originalFilename) {
  if (isR2Url(sourceUrl)) return sourceUrl;

  const imageData = await downloadImage(sourceUrl);
  if (!imageData) return null;
  if (imageData.buffer.length < 1000) return null; // placeholder

  const ext = getExtension(sourceUrl, imageData.contentType);
  const filename = originalFilename || `${crypto.randomUUID()}.${ext}`;
  const objectName = `${folder}/${filename}`;

  const r2Url = await uploadToR2(imageData.buffer, objectName, imageData.contentType);
  return r2Url;
}

/** Update DB with retry */
async function updateDbWithRetry(table, imgCol, idCol, entityId, r2Url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { error } = await supabase
      .from(table)
      .update({ [imgCol]: r2Url })
      .eq(idCol, entityId);

    if (!error) {
      // Verify the update actually persisted
      const { data: verify } = await supabase
        .from(table)
        .select(imgCol)
        .eq(idCol, entityId)
        .single();

      if (verify && verify[imgCol] === r2Url) return true;
    }

    // Wait before retry
    await new Promise(r => setTimeout(r, 200 * attempt));
  }
  return false;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Run tasks with concurrency limit */
async function pMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Entity configs ──────────────────────────────────────

const ENTITY_CONFIGS = [
  { table: 'events',    folder: 'events',    imgCol: 'image_url',           idCol: 'id', sub: 'cover' },
  { table: 'artists',   folder: 'artists',   imgCol: 'image_url',           idCol: 'id', sub: 'cover' },
  { table: 'venues',    folder: 'venues',    imgCol: 'image_url',           idCol: 'id', sub: 'cover' },
  { table: 'promoters', folder: 'promoters', imgCol: 'image_url',           idCol: 'id', sub: 'cover' },
  { table: 'users',     folder: 'users',     imgCol: 'profile_picture_url', idCol: 'id', sub: 'avatar', pathIdCol: 'supabase_id' },
];

// ─── Migration logic ────────────────────────────────────

async function fetchAllRows(table, imgCol, idCol, pathIdCol) {
  const selectCols = [...new Set([idCol, imgCol, ...(pathIdCol ? [pathIdCol] : [])])].join(', ');
  let allRows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .not(imgCol, 'is', null)
      .order(idCol, { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`  DB error fetching ${table}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  return allRows;
}

async function migrateEntity(config) {
  const { table, folder, imgCol, idCol, sub, pathIdCol } = config;
  console.log(`\n━━━ Migrating: ${table} ━━━`);

  const rows = await fetchAllRows(table, imgCol, idCol, pathIdCol);
  console.log(`  Total rows with images: ${rows.length}`);

  // Filter: only rows NOT already on R2
  const toMigrate = rows.filter(row => {
    const url = row[imgCol];
    if (!isDownloadable(url)) return false;
    if (isR2Url(url)) return false;
    if (table === 'users' && url.includes('default.png')) return false;
    return true;
  });

  const alreadyR2 = rows.length - toMigrate.length;
  console.log(`  Already on R2 / skipped: ${alreadyR2}`);
  console.log(`  To migrate: ${toMigrate.length}`);

  if (toMigrate.length === 0) {
    console.log('  Nothing to migrate.');
    return { table, total: rows.length, migrated: 0, skipped: alreadyR2, failed: 0 };
  }

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would migrate these:');
    toMigrate.slice(0, 5).forEach(r => console.log(`    ${idCol}=${r[idCol]}: ${r[imgCol]?.substring(0, 80)}`));
    if (toMigrate.length > 5) console.log(`    ... and ${toMigrate.length - 5} more`);
    return { table, total: rows.length, migrated: 0, skipped: alreadyR2, failed: 0 };
  }

  // Progress bar
  const bar = new cliProgress.SingleBar({
    format: `  ${table} |{bar}| {percentage}% | {value}/{total} | migrated: {migrated} | failed: {failed}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
  });
  let migrated = 0;
  let failed = 0;
  const errors = [];
  bar.start(toMigrate.length, 0, { migrated: 0, failed: 0 });

  await pMap(toMigrate, async (row) => {
    const entityId = row[idCol];
    const pathId = pathIdCol ? row[pathIdCol] : entityId;
    const currentUrl = row[imgCol];

    try {
      const r2Folder = `${folder}/${pathId}/${sub}`;
      const r2Url = await downloadAndUploadToR2(currentUrl, r2Folder);

      if (r2Url && r2Url !== currentUrl) {
        const updated = await updateDbWithRetry(table, imgCol, idCol, entityId, r2Url);
        if (updated) {
          migrated++;
        } else {
          failed++;
          errors.push(`${entityId}: DB update failed after retries`);
        }
        // Small delay to avoid Supabase rate limits
        await sleep(DB_UPDATE_DELAY);
      } else {
        failed++;
        errors.push(`${entityId}: download/upload failed`);
      }
    } catch (err) {
      failed++;
      errors.push(`${entityId}: ${err.message}`);
    }

    bar.increment(1, { migrated, failed });
  }, CONCURRENCY);

  bar.stop();

  if (errors.length > 0) {
    console.log(`  Errors (first 10):`);
    errors.slice(0, 10).forEach(e => console.log(`    ⚠ ${e}`));
  }

  console.log(`  ✓ ${table}: migrated=${migrated}, failed=${failed}, skipped=${alreadyR2}`);
  return { table, total: rows.length, migrated, skipped: alreadyR2, failed };
}

async function migrateDefaultUserAvatar() {
  console.log('\n━━━ Migrating: default user avatar ━━━');

  const defaultUrl = `${SUPABASE_URL}/storage/v1/object/public/user-images/default.png`;

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would upload ${defaultUrl} → users/default.png`);
    return;
  }

  const r2Url = await downloadAndUploadToR2(defaultUrl, 'users', 'default.png');
  if (!r2Url) {
    console.error('  ✗ Failed to upload default avatar');
    return;
  }

  console.log(`  Uploaded to: ${r2Url}`);

  // Update all users still pointing at old default URLs
  const oldPatterns = [
    `${SUPABASE_URL}/storage/v1/object/public/user-images/default.png`,
    'https://api.sway.events/storage/v1/object/public/user-images/default.png',
    'https://gvuwtsdhgqefamzyfyjm.supabase.co/storage/v1/object/public/user-images/default.png',
  ];

  let totalUpdated = 0;
  for (const oldUrl of oldPatterns) {
    const { data, error } = await supabase
      .from('users')
      .update({ profile_picture_url: r2Url })
      .eq('profile_picture_url', oldUrl)
      .select('id');

    if (!error && data) totalUpdated += data.length;
  }

  // Catch any remaining default.png URLs
  const { data: likeData, error: likeErr } = await supabase
    .from('users')
    .update({ profile_picture_url: r2Url })
    .like('profile_picture_url', '%default.png')
    .not('profile_picture_url', 'eq', r2Url)
    .select('id');

  if (!likeErr && likeData) totalUpdated += likeData.length;

  console.log(`  ✓ Default avatar: updated ${totalUpdated} users → ${r2Url}`);
}

// ─── Main ────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Image Migration: Supabase → R2        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  R2 Domain: ${R2_CUSTOM_DOMAIN}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  if (DRY_RUN) console.log('  ⚡ DRY RUN — no uploads or DB changes');
  if (ENTITY_FILTER) console.log(`  Filter: ${ENTITY_FILTER} only`);
  console.log();

  const startTime = Date.now();

  // Determine which entities to migrate
  let configs = ENTITY_CONFIGS;
  if (ENTITY_FILTER) {
    if (ENTITY_FILTER === 'default-user') {
      await migrateDefaultUserAvatar();
      console.log(`\nDone in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      return;
    }
    const found = ENTITY_CONFIGS.find(c => c.table === ENTITY_FILTER || c.folder === ENTITY_FILTER);
    if (!found) {
      console.error(`Unknown entity: ${ENTITY_FILTER}`);
      console.error('Available: events, artists, venues, promoters, users, default-user, all');
      process.exit(1);
    }
    configs = [found];
  }

  // Migrate default user avatar first (unless filtering to a specific non-user entity)
  if (!ENTITY_FILTER || ENTITY_FILTER === 'users') {
    await migrateDefaultUserAvatar();
  }

  // Migrate all entities
  const results = [];
  for (const config of configs) {
    const result = await migrateEntity(config);
    results.push(result);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Migration Summary                     ║');
  console.log('╚══════════════════════════════════════════╝');
  for (const r of results) {
    console.log(`  ${r.table.padEnd(12)} total=${String(r.total).padStart(5)}  migrated=${String(r.migrated).padStart(5)}  skipped=${String(r.skipped).padStart(5)}  failed=${String(r.failed).padStart(4)}`);
  }
  const totalMigrated = results.reduce((s, r) => s + r.migrated, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.log(`\n  Total: ${totalMigrated} migrated, ${totalFailed} failed in ${elapsed}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
