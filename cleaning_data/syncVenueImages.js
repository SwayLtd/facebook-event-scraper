// syncVenueImages.js
import 'dotenv/config';  // Charge SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY :contentReference[oaicite:9]{index=9}
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';     // Pour les requêtes HTTP :contentReference[oaicite:10]{index=10}
import { createClient } from '@supabase/supabase-js';

const logsDir = path.join(process.cwd(), 'logs');   // Chemin des logs :contentReference[oaicite:11]{index=11}
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, 'syncVenueImages.log');
function writeLog(level, msg) {
    const time = new Date().toISOString();
    fs.appendFileSync(logFile, `${time} [${level}] ${msg}\n`);
}

// Initialisation Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Fonction principale
async function main() {
    try {
        writeLog('INFO', '🛠️ Démarrage de syncVenueImages.js');
        console.log('🔎 Lecture des venues sans image…');

        // 1) Récupérer venues sans image
        const { data: venues, error: fetchErr } = await supabase
            .from('venues')
            .select('id, name, location')
            .is('image_url', null);  // Supabase JS select :contentReference[oaicite:12]{index=12}
        if (fetchErr) throw fetchErr;

        for (const { id, name, location } of venues) {
            if (!location) {
                writeLog('WARN', `id=${id} (“${name}”) — pas d’adresse`);
                continue;
            }
            console.log(`\n📍 Venue #${id} — "${name}" : géocoding de "${location}"`);
            writeLog('INFO', `Géocoding id=${id} adresse="${location}"`);

            // 2) Geocoding via Google Maps API :contentReference[oaicite:13]{index=13}
            let lat, lng;
            try {
                const geoRes = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${process.env.GOOGLE_API_KEY}`
                );
                const geoJson = await geoRes.json();
                if (!geoJson.results?.length) {
                    throw new Error('Aucun résultat geocoding');
                }
                ({ lat, lng } = geoJson.results[0].geometry.location);
            } catch (err) {
                writeLog('ERROR', `id=${id} géocoding échoué: ${err.message}`);
                console.error(`⚠️ Geocoding failed for id=${id}:`, err.message);
                continue;
            }

            // 3) Find Place From Text pour récupérer place_id :contentReference[oaicite:14]{index=14}
            let placeId;
            try {
                const findRes = await fetch(
                    `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
                    `?input=${encodeURIComponent(name + ' ' + location)}` +
                    `&inputtype=textquery&fields=place_id&key=${process.env.GOOGLE_API_KEY}`
                );
                const findJson = await findRes.json();
                if (!findJson.candidates?.length) {
                    throw new Error('Aucun place_id trouvé');
                }
                placeId = findJson.candidates[0].place_id;
            } catch (err) {
                writeLog('WARN', `id=${id} aucun place_id: ${err.message}`);
                console.warn(`⚠️ No place_id for id=${id}:`, err.message);
                continue;
            }

            // 4) Récupérer photo_reference via Place Details puis construire URL photo :contentReference[oaicite:15]{index=15}
            let photoUrl;
            try {
                const detailRes = await fetch(
                    `https://maps.googleapis.com/maps/api/place/details/json` +
                    `?place_id=${placeId}&fields=photos&key=${process.env.GOOGLE_API_KEY}`
                );
                const detailJson = await detailRes.json();
                const photos = detailJson.result.photos;
                if (!photos?.length) throw new Error('Pas de photo disponible');
                const photoRef = photos[0].photo_reference;
                photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${process.env.GOOGLE_API_KEY}`;
            } catch (err) {
                writeLog('WARN', `id=${id} pas de photo: ${err.message}`);
                console.warn(`⚠️ No photo for id=${id}:`, err.message);
                continue;
            }

            // 5) Mettre à jour Supabase :contentReference[oaicite:16]{index=16}
            const { error: updErr } = await supabase
                .from('venues')
                .update({ image_url: photoUrl })
                .eq('id', id);
            if (updErr) {
                writeLog('ERROR', `id=${id} mise à jour échouée: ${updErr.message}`);
                console.error(`❌ Failed update id=${id}:`, updErr.message);
            } else {
                writeLog('INFO', `id=${id} image_url mise à jour`);
                console.log(`✅ id=${id} image_url updated`);
            }
        }

        writeLog('INFO', '🎉 Synchronisation terminée');
        console.log('\n🎉 Toutes les venues traitées.');
    } catch (err) {
        writeLog('ERROR', `Erreur globale: ${err.message}`);
        console.error('❌ Erreur non gérée:', err);
        process.exit(1);
    }
}

main();
