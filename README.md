# Facebook Event Import System

An automated system for importing Facebook events with intelligent festival detection and timetable processing.

## 🎯 Features

- **🤖 Automated Processing**: Continuous server that processes events from a queue
- **🎪 Festival Detection**: Automatically detects festivals based on duration (>24h) and keywords
- **📊 Timetable Import**: Integrates with Clashfinder API for festival timetables
- **🔄 Retry Logic**: 5 retry attempts with exponential backoff
- **⭐ Priority System**: Support for premium user prioritization
- **📝 Comprehensive Logging**: Detailed processing logs and error tracking
- **🎵 Artist Enrichment**: SoundCloud integration for artist data
- **🧠 OpenAI Integration**: AI-powered artist extraction from event descriptions

## 🏗️ Architecture

### Database Schema
```
facebook_events_imports
├── Queue management (status, priority, retry_count)
├── Festival detection (detected_as_festival, festival_name)
├── Error tracking (error_details, last_error_message)
├── Processing logs (processing_logs)
└── Timestamps (created_at, processing_started_at, etc.)
```

### Processing Flow
```
Facebook Event URL
       ↓
   Festival Detection (>24h duration + keywords)
       ↓
   ┌─ Festival Route ─────────┐    ┌─ Simple Event Route ─┐
   │ 1. Clashfinder API      │    │ 1. OpenAI Parsing    │
   │ 2. CSV → JSON           │    │ 2. Artist Extraction │
   │ 3. Timetable Processing │    │ 3. Relations         │
   │ 4. SoundCloud Lookup   │    └─────────────────────┘
   └─────────────────────────┘
       ↓
   Database Storage + Relations
```

## 🚀 Quick Start

### 1. Environment Setup
```bash
# Copy environment template
cp .env.example .env

# Configure required variables
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
LONG_LIVED_TOKEN=your_facebook_token
OPENAI_API_KEY=your_openai_key
SOUND_CLOUD_CLIENT_ID=your_soundcloud_id
SOUND_CLOUD_CLIENT_SECRET=your_soundcloud_secret
GOOGLE_API_KEY=your_google_maps_key
```

### 2. Database Setup
```bash
# Run database migrations
psql -h your_host -d your_db -f sql/facebook_events_imports_enhanced.sql
psql -h your_host -d your_db -f sql/triggers_and_functions.sql
```

### 3. Start the Server
```bash
# Start the continuous processing server
node server.js

# Health check
curl http://localhost:3001/health
```

### 4. Add Events to Queue
```bash
# Add a simple event
node add_event.js https://www.facebook.com/events/123456789

# Add with high priority (premium users)
node add_event.js https://www.facebook.com/events/123456789 --priority=10
```

## 📖 Usage Examples

### Adding Events
```bash
# Basic event addition
node add_event.js https://www.facebook.com/events/1234567890

# High priority event (premium feature)
node add_event.js https://www.facebook.com/events/1234567890 --priority=10

# The system will automatically:
# 1. Detect if it's a festival (>24h duration)
# 2. Try Clashfinder for timetables
# 3. Fallback to OpenAI parsing if needed
# 4. Process all artists and create relations
```

### Manual Event Processing (Legacy)
```bash
# Direct processing (bypasses queue)
node import_event.js https://www.facebook.com/events/1234567890

# Dry run mode
DRY_RUN=true node import_event.js https://www.facebook.com/events/1234567890
```

### Festival Timetable Processing
```bash
# Direct timetable import with JSON file
node import_timetable.js --event-url=https://www.facebook.com/events/123 --json=data.json
```

## 🎪 Festival Detection Logic

The system automatically detects festivals using multiple criteria:

### Primary Criterion
- **Duration > 24 hours**: Events spanning more than 24 hours (e.g., Friday 23h → Sunday 7h)

### Secondary Criteria (Confidence Boosters)
- **Festival Keywords**: "festival", "fest", "open air", "rave", "gathering", "weekender"
- **Multi-day Indicators**: "2 days", "weekend", "multiple days" 
- **Venue Types**: "park", "field", "grounds", "complex"

### Confidence Scoring
- Duration >24h: +70 points
- Keywords: +5 points each (max +20)
- Multi-day indicators: +10 points
- Festival venues: +5 points

**Threshold**: 60% confidence required for festival processing

## 🔄 Queue Management

### Status Types
- `pending`: Ready for processing
- `processing`: Currently being processed
- `completed`: Successfully processed
- `failed`: Failed after retries

### Priority System
- Higher numbers = higher priority
- Default priority: 0
- Premium users can use higher priorities (1-100)

### Retry Logic
- **Max retries**: 5 attempts
- **Backoff**: Exponential (1min, 2min, 4min, 8min, 16min)
- **Auto-retry**: Failed events automatically retry after delay

