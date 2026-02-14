-- Migration: Optimize RLS policies to use (select auth.uid()) and (select auth.role())
-- This ensures auth functions are evaluated once per query instead of once per row.
-- Generated: 2026-02-14

BEGIN;

-- ============================================================
-- Table: admin_entity_follow_preferences
-- ============================================================

DROP POLICY IF EXISTS "admin_entity_follow_preferences_delete_own" ON public.admin_entity_follow_preferences;
CREATE POLICY "admin_entity_follow_preferences_delete_own" ON public.admin_entity_follow_preferences
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (((select auth.uid()))::text = ( SELECT (users.supabase_id)::text AS supabase_id
   FROM users
  WHERE (users.id = admin_entity_follow_preferences.user_id)));

DROP POLICY IF EXISTS "admin_entity_follow_preferences_insert_own" ON public.admin_entity_follow_preferences;
CREATE POLICY "admin_entity_follow_preferences_insert_own" ON public.admin_entity_follow_preferences
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (((select auth.uid()))::text = ( SELECT (users.supabase_id)::text AS supabase_id
   FROM users
  WHERE (users.id = admin_entity_follow_preferences.user_id)));

DROP POLICY IF EXISTS "admin_entity_follow_preferences_select_own" ON public.admin_entity_follow_preferences;
CREATE POLICY "admin_entity_follow_preferences_select_own" ON public.admin_entity_follow_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((select auth.uid()))::text = ( SELECT (users.supabase_id)::text AS supabase_id
   FROM users
  WHERE (users.id = admin_entity_follow_preferences.user_id)));

DROP POLICY IF EXISTS "admin_entity_follow_preferences_update_own" ON public.admin_entity_follow_preferences;
CREATE POLICY "admin_entity_follow_preferences_update_own" ON public.admin_entity_follow_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (((select auth.uid()))::text = ( SELECT (users.supabase_id)::text AS supabase_id
   FROM users
  WHERE (users.id = admin_entity_follow_preferences.user_id)))
  WITH CHECK (((select auth.uid()))::text = ( SELECT (users.supabase_id)::text AS supabase_id
   FROM users
  WHERE (users.id = admin_entity_follow_preferences.user_id)));

-- ============================================================
-- Table: ambassador_invitations
-- ============================================================

DROP POLICY IF EXISTS "Program admins can create invitations" ON public.ambassador_invitations;
CREATE POLICY "Program admins can create invitations" ON public.ambassador_invitations
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_invitations.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Program admins can delete their program invitations" ON public.ambassador_invitations;
CREATE POLICY "Program admins can delete their program invitations" ON public.ambassador_invitations
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_invitations.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Program admins can update their program invitations" ON public.ambassador_invitations;
CREATE POLICY "Program admins can update their program invitations" ON public.ambassador_invitations
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_invitations.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Program admins can view their program invitations" ON public.ambassador_invitations;
CREATE POLICY "Program admins can view their program invitations" ON public.ambassador_invitations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_invitations.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

-- ============================================================
-- Table: ambassador_members
-- ============================================================

DROP POLICY IF EXISTS "Event admins can manage ambassador members" ON public.ambassador_members;
CREATE POLICY "Event admins can manage ambassador members" ON public.ambassador_members
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_members.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users can apply to become ambassadors" ON public.ambassador_members;
CREATE POLICY "Users can apply to become ambassadors" ON public.ambassador_members
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid())))) AND (EXISTS ( SELECT 1
   FROM ambassador_programs
  WHERE ((ambassador_programs.id = ambassador_members.program_id) AND (ambassador_programs.is_active = true)))));

DROP POLICY IF EXISTS "Users can view their own ambassador memberships" ON public.ambassador_members;
CREATE POLICY "Users can view their own ambassador memberships" ON public.ambassador_members
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid())))) OR (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_members.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))));

-- ============================================================
-- Table: ambassador_mission_submissions
-- ============================================================

DROP POLICY IF EXISTS "Active ambassadors can submit missions" ON public.ambassador_mission_submissions;
CREATE POLICY "Active ambassadors can submit missions" ON public.ambassador_mission_submissions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.id = ambassador_mission_submissions.member_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (ambassador_members.status = 'active'::text))));

