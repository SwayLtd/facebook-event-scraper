// Cloudflare R2 upload utilities for Edge Functions
// Uses aws4fetch for S3-compatible API calls to R2
// Mirrors the Flutter app's CloudflareR2Service but for server-side use

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { logger } from './logger.ts';
import { withRetry } from './retry.ts';

// We use the AwsClient from aws4fetch for S3 v4 signed requests
// Imported dynamically to avoid bundling issues

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

interface UploadResult {
  success: boolean;
  url?: string;
  objectName?: string;
  error?: string;
}

/**
 * Get R2 configuration from environment variables
 * Uses the same env var names as the Flutter app
 */
function getR2Config(): R2Config | null {
  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const publicUrl = Deno.env.get('R2_PUBLIC_URL');

  if (!accountId || !accessKeyId || !secretAccessKey) {
    logger.warn('R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName: 'content-files', // Same bucket as Flutter app
    publicUrl: publicUrl || `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

/**
 * Create an S3-compatible client for R2 using aws4fetch
 */
async function createR2Client(config: R2Config) {
  // Dynamic import of aws4fetch
  const { AwsClient } = await import('https://esm.sh/aws4fetch@1.0.20');

  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
}

/**
 * Generate a unique filename with UUID
 */
function generateUniqueFilename(originalName: string): string {
  const ext = originalName.split('.').pop() || 'jpg';
  const uuid = crypto.randomUUID();
  return `${uuid}.${ext}`;
}

/**
 * Detect content type from URL or filename
 */
function detectContentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.png') || lower.includes('png')) return 'image/png';
  if (lower.includes('.webp') || lower.includes('webp')) return 'image/webp';
  if (lower.includes('.gif') || lower.includes('gif')) return 'image/gif';
  if (lower.includes('.svg') || lower.includes('svg')) return 'image/svg+xml';
  return 'image/jpeg'; // Default to JPEG
}

/**
 * Download an image from a URL and return the bytes
 */
async function downloadImage(imageUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    logger.debug(`Downloading image from: ${imageUrl.substring(0, 100)}...`);

    const response = await withRetry(async () => {
      const res = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SwayBot/1.0)',
          'Accept': 'image/*,*/*',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    }, { maxRetries: 2, initialDelay: 500 });

    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || detectContentType(imageUrl);

    logger.info(`Image downloaded: ${bytes.length} bytes, type: ${contentType}`);
    return { bytes, contentType };
  } catch (error) {
    logger.error('Failed to download image', error, { url: imageUrl.substring(0, 100) });
    return null;
  }
}

/**
 * Upload bytes to Cloudflare R2 using S3-compatible API
 * 
 * @param bytes - File content as Uint8Array
 * @param objectName - Full object path (e.g., 'events/uuid.jpg')
 * @param contentType - MIME type
 * @param config - R2 configuration
 * @returns Upload result with public URL
 */
async function uploadToR2(
  bytes: Uint8Array,
  objectName: string,
  contentType: string,
  config: R2Config
): Promise<UploadResult> {
  try {
    const client = await createR2Client(config);

    // S3-compatible endpoint for R2
    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${objectName}`;

    logger.info(`Uploading to R2: ${objectName} (${bytes.length} bytes, ${contentType})`);

    const response = await withRetry(async () => {
      return await client.fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(bytes.length),
        },
        body: bytes,
      });
    }, { maxRetries: 3, initialDelay: 1000 });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`R2 upload failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Build public URL
    const publicUrl = `${config.publicUrl}/${objectName}`;

    logger.info(`R2 upload successful: ${publicUrl}`);

    return {
      success: true,
      url: publicUrl,
      objectName,
    };
  } catch (error) {
    logger.error('R2 upload failed', error, { objectName });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Download an image from a source URL and upload it to R2
 * This is the main function to use for migrating images to R2
 * 
 * @param sourceUrl - The original image URL (Facebook, SoundCloud, Google, etc.)
 * @param folder - The folder path in the bucket (e.g., 'event/123/cover', 'artist/456/cover', 'venue/789/cover')
 * @param originalFilename - Optional original filename for extension detection
 * @returns The permanent R2 public URL, or the original URL if upload fails
 */
export async function downloadAndUploadToR2(
  sourceUrl: string,
  folder: string,
  originalFilename?: string
): Promise<string> {
  // Check if R2 is configured
  const config = getR2Config();
  if (!config) {
    logger.warn('R2 not configured, using original URL');
    return sourceUrl;
  }

  // Skip if already an R2 URL (r2.dev subdomain, S3 endpoint, or custom domain)
  if (
    sourceUrl.includes('r2.dev') ||
    sourceUrl.includes('r2.cloudflarestorage.com') ||
    sourceUrl.includes('assets.sway.events')
  ) {
    logger.debug('URL is already an R2 URL, skipping upload');
    return sourceUrl;
  }

  // Skip data URIs
  if (sourceUrl.startsWith('data:')) {
    logger.warn('Cannot upload data URI to R2');
    return sourceUrl;
  }

  try {
    // Download the image
    const imageData = await downloadImage(sourceUrl);
    if (!imageData) {
      logger.warn('Failed to download image, using original URL as fallback');
      return sourceUrl;
    }

    // Skip small images (likely placeholders or broken)
    if (imageData.bytes.length < 1000) {
      logger.warn('Image too small (< 1KB), likely a placeholder — skipping R2 upload');
      return sourceUrl;
    }

    // Generate filename
    // Extract extension from URL path first, then content-type (strip charset params)
    const urlPath = sourceUrl.split('?')[0]; // Remove query params
    const urlExt = urlPath.split('.').pop()?.toLowerCase();
    const validExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'];
    const extFromUrl = urlExt && validExts.includes(urlExt) ? urlExt : null;
    const extFromContentType = imageData.contentType.split('/').pop()?.split(';')[0]?.trim();
    const extFromCT = extFromContentType && validExts.includes(extFromContentType) ? extFromContentType : null;
    const ext = extFromUrl
      || originalFilename?.split('.').pop()
      || extFromCT
      || 'jpg';
    // Use originalFilename as-is when provided (e.g. 'default.png'), otherwise UUID
    const filename = originalFilename || `${crypto.randomUUID()}.${ext}`;
    const objectName = `${folder}/${filename}`;

    // Upload to R2
    const result = await uploadToR2(imageData.bytes, objectName, imageData.contentType, config);

    if (result.success && result.url) {
      return result.url;
    }

    logger.warn('R2 upload failed, using original URL as fallback');
    return sourceUrl;
  } catch (error) {
    logger.error('downloadAndUploadToR2 failed', error, {
      sourceUrl: sourceUrl.substring(0, 100),
      folder
    });
    return sourceUrl;
  }
}

/**
 * Check if R2 is configured and available
 */
export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

/**
 * Download an image and upload to R2 with entity-based folder structure
 * Builds the path as: {entity}/{entityId}/cover/{uuid}.{ext}
 * 
 * @param sourceUrl - The original image URL
 * @param entity - Entity type: 'events', 'venues', 'artists', 'promoters'
 * @param entityId - The database ID of the entity
 * @param subfolder - Subfolder within entity (default: 'cover')
 * @returns The permanent R2 public URL, or the original URL if upload fails
 */
export async function downloadAndUploadEntityImage(
  sourceUrl: string,
  entity: 'events' | 'venues' | 'artists' | 'promoters',
  entityId: number | string,
  subfolder: string = 'cover'
): Promise<string> {
  const folder = `${entity}/${entityId}/${subfolder}`;
  return downloadAndUploadToR2(sourceUrl, folder);
}

export { getR2Config, uploadToR2, downloadImage, generateUniqueFilename, detectContentType };
export type { R2Config, UploadResult };
