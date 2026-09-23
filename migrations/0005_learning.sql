CREATE TABLE IF NOT EXISTS learning_examples (
  episode_id uuid PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  example jsonb NOT NULL,
  reward_version text NOT NULL,
  derived_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS learning_examples_tenant_idx ON learning_examples(tenant_id, derived_at DESC);
CREATE TABLE IF NOT EXISTS shadow_decisions (
  episode_id uuid PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE learning_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_decisions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE shadow_decisions IS 'Shadow policy proposals logged next to production choices. Never served.';