DROP POLICY IF EXISTS "Event admins can manage mission submissions" ON public.ambassador_mission_submissions;
CREATE POLICY "Event admins can manage mission submissions" ON public.ambassador_mission_submissions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM ((ambassador_missions am
     JOIN ambassador_programs ap ON ((ap.id = am.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((am.id = ambassador_mission_submissions.mission_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users can view their own mission submissions" ON public.ambassador_mission_submissions;
CREATE POLICY "Users can view their own mission submissions" ON public.ambassador_mission_submissions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.id = ambassador_mission_submissions.member_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))) OR (EXISTS ( SELECT 1
   FROM ((ambassador_missions am
     JOIN ambassador_programs ap ON ((ap.id = am.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((am.id = ambassador_mission_submissions.mission_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))));

-- ============================================================
-- Table: ambassador_missions
-- ============================================================

DROP POLICY IF EXISTS "Active ambassadors can view active missions" ON public.ambassador_missions;
CREATE POLICY "Active ambassadors can view active missions" ON public.ambassador_missions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true) AND (EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.program_id = ambassador_missions.program_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (ambassador_members.status = 'active'::text)))));

DROP POLICY IF EXISTS "Event admins can manage ambassador missions" ON public.ambassador_missions;
CREATE POLICY "Event admins can manage ambassador missions" ON public.ambassador_missions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_missions.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

-- ============================================================
-- Table: ambassador_programs
-- ============================================================

DROP POLICY IF EXISTS "Event admins can manage ambassador programs" ON public.ambassador_programs;
CREATE POLICY "Event admins can manage ambassador programs" ON public.ambassador_programs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = ambassador_programs.event_id) AND (user_permissions.permission_level >= 2) AND (user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

-- ============================================================
-- Table: ambassador_reward_redemptions
-- ============================================================

DROP POLICY IF EXISTS "Active ambassadors can request reward redemptions" ON public.ambassador_reward_redemptions;
CREATE POLICY "Active ambassadors can request reward redemptions" ON public.ambassador_reward_redemptions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.id = ambassador_reward_redemptions.member_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (ambassador_members.status = 'active'::text))));

DROP POLICY IF EXISTS "Event admins can manage reward redemptions" ON public.ambassador_reward_redemptions;
CREATE POLICY "Event admins can manage reward redemptions" ON public.ambassador_reward_redemptions
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM ((ambassador_rewards ar
     JOIN ambassador_programs ap ON ((ap.id = ar.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ar.id = ambassador_reward_redemptions.reward_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users can view their own reward redemptions" ON public.ambassador_reward_redemptions;
CREATE POLICY "Users can view their own reward redemptions" ON public.ambassador_reward_redemptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.id = ambassador_reward_redemptions.member_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))) OR (EXISTS ( SELECT 1
   FROM ((ambassador_rewards ar
     JOIN ambassador_programs ap ON ((ap.id = ar.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ar.id = ambassador_reward_redemptions.reward_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))));

-- ============================================================
-- Table: ambassador_rewards
-- ============================================================

DROP POLICY IF EXISTS "Active ambassadors can view active rewards" ON public.ambassador_rewards;
CREATE POLICY "Active ambassadors can view active rewards" ON public.ambassador_rewards
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_active = true) AND (EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.program_id = ambassador_rewards.program_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (ambassador_members.status = 'active'::text)))));

DROP POLICY IF EXISTS "Event admins can manage ambassador rewards" ON public.ambassador_rewards;
CREATE POLICY "Event admins can manage ambassador rewards" ON public.ambassador_rewards
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM (ambassador_programs ap
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((ap.id = ambassador_rewards.program_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

-- ============================================================
-- Table: ambassador_sales
-- ============================================================

DROP POLICY IF EXISTS "Event admins can manage ambassador sales" ON public.ambassador_sales;
CREATE POLICY "Event admins can manage ambassador sales" ON public.ambassador_sales
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM ((ambassador_members am
     JOIN ambassador_programs ap ON ((ap.id = am.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((am.id = ambassador_sales.member_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "Users can view their own ambassador sales" ON public.ambassador_sales;
CREATE POLICY "Users can view their own ambassador sales" ON public.ambassador_sales
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM ambassador_members
  WHERE ((ambassador_members.id = ambassador_sales.member_id) AND (ambassador_members.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))) OR (EXISTS ( SELECT 1
   FROM ((ambassador_members am
     JOIN ambassador_programs ap ON ((ap.id = am.program_id)))
     JOIN user_permissions up ON (((up.entity_id = ap.event_id) AND (up.entity_type = 'event'::entity_type_enum))))
  WHERE ((am.id = ambassador_sales.member_id) AND (up.permission_level >= 2) AND (up.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))));

-- ============================================================
-- Table: api_tokens
-- ============================================================

DROP POLICY IF EXISTS "Service role full access" ON public.api_tokens;
CREATE POLICY "Service role full access" ON public.api_tokens
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((select auth.role()) = 'service_role'::text)
  WITH CHECK ((select auth.role()) = 'service_role'::text);

-- ============================================================
-- Table: artist_genre
-- ============================================================

DROP POLICY IF EXISTS "ArtistGenre: Delete for managers and admins" ON public.artist_genre;
CREATE POLICY "ArtistGenre: Delete for managers and admins" ON public.artist_genre
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.artist_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.genre_id))))));

DROP POLICY IF EXISTS "ArtistGenre: Insert for managers and admins" ON public.artist_genre;
CREATE POLICY "ArtistGenre: Insert for managers and admins" ON public.artist_genre
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.artist_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.genre_id))))));

DROP POLICY IF EXISTS "ArtistGenre: Update for managers and admins" ON public.artist_genre;
CREATE POLICY "ArtistGenre: Update for managers and admins" ON public.artist_genre
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.artist_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = artist_genre.genre_id))))));

