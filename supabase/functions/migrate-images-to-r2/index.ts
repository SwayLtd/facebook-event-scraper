/**
 * migrate-images-to-r2 Edge Function
 * 
 * One-shot migration: downloads images from Supabase Storage (or external URLs)
 * and re-uploads them to Cloudflare R2 with the new folder structure.
 * 
 * POST body:
 *   { "entity": "events" | "artists" | "venues" | "promoters" | "users" | "all" }
 *   { "entity": "events", "batchSize": 50, "offset": 0 }  — for manual pagination
 *   { "entity": "default-user" }  — copies the default user avatar only
 * 
 * Arborescence R2 (bucket: content-files):
 *   events/{id}/cover/{uuid}.{ext}
 *   artists/{id}/cover/{uuid}.{ext}
 *   venues/{id}/cover/{uuid}.{ext}
 *   promoters/{id}/cover/{uuid}.{ext}
 *   users/{uuid}/avatar/{uuid}.{ext}
 *   users/default.png
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { downloadAndUploadToR2 } from '../_shared/utils/r2.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Helpers ──────────────────────────────────────────────

/** Check if an image URL is already on R2 */
function isR2Url(url: string): boolean {
  return url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com') || url.includes('assets.sway.events');
}

/** Determine if a URL is downloadable (not a placeholder / null) */
function isDownloadable(url: string | null): url is string {
  if (!url) return false;
  if (url === 'null' || url === '') return false;
  if (url.startsWith('data:')) return false;
  return true;
}

// ─── Entity migration functions ───────────────────────────

interface MigrationResult {
  entity: string;
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Migrate images for a given entity table.
 * For each row with an image_url NOT already on R2, downloads and re-uploads to R2.
 */
/**
 * @param pathIdColumn - Column used for the R2 folder path (e.g. 'supabase_id' for users UUID paths)
 *                       Falls back to idColumn if not provided.
 */
async function migrateEntity(
  supabase: any,
  entityTable: string,
  entityFolder: string,
  imageColumn: string,
  idColumn: string,
  subfolder: string,
  batchSize: number,
  offset: number,
  pathIdColumn?: string
): Promise<MigrationResult> {
  const result: MigrationResult = {
    entity: entityTable,
    total: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Build select columns: always need idColumn + imageColumn, optionally pathIdColumn
  const selectCols = [idColumn, imageColumn];
  if (pathIdColumn && pathIdColumn !== idColumn) selectCols.push(pathIdColumn);
  const selectStr = [...new Set(selectCols)].join(', ');

  // Fetch rows with images
  const { data: rows, error } = await supabase
    .from(entityTable)
    .select(selectStr)
    .not(imageColumn, 'is', null)
    .order(idColumn, { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    result.errors.push(`DB query failed: ${error.message}`);
    return result;
  }

  if (!rows || rows.length === 0) {
    logger.info(`No rows to migrate for ${entityTable} (offset=${offset})`);
    return result;
  }

  result.total = rows.length;
  logger.info(`Migrating ${entityTable}: ${rows.length} rows (offset=${offset})`);

  for (const row of rows) {
    const entityId = row[idColumn];
    const pathId = pathIdColumn ? row[pathIdColumn] : entityId;
    const currentUrl = row[imageColumn];

    // Skip if already on R2
    if (isR2Url(currentUrl)) {
      result.skipped++;
      continue;
    }

    // Skip default user avatar (handled separately)
    if (entityTable === 'users' && currentUrl.includes('default.png')) {
      result.skipped++;
      continue;
    }

    // Skip if not downloadable
    if (!isDownloadable(currentUrl)) {
      result.skipped++;
      continue;
    }

    try {
      const r2Folder = `${entityFolder}/${pathId}/${subfolder}`;
      const r2Url = await downloadAndUploadToR2(currentUrl, r2Folder);

      if (r2Url !== currentUrl) {
        // Update DB with new R2 URL
        const { error: updateError } = await supabase
          .from(entityTable)
          .update({ [imageColumn]: r2Url })
          .eq(idColumn, entityId);

        if (updateError) {
          result.failed++;
          result.errors.push(`Update failed for ${entityTable} ${entityId}: ${updateError.message}`);
        } else {
          result.migrated++;
          logger.debug(`Migrated ${entityTable}/${entityId}: ${r2Url}`);
        }
      } else {
        // downloadAndUploadToR2 returned original URL → R2 not configured or download failed
        result.failed++;
        result.errors.push(`R2 upload returned original URL for ${entityTable} ${entityId}`);
      }
    } catch (err) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entityTable} ${entityId}: ${msg}`);
      logger.error(`Migration failed for ${entityTable} ${entityId}`, err);
    }
  }

  logger.info(`${entityTable} migration batch done`, {
    migrated: result.migrated,
    skipped: result.skipped,
    failed: result.failed,
  });

  return result;
}

/**
 * Migrate the default user avatar to R2 at users/default.png
 */
async function migrateDefaultUserAvatar(supabase: any): Promise<MigrationResult> {
  const result: MigrationResult = {
    entity: 'default-user',
    total: 1,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const defaultUrl = 'https://gvuwtsdhgqefamzyfyjm.supabase.co/storage/v1/object/public/user-images/default.png';

  try {
    // Download from Supabase Storage
    const r2Url = await downloadAndUploadToR2(defaultUrl, 'users', 'default.png');

    if (r2Url !== defaultUrl) {
      // Update all users that have the old default URL (two possible domain patterns)
      const oldUrls = [
        'https://gvuwtsdhgqefamzyfyjm.supabase.co/storage/v1/object/public/user-images/default.png',
        'https://api.sway.events/storage/v1/object/public/user-images/default.png',
      ];

      let totalUpdated = 0;
      for (const oldUrl of oldUrls) {
        const { data: updated, error: updateError } = await supabase
          .from('users')
          .update({ profile_picture_url: r2Url })
          .eq('profile_picture_url', oldUrl)
          .select('id');

        if (updateError) {
          result.errors.push(`Default avatar update failed for URL pattern: ${updateError.message}`);
        } else {
          totalUpdated += updated?.length || 0;
        }
      }

      // Also update users with a LIKE match on default.png (catch variants)
      const { data: likeUpdated, error: likeError } = await supabase
        .from('users')
        .update({ profile_picture_url: r2Url })
        .like('profile_picture_url', '%default.png')
        .not('profile_picture_url', 'eq', r2Url)
        .select('id');

      if (!likeError) {
        totalUpdated += likeUpdated?.length || 0;
      }

      if (result.errors.length > 0) {
        result.failed = 1;
      } else {
        result.migrated = 1;
        logger.info(`Default user avatar migrated to R2: ${r2Url}. Updated ${totalUpdated} users.`);
      }
    } else {
      result.failed = 1;
      result.errors.push('R2 upload returned original URL');
    }
  } catch (err) {
    result.failed = 1;
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Default avatar migration failed: ${msg}`);
  }

  return result;
}

// ─── Main handler ─────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const entity = body.entity || 'all';
    const batchSize = body.batchSize || 100;
    const offset = body.offset || 0;

