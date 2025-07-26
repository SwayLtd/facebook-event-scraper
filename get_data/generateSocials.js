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
// Helpers & consts
// ---------------------------
const URL_REGEX = /\bhttps?:\/\/[^\s"'<>]+/gi;
const HANDLE_REGEX = /(?:IG:?|Insta:?|Instagram:?|Twitter:?|TW:?|X:?|x:?|FB:?|Facebook:?|SC:?|SoundCloud:?|Wiki:?|Wikipedia:?|BandCamp:?|BC:?|@)([A-Za-z0-9._-]+)/gi;
// Un ID doit commencer et finir par [A-Za-z0-9], autoriser ., _, - à l’intérieur.
const VALID_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Normalise une URL ou un handle brut en { platform, link }
 * - Filtre les handles commençant par "http"
 * - Pour les URLs, supprime query et hash
 * - Ne conserve qu'un seul segment de path
 * - Ignore spécifiquement les chemins "http" ou "https"
 * Renvoie null si invalide.
 */
function normalize(raw) {
    const r = raw.trim();

    // --- Cas URL complète ---
    if (/^https?:\/\//i.test(r)) {
        let url;
        try {
            url = new URL(r);
        } catch {
            return null;
        }

        // Host canonique
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        // Segments de chemin
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length !== 1) return null;

        const id = segments[0].toLowerCase();
        // Filtre id trop court, invalides ou équivalent "http(s)"
        if (!VALID_ID.test(id) || id.length < 2 || id === 'http' || id === 'https') {
            return null;
        }

        // Détermination de la plateforme
        let platform;
        switch (host) {
            case 'instagram.com':
                platform = 'instagram'; break;
            case 'x.com':
            case 'twitter.com':
                platform = 'x'; break;
            case 'facebook.com':
                platform = 'facebook'; break;
            case 'soundcloud.com':
                platform = 'soundcloud'; break;
            default:
                if (host.endsWith('.bandcamp.com')) {
                    platform = 'bandcamp';
                    break;
                }
                if (host.endsWith('.wikipedia.org')) {
                    platform = 'wikipedia';
                    break;
                }
                return null;
        }

        // Reconstruction sans query ni hash, et sans slash final
        const cleanPath = `/${segments[0]}`;
        const cleanLink = `${url.protocol}//${url.hostname}${cleanPath}`;
        return { platform, link: cleanLink };
    }

    // --- Cas handle brut ---
    // Empêcher qu'on capture "https" ou "http" comme handle
    if (/^https?:/i.test(r)) {
        return null;
    }

    // Extraction du préfixe (IG, Twitter, @, etc.)
    const prefixMatch = r.match(/^[A-Za-z]+(?=[:@]?)/);
    const prefix = prefixMatch ? prefixMatch[0].toLowerCase() : '';
    // On retire le préfixe pour obtenir l'ID
    const id = r.replace(/^[A-Za-z]+[:@]?/i, '').trim().toLowerCase();
    if (!VALID_ID.test(id) || id.length < 2) {
        return null;
    }

    // Génération de l'URL selon la plateforme
    if (['instagram', 'insta', 'ig'].includes(prefix)) {
        return { platform: 'instagram', link: `https://instagram.com/${id}` };
    }
    if (['twitter', 'tw', 'x'].includes(prefix)) {
        return { platform: 'x', link: `https://x.com/${id}` };
    }
    if (['facebook', 'fb'].includes(prefix)) {
        return { platform: 'facebook', link: `https://facebook.com/${id}` };
    }
    if (['soundcloud', 'sc'].includes(prefix)) {
        return { platform: 'soundcloud', link: `https://soundcloud.com/${id}` };
    }
    if (['bandcamp', 'bc'].includes(prefix)) {
        return { platform: 'bandcamp', link: `https://${id}.bandcamp.com` };
    }
    if (['wikipedia', 'wiki'].includes(prefix)) {
        const article = encodeURIComponent(id.replace(/\s+/g, '_'));
        return { platform: 'wikipedia', link: `https://en.wikipedia.org/wiki/${article}` };
    }

    return null;
}

/**
 * Extrait et normalise tous les liens d’une description texte
 */
function extractFromDescription(text = '') {
    const set = new Set();
    let m;

    // URLs
    while ((m = URL_REGEX.exec(text)) !== null) {
        const norm = normalize(m[0]);
        if (norm) set.add(JSON.stringify(norm));
    }

    // Handles
    while ((m = HANDLE_REGEX.exec(text)) !== null) {
        const norm = normalize(m[0]);
        if (norm) set.add(JSON.stringify(norm));
    }

    return Array.from(set).map(JSON.parse);
}

/**
 * Extrait et normalise depuis le JSON external_links (artists only)
 */
function extractFromJson(jsonLinks) {
    if (!jsonLinks || typeof jsonLinks !== 'object') return [];
    return Object.entries(jsonLinks)
        .map(([, data]) =>
            data && data.link ? normalize(data.link) : null
        )
        .filter(x => x);
}

/**
 * Fusionne deux tableaux de socials, dédupliqués sur la propriété link
 */
function mergeUnique(a, b) {
    const map = new Map();
    for (const item of [...a, ...b]) {
        if (item && !map.has(item.link)) {
            map.set(item.link, item);
        }
    }
    return Array.from(map.values());
}

/**
 * Déduit, pour chaque plateforme, le premier lien uniquement.
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
    const [, , outputDir] = process.argv;
    if (!outputDir) {
        console.error('Usage: node generateSocials.js <output-directory>');
        process.exit(1);
    }

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

    const formatEntities = (rows, hasJson) =>
        rows
            .map(r => {
                const jsonLinks = hasJson ? extractFromJson(r.external_links) : [];
                const descLinks = extractFromDescription(r.description);
                const merged = mergeUnique(jsonLinks, descLinks);
                const socials = firstPerPlatform(merged);
                return { id: r.id, name: r.name, socials };
            })
            .filter(e => e.socials.length > 0);

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