-- ============================================================
-- Table: artists
-- ============================================================

DROP POLICY IF EXISTS "Artists: Delete for admins only" ON public.artists;
CREATE POLICY "Artists: Delete for admins only" ON public.artists
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = artists.id) AND (user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.permission_level = 3))));

DROP POLICY IF EXISTS "Artists: Public view for managers and admins" ON public.artists;
CREATE POLICY "Artists: Public view for managers and admins" ON public.artists
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = artists.id) AND (user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

DROP POLICY IF EXISTS "Artists: Update for managers and admins" ON public.artists;
CREATE POLICY "Artists: Update for managers and admins" ON public.artists
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = artists.id) AND (user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

-- ============================================================
-- Table: chat_participants
-- ============================================================

DROP POLICY IF EXISTS "chat_participants_delete_for_participants" ON public.chat_participants;
CREATE POLICY "chat_participants_delete_for_participants" ON public.chat_participants
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

DROP POLICY IF EXISTS "chat_participants_insert_for_participants" ON public.chat_participants;
CREATE POLICY "chat_participants_insert_for_participants" ON public.chat_participants
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

DROP POLICY IF EXISTS "chat_participants_select_for_participants" ON public.chat_participants;
CREATE POLICY "chat_participants_select_for_participants" ON public.chat_participants
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM chat_participants cp_check
  WHERE ((cp_check.chat_id = chat_participants.chat_id) AND (cp_check.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (cp_check.active = true)))) AND (user_id <> ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "chat_participants_update_for_participants" ON public.chat_participants;
CREATE POLICY "chat_participants_update_for_participants" ON public.chat_participants
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))))
  WITH CHECK (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

-- ============================================================
-- Table: claims
-- ============================================================

DROP POLICY IF EXISTS "insert_claims" ON public.claims;
CREATE POLICY "insert_claims" ON public.claims
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = claims.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "select_own_claims" ON public.claims;
CREATE POLICY "select_own_claims" ON public.claims
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = claims.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "update_own_claims" ON public.claims;
CREATE POLICY "update_own_claims" ON public.claims
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = claims.user_id) AND (users.supabase_id = (select auth.uid())))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = claims.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: event_album_images
-- ============================================================

DROP POLICY IF EXISTS "manage_album_images" ON public.event_album_images;
CREATE POLICY "manage_album_images" ON public.event_album_images
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM event_albums
  WHERE ((event_albums.id = event_album_images.album_id) AND (EXISTS ( SELECT 1
           FROM users
          WHERE ((users.supabase_id = (select auth.uid())) AND (EXISTS ( SELECT 1
                   FROM user_permissions
                  WHERE ((user_permissions.user_id = users.id) AND (user_permissions.entity_id = event_albums.event_id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 1))))))))));

DROP POLICY IF EXISTS "view_album_images" ON public.event_album_images;
CREATE POLICY "view_album_images" ON public.event_album_images
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM event_albums
  WHERE ((event_albums.id = event_album_images.album_id) AND ((event_albums.is_public = true) OR (EXISTS ( SELECT 1
           FROM users
          WHERE ((users.supabase_id = (select auth.uid())) AND (EXISTS ( SELECT 1
                   FROM user_permissions
                  WHERE ((user_permissions.user_id = users.id) AND (user_permissions.entity_id = event_albums.event_id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 1)))))))))));

-- ============================================================
-- Table: event_albums
-- ============================================================

DROP POLICY IF EXISTS "manage_own_albums" ON public.event_albums;
CREATE POLICY "manage_own_albums" ON public.event_albums
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.supabase_id = (select auth.uid())) AND (EXISTS ( SELECT 1
           FROM user_permissions
          WHERE ((user_permissions.user_id = users.id) AND (user_permissions.entity_id = event_albums.event_id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 1)))))));

DROP POLICY IF EXISTS "view_public_albums" ON public.event_albums;
CREATE POLICY "view_public_albums" ON public.event_albums
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_public = true) OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.supabase_id = (select auth.uid())) AND (EXISTS ( SELECT 1
           FROM user_permissions
          WHERE ((user_permissions.user_id = users.id) AND (user_permissions.entity_id = event_albums.event_id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 1))))))));

-- ============================================================
-- Table: event_artist
-- ============================================================

DROP POLICY IF EXISTS "EventArtist: Delete for managers and admins" ON public.event_artist;
CREATE POLICY "EventArtist: Delete for managers and admins" ON public.event_artist
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_artist.event_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = ANY (event_artist.artist_id)))))));

DROP POLICY IF EXISTS "EventArtist: Insert for managers and admins" ON public.event_artist;
CREATE POLICY "EventArtist: Insert for managers and admins" ON public.event_artist
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_artist.event_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = ANY (event_artist.artist_id)))))));

DROP POLICY IF EXISTS "EventArtist: Update for managers and admins" ON public.event_artist;
CREATE POLICY "EventArtist: Update for managers and admins" ON public.event_artist
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_artist.event_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = ANY (event_artist.artist_id)))))));

