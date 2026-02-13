// Database utilities pour les Edge Functions Supabase
// Adaptation des utilitaires JavaScript locaux avec client Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.ts';
import { Event, Artist, Venue, Promoter, Genre, EventArtist, ValidationResult } from '../types/index.ts';

class DatabaseClient {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required Supabase environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  // ===== EVENT OPERATIONS =====
  
  async createEvent(eventData: Omit<Event, 'id' | 'created_at' | 'updated_at'>): Promise<Event> {
    const timer = logger.startTimer('db_create_event');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .insert([eventData])
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('CREATE', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('CREATE', 'events', true, 1);
      return data as Event;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEvent(id: number): Promise<Event | null> {
    const timer = logger.startTimer('db_get_event');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .single();

      const duration = timer();
      
      if (error) {
        if (error.code === 'PGRST116') {
          logger.logDbOperation('SELECT', 'events', true, 0);
          return null;
        }
        logger.logDbOperation('SELECT', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'events', true, 1);
      return data as Event;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEventByFacebookId(facebookEventId: string): Promise<Event | null> {
    const timer = logger.startTimer('db_get_event_by_facebook_id');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .select('*')
        .ilike('metadata->>facebook_url', `%${facebookEventId}%`)
        .maybeSingle();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'events', true, data ? 1 : 0);
      return data as Event | null;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async updateEvent(id: number, updates: Partial<Event>): Promise<Event> {
    const timer = logger.startTimer('db_update_event');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('UPDATE', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('UPDATE', 'events', true, 1);
      return data as Event;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEvents(filters?: {
    status?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<Event[]> {
    const timer = logger.startTimer('db_get_events');
    
    try {
      let query = this.supabase
        .from('events')
        .select('*');

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      
      if (filters?.start_date) {
        query = query.gte('date_time', filters.start_date);
      }
      
      if (filters?.end_date) {
        query = query.lte('date_time', filters.end_date);
      }

      const { data, error } = await query;

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'events', true, data?.length || 0);
      return data as Event[] || [];
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEventsByName(name: string): Promise<Event[]> {
    const timer = logger.startTimer('db_get_events_by_name');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .select('*')
        .eq('title', name);

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'events', true, data?.length || 0);
      return data as Event[] || [];
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEventsByFacebookUrl(facebookUrl: string): Promise<Event[]> {
    const timer = logger.startTimer('db_get_events_by_facebook_url');
    
    try {
      const { data, error } = await this.supabase
        .from('events')
        .select('*')
        .ilike('metadata->>facebook_url', facebookUrl);

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'events', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'events', true, data?.length || 0);
      return data as Event[] || [];
    } catch (error) {
      timer();
      throw error;
    }
  }

  // ===== EVENT-ARTIST LINK OPERATIONS =====
  
  async createEventArtistLink(linkData: {
    event_id: number;
    artist_id: string | string[];
    start_time?: string | null;
    end_time?: string | null;
    status?: string;
    stage?: string | null;
    custom_name?: string | null;
  }): Promise<any> {
    const timer = logger.startTimer('db_create_event_artist_link');
    
    try {
      const { data, error } = await this.supabase
        .from('event_artist')
        .insert([{
          ...linkData,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('CREATE', 'event_artist', false, 0, error);
        throw error;
      }

      logger.logDbOperation('CREATE', 'event_artist', true, 1);
      return data;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getEventArtistLinks(eventId: number, filters?: {
    stage?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    artist_ids?: string[];
  }): Promise<any[]> {
    const timer = logger.startTimer('db_get_event_artist_links');
    
    try {
      let query = this.supabase
        .from('event_artist')
        .select('*')
        .eq('event_id', eventId);

      if (filters?.stage !== undefined) {
        if (filters.stage === null) {
          query = query.is('stage', null);
        } else {
          query = query.eq('stage', filters.stage);
        }
      }
      
      if (filters?.start_time !== undefined) {
        if (filters.start_time === null) {
          query = query.is('start_time', null);
        } else {
          query = query.eq('start_time', filters.start_time);
        }
      }
      
      if (filters?.end_time !== undefined) {
        if (filters.end_time === null) {
          query = query.is('end_time', null);
        } else {
          query = query.eq('end_time', filters.end_time);
        }
      }
      
      if (filters?.artist_ids) {
        query = query.contains('artist_id', filters.artist_ids);
      }

      const { data, error } = await query;

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'event_artist', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'event_artist', true, data?.length || 0);
      return data || [];
    } catch (error) {
      timer();
      throw error;
    }
  }

  // ===== ARTIST OPERATIONS =====
  
  async createArtist(artistData: Omit<Artist, 'id' | 'created_at' | 'updated_at'>): Promise<Artist> {
    const timer = logger.startTimer('db_create_artist');
    
    try {
      const { data, error } = await this.supabase
        .from('artists')
        .insert([artistData])
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('CREATE', 'artists', false, 0, error);
        throw error;
      }

      logger.logDbOperation('CREATE', 'artists', true, 1);
      return data as Artist;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getArtistBySoundCloudId(soundCloudId: string): Promise<Artist | null> {
    const timer = logger.startTimer('db_get_artist_by_soundcloud_id');
    
    try {
      const { data, error } = await this.supabase
        .from('artists')
        .select('*')
        .eq('external_links->soundcloud->>id', soundCloudId)
        .maybeSingle();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'artists', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'artists', true, data ? 1 : 0);
      return data as Artist | null;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async searchArtistByName(name: string): Promise<Artist[]> {
    const timer = logger.startTimer('db_search_artist_by_name');
    
    try {
      const { data, error } = await this.supabase
        .from('artists')
        .select('*')
        .ilike('name', `%${name}%`);

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'artists', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'artists', true, data?.length || 0);
      return data as Artist[] || [];
    } catch (error) {
      timer();
      throw error;
    }
  }

  async updateArtist(id: number, updates: Partial<Artist>): Promise<Artist> {
    const timer = logger.startTimer('db_update_artist');
    
    try {
      const { data, error } = await this.supabase
        .from('artists')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('UPDATE', 'artists', false, 0, error);
        throw error;
      }

      logger.logDbOperation('UPDATE', 'artists', true, 1);
      return data as Artist;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async linkArtistGenres(artistId: number, genreIds: number[]): Promise<void> {
    const timer = logger.startTimer('db_link_artist_genres');
    
    try {
      const links = genreIds.map(genreId => ({
        artist_id: artistId,
        genre_id: genreId
      }));

      const { error } = await this.supabase
        .from('artist_genre')
        .upsert(links, { onConflict: 'artist_id,genre_id', ignoreDuplicates: true });

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('UPSERT', 'artist_genre', false, 0, error);
        throw error;
      }

      logger.logDbOperation('UPSERT', 'artist_genre', true, genreIds.length);
    } catch (error) {
      timer();
      throw error;
    }
  }

  // ===== VENUE OPERATIONS =====
  
  async createVenue(venueData: any): Promise<Venue> {
    const timer = logger.startTimer('db_create_venue');
    
    try {
      logger.info('Creating venue with data:', venueData);
      
      const { data, error } = await this.supabase
        .from('venues')
        .insert([venueData])
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.error('Database error creating venue:', error);
        logger.logDbOperation('CREATE', 'venues', false, 0, error);
        throw error;
      }

      logger.info('Venue created successfully:', data);
      logger.logDbOperation('CREATE', 'venues', true, 1);
      return data as Venue;
    } catch (error) {
      timer();
      logger.error('Exception in createVenue:', error);
      throw error;
    }
  }

  // ===== GENRE OPERATIONS =====
  
  async createGenre(genreData: Omit<Genre, 'id' | 'created_at' | 'updated_at'>): Promise<Genre> {
    const timer = logger.startTimer('db_create_genre');
    
    try {
      const { data, error } = await this.supabase
        .from('genres')
        .insert([genreData])
        .select()
        .single();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('CREATE', 'genres', false, 0, error);
        throw error;
      }

      logger.logDbOperation('CREATE', 'genres', true, 1);
      return data as Genre;
    } catch (error) {
      timer();
      throw error;
    }
  }

  async getGenreByName(name: string): Promise<Genre | null> {
    const timer = logger.startTimer('db_get_genre_by_name');
    
    try {
      const { data, error } = await this.supabase
        .from('genres')
        .select('*')
        .eq('name', name)
        .maybeSingle();

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'genres', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'genres', true, data ? 1 : 0);
      return data as Genre | null;
    } catch (error) {
      timer();
      throw error;
    }
  }

  // ===== GENRE QUERY OPERATIONS =====

  async getAllGenres(): Promise<Genre[]> {
    const timer = logger.startTimer('db_get_all_genres');
    
    try {
      const { data, error } = await this.supabase
        .from('genres')
        .select('id, name, description, external_links');

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('SELECT', 'genres', false, 0, error);
        throw error;
      }

      logger.logDbOperation('SELECT', 'genres', true, data?.length || 0);
      return (data || []) as Genre[];
    } catch (error) {
      timer();
      throw error;
    }
  }

  async linkEventGenres(eventId: number, genreIds: number[]): Promise<void> {
    const timer = logger.startTimer('db_link_event_genres');
    
    try {
      // Build upsert data — avoid duplicates with onConflict
      const links = genreIds.map(genreId => ({
        event_id: eventId,
        genre_id: genreId
      }));

      const { error } = await this.supabase
        .from('event_genre')
        .upsert(links, { onConflict: 'event_id,genre_id', ignoreDuplicates: true });

      const duration = timer();
      
      if (error) {
        logger.logDbOperation('UPSERT', 'event_genre', false, 0, error);
        throw error;
      }

      logger.logDbOperation('UPSERT', 'event_genre', true, genreIds.length);
      logger.info(`Linked ${genreIds.length} genres to event ${eventId}`);
    } catch (error) {
      timer();
      throw error;
    }
  }

  // ===== EVENT-ARTIST RELATION OPERATIONS =====
  
  async createEventArtistRelation(
    eventId: number,
    artistIds: number[],
    performanceData?: { stage?: string | null; start_time?: string | null; end_time?: string | null }
  ): Promise<void> {
    const timer = logger.startTimer('db_create_event_artist_relation');
    
    try {
      // Check for existing relations to avoid duplicates
      const { data: existingRelations, error: checkError } = await this.supabase
        .from('event_artist')
        .select('artist_id')
        .eq('event_id', eventId);
        
      if (checkError) {
        logger.warn('Could not check existing relations, proceeding anyway', checkError);
      }
      
      // Get already existing artist IDs to avoid duplicates
      const existingArtistIds = new Set<number>();
      if (existingRelations) {
        existingRelations.forEach((rel: any) => {
          if (rel.artist_id && Array.isArray(rel.artist_id)) {
            rel.artist_id.forEach((id: any) => existingArtistIds.add(Number(id)));
          }
        });
      }
      
      // Filter out already existing artists
      const newArtistIds = artistIds.filter(id => !existingArtistIds.has(id));
      
      if (newArtistIds.length === 0) {
        logger.info(`All ${artistIds.length} artists already have relations with event ${eventId}`);
        timer();
        return;
      }
      
      logger.info(`Creating relations for ${newArtistIds.length} new artists (${existingArtistIds.size} already exist)`);
      
      // Create individual relations for each artist (like local system)
      const relationPromises = newArtistIds.map(artistId => {
        const relationData: any = {
          event_id: eventId,
          artist_id: [String(artistId)], // Array with single ID as string, matching local system behavior
          status: 'confirmed',
          stage: performanceData?.stage || null,
          start_time: performanceData?.start_time || null,
          end_time: performanceData?.end_time || null,
          custom_name: null
        };

        return this.supabase
          .from('event_artist')
          .insert([relationData]);
      });

      const results = await Promise.all(relationPromises);
      const duration = timer();
      
      // Check for any errors
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        const firstError = errors[0].error!;
        logger.logDbOperation('CREATE', 'event_artist', false, 0, firstError);
        throw firstError;
      }

      logger.logDbOperation('CREATE', 'event_artist', true, newArtistIds.length);
      logger.info(`Created ${newArtistIds.length} event_artist relations: event ${eventId} -> artists [${newArtistIds.join(', ')}]`);
    } catch (error) {
      timer();
      throw error;
    }
  }
  
  // ===== VALIDATION HELPERS =====
  
  validateEvent(eventData: Partial<Event>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!eventData.title || eventData.title.trim().length === 0) {
      errors.push('Event title is required');
    }

    if (!eventData.date_time) {
      errors.push('Event date_time is required');
    } else {
      const startTime = new Date(eventData.date_time);
      if (isNaN(startTime.getTime())) {
        errors.push('Invalid date_time format');
      } else if (eventData.end_date_time) {
        const endTime = new Date(eventData.end_date_time);
        if (isNaN(endTime.getTime())) {
          errors.push('Invalid end_date_time format');
        } else if (endTime <= startTime) {
          errors.push('end_date_time must be after date_time');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  validateArtist(artistData: Partial<Artist>): ValidationResult {
    const errors: string[] = [];

    if (!artistData.name || artistData.name.trim().length === 0) {
      errors.push('Artist name is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // ===== TRANSACTION HELPERS =====
  
  async executeTransaction<T>(operations: (() => Promise<T>)[]): Promise<T[]> {
    const results: T[] = [];
    
    for (const operation of operations) {
      try {
        const result = await operation();
        results.push(result);
      } catch (error) {
        logger.error('Transaction operation failed', error);
        throw error;
      }
    }

    return results;
  }

  // Direct access to Supabase client for advanced operations
  get client(): SupabaseClient {
    return this.supabase;
  }
}

// Export singleton instance
export const db = new DatabaseClient();

// Export class for testing or custom instances
export { DatabaseClient };

export default db;
