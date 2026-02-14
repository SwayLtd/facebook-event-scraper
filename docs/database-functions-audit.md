# Audit des fonctions SQL custom — Sway App

**Date :** 14 février 2026  
**Projet Supabase :** Sway App (`gvuwtsdhgqefamzyfyjm`)  
**Total fonctions custom :** 148 (hors PostGIS, pgTAP, pgcrypto, pgjwt, uuid-ossp, fuzzystrmatch, unaccent)

---

## Résumé

| Catégorie | Nombre | Statut |
|---|---|---|
| Trigger functions | 42 | ✅ Utilisées |
| Cron jobs | 6 | ✅ Utilisées |
| RLS | 1 | ✅ Utilisée |
| Flutter app RPCs | 47 | ✅ Utilisées |
| Scraper RPCs | 7 | ✅ Utilisées |
| Edge function RPCs | 2 | ✅ Utilisées |
| Helpers internes | 11 | ✅ Utilisées |
| **Potentiellement inutilisées** | **32** | ⚠️ À investiguer |

**107 fonctions confirmées utilisées, 41 potentiellement inutilisées.**

---

## 1. Trigger functions (42) ✅

Toutes liées à des triggers actifs — **ne pas toucher**.

| Fonction | Usage |
|---|---|
| `assign_permission` | Trigger sur artists, venues, promoters, events |
| `auto_follow_created_artist` | Follow auto à la création d'un artiste |
| `auto_follow_created_promoter` | Follow auto à la création d'un promoter |
| `auto_follow_created_venue` | Follow auto à la création d'un venue |
| `auto_follow_on_claim_accepted` | Follow auto quand un claim est accepté |
| `create_default_notification_preferences` | Trigger sur users |
| `fn_notification_new_follower` | Trigger sur follows |
| `handle_auth_signup_enhanced` | Trigger `auth.users` (inscription) |
| `handle_email_change` | Trigger `auth.users` (changement email) |
| `handle_first_publication` | Trigger première publication |
| `notify_admin_on_artist_follow` | Notification admin follow artiste |
| `notify_admin_on_promoter_follow` | Notification admin follow promoter |
| `notify_admin_on_venue_follow` | Notification admin follow venue |
| `notify_chat_participants_on_new_message` | Notification nouveau message chat |
| `notify_claimed_entity_status_update` | Notification statut claim |
| `notify_event_cancelled` | Notification événement annulé |
| `notify_event_rescheduled` | Notification événement reprogrammé |
| `notify_event_venue_changed` | Notification changement de venue |
| `notify_fcm_immediate_push` | Push FCM immédiat |
| `notify_followed_artist_in_lineup` | Notification artiste suivi dans lineup |
| `notify_generate_tickets` | Génération tickets |
| `notify_image_transformer` | Transformation d'images |
| `notify_lineup_updated` | Notification lineup mis à jour |
| `notify_new_event_by_genre` | Notification nouvel événement par genre |
| `notify_new_event_by_promoter` | Notification nouvel événement par promoter |
| `notify_new_event_by_venue` | Notification nouvel événement par venue |
| `notify_new_playlist_for_genre` | Notification nouvelle playlist par genre |
| `notify_permission_granted` | Notification permission accordée |
| `notify_webhook_new_event` | Webhook nouvel événement |
| `recalc_chat_last_update_on_delete` | Trigger suppression message chat |
| `trigger_queue_processing` | Trigger queue Facebook |
| `update_admin_entity_follow_preferences_timestamp` | Trigger `updated_at` admin follow prefs |
| `update_chat_last_update` | Trigger `updated_at` chat |
| `update_chat_last_update_on_message_update` | Trigger `updated_at` chat sur update message |
| `update_discounts_updated_at` | Trigger `updated_at` discounts |
| `update_facebook_events_imports_updated_at` | Trigger `updated_at` imports Facebook |
| `update_notification_digests_updated_at` | Trigger `updated_at` digests |
| `update_notification_types_updated_at` | Trigger `updated_at` types notif |
| `update_playlists_updated_at` | Trigger `updated_at` playlists |
| `update_scanner_updated_at` | Trigger `updated_at` scanners |
| `update_updated_at_column` | Trigger `updated_at` générique (7 tables) |
| `update_user_permissions_on_claim_accept` | Trigger claims → permissions |
| `update_user_permissions_updated_at` | Trigger `updated_at` permissions |
| `update_webhook_events_updated_at` | Trigger `updated_at` webhooks |