-- ============================================================
-- Table: event_genre
-- ============================================================

DROP POLICY IF EXISTS "EventGenre: Delete for managers and admins" ON public.event_genre;
CREATE POLICY "EventGenre: Delete for managers and admins" ON public.event_genre
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_genre.event_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = event_genre.genre_id))))));

DROP POLICY IF EXISTS "EventGenre: Insert for managers and admins" ON public.event_genre;
CREATE POLICY "EventGenre: Insert for managers and admins" ON public.event_genre
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_genre.event_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = event_genre.genre_id))))));

DROP POLICY IF EXISTS "EventGenre: Update for managers and admins" ON public.event_genre;
CREATE POLICY "EventGenre: Update for managers and admins" ON public.event_genre
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_genre.event_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = event_genre.genre_id))))));

-- ============================================================
-- Table: event_guestlist
-- ============================================================

DROP POLICY IF EXISTS "guestlist_delete_by_permission" ON public.event_guestlist;
CREATE POLICY "guestlist_delete_by_permission" ON public.event_guestlist
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (EXISTS ( SELECT 1
   FROM (user_permissions up
     JOIN users u ON ((u.id = up.user_id)))
  WHERE ((up.entity_id = event_guestlist.event_id) AND (up.entity_type = 'event'::entity_type_enum) AND (up.permission_level >= 2) AND (u.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "guestlist_insert_by_permission" ON public.event_guestlist;
CREATE POLICY "guestlist_insert_by_permission" ON public.event_guestlist
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions up
     JOIN users u ON ((u.id = up.user_id)))
  WHERE ((up.entity_id = event_guestlist.event_id) AND (up.entity_type = 'event'::entity_type_enum) AND (up.permission_level >= 2) AND (u.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "guestlist_select_by_permission" ON public.event_guestlist;
CREATE POLICY "guestlist_select_by_permission" ON public.event_guestlist
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM (user_permissions up
     JOIN users u ON ((u.id = up.user_id)))
  WHERE ((up.entity_id = event_guestlist.event_id) AND (up.entity_type = 'event'::entity_type_enum) AND (up.permission_level >= 1) AND (u.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "guestlist_update_by_permission" ON public.event_guestlist;
CREATE POLICY "guestlist_update_by_permission" ON public.event_guestlist
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (EXISTS ( SELECT 1
   FROM (user_permissions up
     JOIN users u ON ((u.id = up.user_id)))
  WHERE ((up.entity_id = event_guestlist.event_id) AND (up.entity_type = 'event'::entity_type_enum) AND (up.permission_level >= 2) AND (u.supabase_id = (select auth.uid())))))
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions up
     JOIN users u ON ((u.id = up.user_id)))
  WHERE ((up.entity_id = event_guestlist.event_id) AND (up.entity_type = 'event'::entity_type_enum) AND (up.permission_level >= 2) AND (u.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: event_promoter
-- ============================================================

DROP POLICY IF EXISTS "EventPromoter: Delete for managers and admins" ON public.event_promoter;
CREATE POLICY "EventPromoter: Delete for managers and admins" ON public.event_promoter
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.event_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.promoter_id))))));

DROP POLICY IF EXISTS "EventPromoter: Insert for managers and admins" ON public.event_promoter;
CREATE POLICY "EventPromoter: Insert for managers and admins" ON public.event_promoter
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.event_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.promoter_id))))));

DROP POLICY IF EXISTS "EventPromoter: Update for managers and admins" ON public.event_promoter;
CREATE POLICY "EventPromoter: Update for managers and admins" ON public.event_promoter
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.event_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = event_promoter.promoter_id))))));

-- ============================================================
-- Table: event_venue
-- ============================================================

DROP POLICY IF EXISTS "EventVenue: Delete for managers and admins" ON public.event_venue;
CREATE POLICY "EventVenue: Delete for managers and admins" ON public.event_venue
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_venue.event_id)) OR ((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = event_venue.venue_id))))));

DROP POLICY IF EXISTS "EventVenue: Insert for managers and admins" ON public.event_venue;
CREATE POLICY "EventVenue: Insert for managers and admins" ON public.event_venue
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_venue.event_id)) OR ((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = event_venue.venue_id))))));

DROP POLICY IF EXISTS "EventVenue: Update for managers and admins" ON public.event_venue;
CREATE POLICY "EventVenue: Update for managers and admins" ON public.event_venue
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.entity_id = event_venue.event_id)) OR ((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = event_venue.venue_id))))));

-- ============================================================
-- Table: events
-- ============================================================

DROP POLICY IF EXISTS "Events: Delete for admins only" ON public.events;
CREATE POLICY "Events: Delete for admins only" ON public.events
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = events.id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level = 3))));

DROP POLICY IF EXISTS "Events: Public view for managers and admins" ON public.events;
CREATE POLICY "Events: Public view for managers and admins" ON public.events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = events.id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

