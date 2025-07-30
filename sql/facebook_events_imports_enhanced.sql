-- Enhanced facebook_events_imports table for automated event processing
-- This table manages the import queue with retry logic, priority system, and comprehensive logging

-- Drop existing table if needed (uncomment if you want to recreate)
-- DROP TABLE IF EXISTS facebook_events_imports CASCADE;

CREATE TABLE IF NOT EXISTS facebook_events_imports (
    id SERIAL PRIMARY KEY,
    facebook_url TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority INTEGER NOT NULL DEFAULT 0, -- Higher numbers = higher priority (for premium users later)
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    
    -- Timestamps for tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processing_started_at TIMESTAMP WITH TIME ZONE NULL,
    processing_completed_at TIMESTAMP WITH TIME ZONE NULL,
    
    -- Event detection and processing details
    detected_as_festival BOOLEAN NULL, -- NULL = not yet analyzed, TRUE/FALSE = analysis result
    festival_name TEXT NULL, -- Extracted festival name for Clashfinder search
    clashfinder_id TEXT NULL, -- Clashfinder event ID if found
    
    -- Error tracking and logging
    error_details JSONB NULL, -- Detailed error information
    last_error_message TEXT NULL,
    processing_logs JSONB NULL, -- Array of processing log entries
    
    -- Results tracking
    event_id INTEGER NULL, -- Reference to created event in events table
    artists_imported INTEGER DEFAULT 0, -- Number of artists imported
    processing_time_seconds INTEGER NULL, -- Time taken to process
    
    -- Metadata
    facebook_event_data JSONB NULL, -- Cached Facebook event data to avoid re-scraping
    metadata JSONB NULL -- Additional metadata (user_id, source, etc.)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_status ON facebook_events_imports(status);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_priority ON facebook_events_imports(priority DESC);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_created_at ON facebook_events_imports(created_at);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_retry ON facebook_events_imports(retry_count, max_retries);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_festival ON facebook_events_imports(detected_as_festival);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_facebook_events_imports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_facebook_events_imports_updated_at
    BEFORE UPDATE ON facebook_events_imports
    FOR EACH ROW
    EXECUTE FUNCTION update_facebook_events_imports_updated_at();

-- Function to get the next event for processing (priority + retry logic)
CREATE OR REPLACE FUNCTION get_next_event_for_processing()
RETURNS TABLE (
    id INTEGER,
    facebook_url TEXT,
    retry_count INTEGER,
    detected_as_festival BOOLEAN,
    festival_name TEXT,
    clashfinder_id TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fei.id,
        fei.facebook_url,
        fei.retry_count,
        fei.detected_as_festival,
        fei.festival_name,
        fei.clashfinder_id
    FROM facebook_events_imports fei
    WHERE 
        fei.status IN ('pending', 'failed') 
        AND fei.retry_count < fei.max_retries
        AND (
            -- Immediate processing for new events
            fei.status = 'pending' 
            OR 
            -- Retry failed events after delay (exponential backoff)
            (fei.status = 'failed' AND fei.updated_at < NOW() - INTERVAL '1 minute' * POWER(2, fei.retry_count))
        )
    ORDER BY 
        fei.priority DESC, -- Higher priority first
        fei.status ASC, -- Pending before failed
        fei.created_at ASC -- Older events first within same priority/status
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- Prevent concurrent processing
END;
$$ LANGUAGE plpgsql;

-- Function to mark event as being processed
CREATE OR REPLACE FUNCTION mark_event_processing(event_id INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE facebook_events_imports 
    SET 
        status = 'processing',
        processing_started_at = NOW(),
        updated_at = NOW()
    WHERE id = event_id AND status IN ('pending', 'failed');
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to mark event as completed
CREATE OR REPLACE FUNCTION mark_event_completed(
    event_id INTEGER,
    result_event_id INTEGER DEFAULT NULL,
    artists_count INTEGER DEFAULT 0,
    processing_seconds INTEGER DEFAULT NULL,
    logs JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE facebook_events_imports 
    SET 
        status = 'completed',
        processing_completed_at = NOW(),
        event_id = COALESCE(result_event_id, event_id),
        artists_imported = COALESCE(artists_count, 0),
        processing_time_seconds = processing_seconds,
        processing_logs = COALESCE(logs, processing_logs),
        error_details = NULL,
        last_error_message = NULL,
        updated_at = NOW()
    WHERE id = event_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to mark event as failed with error details
CREATE OR REPLACE FUNCTION mark_event_failed(
    event_id INTEGER,
    error_message TEXT,
    error_details_json JSONB DEFAULT NULL,
    logs JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE facebook_events_imports 
    SET 
        status = 'failed',
        retry_count = retry_count + 1,
        last_error_message = error_message,
        error_details = COALESCE(error_details_json, error_details),
        processing_logs = COALESCE(logs, processing_logs),
        processing_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = event_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to add processing log entry
CREATE OR REPLACE FUNCTION add_processing_log(
    event_id INTEGER,
    log_level TEXT, -- 'info', 'warning', 'error', 'debug'
    message TEXT,
    details JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    log_entry JSONB;
    current_logs JSONB;
BEGIN
    log_entry := jsonb_build_object(
        'timestamp', NOW(),
        'level', log_level,
        'message', message,
        'details', details
    );
    
    SELECT processing_logs INTO current_logs 
    FROM facebook_events_imports 
    WHERE id = event_id;
    
    -- Initialize logs array if null
    IF current_logs IS NULL THEN
        current_logs := '[]'::jsonb;
    END IF;
    
    -- Append new log entry
    UPDATE facebook_events_imports 
    SET 
        processing_logs = current_logs || log_entry,
        updated_at = NOW()
    WHERE id = event_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to update festival detection results
CREATE OR REPLACE FUNCTION update_festival_detection(
    event_id INTEGER,
    is_festival BOOLEAN,
    festival_name_param TEXT DEFAULT NULL,
    clashfinder_id_param TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE facebook_events_imports 
    SET 
        detected_as_festival = is_festival,
        festival_name = festival_name_param,
        clashfinder_id = clashfinder_id_param,
        updated_at = NOW()
    WHERE id = event_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to reset event for retry (manual retry mechanism)
CREATE OR REPLACE FUNCTION reset_event_for_retry(event_id INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE facebook_events_imports 
    SET 
        status = 'pending',
        retry_count = 0,
        error_details = NULL,
        last_error_message = NULL,
        processing_started_at = NULL,
        processing_completed_at = NULL,
        updated_at = NOW()
    WHERE id = event_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- View for monitoring processing status
CREATE OR REPLACE VIEW facebook_events_imports_status AS
SELECT 
    status,
    COUNT(*) as count,
    AVG(processing_time_seconds) as avg_processing_time,
    AVG(artists_imported) as avg_artists_imported
FROM facebook_events_imports 
GROUP BY status;

-- View for failed events analysis
CREATE OR REPLACE VIEW facebook_events_imports_failures AS
SELECT 
    id,
    facebook_url,
    retry_count,
    max_retries,
    last_error_message,
    error_details,
    created_at,
    updated_at
FROM facebook_events_imports 
WHERE status = 'failed' AND retry_count >= max_retries
ORDER BY updated_at DESC;

-- Comments
COMMENT ON TABLE facebook_events_imports IS 'Queue for processing Facebook event imports with retry logic and comprehensive logging';
COMMENT ON COLUMN facebook_events_imports.priority IS 'Higher numbers = higher priority (for premium users)';
COMMENT ON COLUMN facebook_events_imports.detected_as_festival IS 'NULL = not analyzed yet, TRUE = festival (>24h), FALSE = simple event';
COMMENT ON COLUMN facebook_events_imports.processing_logs IS 'Array of timestamped log entries for debugging';
COMMENT ON COLUMN facebook_events_imports.facebook_event_data IS 'Cached Facebook event data to avoid re-scraping on retries';