    logger.info('Image migration started', { entity, batchSize, offset });

    const results: MigrationResult[] = [];

    // Entity configs: [tableName, r2Folder, imageColumn, idColumn, subfolder, pathIdColumn?]
    const entityConfigs: [string, string, string, string, string, string?][] = [
      ['events',    'events',    'image_url',           'id', 'cover'],
      ['artists',   'artists',   'image_url',           'id', 'cover'],
      ['venues',    'venues',    'image_url',           'id', 'cover'],
      ['promoters', 'promoters', 'image_url',           'id', 'cover'],
      ['users',     'users',     'profile_picture_url', 'id', 'avatar', 'supabase_id'],
    ];

    if (entity === 'default-user') {
      // Special case: just migrate the default avatar
      const r = await migrateDefaultUserAvatar(supabase);
      results.push(r);
    } else if (entity === 'all') {
      // Migrate default user avatar first
      const defaultResult = await migrateDefaultUserAvatar(supabase);
      results.push(defaultResult);

      // Then migrate all entities
      for (const [table, folder, imgCol, idCol, sub, pathIdCol] of entityConfigs) {
        // For "all" mode, paginate through everything
        let currentOffset = 0;
        const allBatchSize = 100;
        let hasMore = true;

        while (hasMore) {
          const r = await migrateEntity(supabase, table, folder, imgCol, idCol, sub, allBatchSize, currentOffset, pathIdCol);
          results.push(r);
          hasMore = r.total === allBatchSize; // If we got a full batch, there might be more
          currentOffset += allBatchSize;
        }
      }
    } else {
      // Single entity migration with pagination
      const config = entityConfigs.find(c => c[0] === entity || c[1] === entity);
      if (!config) {
        return new Response(
          JSON.stringify({ error: `Unknown entity: ${entity}. Use: events, artists, venues, promoters, users, default-user, all` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const [table, folder, imgCol, idCol, sub, pathIdCol] = config;
      const r = await migrateEntity(supabase, table, folder, imgCol, idCol, sub, batchSize, offset, pathIdCol);
      results.push(r);
    }

    // Aggregate results
    const summary = {
      totalMigrated: results.reduce((s, r) => s + r.migrated, 0),
      totalSkipped: results.reduce((s, r) => s + r.skipped, 0),
      totalFailed: results.reduce((s, r) => s + r.failed, 0),
      totalProcessed: results.reduce((s, r) => s + r.total, 0),
      durationMs: Date.now() - startTime,
      batches: results.map(r => ({
        entity: r.entity,
        total: r.total,
        migrated: r.migrated,
        skipped: r.skipped,
        failed: r.failed,
        errors: r.errors.slice(0, 5), // Only keep first 5 errors per batch
      })),
    };

    logger.info('Migration completed', summary);

    return new Response(
      JSON.stringify({ success: true, ...summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Migration failed', err);
    return new Response(
      JSON.stringify({ success: false, error: msg, durationMs: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