DROP POLICY IF EXISTS "Events: Update basic fields for managers and admins" ON public.events;
CREATE POLICY "Events: Update basic fields for managers and admins" ON public.events
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = events.id) AND (user_permissions.entity_type = 'event'::entity_type_enum) AND (user_permissions.permission_level >= 2))))
  WITH CHECK true;

-- ============================================================
-- Table: fullscreen_notification_views
-- ============================================================

DROP POLICY IF EXISTS "Insert own notification views" ON public.fullscreen_notification_views;
CREATE POLICY "Insert own notification views" ON public.fullscreen_notification_views
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))
 LIMIT 1));

DROP POLICY IF EXISTS "Users can view their own notification views" ON public.fullscreen_notification_views;
CREATE POLICY "Users can view their own notification views" ON public.fullscreen_notification_views
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))
 LIMIT 1));

-- ============================================================
-- Table: messages
-- ============================================================

DROP POLICY IF EXISTS "messages_delete_for_message_sender" ON public.messages;
CREATE POLICY "messages_delete_for_message_sender" ON public.messages
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (sender_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

DROP POLICY IF EXISTS "messages_insert_for_authenticated" ON public.messages;
CREATE POLICY "messages_insert_for_authenticated" ON public.messages
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((sender_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid())))) AND (EXISTS ( SELECT 1
   FROM chat_participants
  WHERE ((chat_participants.chat_id = messages.chat_id) AND (chat_participants.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (chat_participants.active = true)))));

DROP POLICY IF EXISTS "messages_select_for_chat_participants" ON public.messages;
CREATE POLICY "messages_select_for_chat_participants" ON public.messages
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM chat_participants
  WHERE ((chat_participants.chat_id = messages.chat_id) AND (chat_participants.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (chat_participants.active = true))));

DROP POLICY IF EXISTS "messages_update_for_message_sender" ON public.messages;
CREATE POLICY "messages_update_for_message_sender" ON public.messages
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (sender_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))))
  WITH CHECK (sender_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

-- ============================================================
-- Table: notifications
-- ============================================================

DROP POLICY IF EXISTS "Insert own notifications" ON public.notifications;
CREATE POLICY "Insert own notifications" ON public.notifications
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (supabase_id = (select auth.uid()));

DROP POLICY IF EXISTS "Select own notifications" ON public.notifications;
CREATE POLICY "Select own notifications" ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (supabase_id = (select auth.uid()));

DROP POLICY IF EXISTS "Update own notifications" ON public.notifications;
CREATE POLICY "Update own notifications" ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (supabase_id = (select auth.uid()));

-- ============================================================
-- Table: promoter_genre
-- ============================================================

DROP POLICY IF EXISTS "PromoterGenre: Delete for managers and admins" ON public.promoter_genre;
CREATE POLICY "PromoterGenre: Delete for managers and admins" ON public.promoter_genre
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.promoter_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.genre_id))))));

DROP POLICY IF EXISTS "PromoterGenre: Insert for managers and admins" ON public.promoter_genre;
CREATE POLICY "PromoterGenre: Insert for managers and admins" ON public.promoter_genre
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.promoter_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.genre_id))))));

DROP POLICY IF EXISTS "PromoterGenre: Update for managers and admins" ON public.promoter_genre;
CREATE POLICY "PromoterGenre: Update for managers and admins" ON public.promoter_genre
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.promoter_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = promoter_genre.genre_id))))));

-- ============================================================
-- Table: promoter_resident_artists
-- ============================================================

DROP POLICY IF EXISTS "PromoterResidentArtists: Delete for managers and admins" ON public.promoter_resident_artists;
CREATE POLICY "PromoterResidentArtists: Delete for managers and admins" ON public.promoter_resident_artists
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.promoter_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.artist_id))))));

DROP POLICY IF EXISTS "PromoterResidentArtists: Insert for managers and admins" ON public.promoter_resident_artists;
CREATE POLICY "PromoterResidentArtists: Insert for managers and admins" ON public.promoter_resident_artists
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.promoter_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.artist_id))))));

DROP POLICY IF EXISTS "PromoterResidentArtists: Update for managers and admins" ON public.promoter_resident_artists;
CREATE POLICY "PromoterResidentArtists: Update for managers and admins" ON public.promoter_resident_artists
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.promoter_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = promoter_resident_artists.artist_id))))));

-- ============================================================
-- Table: promoters
-- ============================================================

DROP POLICY IF EXISTS "Promoters: Delete for admins only" ON public.promoters;
CREATE POLICY "Promoters: Delete for admins only" ON public.promoters
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = promoters.id) AND (user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.permission_level = 3))));

