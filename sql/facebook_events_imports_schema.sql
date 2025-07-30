-- Improved facebook_events_imports table schema
-- This table manages the queue of Facebook events to be imported

-- Drop existing table if it exists (be careful in production!)
-- DROP TABLE IF EXISTS facebook_events_imports CASCADE;

CREATE TABLE IF NOT EXISTS facebook_events_imports (
    id SERIAL PRIMARY KEY,
    
    -- Event identification
    facebook_url TEXT NOT NULL UNIQUE,
    facebook_event_id TEXT,
    event_title TEXT,
    
    -- Import status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry')),
    import_type TEXT CHECK (import_type IN ('simple', 'festival', 'auto')),
    
    -- Processing metadata
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10), -- 1 = highest priority, 10 = lowest
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Result tracking
    imported_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    error_message TEXT,
    error_details JSONB,
    
    -- Festival-specific data
    is_festival BOOLEAN DEFAULT NULL, -- NULL = not determined, TRUE/FALSE = determined
    has_multiple_stages BOOLEAN DEFAULT NULL,
    has_multiple_days BOOLEAN DEFAULT NULL,
    clashfinder_data JSONB, -- Store Clashfinder API response
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_processing_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}', -- Flexible storage for additional data
    
    -- Indexes for performance
    CONSTRAINT check_retry_logic CHECK (retry_count <= max_retries)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_status ON facebook_events_imports(status);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_priority ON facebook_events_imports(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_facebook_url ON facebook_events_imports(facebook_url);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_created_at ON facebook_events_imports(created_at);
CREATE INDEX IF NOT EXISTS idx_facebook_events_imports_is_festival ON facebook_events_imports(is_festival) WHERE is_festival IS NOT NULL;

-- Create trigger function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_facebook_events_imports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_facebook_events_imports_updated_at ON facebook_events_imports;
CREATE TRIGGER trigger_update_facebook_events_imports_updated_at
    BEFORE UPDATE ON facebook_events_imports
    FOR EACH ROW
    EXECUTE FUNCTION update_facebook_events_imports_updated_at();

-- Create function to get next event for processing
CREATE OR REPLACE FUNCTION get_next_event_for_processing()
RETURNS facebook_events_imports AS $$
DECLARE
    next_event facebook_events_imports;
BEGIN
    SELECT * INTO next_event
    FROM facebook_events_imports
    WHERE status IN ('pending', 'retry')
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    -- Mark as processing if found
    IF next_event.id IS NOT NULL THEN
        UPDATE facebook_events_imports
        SET status = 'processing',
            started_processing_at = NOW()
        WHERE id = next_event.id;
        
        -- Return updated record
        SELECT * INTO next_event
        FROM facebook_events_imports
        WHERE id = next_event.id;
    END IF;
    
    RETURN next_event;
END;
$$ LANGUAGE plpgsql;

-- Create function to mark event as completed
CREATE OR REPLACE FUNCTION mark_event_completed(
    event_import_id INTEGER,
    imported_event_id INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    UPDATE facebook_events_imports
    SET status = 'completed',
        completed_at = NOW(),
        imported_event_id = mark_event_completed.imported_event_id,
        error_message = NULL,
        error_details = NULL
    WHERE id = event_import_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to mark event as failed
CREATE OR REPLACE FUNCTION mark_event_failed(
    event_import_id INTEGER,
    error_msg TEXT,
    error_detail JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    current_retry_count INTEGER;
    max_retry_count INTEGER;
BEGIN
    -- Get current retry information
    SELECT retry_count, max_retries 
    INTO current_retry_count, max_retry_count
    FROM facebook_events_imports
    WHERE id = event_import_id;
    
    -- Increment retry count
    current_retry_count := current_retry_count + 1;
    
    -- Determine new status
    IF current_retry_count >= max_retry_count THEN
        -- Max retries reached, mark as permanently failed
        UPDATE facebook_events_imports
        SET status = 'failed',
            retry_count = current_retry_count,
            error_message = error_msg,
            error_details = error_detail,
            completed_at = NOW()
        WHERE id = event_import_id;
    ELSE
        -- Still have retries left
        UPDATE facebook_events_imports
        SET status = 'retry',
            retry_count = current_retry_count,
            error_message = error_msg,
            error_details = error_detail
        WHERE id = event_import_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create view for monitoring
CREATE OR REPLACE VIEW facebook_events_imports_summary AS
SELECT 
    status,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE is_festival = true) as festival_count,
    COUNT(*) FILTER (WHERE is_festival = false) as simple_count,
    AVG(retry_count) as avg_retry_count,
    MIN(created_at) as oldest_created,
    MAX(created_at) as newest_created
FROM facebook_events_imports
GROUP BY status
ORDER BY 
    CASE status 
        WHEN 'processing' THEN 1
        WHEN 'pending' THEN 2  
        WHEN 'retry' THEN 3
        WHEN 'completed' THEN 4
        WHEN 'failed' THEN 5
    END;

-- Example usage commands:
/*
-- Add a new event to be imported
INSERT INTO facebook_events_imports (facebook_url, priority) 
VALUES ('https://www.facebook.com/events/123456789', 1);

-- Get next event for processing
SELECT * FROM get_next_event_for_processing();

-- Mark event as completed
SELECT mark_event_completed(1, 42);

-- Mark event as failed  
SELECT mark_event_failed(1, 'Clashfinder API unavailable', '{"error_code": "API_DOWN"}');

-- Check import status summary
SELECT * FROM facebook_events_imports_summary;
*/