---

## 2. Cron jobs (6) ✅

| Fonction | Schedule |
|---|---|
| `auto_complete_successful_imports` | Toutes les 5 min |
| `force_complete_old_processing_events` | Toutes les heures |
| `process_facebook_events_queue` | Toutes les 30s |
| `schedule_event_reminders` | Quotidien 9h |
| `send_event_suggestions` | Hebdo lundi 9h + Mensuel 1er 10h |
| `sync_missing_usernames` | Toutes les 15s |

---

## 3. RLS (1) ✅

| Fonction | Usage |
|---|---|
| `get_user_perm_level` | Utilisée dans les policies RLS de `user_permissions` |

---

## 4. Flutter app RPCs (47) ✅

Toutes appelées via `.rpc()` dans l'app Flutter (`sway_app`).

| Fonction |
|---|
| `copy_promoter_permissions_to_event` |
| `create_default_event_topics` |
| `ensure_user_exists_in_public` |
| `find_private_chat` |
| `get_active_fullscreen_notifications` |
| `get_admin_managed_entities_with_follow_prefs` |
| `get_artist_upcoming_event_summary` |
| `get_artists_by_event_id` |
| `get_chat_images` |
| `get_chat_messages` |
| `get_claims_for_entity` |
| `get_community_topics_for_entity` |
| `get_events_around` |
| `get_followed_artist_ids_by_user_and_event` |
| `get_followed_artist_ids_by_user_id` |
| `get_followed_genre_ids_by_user_id` |
| `get_followed_promoter_ids_by_user_id` |
| `get_followed_user_ids_by_user_id` |
| `get_followed_venue_ids_by_user_id` |
| `get_followers_for_user_id` |
| `get_group_calendar_events` |
| `get_latest_playlist_by_genre` |
| `get_or_create_admin_entity_follow_preference` |
| `get_past_events` |
| `get_popular_genres` |
| `get_recommended_artists` |
| `get_recommended_events` |
| `get_recommended_genres` |
| `get_recommended_promoters` |
| `get_recommended_users` |
| `get_recommended_venues` |
| `get_top_artists_by_genre` |
| `get_top_events` |
| `get_upcoming_events` |
| `get_user_chats_with_details` |
| `get_user_entity_permissions` |
| `get_user_event_dashboard` |
| `get_user_events_feed` |
| `has_active_playlists_by_genre` |
| `search_artists` |
| `search_entities` |
| `search_events` |
| `search_users` |
| `submit_claim` |
| `update_admin_entity_follow_preference` |
| `update_user_preferences` |
| `get_community_topic_stats` (non trouvée en DB — vérifier) |

---

## 5. Scraper RPCs (7) ✅

Appelées via `.rpc()` dans le scraper Facebook (`facebook-event-scraper`).

| Fonction |
|---|
| `add_processing_log` |
| `get_next_event_for_processing` |
| `mark_event_completed` |
| `mark_event_failed` |
| `mark_event_processing` |
| `recover_stuck_events` |
| `update_event_processing_status` |

---

## 6. Edge function RPCs (2) ✅

| Fonction | Edge function |
|---|---|
| `delete_user_account` | `delete_user/index.ts` |
| `sync_missing_usernames` | `sync_missing_usernames/index.ts` |

---

## 7. Helpers internes (11) ✅

Appelées par d'autres fonctions (triggers, cron, etc.) — jamais directement par le client.

| Helper | Appelé par |
|---|---|
| `clean_username` | `handle_auth_signup_enhanced`, `ensure_user_exists_in_public`, `repair_missing_users` |
| `extract_social_name` | `handle_auth_signup_enhanced`, `ensure_user_exists_in_public`, `repair_missing_users` |
| `generate_unique_username` | `handle_auth_signup_enhanced`, `ensure_user_exists_in_public`, `repair_missing_users` |
| `create_notification` | 14 fonctions `notify_*`, `schedule_event_reminders`, `send_event_suggestions`, `grant_promoter_permissions_on_claim` |
| `insert_notification` | `fn_notification_new_follower` |
| `replace_template_vars` | `create_notification` |
| `generate_dedupe_key` | `create_notification` |
| `resolve_notification_image` | `create_notification` |
| `check_user_preferences` | `create_notification` |
| `is_in_quiet_hours` | `check_user_preferences` |
| `add_to_digest` | `create_notification` |

---

## 8. Potentiellement inutilisées (41) ⚠️

### 8.1 Dead code confirmé 🗑️

