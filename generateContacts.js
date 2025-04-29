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
// Regex & utilitaires e-mail
// ---------------------------
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function extractEmails(text = '') {
    const found = [];
    let m;
    while ((m = EMAIL_REGEX.exec(text)) !== null) {
        found.push(m[0].toLowerCase());
    }
    return Array.from(new Set(found));
}

function categorizeEmail(email) {
    const local = email.split('@')[0];
    if (/^booking/.test(local)) return 'booking';
    if (/^info/.test(local)) return 'info';
    if (/^contact/.test(local)) return 'contact';
    if (/^press/.test(local)) return 'press';
    if (/^demo/.test(local)) return 'demo';
    if (/promo/.test(local)) return 'promo';
    if (/(manage|agency|talent)/.test(local)) return 'management';
    return 'unknown';
}

// ---------------------------
// Transformation & filtrage
// ---------------------------
function formatContacts(rows) {
    return rows
        .map(r => {
            const emails = extractEmails(r.description);
            return {
                id: r.id,
                name: r.name,
                emails: emails.map(email => ({
                    email,
                    type: categorizeEmail(email)
                }))
            };
        })
        .filter(r => r.emails.length > 0);
}

// ---------------------------
// Entrée commande
// ---------------------------
const [, , outputDir] = process.argv;
if (!outputDir) {
    console.error('Usage: node generateContacts.js <output-directory>');
    process.exit(1);
}

async function main() {
    // 1) Récupérer tables
    const [
        { data: artists, error: errA },
        { data: promoters, error: errP },
        { data: venues, error: errV }
    ] = await Promise.all([
        supabase.from('artists').select('id, name, description'),
        supabase.from('promoters').select('id, name, description'),
        supabase.from('venues').select('id, name, description')
    ]);

    if (errA || errP || errV) {
        console.error('❌ Erreur Supabase :', errA?.message || errP?.message || errV?.message);
        process.exit(1);
    }

    // 2) Formatter
    const artistsContacts = formatContacts(artists);
    const promotersContacts = formatContacts(promoters);
    const venuesContacts = formatContacts(venues);

    const output = {
        artists: artistsContacts,
        promoters: promotersContacts,
        venues: venuesContacts
    };

    // 3) Préparer dossier
    const baseOut = path.join(outputDir, 'generateContacts');
    fs.mkdirSync(baseOut, { recursive: true });

    // 4) Écrire JSON
    const jsonPath = path.join(baseOut, 'contacts.json');
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`✅ JSON écrit dans : ${jsonPath}`);

    // 5) Écrire fichiers texte
    const writeEmailList = (list, filename) => {
        const allEmails = list
            .flatMap(item => item.emails.map(e => e.email))
            .sort();
        fs.writeFileSync(
            path.join(baseOut, filename),
            allEmails.join('\n'),
            'utf8'
        );
        console.log(`📄 ${filename} (${allEmails.length} adresses)`);
    };

    writeEmailList(artistsContacts, 'artists_emails.txt');
    writeEmailList(promotersContacts, 'promoters_emails.txt');
    writeEmailList(venuesContacts, 'venues_emails.txt');
}

main();
