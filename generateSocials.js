#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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
// Helpers
// ---------------------------
const URL_REGEX = /https?:\/\/[\S"']+/gi;
const HANDLE_REGEX = /(?:IG:?|Insta:?|Instagram:?|Twitter:?|TW:?|X:?|x:?|FB:?|Facebook:?|SC:?|SoundCloud:?|Wiki:?|Wikipedia:?|BandCamp:?|BC:?|@)([A-Za-z0-9._%+-]+)/gi;

/**
 * Normalize a raw handle or URL into {platform, link}
 */
function normalize(platform, raw) {
    const r = raw.trim();
    // if full URL
    if (/^https?:\/\//i.test(r)) {
        try {
            const hostname = new URL(r).hostname.replace(/^www\./, '');
            return { platform: hostname, link: r };
        } catch {
            return null;
        }
    }
    // strip prefix
    const id = r.replace(/^(IG:?|ig:?|Insta:?|insta:?|Instagram:?|instagram:?|X:?|x:?|Twitter:?|twitter:?|TW:?|tw:?|FB:?|fb:?|Facebook:?|facebook:?|SC:?|sc:?|SoundCloud:?|soundcloud:?|Wiki:?|wiki:?|Wikipedia:?|wikipedia:?|BandCamp:?|bandcamp:?|BC:?|bc:?|@)/i, '').trim();
    let link;
    const p = platform.toLowerCase();
    if (['instagram', 'insta', 'ig'].includes(p)) {
        link = `https://instagram.com/${id}`;
        return { platform: 'instagram', link };
    }
    if (['twitter', 'tw', 'x'].includes(p)) {
        link = `https://x.com/${id}`;
        return { platform: 'x', link };
    }
    if (['facebook', 'fb'].includes(p)) {
        link = `https://facebook.com/${id}`;
        return { platform: 'facebook', link };
    }
    if (['bandcamp', 'bc'].includes(p)) {
        if (/\.bandcamp\.com/i.test(id)) link = id.startsWith('http') ? id : `https://${id}`;
        else link = `https://${id}.bandcamp.com`;
        return { platform: 'bandcamp', link };
    }
    if (['soundcloud', 'sc'].includes(p)) {
        link = `https://soundcloud.com/${id}`;
        return { platform: 'soundcloud', link };
    }
    if (['wikipedia', 'wiki'].includes(p)) {
        const article = encodeURIComponent(id.replace(/\s+/g, '_'));
        link = `https://en.wikipedia.org/wiki/${article}`;
        return { platform: 'wikipedia', link };
    }
    // fallback unknown handle
    return null;
}

/**
 * Extract normalized social objects from a description text
 */
function extractFromDescription(text = '') {
    const items = new Set();
    let m;
    // URLs
    while ((m = URL_REGEX.exec(text)) !== null) {
        const norm = normalize('', m[0]);
        if (norm) items.add(JSON.stringify(norm));
    }
    // handles
    while ((m = HANDLE_REGEX.exec(text)) !== null) {
        const raw = m[0];
        const prefix = raw.match(/^[A-Za-z]+(?=[:@]?)/i);
        const platform = prefix ? prefix[0] : '';
        const norm = normalize(platform, raw);
        if (norm) items.add(JSON.stringify(norm));
    }
    return Array.from(items).map(s => JSON.parse(s));
}

/**
 * Extract normalized social objects from external_links JSON
 * Safely handles null or undefined jsonLinks
 */
function extractFromJson(jsonLinks) {
    const obj = jsonLinks || {};
    const items = [];
    for (const [platform, data] of Object.entries(obj)) {
        if (data && typeof data === 'object' && data.link) {
            items.push({ platform: platform.toLowerCase(), link: data.link });
        }
    }
    return items;
}

/**
 * Merge two lists of social objects, dedupe by link
 */
function mergeUnique(arr1, arr2) {
    const map = new Map();
    [...arr1, ...arr2].forEach(item => {
        if (!map.has(item.link)) map.set(item.link, item);
    });
    return Array.from(map.values());
}

// ---------------------------
// Main
// ---------------------------
const [, , outputDir] = process.argv;
if (!outputDir) {
    console.error('Usage: node generateSocials.js <output-directory>');
    process.exit(1);
}
(async () => {
    const [
        { data: artists, error: errA },
        { data: promoters, error: errP },
        { data: venues, error: errV }
    ] = await Promise.all([
        supabase.from('artists').select('id, name, external_links, description'),
        supabase.from('promoters').select('id, name, description'),
        supabase.from('venues').select('id, name, description')
    ]);
    if (errA || errP || errV) {
        console.error('❌ Erreur Supabase:', (errA || errP || errV).message);
        process.exit(1);
    }

    const formatEntities = (rows, hasJson) => rows.map(r => {
        const fromJson = hasJson ? extractFromJson(r.external_links) : [];
        const fromDesc = extractFromDescription(r.description);
        const socials = mergeUnique(fromJson, fromDesc);
        return { id: r.id, name: r.name, socials };
    });

    const output = {
        artists: formatEntities(artists, true),
        promoters: formatEntities(promoters, false),
        venues: formatEntities(venues, false)
    };

    const baseOut = path.join(outputDir, 'generateSocials');
    fs.mkdirSync(baseOut, { recursive: true });

    const jsonPath = path.join(baseOut, 'socials.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`✅ JSON écrit dans : ${jsonPath}`);
})();