## 🛠️ Server Configuration

### Environment Variables
```bash
# Core settings
POLL_INTERVAL_MS=30000          # How often to check for new events (30s)
MAX_CONCURRENT_JOBS=1           # Max parallel processing jobs
DRY_RUN=false                   # Set to 'true' for testing

# Health check
HEALTH_CHECK_PORT=3001          # Health endpoint port
```

### Server Monitoring
```bash
# Health check endpoint
curl http://localhost:3001/health

# Returns:
{
  "status": "healthy",
  "processing_count": 1,
  "total_processed": 25,
  "success_rate": "92.0",
  "uptime": 3600
}
```

## 📊 Database Functions

### Processing Statistics
```sql
-- Get statistics for last 7 days
SELECT * FROM get_processing_statistics(7);

-- Returns: total_events, success_rate, avg_processing_time, etc.
```

### Event Management
```sql
-- Get events by status
SELECT * FROM get_events_by_status('failed', 10, 0);

-- Retry all failed events
SELECT retry_all_failed_events();

-- Reset specific event for retry
SELECT reset_event_for_retry(123);

-- Get detailed event info
SELECT * FROM get_event_processing_details(123);
```

### Queue Monitoring
```sql
-- Current queue status
SELECT * FROM facebook_events_imports_status;

-- Recent failures
SELECT * FROM facebook_events_imports_failures;

-- Cleanup old records
SELECT cleanup_old_import_records();
```

## 🎵 Artist Processing

### SoundCloud Integration
- **Search**: Fuzzy matching with confidence scoring
- **Data**: Profile, followers, image, description
- **Rate Limiting**: 500ms delays between requests

### OpenAI Parsing (Fallback)
- **Model**: GPT-4o-mini
- **Extraction**: Artist names, times, stages, performance modes
- **B2B Detection**: Handles collaborations (B2B, F2F, etc.)

### Data Enrichment
- **Genre Assignment**: Automatic genre classification
- **Image Fetching**: SoundCloud profile images
- **Relationship Mapping**: Artist-event-venue-promoter relations

## 🔧 Troubleshooting

### Common Issues

**1. Events not processing**
```bash
# Check server logs
tail -f logs/import_timetable_*.log

# Check queue status
node add_event.js https://www.facebook.com/events/123 # Shows queue status

# Manual retry
# Connect to database and run: SELECT retry_all_failed_events();
```

**2. Festival detection not working**
```bash
# Check detection manually
node -e "
import('./utils/festival-detection.js').then(({ detectFestival }) => {
  console.log(detectFestival({
    startTimestamp: 1730509200,  // Your event start
    endTimestamp: 1730750400,    // Your event end
    name: 'Your Festival Name'
  }));
});
"
```

**3. Clashfinder integration issues**
```bash
# Test Clashfinder manually
node get_data/get_clashfinder_timetable.js "festival name"
```

### Logging
- **Application logs**: `logs/import_timetable_*.log`
- **Database logs**: `processing_logs` JSONB field
- **Error details**: `error_details` JSONB field

## 🧪 Testing

### Dry Run Mode
```bash
# Test without database writes
DRY_RUN=true node server.js
DRY_RUN=true node import_event.js https://www.facebook.com/events/123
```

### Manual Testing
```bash
# Test festival detection
node tests/test_festival_days_detection.js imports/true_dour2025.json

# Test full pipeline
node tests/test_full_timetable_pipeline.js
```

## 📈 Performance

### Benchmarks
- **Simple events**: ~30-60 seconds (depends on artist count)
- **Festivals**: ~2-10 minutes (depends on timetable size)
- **SoundCloud rate limit**: 500ms between requests
- **Memory usage**: ~50-100MB per processing job

### Optimization Tips
- Use higher `MAX_CONCURRENT_JOBS` for faster processing (if server can handle it)
- Adjust `POLL_INTERVAL_MS` based on your event volume
- Use priority system for urgent events

## 🔐 Security Notes

- Never commit `.env` file with real credentials
- Use service role key for server, not anon key
- Consider IP restrictions for production Supabase setup
- Log sensitive data carefully (URLs are logged, tokens are not)

## 🎯 Roadmap

- [ ] **Manual Festival Mapping**: UI for mapping event names to Clashfinder IDs
- [ ] **Real-time Processing**: WebSocket notifications for queue updates
- [ ] **Batch Processing**: Bulk event import from CSV/JSON
- [ ] **Advanced Analytics**: Processing dashboards and metrics
- [ ] **API Integration**: REST API for queue management
- [ ] **Multi-source Festivals**: Support for additional timetable sources beyond Clashfinder

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with dry run mode
4. Submit a pull request with detailed description

## 📄 License

MIT License - see LICENSE file for details
