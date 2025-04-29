// normalizeVenues.js
// Standardise toutes les adresses de la table "venues" avec Node-Geocoder (OpenStreetMap) et Supabase,
// et enregistre les logs (WARN, ERROR, INFO) dans logs/normalizeVenues.log

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import NodeGeocoder from 'node-geocoder';

// --- Préparation du dossier de logs ---
const logsDir = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
const logFile = path.join(logsDir, 'normalizeVenues.log');

// Fonction utilitaire pour écrire dans le fichier de logs
function writeLog(level, message) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `${timestamp} [${level}] ${message}\n`);
}

// --- Initialisation Supabase ---
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Configuration Node-Geocoder ---
const geocoder = NodeGeocoder({
    provider: 'openstreetmap',       // provider gratuit via Nominatim
    httpAdapter: 'https',
    formatter: null
});

async function normalizeVenues() {
    try {
        // 1) Récupérer toutes les venues
        const { data: venues, error: fetchError } = await supabase
            .from('venues')
            .select('id, location');
        if (fetchError) throw fetchError;

        // 2) Pour chaque venue, normaliser et mettre à jour
        for (const v of venues) {
            if (!v.location) continue;

            try {
                const results = await geocoder.geocode(v.location);
                if (!results || results.length === 0) {
                    const warnMsg = `id=${v.id} — aucun résultat pour "${v.location}"`;
                    console.warn(`⚠️ ${warnMsg}`);
                    writeLog('WARN', warnMsg);
                    continue;
                }
                const geo = results[0];

                if (!geo.streetNumber || !geo.streetName) {
                    const warnMsg = `id=${v.id} — géocoding partiel: ${JSON.stringify(geo)}`;
                    console.warn(`⚠️ ${warnMsg}`);
                    writeLog('WARN', warnMsg);
                }

                // 3) Mapping manuel du nom du pays si nécessaire
                let countryEnglish = geo.country;
                if (countryEnglish === 'België / Belgique / Belgien') {
                    countryEnglish = 'Belgium';
                }

                // 4) Reconstruction de l'adresse standardisée
                const standardized = [
                    geo.streetNumber,
                    geo.streetName,
                    geo.city,
                    geo.zipcode,
                    countryEnglish
                ]
                    .filter(Boolean)
                    .join(', ');

                if (standardized !== v.location) {
                    const { error: updateError } = await supabase
                        .from('venues')
                        .update({ location: standardized })
                        .eq('id', v.id);
                    if (updateError) {
                        const errMsg = `id=${v.id} — mise à jour échouée: ${updateError.message}`;
                        console.error(`❌ ${errMsg}`);
                        writeLog('ERROR', errMsg);
                    } else {
                        const infoMsg = `id=${v.id} normalisé: "${standardized}"`;
                        console.log(`✅ ${infoMsg}`);
                        writeLog('INFO', infoMsg);
                    }
                }
            } catch (err) {
                const errMsg = `id=${v.id} — exception: ${err.message}`;
                console.error(`❌ ${errMsg}`);
                writeLog('ERROR', errMsg);
                continue;
            }
        }

        console.log('✔️ Normalisation terminée');
    } catch (err) {
        const errMsg = `Erreur globale: ${err.message}`;
        console.error(`❌ ${errMsg}`);
        writeLog('ERROR', errMsg);
        process.exit(1);
    }
}

normalizeVenues();
