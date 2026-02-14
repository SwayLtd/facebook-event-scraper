-- Create api_tokens table for persisting API tokens across Edge Function invocations
-- This avoids generating a new SoundCloud token on every cold start

CREATE TABLE IF NOT EXISTS api_tokens (
  type TEXT PRIMARY KEY,              -- Token type: 'soundcloud', 'facebook', 'lastfm'
  token TEXT NOT NULL,                -- The actual token value
  expiration BIGINT NOT NULL,         -- Expiration timestamp in milliseconds (Date.now() format)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE api_tokens IS 'Persists API tokens (e.g., SoundCloud OAuth) across Edge Function cold starts';

-- Enable RLS but allow service_role full access
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

-- Only service_role can access this table (Edge Functions use service_role key)
CREATE POLICY "Service role full access" ON api_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
