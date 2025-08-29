// Types partagés pour les Edge Functions Supabase
// Adaptation complète de l'architecture JavaScript locale

export interface Event {
  id?: number;
  name: string;
  description?: string;
  start_time: string;
  end_time?: string;
  location?: string;
  venue_name?: string;
  venue_id?: number;
  promoter_id?: number;
  facebook_event_id?: string;
  external_url?: string;
  image_url?: string;
  ticket_url?: string;
  created_at?: string;
  updated_at?: string;
  status?: 'active' | 'cancelled' | 'postponed';
  is_festival?: boolean;
  duration_hours?: number;
  metadata?: Record<string, any>;
  genres?: string[];
  artists?: Artist[];
}

export interface Artist {
  id?: number;
  name: string;
  image_url?: string;
  description?: string;
  is_verified?: boolean;
  external_links?: {
    soundcloud?: { link: string; id?: string };
    spotify?: { link: string; id?: string };
    facebook?: { link: string; id?: string };
    instagram?: { link: string; id?: string };
    twitter?: { link: string; id?: string };
    youtube?: { link: string; id?: string };
    website?: { link: string };
    musicbrainz?: { link: string; id?: string };
    lastfm?: { link: string };
    discogs?: { link: string };
    bandcamp?: { link: string };
    email?: Array<{
      address: string;
      type: 'booking' | 'management' | 'press' | 'general' | 'contact' | 'ar' | 'radio' | 'distribution' | 'touring' | 'label' | 'publisher';
    }>;
  };
  location_info?: {
    country?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  created_at?: string;
}

export interface Venue {
  id?: number;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  website_url?: string;
  facebook_url?: string;
  phone?: string;
  email?: string;
  google_places_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Promoter {
  id?: number;
  name: string;
  description?: string;
  website_url?: string;
  facebook_url?: string;
  instagram_url?: string;
  twitter_url?: string;
  email?: string;
  phone?: string;
  logo_url?: string;
  image_url?: string;
  external_links?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Genre {
  id?: number;
  name: string;
  description?: string;
  parent_genre_id?: number;
  color?: string;
  is_electronic?: boolean;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

export interface Timetable {
  id?: number;
  event_id: number;
  artist_id: number[];  // Array of artist IDs
  start_time?: string;
  end_time?: string;
  stage?: string;
  status?: string;
  custom_name?: string;
  created_at?: string;
}

// Types pour les intégrations API
export interface SoundCloudTrack {
  id: number;
  title: string;
  description?: string;
  genre?: string;
  tag_list?: string;
  permalink_url: string;
  artwork_url?: string;
  user: {
    id: number;
    username: string;
    permalink_url: string;
    followers_count: number;
    track_count: number;
    avatar_url?: string;
  };
  playback_count?: number;
  likes_count?: number;
  created_at: string;
}

export interface SoundCloudUser {
  id: number;
  username: string;
  permalink_url: string;
  followers_count: number;
  track_count: number;
  avatar_url?: string;
  description?: string;
  country?: string;
  city?: string;
  website?: string;
}

export interface MusicBrainzArtist {
  id: string;
  name: string;
  disambiguation?: string;
  'life-span'?: {
    begin?: string;
    end?: string;
  };
  area?: {
    name: string;
  };
  genres?: Array<{
    id: string;
    name: string;
    count: number;
  }>;
  relations?: Array<{
    type: string;
    url: {
      resource: string;
    };
  }>;
  aliases?: Array<{
    name: string;
    type?: string;
  }>;
}

export interface LastFmArtist {
  name: string;
  mbid?: string;
  url: string;
  image?: Array<{
    '#text': string;
    size: string;
  }>;
  bio?: {
    summary: string;
    content: string;
  };
  tags?: {
    tag: Array<{
      name: string;
      count: number;
      url: string;
    }>;
  };
  stats?: {
    listeners: string;
    playcount: string;
  };
}

export interface FacebookEvent {
  id: string;
  name: string;
  description?: string;
  start_time: string;
  end_time?: string;
  place?: {
    name: string;
    location?: {
      latitude: number;
      longitude: number;
      street?: string;
      city?: string;
      country?: string;
    };
  };
  cover?: {
    source: string;
  };
  ticket_uri?: string;
  attending_count?: number;
  interested_count?: number;
  maybe_count?: number;
}

export interface GooglePlace {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  formatted_phone_number?: string;
}

// Types pour l'enrichissement
export interface EnrichmentResult {
  success: boolean;
  score: number;
  source: 'soundcloud' | 'musicbrainz' | 'lastfm' | 'openai' | 'manual';
  data?: Partial<Artist>;
  errors?: string[];
  metadata?: Record<string, any>;
}

export interface GenreAssignmentResult {
  genres: string[];
  confidence: number;
  source: 'lastfm' | 'soundcloud' | 'musicbrainz' | 'festival' | 'default';
  raw_genres?: string[];
  filtered_genres?: string[];
}

// Types pour la gestion des tokens
export interface TokenConfig {
  soundcloud_client_id?: string;
  soundcloud_client_secret?: string;
  musicbrainz_user_agent?: string;
  lastfm_api_key?: string;
  facebook_access_token?: string;
  google_places_api_key?: string;
  openai_api_key?: string;
}

// Types pour les réponses API
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export interface EdgeFunctionResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
  execution_time_ms?: number;
  action?: string;
  metadata?: Record<string, any>;
}

// Types pour les actions de l'Edge Function
export type AddEventAction = 
  | 'create'
  | 'import-timetable'
  | 'enrich-artists'
  | 'update-metadata'
  | 'full-process';

export interface AddEventRequest {
  action: AddEventAction;
  facebook_event_id?: string;
  event_data?: Partial<Event>;
  dry_run?: boolean;
  options?: {
    skip_artist_enrichment?: boolean;
    skip_genre_assignment?: boolean;
    skip_venue_geocoding?: boolean;
    force_festival_detection?: boolean;
    custom_festival_threshold_hours?: number;
  };
}

export interface ImportTimetableRequest {
  event_id: number;
  timetable_data: Array<{
    artist_name: string;
    start_time: string;
    end_time?: string;
    stage?: string;
    day?: string;
  }>;
  options?: {
    auto_create_artists?: boolean;
    skip_enrichment?: boolean;
  };
}

// Types pour la détection de festival
export interface FestivalDetectionResult {
  is_festival: boolean;
  duration_hours: number;
  confidence: number;
  reasons: string[];
  metadata?: {
    start_time: string;
    end_time?: string;
    calculated_duration: number;
    threshold_used: number;
  };
}

// Types pour les constantes
export interface Constants {
  BANNED_GENRES: string[];
  FESTIVAL_DURATION_THRESHOLD_HOURS: number;
  SOUNDCLOUD_RATE_LIMIT: {
    requests_per_minute: number;
    burst_limit: number;
  };
  MUSICBRAINZ_RATE_LIMIT: {
    requests_per_second: number;
  };
  LASTFM_RATE_LIMIT: {
    requests_per_second: number;
  };
  ENRICHMENT_SCORE_THRESHOLDS: {
    minimum: number;
    good: number;
    excellent: number;
  };
}

// Types pour la validation
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// Types pour les logs structurés
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, any>;
  error?: Error;
}

// Exports par défaut
export type { Event as default };
