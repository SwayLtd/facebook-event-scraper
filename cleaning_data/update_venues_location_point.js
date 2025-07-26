import 'dotenv/config';  // Charge les variables d'environnement depuis .env
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// Récupération des variables d'environnement
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Création du client Supabase
const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Géocode une adresse en utilisant l'API Nominatim.
 * @param {string} address - L'adresse à géocoder.
 * @returns {Promise<{lat: number, lon: number} | null>}
 */
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'MyApp/1.0 (your_email@example.com)'
            }
        });
        if (response.data && response.data.length > 0) {
            const { lat, lon } = response.data[0];
            return { lat: parseFloat(lat), lon: parseFloat(lon) };
        }
    } catch (error) {
        console.error(`Erreur lors du géocodage de "${address}":`, error.message);
    }
    return null;
}

async function updateVenues() {
    // Récupère les venues avec id entre 1 et 31 et dont location_point est null
    const { data: venues, error } = await supabase
        .from('venues')
        .select('id, location')
        .gte('id', 1)
        .lte('id', 31)
        .is('location_point', null);

    if (error) {
        console.error("Erreur lors de la récupération des venues:", error);
        return;
    }

    for (const venue of venues) {
        const address = venue.location;
        console.log(`Géocodage de la venue ${venue.id}: ${address}`);
        const geo = await geocodeAddress(address);
        if (geo) {
            const { lat, lon } = geo;
            // Mise à jour de la colonne location_point avec le format WKT pour un point géographique
            const { data: updateData, error: updateError } = await supabase
                .from('venues')
                .update({
                    location_point: `SRID=4326;POINT(${lon} ${lat})`
                })
                .eq('id', venue.id);
            if (updateError) {
                console.error(`Erreur lors de la mise à jour de la venue ${venue.id}:`, updateError);
            } else {
                console.log(`Venue ${venue.id} mise à jour: lat=${lat}, lon=${lon}`);
            }
        } else {
            console.log(`Aucun résultat de géocodage pour la venue ${venue.id}`);
        }
    }
}

updateVenues();
