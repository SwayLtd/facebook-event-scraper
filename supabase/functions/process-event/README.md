# Process Event Edge Function

Complete event processing system with full enrichment capabilities, migrated from import_event.js to Supabase Edge Functions with Deno runtime.

## Features

### Core Event Processing
- **Facebook Graph API Integration**: Fetches complete event data from Facebook including venue, timing, description, cover image, and owner information
- **Comprehensive Event Creation**: Creates structured event records with full metadata and relationships
- **Event Times Support**: Handles multiple session events with individual time slots

### Artist Enrichment Pipeline
- **SoundCloud Integration**: Enriches artist profiles with SoundCloud data, follower counts, and track information
- **OpenAI Description Generation**: Creates AI-powered artist descriptions for better user experience  
- **Last.fm Genre Classification**: Extracts and classifies music genres with confidence scoring
- **Social Media Extraction**: Automatically extracts social media links from artist profiles
- **Duplicate Detection**: Smart artist matching and deduplication based on normalized names

### Venue Management
- **Google Maps Geocoding**: Enriches venue data with precise coordinates and standardized addresses
- **Geocoding Exception Handling**: Handles special cases and known problematic venue names
- **Distance Calculations**: Haversine distance calculations for venue proximity analysis
- **Venue Deduplication**: Merges similar venues based on location and name similarity

### Festival Processing
- **Advanced Festival Detection**: Multi-factor analysis including duration, name patterns, and known festival databases
- **Clashfinder Integration**: Automatically processes festival timetables from Clashfinder.com when available
- **Timetable Event Creation**: Creates individual events for each timetable slot with artist linkages
- **Festival Hierarchy**: Links timetable events to parent festival events

### Data Quality & Reliability
- **Exponential Backoff Retry**: Robust retry logic for all external API calls
- **Error Handling**: Comprehensive error handling and logging throughout the pipeline  
- **Banned Content Filtering**: Filters out inappropriate genres and content
- **Rate Limit Management**: Respectful API usage with built-in rate limiting

## API Endpoints

### POST /process-event

Process a Facebook event with comprehensive enrichment.

#### Request Body
```json
{
  "eventId": "facebook_event_id",
  "pageId": "facebook_page_id", // optional
  "processClashfinder": true // optional, forces Clashfinder processing
}
```

#### Response
```json
{
  "success": true,
  "eventId": "generated_event_id",
  "festivalInfo": {
    "isFestival": true,
    "confidence": 0.95,
    "estimatedDays": 3,
    "indicators": ["duration", "name_pattern", "known_festival"]
  },
  "clashfinderResults": {
    "success": true,
    "eventsProcessed": 150,
    "artistsFound": 200,
    "venuesProcessed": 8,
    "errors": []
  }
}
```

## Environment Variables

### Required
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for database access  
- `FACEBOOK_LONG_LIVED_TOKEN`: Facebook Graph API long-lived access token

### Optional (for enrichment features)
- `GOOGLE_API_KEY`: Google Maps Geocoding API key
- `OPENAI_API_KEY`: OpenAI API key for artist description generation
- `SOUND_CLOUD_CLIENT_ID`: SoundCloud API client ID
- `SOUND_CLOUD_CLIENT_SECRET`: SoundCloud API client secret  
- `LASTFM_API_KEY`: Last.fm API key for genre classification

## Modules Architecture

### Core Models
- **`models/event.ts`**: Event creation and Facebook data processing
- **`models/artist.ts`**: Artist enrichment with external APIs
- **`models/venue.ts`**: Venue geocoding and management
- **`models/genre.ts`**: Genre classification and filtering

### Utility Modules
- **`utils/constants.ts`**: Configuration data, banned genres, known festivals
- **`utils/name.ts`**: Name normalization and artist extraction
- **`utils/geo.ts`**: Geocoding and distance calculations
- **`utils/retry.ts`**: Exponential backoff retry logic for APIs
- **`utils/festival-detection.ts`**: Advanced festival detection algorithms  
- **`utils/clashfinder.ts`**: Clashfinder timetable processing

## Database Schema

The function expects the following Supabase tables:

### events
- `id`: Primary key
- `facebook_event_id`: Unique Facebook event identifier
- `name`: Event name
- `description`: Event description
- `start_time`: Event start timestamp
- `end_time`: Event end timestamp  
- `venue_id`: Foreign key to venues table
- `is_festival`: Boolean flag for festival events
- `festival_confidence`: Festival detection confidence score
- `clashfinder_id`: Clashfinder event identifier (for timetable events)
- `parent_event_id`: Links timetable events to festival parent

### artists  
- `id`: Primary key
- `name`: Normalized artist name
- `soundcloud_url`: SoundCloud profile URL
- `soundcloud_followers`: Follower count from SoundCloud
- `ai_description`: AI-generated artist description
- `social_links`: JSON array of social media links

### venues
- `id`: Primary key  
- `name`: Venue name
- `address`: Formatted address
- `latitude`: Geocoded latitude
- `longitude`: Geocoded longitude
- `google_place_id`: Google Places identifier

### genres
- `id`: Primary key
- `name`: Genre name
- `confidence`: Classification confidence score

### event_artists
- `event_id`: Foreign key to events
- `artist_id`: Foreign key to artists  
- `is_headliner`: Boolean headliner flag

### artist_genres
- `artist_id`: Foreign key to artists
- `genre_id`: Foreign key to genres
- `confidence`: Classification confidence

## Usage Examples

### Basic Event Processing
```bash
curl -X POST https://your-project.supabase.co/functions/v1/process-event \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "123456789012345"}'
```

### Festival with Clashfinder Processing
```bash
curl -X POST https://your-project.supabase.co/functions/v1/process-event \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "123456789012345", "processClashfinder": true}'
```

## Error Handling

The function includes comprehensive error handling:
- **Facebook API errors**: Invalid tokens, event not found, rate limits
- **Database errors**: Connection issues, constraint violations  
- **External API errors**: SoundCloud, OpenAI, Google Maps API failures
- **Processing errors**: Invalid data formats, missing required fields

All errors are logged with detailed context and return appropriate HTTP status codes.

## Performance Considerations

- **Edge Function Timeout**: Maximum processing time is 150 seconds
- **API Rate Limits**: Built-in retry logic respects rate limits for all external APIs
- **Database Efficiency**: Optimized queries with proper indexing requirements
- **Memory Usage**: Efficient processing of large festival timetables

## Migration from Node.js

This Edge Function provides complete feature parity with the original `import_event.js` Node.js implementation, including:
- All 10 utility modules adapted for Deno runtime
- All 6 model modules with full enrichment capabilities  
- Complete Clashfinder timetable processing
- All external API integrations maintained
- Enhanced TypeScript type safety

The migration maintains the same database schema and provides the same enrichment quality while benefiting from Edge Functions' global distribution and serverless architecture.