DROP POLICY IF EXISTS "Promoters: Public view for managers and admins" ON public.promoters;
CREATE POLICY "Promoters: Public view for managers and admins" ON public.promoters
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = promoters.id) AND (user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

DROP POLICY IF EXISTS "Promoters: Update for managers and admins" ON public.promoters;
CREATE POLICY "Promoters: Update for managers and admins" ON public.promoters
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = promoters.id) AND (user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

-- ============================================================
-- Table: scanners
-- ============================================================

DROP POLICY IF EXISTS "Event admins can delete scanners" ON public.scanners;
CREATE POLICY "Event admins can delete scanners" ON public.scanners
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((CURRENT_USER = 'postgres'::name) OR ((select auth.uid()) IN ( SELECT u.supabase_id
   FROM (users u
     JOIN user_permissions up ON ((u.id = up.user_id)))
  WHERE ((up.entity_type = 'event'::entity_type_enum) AND (up.entity_id = scanners.event_id) AND (up.permission_level >= 3)))));

DROP POLICY IF EXISTS "Event managers can create scanners" ON public.scanners;
CREATE POLICY "Event managers can create scanners" ON public.scanners
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((CURRENT_USER = 'postgres'::name) OR ((select auth.uid()) IN ( SELECT u.supabase_id
   FROM (users u
     JOIN user_permissions up ON ((u.id = up.user_id)))
  WHERE ((up.entity_type = 'event'::entity_type_enum) AND (up.entity_id = scanners.event_id) AND (up.permission_level >= 2)))));

DROP POLICY IF EXISTS "Event managers can update scanners" ON public.scanners;
CREATE POLICY "Event managers can update scanners" ON public.scanners
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((CURRENT_USER = 'postgres'::name) OR ((select auth.uid()) IN ( SELECT u.supabase_id
   FROM (users u
     JOIN user_permissions up ON ((u.id = up.user_id)))
  WHERE ((up.entity_type = 'event'::entity_type_enum) AND (up.entity_id = scanners.event_id) AND (up.permission_level >= 2)))));

DROP POLICY IF EXISTS "Users can view scanners" ON public.scanners;
CREATE POLICY "Users can view scanners" ON public.scanners
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((CURRENT_USER = 'postgres'::name) OR ((select auth.uid()) IN ( SELECT u.supabase_id
   FROM (users u
     JOIN user_permissions up ON ((u.id = up.user_id)))
  WHERE ((up.entity_type = 'event'::entity_type_enum) AND (up.entity_id = scanners.event_id) AND (up.permission_level >= 2)))) OR (user_id IN ( SELECT u.id
   FROM users u
  WHERE (u.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: tickets
-- ============================================================

DROP POLICY IF EXISTS "ticket_download_with_token" ON public.tickets;
CREATE POLICY "ticket_download_with_token" ON public.tickets
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((customization_token = ((current_setting('request.jwt.claims'::text, true))::json ->> 'customization_token'::text)) OR (order_id IN ( SELECT orders.id
   FROM orders
  WHERE (orders.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))))));

DROP POLICY IF EXISTS "users_can_update_own_ticket_customization" ON public.tickets;
CREATE POLICY "users_can_update_own_ticket_customization" ON public.tickets
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (order_id IN ( SELECT orders.id
   FROM orders
  WHERE (orders.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))))
  WITH CHECK (order_id IN ( SELECT orders.id
   FROM orders
  WHERE (orders.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))));

DROP POLICY IF EXISTS "users_can_view_own_tickets" ON public.tickets;
CREATE POLICY "users_can_view_own_tickets" ON public.tickets
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (order_id IN ( SELECT orders.id
   FROM orders
  WHERE (orders.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid()))))));

-- ============================================================
-- Table: user_follow_artist
-- ============================================================

DROP POLICY IF EXISTS "UserFollowArtist: Delete own follows" ON public.user_follow_artist;
CREATE POLICY "UserFollowArtist: Delete own follows" ON public.user_follow_artist
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_artist.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowArtist: Insert own follows" ON public.user_follow_artist;
CREATE POLICY "UserFollowArtist: Insert own follows" ON public.user_follow_artist
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_artist.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowArtist: Update own follows" ON public.user_follow_artist;
CREATE POLICY "UserFollowArtist: Update own follows" ON public.user_follow_artist
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_artist.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_follow_chat
-- ============================================================

DROP POLICY IF EXISTS "user_follow_chat_delete_for_user" ON public.user_follow_chat;
CREATE POLICY "user_follow_chat_delete_for_user" ON public.user_follow_chat
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

DROP POLICY IF EXISTS "user_follow_chat_insert_for_user" ON public.user_follow_chat;
CREATE POLICY "user_follow_chat_insert_for_user" ON public.user_follow_chat
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

DROP POLICY IF EXISTS "user_follow_chat_select_for_user" ON public.user_follow_chat;
CREATE POLICY "user_follow_chat_select_for_user" ON public.user_follow_chat
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))));

-- ============================================================
-- Table: user_follow_genre
-- ============================================================

DROP POLICY IF EXISTS "UserFollowGenre: Delete own follows" ON public.user_follow_genre;
CREATE POLICY "UserFollowGenre: Delete own follows" ON public.user_follow_genre
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_genre.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowGenre: Insert own follows" ON public.user_follow_genre;
CREATE POLICY "UserFollowGenre: Insert own follows" ON public.user_follow_genre
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_genre.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowGenre: Update own follows" ON public.user_follow_genre;
CREATE POLICY "UserFollowGenre: Update own follows" ON public.user_follow_genre
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_genre.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_follow_promoter
-- ============================================================

