#!/usr/bin/env node

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ---------------------------
// Config Supabase
// ---------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------
// Helpers & consts
// ---------------------------
const URL_REGEX = /\bhttps?:\/\/[^")\s'<>]+/gi;
const HANDLE_REGEX = /(?:IG:?|Insta:?|Instagram:?|Twitter:?|TW:?|X:?|x:?|FB:?|Facebook:?|SC:?|SoundCloud:?|Wiki:?|Wikipedia:?|BandCamp:?|BC:?|@)([A-Za-z0-9._-]+)/gi;
const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Normalise une URL ou un handle brut en { platform, link }
 */
function normalize(raw) {
    const r = raw.trim();
    // URL complète
    if (/^https?:\/\//i.test(r)) {
        let url;
        try { url = new URL(r); } catch { return null; }
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 1) return null;
        const id = segments[0].toLowerCase();
        if (!VALID_ID.test(id) || id.length < 2 || ['http', 'https'].includes(id)) return null;
        let platform;
        switch (host) {
            case 'instagram.com': platform = 'instagram'; break;
            case 'twitter.com':
            case 'x.com': platform = 'x'; break;
            case 'facebook.com': platform = 'facebook'; break;
            case 'soundcloud.com': platform = 'soundcloud'; break;
            default:
                if (host.endsWith('.bandcamp.com')) platform = 'bandcamp';
                else if (host.endsWith('.wikipedia.org')) platform = 'wikipedia';
                else return null;
        }
        return { platform, link: `${url.protocol}//${url.hostname}/${segments[0]}` };
    }
    // Handle brut
    if (/^https?:/i.test(r)) return null;
    const prefixMatch = r.match(/^[A-Za-z]+(?=[:@]?)/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    const id = r.replace(/^[A-Za-z]+[:@]?/i, '').trim().toLowerCase();
    if (!VALID_ID.test(id) || id.length < 2) return null;
    if (['instagram', 'insta', 'ig'].includes(prefix)) return { platform: 'instagram', link: `https://instagram.com/${id}` };
    if (['twitter', 'tw', 'x'].includes(prefix)) return { platform: 'x', link: `https://x.com/${id}` };
    if (['facebook', 'fb'].includes(prefix)) return { platform: 'facebook', link: `https://facebook.com/${id}` };
    if (['soundcloud', 'sc'].includes(prefix)) return { platform: 'soundcloud', link: `https://soundcloud.com/${id}` };
    if (['bandcamp', 'bc'].includes(prefix)) return { platform: 'bandcamp', link: `https://${id}.bandcamp.com` };
    if (['wikipedia', 'wiki'].includes(prefix)) return { platform: 'wikipedia', link: `https://en.wikipedia.org/wiki/${encodeURIComponent(id.replace(/\s+/g, '_'))}` };
    return null;
}

/**
 * Extrait et normalise tous les liens d’une description texte
 */
function extractFromDescription(text = '') {
    const set = new Set();
    let m;
    while ((m = URL_REGEX.exec(text)) !== null) {
        const norm = normalize(m[0]);
        if (norm) set.add(JSON.stringify(norm));
    }
    while ((m = HANDLE_REGEX.exec(text)) !== null) {
        const norm = normalize(m[0]);
        if (norm) set.add(JSON.stringify(norm));
    }
    return Array.from(set).map(JSON.parse);
}

/**
 * Extrait et normalise depuis le JSON external_links déjà stocké
 */
function extractFromJson(jsonLinks) {
    if (!jsonLinks || typeof jsonLinks !== 'object') return [];
    return Object.entries(jsonLinks)
        .map(([platform, data]) => {
            if (!data || !data.link) return null;
            const norm = normalize(data.link);
            return norm
                ? { platform, link: norm.link, id: data.id }
                : { platform, link: data.link, id: data.id };
        })
        .filter(Boolean);
}

/**
 * Fusionne deux tableaux de liens unique sur la propriété `link`
 */
function mergeUnique(a, b) {
    const map = new Map();
    for (const item of [...a, ...b]) {
        if (item && !map.has(item.link)) map.set(item.link, item);
    }
    return Array.from(map.values());
}

/**
 * Ne garde que le premier lien par plateforme
 */
function firstPerPlatform(socials) {
    const seen = new Set();
    return socials.filter(s => {
        if (seen.has(s.platform)) return false;
        seen.add(s.platform);
        return true;
    });
}

// ---------------------------
// Main
// ---------------------------
(async () => {
    const { data: artists, error } = await supabase
        .from('artists')
        .select('id, external_links, description');
    if (error) {
        console.error('❌ Erreur Supabase:', error.message);
        process.exit(1);
    }

    for (const artist of artists) {
        const jsonLinks = extractFromJson(artist.external_links);
        const descLinks = extractFromDescription(artist.description);
        const allLinks = mergeUnique(jsonLinks, descLinks);
        const socials = firstPerPlatform(allLinks);
        if (socials.length === 0) continue;

        // Reconstruction de external_links en préservant l'id si existant
        const updatedLinks = { ...artist.external_links };
        let hasChange = false;
        for (const { platform, link, id } of socials) {
            if (!updatedLinks[platform]) {
                updatedLinks[platform] = id ? { id, link } : { link };
                hasChange = true;
            }
        }
        if (!hasChange) continue;

        const { error: upErr } = await supabase
            .from('artists')
            .update({ external_links: updatedLinks })
            .eq('id', artist.id);
        if (upErr) console.error(`⚠️ Erreur update id=${artist.id}:`, upErr.message);
        else console.log(`✅ Mis à jour id=${artist.id} avec:`, updatedLinks);
    }
})();