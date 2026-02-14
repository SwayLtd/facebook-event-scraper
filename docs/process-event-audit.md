# Process-Event : Pistes d'amélioration

> **Date** : Février 2026  
> **Scope** : `process-event/index.ts` + `_shared/` modules (Supabase Edge Functions)

---

## Table des matières

1. [APIs externes à intégrer](#1-apis-externes-à-intégrer)
2. [Architecture & Performance](#2-architecture--performance)
3. [Sources d'événements multi-plateformes](#3-sources-dévénements-multi-plateformes)
4. [Intelligence artificielle & NLP](#4-intelligence-artificielle--nlp)
5. [Qualité des données & Déduplication](#5-qualité-des-données--déduplication)
6. [Images & Médias](#6-images--médias)
7. [Sécurité & Monitoring](#7-sécurité--monitoring)
8. [Ressources & Documentation](#8-ressources--documentation)
9. [Plan d'action](#9-plan-daction)

---

## 1. APIs externes à intégrer

#### 🎵 Spotify API

- **Quoi** : Enrichir les profils artistes avec popularité, genres Spotify, images HD, top tracks, artistes similaires
- **Endpoint clé** : `GET /v1/search?type=artist&q={name}` → `GET /v1/artists/{id}`
- **Auth** : Client Credentials Flow (pas besoin de user OAuth)
- **Rate limit** : Pas de limite stricte documentée, ~100 req/s en pratique
- **Valeur ajoutée** : 
  - Genres Spotify sont très fiables et standardisés (ex: "melodic techno", "minimal house")
  - Score de popularité 0-100 pour trier/filtrer
  - Images HD (640x640) comme fallback si SoundCloud n'en a pas
  - Related artists pour recommandations futures
- **Doc** : https://developer.spotify.com/documentation/web-api
- **Implémentation** : Ajouter comme étape d'enrichissement dans `artist.ts` après SoundCloud

#### 🎵 MusicBrainz API (déjà intégré partiellement)

- **Statut actuel** : Utilisé dans `enrichment.ts` pour liens externes (Discogs, Wikidata, etc.)
- **Amélioration possible** : 
  - Extraire les "tags" MusicBrainz comme source de genres supplémentaire
  - Utiliser les "release groups" pour vérifier que c'est bien un artiste musical
  - Cross-reference avec Discogs pour images
- **Rate limit** : 1 req/s (déjà respecté via `createMusicBrainzApiCall`)
- **Doc** : https://musicbrainz.org/doc/MusicBrainz_API

#### 🎵 Discogs API

- **Quoi** : Base de données musicale collaborative avec genres/styles très détaillés
- **Endpoint** : `GET /database/search?type=artist&q={name}`
- **Auth** : Token personnel ou OAuth
- **Rate limit** : 60 req/min (auth), 25 req/min (non-auth)
- **Valeur ajoutée** :
  - Styles très précis (ex: "Acid House", "Deep Minimal" vs juste "Techno")
  - Images d'artistes haute qualité
  - Discographie complète
  - Liens vers d'autres plateformes
- **Doc** : https://www.discogs.com/developers
- **Forum** : https://www.discogs.com/forum/thread/802470

#### 🎵 Wikidata / Wikipedia API

- **Quoi** : Données structurées sur les artistes (pays d'origine, date de naissance, labels, genres)
- **Endpoint** : `https://www.wikidata.org/w/api.php?action=wbsearchentities&search={name}&type=item`
- **Pas de rate limit strict** mais User-Agent requis
- **Valeur ajoutée** :
  - Pays d'origine de l'artiste → filtrage géographique
  - Labels musicaux associés
  - Liens croisés vers toutes les plateformes
- **Doc** : https://www.wikidata.org/wiki/Wikidata:Data_access

#### 🎵 Last.fm API (déjà intégré)

- **Statut actuel** : Utilisé dans `genre.ts` pour vérifier les tags via `tag.getinfo`
- **Amélioration possible** :
  - `artist.getTopTags` — Tags les plus populaires pour un artiste spécifique
  - `artist.getSimilar` — Artistes similaires pour recommandations
  - `artist.getInfo` — Bio, listeners count, play count
- **Doc** : https://www.last.fm/api

#### 📍 Geocoding — alternatives et améliorations

| Service | Avantage | Gratuit | Rate limit |
|---------|----------|---------|------------|
| **Nominatim** (actuel) | Gratuit, pas de clé | ✅ | 1 req/s |
| **LocationIQ** | Meilleure qualité, compatible Nominatim | 5000/jour gratuit | 2 req/s |
| **OpenCage** | Annotations enrichies (timezone, monnaie, route) | 2500/jour gratuit | 1 req/s |
| **Mapbox** | Très rapide, autocomplete | 100K/mois gratuit | 600 req/min |
| **HERE** | Excellent pour adresses européennes | 1000/jour gratuit | 5 req/s |
| **Google Maps** (actuel) | Le plus complet mais cher | 200$/mois crédit | 50 req/s |

**Recommandation** : Garder Google en primaire pour les venues, ajouter **LocationIQ** comme fallback gratuit au lieu de Nominatim brut (meilleur parsing d'adresses, même format de réponse).

- **LocationIQ** : https://locationiq.com/docs
- **OpenCage** : https://opencagedata.com/api

## 2. Architecture & Performance

#### ⚡ File d'attente asynchrone avec pgmq

**Problème** : Le timeout de 60s des Edge Functions empêche le traitement complet des festivals (200+ artistes × enrichissement SoundCloud/MusicBrainz).

**Solution** : Utiliser **pgmq** (PostgreSQL Message Queue) intégré à Supabase.

```
┌──────────────┐     ┌─────────────────┐     ┌───────────────────┐
│  n8n webhook │────▶│ process-event   │────▶│ pgmq queue        │
│              │     │ (scrape + base) │     │ "artist_enrichment"|
└──────────────┘     └─────────────────┘     └─────┬─────────────┘
                                                    │
                           ┌────────────────────────┘
                           ▼
                    ┌─────────────────┐
                    │ enrich-artist   │  ← Edge Function séparée
                    │ (SoundCloud,    │    appelée par pg_cron
                    │  MusicBrainz,   │    ou pg_net
                    │  Spotify)       │
                    └─────────────────┘
```

- **pgmq** : Extension PostgreSQL native dans Supabase, pas besoin d'infra externe
- **Doc** : https://github.com/tembo-io/pgmq — https://supabase.com/docs/guides/queues
- **Migration SQL** :
  ```sql
  SELECT pgmq.create('artist_enrichment');
  SELECT pgmq.create('festival_timetable');
  ```
- **Lecture depuis Edge Function** :
  ```sql
  SELECT * FROM pgmq.read('artist_enrichment', 30, 1); -- 30s visibility timeout, 1 message
  ```

#### ⚡ pg_cron pour jobs planifiés

- **Quoi** : Scheduler intégré à Supabase pour lancer des tâches récurrentes
- **Use cases** :
  - Drainer la queue `artist_enrichment` toutes les 5 minutes
  - Re-scraper les événements à venir pour détecter les changements
  - Nettoyer les entrées `facebook_events_imports` anciennes
- **Doc** : https://supabase.com/docs/guides/database/extensions/pg_cron

#### ⚡ Découpage du process-event

Architecture actuelle (monolithique) :
```
process-event → scrape + venue + promoter + artists + genres (60s max)
```

Architecture recommandée (microservices) :
```
process-event     → scrape + venue + promoter + event creation (15s)
  ├─▶ queue: process-artists   → parsing OpenAI + SoundCloud (par artiste)
  ├─▶ queue: process-festival  → Clashfinder + timetable (si festival)
  └─▶ queue: assign-genres     → genres event + promoters (après artistes)
```

#### ⚡ Supabase Database Webhooks

Au lieu d'appeler des Edge Functions depuis n8n, utiliser des database webhooks :
- `INSERT` sur `facebook_events_imports` → trigger `process-event`
- `INSERT` sur `event_artist` → trigger `enrich-artist`
- **Doc** : https://supabase.com/docs/guides/database/webhooks

#### ⚡ Connection pooling & batch operations

- Utiliser `supabase.rpc()` pour les opérations batch au lieu de N inserts séparés
- Créer des RPC functions PostgreSQL pour les patterns fréquents :
  ```sql
  CREATE FUNCTION upsert_event_with_relations(...)
  ```
- **Doc** : https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooling

## 3. Sources d'événements multi-plateformes

#### 🎪 Resident Advisor (RA.co)

- **Quoi** : La référence pour les événements musique électronique
- **API** : Pas d'API publique officielle, mais GraphQL interne accessible
- **Scraping** : Structure HTML bien définie, ou utiliser le GraphQL endpoint
- **Endpoint GraphQL** : `https://ra.co/graphql` (non documenté mais stable)
- **Query utile** : `eventListings(filters: { areas: { eq: 56 }})` (56 = Belgique)
- **Données** : Artistes, venue, lineup, image, prix, horaires
- **Discussions** :
  - https://github.com/nicobrinkkemper/ra-scraper — Scraper RA.co open-source
  - https://www.reddit.com/r/webdev/comments/ra_api_alternatives/ — Discussions communautaires

#### 🎪 Dice.fm

- **Quoi** : Plateforme de billetterie européenne populaire (UK, Belgique, France, Allemagne)
- **API** : Pas d'API publique, mais pages structurées avec JSON-LD
- **Scraping** : Chaque page événement contient `<script type="application/ld+json">` avec toutes les données structurées
- **Données** : Artistes, venue, prix, lineup en JSON-LD standard Schema.org

#### 🎪 Shotgun (anciennement Resident Advisor FR)

- **Quoi** : Plateforme de billetterie très utilisée en Belgique et France
- **API** : `https://api.shotgun.live/api/v1/events?city=Brussels`
- **Auth** : API key gratuite sur demande
- **Données** : Events, venues, artistes, genres, images

#### 🎪 Eventbrite API

- **API** : `https://www.eventbriteapi.com/v3/events/search/`
- **Auth** : OAuth token gratuit
- **Doc** : https://www.eventbrite.com/platform/api
- **Params utiles** : `location.address`, `categories`, `subcategories`
- **Limitation** : Beaucoup d'événements non-musicaux → filtrage nécessaire

#### 🎪 Bandsintown API

- **Quoi** : Calendrier de concerts avec base artistes très complète
- **API** : `https://rest.bandsintown.com/artists/{name}/events?app_id={id}`
- **Auth** : App ID gratuit
- **Doc** : https://artists.bandsintown.com/support/api-installation
- **Valeur ajoutée** : Cross-reference artistes déjà en DB avec leurs futures dates

#### 🎪 Songkick API

- **Quoi** : Base mondiale de concerts et festivals
- **API** : `https://api.songkick.com/api/3.0/events.json?apikey={key}&location=geo:{lat},{lng}`
- **Auth** : API key sur demande
- **Doc** : https://www.songkick.com/developer

#### 🎪 Stratégie de déduplication multi-source

Quand on importe depuis plusieurs sources, il faut dédupliquer :
1. **Par URL** : Chaque source a son URL dans `metadata` (facebook_url, ra_url, dice_url, etc.)
2. **Par venue + date** : Même venue + même date = probablement même event
3. **Par titre fuzzy** : Dice coefficient > 0.85 + même ville + ±2 jours
4. **Merge intelligent** : Garder les données les plus complètes de chaque source

## 4. Intelligence artificielle & NLP

#### 🤖 OpenAI Structured Outputs

- **Quoi** : Forcer le modèle à retourner du JSON qui suit un schéma exact
- **Bénéfice** : Plus besoin de parser manuellement la réponse, garantie de conformité au schéma
- **Actuel** : Le prompt demande un JSON et on parse avec `JSON.parse()` (fragile)
- **Amélioration** :
  ```javascript
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "artist_list",
        schema: {
          type: "object",
          properties: {
            artists: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["artists"],
          additionalProperties: false
        }
      }
    },
    messages: [...]
  });
  ```
- **Doc** : https://platform.openai.com/docs/guides/structured-outputs
- **Avantage pricing** : `gpt-4o-mini` est 15× moins cher que `gpt-4o` avec des résultats quasi identiques pour l'extraction de noms

#### 🤖 Détection de genre par description

Utiliser OpenAI pour extraire les genres directement depuis la description de l'événement, en plus du pipeline SoundCloud/Last.fm actuel :
```
Prompt: "Given this event description, extract music genres mentioned or implied: {description}"
```
Cela permettrait d'avoir des genres même quand les artistes n'ont pas de profil SoundCloud.

#### 🤖 Classification événement/festival améliorée

Combiner la détection actuelle (durée + mots-clés) avec un classifieur NLP :
- Input : titre + description + durée + nombre d'artistes
- Output : probabilité festival vs event régulier
- Modèle : `gpt-4o-mini` avec few-shot examples ou fine-tuning

#### 🤖 Extraction de lineup depuis images/flyers

- Utiliser **GPT-4 Vision** pour extraire les noms d'artistes depuis les flyers/images d'événements
- Endpoint : `gpt-4o` avec images en input
- Use case : Quand la description texte ne contient pas le lineup mais l'image du flyer si
- **Doc** : https://platform.openai.com/docs/guides/vision

## 5. Qualité des données & Déduplication

#### 🔍 Déduplication artistes

**Problème actuel** : Doublons possibles car la recherche par nom est sensible à la casse et aux variantes.

**Améliorations** :
1. **Trigram PostgreSQL** : Installer `pg_trgm` et créer un index GIN
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX idx_artists_name_trgm ON artists USING GIN (name gin_trgm_ops);
   -- Recherche : SELECT * FROM artists WHERE name % 'Amelie Lens' LIMIT 5;
   ```
2. **SoundCloud ID comme clé primaire de dédup** : Si deux entrées ont le même `soundcloud_id`, merger
3. **Normalisation systématique** : Appliquer `cleanArtistName()` + `normalizeNameEnhanced()` AVANT insertion
4. **Script de nettoyage** : Identifier les doublons existants avec `pg_trgm` et merger

#### 🔍 Déduplication venues

1. **PostGIS proximity** : Deux venues à < 50m l'un de l'autre = probablement le même
   ```sql
   SELECT a.id, b.id, ST_Distance(a.location_point::geography, b.location_point::geography)
   FROM venues a, venues b
   WHERE a.id < b.id
   AND ST_DWithin(a.location_point::geography, b.location_point::geography, 50);
   ```
2. **Google Place ID** : Stocker le `place_id` Google comme identifiant unique de dédup

#### 🔍 Validation des données

- **Événements sans artistes** : Lister et re-processer
- **Artistes sans genres** : Backfill avec `backfillArtistGenres()`
- **Venues sans coordonnées** : Géocoder en batch
- **Images cassées** : Script de vérification périodique (HEAD request sur chaque URL)

## 6. Images & Médias

#### 🖼️ Supabase Image Transformations

- **Quoi** : CDN intégré qui redimensionne/optimise les images à la volée
- **Endpoint** : `https://{project}.supabase.co/storage/v1/render/image/public/{bucket}/{path}?width=400&height=400&quality=80`
- **Formats** : WebP automatique si le navigateur supporte
- **Bénéfice** : Réduire la bande passante de 70%+ sans stocker plusieurs tailles
- **Doc** : https://supabase.com/docs/guides/storage/serving/image-transformations

#### 🖼️ Stratégie d'images artistes

Ordre de priorité pour les images :
1. **Spotify** (640x640, très fiable)
2. **SoundCloud** (500x500 via `-t500x500.jpg` transform)
3. **Discogs** (variable, souvent haute qualité)
4. **MusicBrainz → Cover Art Archive** (pochettes d'albums)
5. **Facebook Graph API** (si l'artiste a une page FB)

#### 🖼️ Lazy image validation

Vérifier périodiquement que les URLs d'images sont toujours valides :
```javascript
const response = await fetch(imageUrl, { method: 'HEAD' });
if (!response.ok || response.status === 404) {
  // Marquer pour re-fetch
}
```

## 7. Sécurité & Monitoring

#### 🔒 Row Level Security (RLS)

- **Statut actuel** : Probablement désactivé (utilise service_role_key)
- **Recommandation** : Activer RLS sur toutes les tables publiques
- **Doc** : https://supabase.com/docs/guides/auth/row-level-security

#### 🔒 Webhook authentication

Sécuriser les appels n8n → Edge Function :
```typescript
const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
const signature = req.headers.get('x-webhook-signature');
if (!verifySignature(signature, body, webhookSecret)) {
  return new Response('Unauthorized', { status: 401 });
}
```

#### 🔒 Rate limiting

Protéger les Edge Functions contre les abus :
- Utiliser Supabase Auth avec API keys
- Ou implémenter un rate limiter simple avec une table PostgreSQL

#### 📊 Monitoring & Alerting

1. **Supabase Dashboard** : Logs des Edge Functions disponibles dans le dashboard
2. **Erreurs structurées** : Le `logger.ts` actuel est bon, ajouter un `error_id` unique par erreur
3. **Métriques** :
   - Temps de traitement moyen par événement
   - Taux de succès/échec par étape (scraping, venue, artists, genres)
   - Nombre d'artistes trouvés vs non-trouvés sur SoundCloud
4. **Alertes** : Utiliser pg_cron + pg_net pour envoyer une notification Discord/Slack si le taux d'erreur dépasse un seuil
5. **Table de métriques** :
   ```sql
   CREATE TABLE processing_metrics (
     id bigserial primary key,
     event_id bigint references events(id),
     processing_time_ms int,
     step text, -- 'scrape', 'venue', 'artists', 'genres'
     status text, -- 'success', 'error', 'timeout'
     details jsonb,
     created_at timestamptz default now()
   );
   ```

---

## 8. Ressources & Documentation

### APIs & Services

| Service | URL documentation | Gratuit | Recommandation |
|---------|-------------------|---------|----------------|
| **Spotify API** | https://developer.spotify.com/documentation/web-api | Oui | ⭐⭐⭐ Prioritaire |
| **MusicBrainz** | https://musicbrainz.org/doc/MusicBrainz_API | Oui | ⭐⭐ Déjà intégré, à étendre |
| **Discogs** | https://www.discogs.com/developers | Oui (60 req/min) | ⭐⭐ Genres très précis |
| **Wikidata** | https://www.wikidata.org/wiki/Wikidata:Data_access | Oui | ⭐ Nice to have |
| **Last.fm** | https://www.last.fm/api | Oui | ⭐⭐ Déjà intégré |
| **Bandsintown** | https://artists.bandsintown.com/support/api-installation | Oui | ⭐⭐ Cross-ref artistes |
| **OpenAI** | https://platform.openai.com/docs | Payant | ⭐⭐⭐ Structured outputs |
| **LocationIQ** | https://locationiq.com/docs | 5000/jour | ⭐⭐ Remplacement Nominatim |
| **pgmq** | https://github.com/tembo-io/pgmq | Oui (Supabase) | ⭐⭐⭐ Architecture async |

### Guides & Tutoriels

| Sujet | URL |
|-------|-----|
| Supabase Edge Functions best practices | https://supabase.com/docs/guides/functions/best-practices |
| Supabase Queues (pgmq) | https://supabase.com/docs/guides/queues |
| pg_cron scheduling | https://supabase.com/docs/guides/database/extensions/pg_cron |
| Database webhooks | https://supabase.com/docs/guides/database/webhooks |
| Image transformations | https://supabase.com/docs/guides/storage/serving/image-transformations |
| RLS policies | https://supabase.com/docs/guides/auth/row-level-security |
| PostGIS sur Supabase | https://supabase.com/docs/guides/database/extensions/postgis |
| pg_trgm fuzzy search | https://www.postgresql.org/docs/current/pgtrgm.html |
| OpenAI Structured Outputs | https://platform.openai.com/docs/guides/structured-outputs |
| GPT-4 Vision | https://platform.openai.com/docs/guides/vision |

### Discussions & Forums

| Sujet | URL |
|-------|-----|
| Facebook scraping alternatives (2024) | https://github.com/joshuatz/fb-scraping-guide |
| RA.co scraper communautaire | https://github.com/nicobrinkkemper/ra-scraper |
| Event deduplication algorithms | https://doi.org/10.1145/3477495.3531865 (ACL paper) |
| Supabase community Discord | https://discord.supabase.com |
| MusicBrainz community forum | https://community.metabrainz.org |
| Discogs developer forum | https://www.discogs.com/forum/topic/802470 |

### Outils de développement recommandés

| Outil | Usage | URL |
|-------|-------|-----|
| **Supabase CLI** | Test local des Edge Functions | `supabase functions serve` |
| **Deno Deploy** | Logs et métriques Edge Functions | https://dash.deno.com |
| **Bruno / Insomnia** | Test API endpoints | https://usebruno.com |
| **pgAdmin / DBeaver** | Exploration base de données | - |

---

## 9. Plan d'action

### Phase 1 — Architecture async (2-4 semaines)

1. 🔲 Créer queue pgmq `artist_enrichment`
2. 🔲 Découper `process-event` : event+venue+promoter (sync) → artists+genres (async via queue)
3. 🔲 Créer Edge Function `enrich-artist` consommatrice de la queue
4. 🔲 Porter le pipeline Clashfinder/timetable comme job async séparé

### Phase 2 — Enrichissement (1-2 mois)

5. 🔲 Intégrer Spotify API dans l'enrichissement artiste
6. 🔲 OpenAI Structured Outputs pour parsing artistes
7. 🔲 Ajouter sources d'événements (RA.co, Dice.fm, Shotgun)
8. 🔲 pg_trgm pour déduplication artistes
9. 🔲 Supabase Image Transformations pour optimisation images
