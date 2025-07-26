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

/**
 * Met à jour une URL d'image SoundCloud en remplaçant "-large" par "-t500x500"
 * @param {string} imageUrl - L'URL d'image originale
 * @returns {string} - L'URL d'image mise à jour
 */
function updateSoundCloudImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return imageUrl;
    }
    
    // Vérifier si c'est une URL SoundCloud avec "-large"
    if (imageUrl.includes('i1.sndcdn.com') && imageUrl.includes('-large')) {
        return imageUrl.replace('-large', '-t500x500');
    }
    
    return imageUrl;
}

/**
 * Fonction principale pour mettre à jour les images des artistes
 */
async function main() {
    try {
        console.log('🔍 Recherche des artistes avec des images SoundCloud "-large"...');
        
        // Récupérer tous les artistes avec des image_url contenant "i1.sndcdn.com" et "-large"
        const { data: artists, error } = await supabase
            .from('artists')
            .select('id, name, image_url')
            .like('image_url', '%i1.sndcdn.com%')
            .like('image_url', '%-large%');
        
        if (error) {
            console.error('❌ Erreur lors de la récupération des artistes:', error.message);
            process.exit(1);
        }
        
        if (!artists || artists.length === 0) {
            console.log('ℹ️ Aucun artiste trouvé avec des images SoundCloud "-large"');
            return;
        }
        
        console.log(`📊 ${artists.length} artiste(s) trouvé(s) avec des images à mettre à jour`);
        
        let updatedCount = 0;
        let errorCount = 0;
        
        // Traiter chaque artiste
        for (const artist of artists) {
            const originalUrl = artist.image_url;
            const updatedUrl = updateSoundCloudImageUrl(originalUrl);
            
            if (originalUrl !== updatedUrl) {
                try {
                    console.log(`🔄 Mise à jour de l'artiste "${artist.name}" (ID: ${artist.id})`);
                    console.log(`   Avant: ${originalUrl}`);
                    console.log(`   Après: ${updatedUrl}`);
                    
                    const { error: updateError } = await supabase
                        .from('artists')
                        .update({ image_url: updatedUrl })
                        .eq('id', artist.id);
                    
                    if (updateError) {
                        console.error(`❌ Erreur lors de la mise à jour de l'artiste ${artist.id}:`, updateError.message);
                        errorCount++;
                    } else {
                        console.log(`✅ Artiste "${artist.name}" mis à jour avec succès`);
                        updatedCount++;
                    }
                } catch (err) {
                    console.error(`❌ Erreur inattendue pour l'artiste ${artist.id}:`, err.message);
                    errorCount++;
                }
            } else {
                console.log(`ℹ️ Aucune modification nécessaire pour "${artist.name}"`);
            }
        }
        
        console.log('\n📈 Résumé de la mise à jour:');
        console.log(`   ✅ Artistes mis à jour: ${updatedCount}`);
        console.log(`   ❌ Erreurs: ${errorCount}`);
        console.log(`   📊 Total traité: ${artists.length}`);
        
        if (updatedCount > 0) {
            console.log('\n🎉 Mise à jour des images terminée avec succès!');
        }
        
    } catch (error) {
        console.error('❌ Erreur globale:', error.message);
        process.exit(1);
    }
}

// Exécution du script
main().catch(err => {
    console.error('❌ Erreur non gérée:', err);
    process.exit(1);
});
