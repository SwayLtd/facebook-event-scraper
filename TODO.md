# TODO

## ✅ Images Promoteurs — DONE
- 743/745 promoteurs ont des images HD en Supabase storage
- 2 restants sans image (pas de lien Facebook exploitable) :
  - ID 427 — Herton Sanchez (aucun lien FB)
  - ID 429 — Insolent Events (photo de profil par défaut)
- Script : `scripts/promoters/images/fix-promoter-images.js`
  - Utilise `graph.facebook.com/{slug}/picture?width=960&height=960` (sans token)
  - Télécharge, upload en storage, met à jour la DB
  - Options : `--dry-run`, `--ids=N,M`, `--all`

## ✅ Sync images Venue ← Promoteur — DONE
- Toutes les venues matchant un promoteur par nom ont déjà l'image synchronisée
- La logique est intégrée dans `process-event` pour les nouveaux events (L540-580)
- Script one-shot : `scripts/venues/sync-venue-images.js` (prêt pour réutilisation future)
  - Options : `--dry-run`
