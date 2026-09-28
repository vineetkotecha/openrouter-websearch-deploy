-- Agent IDs are builder-scoped, and downstream user IDs are agent-scoped.
CREATE TABLE IF NOT EXISTS builder_agents (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,external_id), UNIQUE(tenant_id,id)
);
-- Preserve the existing default namespace for rows written before this migration.
INSERT INTO builder_agents(id,tenant_id,external_id)
SELECT gen_random_uuid(),tenant_id,'default' FROM (SELECT DISTINCT tenant_id FROM end_users) x
ON CONFLICT(tenant_id,external_id) DO NOTHING;
ALTER TABLE end_users ADD COLUMN IF NOT EXISTS agent_id uuid;
UPDATE end_users e SET agent_id=a.id FROM builder_agents a
WHERE e.tenant_id=a.tenant_id AND a.external_id='default' AND e.agent_id IS NULL;
ALTER TABLE end_users ALTER COLUMN agent_id SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'end_users_agent_fk' AND conrelid = 'end_users'::regclass) THEN
  ALTER TABLE end_users ADD CONSTRAINT end_users_agent_fk FOREIGN KEY(tenant_id,agent_id) REFERENCES builder_agents(tenant_id,id) ON DELETE CASCADE;
 END IF;
END $$;
ALTER TABLE end_users DROP CONSTRAINT IF EXISTS end_users_tenant_id_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS end_users_agent_external_key ON end_users(tenant_id,agent_id,external_id);
CREATE INDEX IF NOT EXISTS end_users_agent_lookup ON end_users(tenant_id,agent_id);
