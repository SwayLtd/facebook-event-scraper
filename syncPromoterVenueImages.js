// syncPromoterVenueImages.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error("❌ Veuillez définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans vos variables d'environnement.");
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 1) Récupérer tous les promoteurs avec leur nom et leur image
    const { data: promoters, error: promError } = await supabase
        .from('promoters')
        .select('id, name, image_url')
        .neq('image_url', null);
    if (promError) {
        console.error("❌ Erreur lors de la récupération des promoteurs :", promError);
        process.exit(1);
    }

    // 2) Pour chaque promoteur, normaliser le nom et mettre à jour les venues correspondantes
    for (const promo of promoters) {
        const normalizedName = promo.name.trim().toLowerCase();

        // Récupérer les venues dont le nom correspond au promoteur
        const { data: venues, error: venueError } = await supabase
            .from('venues')
            .select('id, name, image_url')
            .ilike('name', normalizedName);
        if (venueError) {
            console.error(`⚠️ Erreur lors de la recherche de venues pour "${promo.name}" :`, venueError);
            continue;
        }

        // Filtrer celles qui n'ont pas déjà d'image
        const toUpdate = venues.filter(v =>
            v.name.trim().toLowerCase() === normalizedName &&
            !v.image_url
        );

        if (toUpdate.length === 0) {
            console.log(`ℹ️ Aucune venue à mettre à jour pour "${promo.name}".`);
            continue;
        }

        // 3) Mettre à jour chaque venue
        for (const venue of toUpdate) {
            const { error: updError } = await supabase
                .from('venues')
                .update({ image_url: promo.image_url })
                .eq('id', venue.id);
            if (updError) {
                console.error(`❌ Échec mise à jour venue id=${venue.id} :`, updError);
            } else {
                console.log(`✅ Venue "${venue.name}" (id=${venue.id}) mise à jour avec l'image du promoteur.`);
            }
        }
    }

    console.log("🎉 Synchronisation terminée.");
}

main().catch(err => {
    console.error("❌ Erreur non gérée :", err);
    process.exit(1);
});
