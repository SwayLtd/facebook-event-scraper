-- Database triggers for automatic event processing
-- These triggers will be executed when events are inserted or updated in the facebook_events_imports table

-- Trigger function to update festival detection on event insertion
CREATE OR REPLACE FUNCTION trigger_detect_festival()
RETURNS TRIGGER AS $$
DECLARE
    event_data JSONB;
    duration_hours NUMERIC;
    festival_keywords TEXT[] := ARRAY['festival', 'fest', 'open air', 'openair', 'rave', 'gathering', 'weekender', 'marathon', 'edition'];
    found_keywords TEXT[];
    confidence INTEGER := 0;
    is_festival BOOLEAN := FALSE;
    festival_name_extracted TEXT;
BEGIN
    -- Only process on INSERT when facebook_event_data is available
    IF TG_OP = 'INSERT' AND NEW.facebook_event_data IS NOT NULL THEN
        event_data := NEW.facebook_event_data;
        
        -- Calculate duration if timestamps are available
        IF event_data ? 'startTimestamp' AND event_data ? 'endTimestamp' THEN
            duration_hours := (
                (event_data->>'endTimestamp')::BIGINT - (event_data->>'startTimestamp')::BIGINT
            ) / 3600.0; -- Convert seconds to hours
            
            -- Primary criterion: Duration > 24 hours
            IF duration_hours > 24 THEN
                is_festival := TRUE;
                confidence := confidence + 70;
            END IF;
        END IF;
        
        -- Secondary criteria: Festival keywords in name or description
        IF event_data ? 'name' OR event_data ? 'description' THEN
            DECLARE
                combined_text TEXT := LOWER(
                    COALESCE(event_data->>'name', '') || ' ' || 
                    COALESCE(event_data->>'description', '')
                );
                keyword TEXT;
            BEGIN
                FOREACH keyword IN ARRAY festival_keywords
                LOOP
                    IF combined_text LIKE '%' || keyword || '%' THEN
                        found_keywords := array_append(found_keywords, keyword);
                        confidence := confidence + 5;
                    END IF;
                END LOOP;
                
                -- Cap keyword bonus at 20 points
                confidence := LEAST(confidence, confidence - array_length(found_keywords, 1) * 5 + 20);
            END;
        END IF;
        
        -- Extract festival name if it's detected as a festival
        IF is_festival AND event_data ? 'name' THEN
            festival_name_extracted := event_data->>'name';
            -- Basic cleanup: remove year patterns
            festival_name_extracted := regexp_replace(festival_name_extracted, '\b20\d{2}\b', '', 'g');
            -- Remove edition indicators
            festival_name_extracted := regexp_replace(festival_name_extracted, '\b\d+(st|nd|rd|th)?\s*(edition|ed\.?)\b', '', 'gi');
            -- Trim whitespace
            festival_name_extracted := trim(festival_name_extracted);
        END IF;
        
        -- Cap confidence at 100
        confidence := LEAST(confidence, 100);
        
        -- Update the record with detection results
        NEW.detected_as_festival := is_festival;
        NEW.festival_name := festival_name_extracted;
        
        -- Add initial processing log
        NEW.processing_logs := jsonb_build_array(
            jsonb_build_object(
                'timestamp', NOW(),
                'level', 'info',
                'message', 'Event added to queue with festival detection',
                'details', jsonb_build_object(
                    'detected_as_festival', is_festival,
                    'confidence', confidence,
                    'duration_hours', duration_hours,
                    'keywords_found', found_keywords
                )
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for festival detection on insert
DROP TRIGGER IF EXISTS trigger_facebook_events_festival_detection ON facebook_events_imports;
CREATE TRIGGER trigger_facebook_events_festival_detection
    BEFORE INSERT ON facebook_events_imports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_detect_festival();

-- Trigger function to notify server of new events (optional - for real-time processing)
CREATE OR REPLACE FUNCTION trigger_notify_new_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify the server that a new event is available for processing
    -- This can be used with LISTEN/NOTIFY for real-time processing
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
        PERFORM pg_notify('new_event_added', NEW.id::text);
    ELSIF TG_OP = 'UPDATE' AND OLD.status != 'pending' AND NEW.status = 'pending' THEN
        PERFORM pg_notify('event_ready_for_retry', NEW.id::text);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for notifications
DROP TRIGGER IF EXISTS trigger_facebook_events_notify ON facebook_events_imports;
CREATE TRIGGER trigger_facebook_events_notify
    AFTER INSERT OR UPDATE ON facebook_events_imports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_notify_new_event();

-- Function to automatically clean up old completed/failed events (optional maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_import_records()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete completed records older than 30 days
    DELETE FROM facebook_events_imports
    WHERE status = 'completed' 
    AND processing_completed_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Delete failed records that have exceeded max retries and are older than 7 days
    DELETE FROM facebook_events_imports
    WHERE status = 'failed' 
    AND retry_count >= max_retries
    AND updated_at < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = deleted_count + ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get processing statistics
CREATE OR REPLACE FUNCTION get_processing_statistics(days_back INTEGER DEFAULT 7)
RETURNS TABLE (
    total_events BIGINT,
    completed_events BIGINT,
    failed_events BIGINT,
    pending_events BIGINT,
    processing_events BIGINT,
    success_rate NUMERIC,
    avg_processing_time NUMERIC,
    avg_artists_per_event NUMERIC,
    festival_events BIGINT,
    simple_events BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE fei.status = 'completed') as completed_events,
        COUNT(*) FILTER (WHERE fei.status = 'failed') as failed_events,
        COUNT(*) FILTER (WHERE fei.status = 'pending') as pending_events,
        COUNT(*) FILTER (WHERE fei.status = 'processing') as processing_events,
        ROUND(
            (COUNT(*) FILTER (WHERE fei.status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0)) * 100, 
            2
        ) as success_rate,
        ROUND(AVG(fei.processing_time_seconds), 2) as avg_processing_time,
        ROUND(AVG(fei.artists_imported), 2) as avg_artists_per_event,
        COUNT(*) FILTER (WHERE fei.detected_as_festival = TRUE) as festival_events,
        COUNT(*) FILTER (WHERE fei.detected_as_festival = FALSE) as simple_events
    FROM facebook_events_imports fei
    WHERE fei.created_at >= NOW() - (days_back || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Function to get detailed event processing logs
CREATE OR REPLACE FUNCTION get_event_processing_details(event_queue_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    facebook_url TEXT,
    status TEXT,
    detected_as_festival BOOLEAN,
    festival_name TEXT,
    retry_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    processing_time_seconds INTEGER,
    artists_imported INTEGER,
    last_error_message TEXT,
    processing_logs JSONB,
    error_details JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fei.id,
        fei.facebook_url,
        fei.status,
        fei.detected_as_festival,
        fei.festival_name,
        fei.retry_count,
        fei.created_at,
        fei.processing_started_at,
        fei.processing_completed_at,
        fei.processing_time_seconds,
        fei.artists_imported,
        fei.last_error_message,
        fei.processing_logs,
        fei.error_details
    FROM facebook_events_imports fei
    WHERE fei.id = event_queue_id;
END;
$$ LANGUAGE plpgsql;

-- Function to retry all failed events (manual intervention)
CREATE OR REPLACE FUNCTION retry_all_failed_events()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
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
    WHERE status = 'failed' AND retry_count < max_retries;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get events by status with pagination
CREATE OR REPLACE FUNCTION get_events_by_status(
    event_status TEXT,
    page_limit INTEGER DEFAULT 50,
    page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id INTEGER,
    facebook_url TEXT,
    priority INTEGER,
    retry_count INTEGER,
    detected_as_festival BOOLEAN,
    festival_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    last_error_message TEXT,
    processing_time_seconds INTEGER,
    artists_imported INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fei.id,
        fei.facebook_url,
        fei.priority,
        fei.retry_count,
        fei.detected_as_festival,
        fei.festival_name,
        fei.created_at,
        fei.last_error_message,
        fei.processing_time_seconds,
        fei.artists_imported
    FROM facebook_events_imports fei
    WHERE fei.status = event_status
    ORDER BY 
        fei.priority DESC,
        fei.created_at ASC
    LIMIT page_limit
    OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON FUNCTION trigger_detect_festival() IS 'Automatically detects if an event is a festival based on duration and keywords';
COMMENT ON FUNCTION trigger_notify_new_event() IS 'Notifies the server when new events are ready for processing';
COMMENT ON FUNCTION cleanup_old_import_records() IS 'Maintenance function to clean up old completed/failed records';
COMMENT ON FUNCTION get_processing_statistics(INTEGER) IS 'Returns processing statistics for the specified number of days back';
COMMENT ON FUNCTION get_event_processing_details(INTEGER) IS 'Returns detailed processing information for a specific event';
COMMENT ON FUNCTION retry_all_failed_events() IS 'Resets all failed events for retry (manual intervention)';
COMMENT ON FUNCTION get_events_by_status(TEXT, INTEGER, INTEGER) IS 'Gets events by status with pagination support';

-- Grant permissions (adjust as needed for your setup)
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO your_app_user;
