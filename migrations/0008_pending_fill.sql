ALTER TABLE pending_searches ADD COLUMN IF NOT EXISTS gap_keys jsonb NOT NULL DEFAULT '[]'::jsonb;