DROP POLICY IF EXISTS "UserFollowPromoter: Delete own follows" ON public.user_follow_promoter;
CREATE POLICY "UserFollowPromoter: Delete own follows" ON public.user_follow_promoter
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_promoter.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowPromoter: Insert own follows" ON public.user_follow_promoter;
CREATE POLICY "UserFollowPromoter: Insert own follows" ON public.user_follow_promoter
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_promoter.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowPromoter: Update own follows" ON public.user_follow_promoter;
CREATE POLICY "UserFollowPromoter: Update own follows" ON public.user_follow_promoter
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_promoter.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_follow_user
-- ============================================================

DROP POLICY IF EXISTS "UserFollowEvent: Delete own follows" ON public.user_follow_user;
CREATE POLICY "UserFollowEvent: Delete own follows" ON public.user_follow_user
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_user.follower_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowEvent: Insert own follows" ON public.user_follow_user;
CREATE POLICY "UserFollowEvent: Insert own follows" ON public.user_follow_user
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_user.follower_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowEvent: Update own follows" ON public.user_follow_user;
CREATE POLICY "UserFollowEvent: Update own follows" ON public.user_follow_user
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_user.follower_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_follow_venue
-- ============================================================

DROP POLICY IF EXISTS "UserFollowVenue: Delete own follows" ON public.user_follow_venue;
CREATE POLICY "UserFollowVenue: Delete own follows" ON public.user_follow_venue
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_venue.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowVenue: Insert own follows" ON public.user_follow_venue;
CREATE POLICY "UserFollowVenue: Insert own follows" ON public.user_follow_venue
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_venue.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserFollowVenue: Update own follows" ON public.user_follow_venue;
CREATE POLICY "UserFollowVenue: Update own follows" ON public.user_follow_venue
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_follow_venue.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_interest_event
-- ============================================================

DROP POLICY IF EXISTS "UserInterestEvent: Delete own follows" ON public.user_interest_event;
CREATE POLICY "UserInterestEvent: Delete own follows" ON public.user_interest_event
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_interest_event.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserInterestEvent: Insert own follows" ON public.user_interest_event;
CREATE POLICY "UserInterestEvent: Insert own follows" ON public.user_interest_event
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_interest_event.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "UserInterestEvent: Update own follows" ON public.user_interest_event;
CREATE POLICY "UserInterestEvent: Update own follows" ON public.user_interest_event
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_interest_event.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_notification_preferences
-- ============================================================

DROP POLICY IF EXISTS "Delete own notification preferences" ON public.user_notification_preferences;
CREATE POLICY "Delete own notification preferences" ON public.user_notification_preferences
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_notification_preferences.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Insert own notification preferences" ON public.user_notification_preferences;
CREATE POLICY "Insert own notification preferences" ON public.user_notification_preferences
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_notification_preferences.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Select own notification preferences" ON public.user_notification_preferences;
CREATE POLICY "Select own notification preferences" ON public.user_notification_preferences
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_notification_preferences.user_id) AND (users.supabase_id = (select auth.uid())))));

DROP POLICY IF EXISTS "Update own notification preferences" ON public.user_notification_preferences;
CREATE POLICY "Update own notification preferences" ON public.user_notification_preferences
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = user_notification_preferences.user_id) AND (users.supabase_id = (select auth.uid())))));

-- ============================================================
-- Table: user_permissions
-- ============================================================

DROP POLICY IF EXISTS "UserPermissions: Delete permissions" ON public.user_permissions;
CREATE POLICY "UserPermissions: Delete permissions" ON public.user_permissions
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))
 LIMIT 1)) OR (get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 3) OR ((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 2) AND (permission_level = 1)));

DROP POLICY IF EXISTS "UserPermissions: Insert permissions" ON public.user_permissions;
CREATE POLICY "UserPermissions: Insert permissions" ON public.user_permissions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 3) AND (permission_level = ANY (ARRAY[1, 2, 3]))) OR ((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 2) AND (permission_level = 1))) AND (user_id <> ( SELECT users.id
   FROM users
  WHERE (users.supabase_id = (select auth.uid()))
 LIMIT 1)));

DROP POLICY IF EXISTS "UserPermissions: Update permissions" ON public.user_permissions;
CREATE POLICY "UserPermissions: Update permissions" ON public.user_permissions
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 3) OR ((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 2) AND (permission_level = 1)))
  WITH CHECK (((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 3) AND (permission_level = ANY (ARRAY[1, 2, 3]))) OR ((get_user_perm_level(entity_type, entity_id, (select auth.uid())) = 2) AND (permission_level = 1)));

DROP POLICY IF EXISTS "UserPermissions: View entity permissions" ON public.user_permissions;
CREATE POLICY "UserPermissions: View entity permissions" ON public.user_permissions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (get_user_perm_level(entity_type, entity_id, (select auth.uid())) > 0);

-- ============================================================
-- Table: users
-- ============================================================

