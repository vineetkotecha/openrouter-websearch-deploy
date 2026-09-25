-- Builder-owned end users and typed, permissioned context. No cross-tenant reads.
CREATE TABLE IF NOT EXISTS end_users (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,external_id), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS curated_parameters (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, end_user_id uuid NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  class text NOT NULL CHECK (class IN ('functional','psychological')),
  value jsonb NOT NULL, source text NOT NULL CHECK(source IN ('caller','human','prior_outcome')),
  confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  allowed_uses text[] NOT NULL CHECK(cardinality(allowed_uses)>0),
  version integer NOT NULL CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,end_user_id) REFERENCES end_users(tenant_id,id) ON DELETE CASCADE,
  UNIQUE(tenant_id,end_user_id,key,version)
);
CREATE INDEX IF NOT EXISTS curated_parameters_live_idx ON curated_parameters(tenant_id,end_user_id,key,version DESC);
CREATE TABLE IF NOT EXISTS platform_admin_audit (
  id uuid PRIMARY KEY, operation text NOT NULL, target_tenant_id uuid,
  actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS episodes_actor_idx ON episodes(tenant_id,actor_user_id,created_at DESC);
ALTER TABLE pending_searches ADD COLUMN IF NOT EXISTS gap_key text;