| Fonction | Raison |
|---|---|
| `handle_auth_signup` | Remplacée par `handle_auth_signup_enhanced` (aucun trigger ne l'utilise) |
| `get_next_pending_event` | Remplacée par `get_next_event_for_processing` |

### 8.2 Feature Ticketing 🎫

Probablement pas encore lancée ou en développement.

| Fonction |
|---|
| `mark_ticket_scanned` |
| `validate_grouped_tickets` |
| `validate_qr_code` |
| `increment_coupon_usage` |

### 8.3 Feature Ambassador 🏆

| Fonction |
|---|
| `ambassador_get_leaderboard` |
| `ambassador_get_program_by_event` |

### 8.4 Feature API publique 🔑

| Fonction |
|---|
| `create_api_client` |
| `get_client_usage_stats` |
| `validate_api_key_and_log` |

### 8.5 Monitoring / Admin / Debug 📊

| Fonction | Analyse |
|---|---|
| `get_queue_monitoring_dashboard` | Dashboard monitoring queue |
| `get_queue_status_summary` | Résumé statut queue |
| `check_auth_sync_health` | Vérification santé sync auth |
| `log_message` | Debug logging |
| `repair_missing_users` | Script admin ponctuel |
| `reset_event_for_retry` | Outil admin retry |
| `refresh_expired_attachment_urls` | Pas de cron ni trigger visible |

### 8.6 Helpers CRUD safe 🔧

Probablement utilisés via Supabase Studio ou scripts admin.

| Fonction |
|---|
| `create_artist_safe` |
| `create_promoter_safe` |
| `create_venue_safe` |
| `create_venue_with_point` |

### 8.7 Fonctions potentiellement orphelines 🔍

| Fonction | Analyse |
|---|---|
| `copy_promoter_permissions_to_all_events` | Version batch — peut-être admin only |
| `count_upcoming_events_by_artist` | Pas dans Flutter |
| `get_upcoming_events_by_artist_id` | Pas dans Flutter (mais `get_upcoming_events` l'est) |
| `get_events_with_coordinates` | Pas dans Flutter (mais `get_events_around` l'est) |
| `get_admin_entity_follow_preferences` | Possiblement remplacé par `get_admin_managed_entities_with_follow_prefs` |
| `get_chat_participants_excluding_current` | Ancien helper chat |
| `get_chat_participants_rpc` | Ancien helper chat |
| `get_user_and_permission` | Pas dans Flutter |
| `get_user_id_by_username` | Pas dans Flutter |
| `get_venues_around` | Pas dans Flutter (mais `get_events_around` l'est) |
| `grant_promoter_permissions_on_claim` | Helper interne (appelé par aucun trigger/cron visible) |
| `has_public_albums_for_event` | Pas dans Flutter |
| `is_following_community_topic` | Pas dans Flutter |
| `is_invitation_valid` | Pas dans Flutter |
| `setup_notification_preferences` | Possiblement appelé manuellement |
| `update_festival_detection` | Possiblement appelé par le scraper edge function |

### 8.8 Utilitaires divers 🛠️

| Fonction | Analyse |
|---|---|
| `extract_facebook_event_id` | Possiblement utilisé dans `process_facebook_events_queue` |
| `generate_invitation_code` | Probablement DEFAULT de colonne |
| `generate_referral_code` | Probablement DEFAULT de colonne |

---

## 9. Extension pgjwt ⚠️

**Fonctions :** `sign()`, `verify()`, `algorithm_sign()`, `url_encode()`, `url_decode()`

**Résultat de l'audit :**
- ❌ Aucune fonction custom ne les appelle
- ❌ Aucune policy RLS ne les utilise
- ❌ Aucune vue ne les référence
- ❌ Aucun DEFAULT de colonne ne les utilise
- ❌ Aucun schema interne (auth, supabase_functions, extensions, realtime) ne les utilise
- ❌ Aucune référence dans le code Flutter, scraper ou edge functions

**Conclusion :** L'extension pgjwt est complètement inutilisée. Elle peut être désactivée sans risque.

---

## Recommandations

1. **Supprimer immédiatement :** `handle_auth_signup`, `get_next_pending_event` (dead code confirmé)
2. **Désactiver pgjwt :** Extension complètement inutilisée
3. **Investiguer :** Les 39 fonctions "potentiellement inutilisées" avant suppression
4. **Conserver :** Les features non lancées (ticketing, ambassador, API) si elles sont prévues
