CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS episodes (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text,
  session_id text,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS episode_tenant_created_idx ON episodes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS episode_expiry_idx ON episodes(expires_at);
CREATE TABLE IF NOT EXISTS outcomes (
  id uuid PRIMARY KEY,
  episode_id uuid NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
