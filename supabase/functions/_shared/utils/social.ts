// Social link normalization utilities for Edge Functions
// Ported from utils/social.js

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { logger } from './logger.ts';

const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Normalizes a raw social media handle or URL into a full URL.
 * Supports Instagram, Twitter/X, Facebook, SoundCloud, Bandcamp, Wikipedia.
 * @param raw - Raw handle or URL string
 * @returns Normalized full URL or null if not recognizable
 */
export function normalizeSocialLink(raw: string): string | null {
    const r = raw.trim();
    // Full URL — keep as-is
    if (/^https?:\/\//i.test(r)) {
        return r;
    }
    // Raw handle with optional prefix
    const prefixMatch = r.match(/^[A-Za-z]+(?=[:@]?)/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    const id = r.replace(/^[A-Za-z]+[:@]?/i, '').trim().toLowerCase();
    if (!VALID_ID.test(id) || id.length < 2) return null;
    if (['instagram', 'insta', 'ig'].includes(prefix)) return `https://instagram.com/${id}`;
    if (['twitter', 'tw', 'x'].includes(prefix)) return `https://twitter.com/${id}`;
    if (['facebook', 'fb'].includes(prefix)) return `https://facebook.com/${id}`;
    if (['soundcloud', 'sc'].includes(prefix)) return `https://soundcloud.com/${id}`;
    if (['bandcamp', 'bc'].includes(prefix)) return `https://${id}.bandcamp.com`;
    if (['wikipedia', 'wiki'].includes(prefix)) return `https://en.wikipedia.org/wiki/${id}`;
    return null;
}

/**
 * Normalizes all external links in an object.
 * Handles both string values and objects with a `link` property.
 * @param externalLinksObj - Object with platform keys and link values
 * @returns Normalized links object, or null if empty
 */
export function normalizeExternalLinks(externalLinksObj: Record<string, any> | null | undefined): Record<string, any> | null {
    if (!externalLinksObj || typeof externalLinksObj !== 'object') return null;
    const normalized: Record<string, any> = {};
    for (const [platform, data] of Object.entries(externalLinksObj)) {
        if (typeof data === 'string') {
            const norm = normalizeSocialLink(data);
            if (norm) normalized[platform] = norm;
        } else if (data && typeof data === 'object' && data.link) {
            const norm = normalizeSocialLink(data.link);
            if (norm) normalized[platform] = { ...data, link: norm };
        } else if (data && typeof data === 'object') {
            // Pass through structured objects (e.g., { id: '...', link: undefined })
            normalized[platform] = data;
        }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * Fetches a high-resolution image from Facebook Graph API.
 * @param objectId - The Facebook object ID (e.g., page slug or numeric ID)
 * @returns The URL of the high-resolution image, or null
 */
export async function fetchHighResImage(objectId: string): Promise<string | null> {
    try {
        const longLivedToken = Deno.env.get('LONG_LIVED_TOKEN');
        if (!longLivedToken) {
            logger.warn('LONG_LIVED_TOKEN not set, cannot fetch high-res image');
            return null;
        }
        const response = await fetch(
            `https://graph.facebook.com/${objectId}?fields=picture.width(720).height(720)&access_token=${longLivedToken}`
        );
        const data = await response.json();
        if (data.picture?.data?.url) {
            return data.picture.data.url;
        }
    } catch (err) {
        logger.error('Error fetching high resolution image', err);
    }
    return null;
}