DROP POLICY IF EXISTS "Users can select their own data" ON public.users;
CREATE POLICY "Users can select their own data" ON public.users
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (supabase_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users: Insert own user" ON public.users;
CREATE POLICY "Users: Insert own user" ON public.users
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((supabase_id = (select auth.uid())) AND (email IS NOT NULL) AND ((email)::text <> ''::text));

DROP POLICY IF EXISTS "Users: Select own row" ON public.users;
CREATE POLICY "Users: Select own row" ON public.users
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (supabase_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users: Update own user" ON public.users;
CREATE POLICY "Users: Update own user" ON public.users
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (supabase_id = (select auth.uid()))
  WITH CHECK ((supabase_id = (select auth.uid())) AND (email IS NOT NULL) AND ((email)::text <> ''::text));

DROP POLICY IF EXISTS "Users: View own data" ON public.users;
CREATE POLICY "Users: View own data" ON public.users
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (supabase_id = (select auth.uid()));

-- ============================================================
-- Table: venue_genre
-- ============================================================

DROP POLICY IF EXISTS "VenueGenre: Delete for managers and admins" ON public.venue_genre;
CREATE POLICY "VenueGenre: Delete for managers and admins" ON public.venue_genre
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.venue_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.genre_id))))));

DROP POLICY IF EXISTS "VenueGenre: Insert for managers and admins" ON public.venue_genre;
CREATE POLICY "VenueGenre: Insert for managers and admins" ON public.venue_genre
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.venue_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.genre_id))))));

DROP POLICY IF EXISTS "VenueGenre: Update for managers and admins" ON public.venue_genre;
CREATE POLICY "VenueGenre: Update for managers and admins" ON public.venue_genre
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.venue_id)) OR ((user_permissions.entity_type = 'genre'::entity_type_enum) AND (user_permissions.entity_id = venue_genre.genre_id))))));

-- ============================================================
-- Table: venue_promoter
-- ============================================================

DROP POLICY IF EXISTS "VenuePromoter: Delete for managers and admins" ON public.venue_promoter;
CREATE POLICY "VenuePromoter: Delete for managers and admins" ON public.venue_promoter
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.venue_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.promoter_id))))));

DROP POLICY IF EXISTS "VenuePromoter: Insert for managers and admins" ON public.venue_promoter;
CREATE POLICY "VenuePromoter: Insert for managers and admins" ON public.venue_promoter
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.venue_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.promoter_id))))));

DROP POLICY IF EXISTS "VenuePromoter: Update for managers and admins" ON public.venue_promoter;
CREATE POLICY "VenuePromoter: Update for managers and admins" ON public.venue_promoter
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.venue_id)) OR ((user_permissions.entity_type = 'promoter'::entity_type_enum) AND (user_permissions.entity_id = venue_promoter.promoter_id))))));

-- ============================================================
-- Table: venue_resident_artists
-- ============================================================

DROP POLICY IF EXISTS "VenueResidentArtists: Delete for managers and admins" ON public.venue_resident_artists;
CREATE POLICY "VenueResidentArtists: Delete for managers and admins" ON public.venue_resident_artists
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.venue_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.artist_id))))));

DROP POLICY IF EXISTS "VenueResidentArtists: Insert for managers and admins" ON public.venue_resident_artists;
CREATE POLICY "VenueResidentArtists: Insert for managers and admins" ON public.venue_resident_artists
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.venue_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.artist_id))))));

DROP POLICY IF EXISTS "VenueResidentArtists: Update for managers and admins" ON public.venue_resident_artists;
CREATE POLICY "VenueResidentArtists: Update for managers and admins" ON public.venue_resident_artists
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM (user_permissions
     JOIN users ON ((users.id = user_permissions.user_id)))
  WHERE ((users.supabase_id = (select auth.uid())) AND (user_permissions.permission_level >= 2) AND (((user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.venue_id)) OR ((user_permissions.entity_type = 'artist'::entity_type_enum) AND (user_permissions.entity_id = venue_resident_artists.artist_id))))));

-- ============================================================
-- Table: venues
-- ============================================================

DROP POLICY IF EXISTS "Venues: Delete for admins only" ON public.venues;
CREATE POLICY "Venues: Delete for admins only" ON public.venues
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = venues.id) AND (user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.permission_level = 3))));

DROP POLICY IF EXISTS "Venues: Public view for managers and admins" ON public.venues;
CREATE POLICY "Venues: Public view for managers and admins" ON public.venues
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = venues.id) AND (user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

DROP POLICY IF EXISTS "Venues: Update for managers and admins" ON public.venues;
CREATE POLICY "Venues: Update for managers and admins" ON public.venues
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (EXISTS ( SELECT 1
   FROM user_permissions
  WHERE ((user_permissions.user_id = ( SELECT users.id
           FROM users
          WHERE (users.supabase_id = (select auth.uid())))) AND (user_permissions.entity_id = venues.id) AND (user_permissions.entity_type = 'venue'::entity_type_enum) AND (user_permissions.permission_level >= 2))));

COMMIT;