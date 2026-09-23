ALTER TABLE episodes ADD COLUMN IF NOT EXISTS mandate jsonb;
CREATE INDEX IF NOT EXISTS episode_mandate_prompt_idx ON episodes((mandate->>'prompt_version')) WHERE mandate IS NOT NULL;
COMMENT ON COLUMN episodes.mandate IS 'Private internal search mandate. Never returned by user-facing REST or MCP responses.';
