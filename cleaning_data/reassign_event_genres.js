import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
const MAX_EVENT_ID = 257;
const MIN_GENRE_OCCURRENCE = 3; // Seuil minimal d'occurrences pour retenir un genre

// Initialisation du client Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Veuillez définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans vos variables d\'environnement.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// Vérifie et insère une relation si nécessaire
async function ensureRelation(table, relationData) {
  const { data, error } = await supabase
    .from(table)
    .select()
    .match(relationData);
  if (error) throw error;
  if (!data || data.length === 0) {
    const { error: insertError } = await supabase
      .from(table)
      .insert(relationData);
    if (insertError) throw insertError;
    console.log(`✅ Insert dans ${table}:`, relationData);
  } else {
    console.log(`↗️ Déjà présent dans ${table}:`, relationData);
  }
}

// Calcule et assigne les genres à un événement donné
async function assignEventGenres(eventId) {
  // 1) Récupérer les artistes liés
  const { data: eventArtists, error: eaError } = await supabase
    .from('event_artist')
    .select('artist_id')
    .eq('event_id', eventId);
  if (eaError) throw eaError;

  // 2) Compter les occurrences de chaque genre
  const genreCounts = {};
  for (const { artist_id } of eventArtists) {
    const { data: artistGenres, error: agError } = await supabase
      .from('artist_genre')
      .select('genre_id')
      .eq('artist_id', parseInt(artist_id, 10));
    if (agError) throw agError;
    for (const g of artistGenres) {
      genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
    }
  }

  // 3) Filtrer selon le seuil
  let topGenreIds = Object.entries(genreCounts)
    .filter(([, count]) => count >= MIN_GENRE_OCCURRENCE)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([genreId]) => Number(genreId));

  // 4) Fallback si aucun genre ne passe le seuil
  if (topGenreIds.length === 0) {
    topGenreIds = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([genreId]) => Number(genreId));
    console.log(`Event ${eventId}: fallback genres =`, topGenreIds);
  } else {
    console.log(`Event ${eventId}: top genres =`, topGenreIds);
  }

  // 5) Insérer les nouvelles relations
  for (const genreId of topGenreIds) {
    await ensureRelation('event_genre', { event_id: eventId, genre_id: genreId });
  }
}

// Point d'entrée principal
async function main() {
  try {
    for (let eventId = 1; eventId <= MAX_EVENT_ID; eventId++) {
      console.log(`\n--- Traitement événement ${eventId} ---`);

      // Suppression des anciennes assignations de genres
      const { error: deleteError } = await supabase
        .from('event_genre')
        .delete()
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;
      console.log(`🗑️ Genres supprimés pour l'événement ${eventId}`);

      // Recalcul et insertion des nouvelles assignations
      await assignEventGenres(eventId);
    }

    console.log(`\n✅ Réassignation des genres terminée pour les événements 1 à ${MAX_EVENT_ID}`);
  } catch (err) {
    console.error('❌ Erreur lors de la réassignation des genres :', err);
    process.exit(1);
  }
}

main();
