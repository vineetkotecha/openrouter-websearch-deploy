-- Existing production account created before signup began assigning the builder-admin role.
-- Exact IDs came from the live divAIne Search Neon database on 2026-09-25.
-- This is intentionally NOT a blanket migration: the proof and test accounts remain users.
DO $$
BEGIN
  -- On fresh/test databases the exact account is absent; do nothing.
  -- If the ID exists, validate the identity and key before changing either row.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id='b5787abf-f6fe-414b-a6bf-e3ff03d3dc99'::uuid) THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM users WHERE id='b5787abf-f6fe-414b-a6bf-e3ff03d3dc99'::uuid
      AND email='vineetkotecha222@gmail.com' AND tenant_id IN
      (SELECT id FROM tenants WHERE name='Vineet Kotecha')) <> 1 THEN
    RAISE EXCEPTION 'Vineet builder account mismatch; refuse role migration';
  END IF;
  IF (SELECT count(*) FROM api_keys WHERE id='5e54fa6d-2dcd-49e2-bcc3-668b32d0a977'::uuid
      AND user_id='b5787abf-f6fe-414b-a6bf-e3ff03d3dc99'::uuid
      AND revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Vineet builder API key mismatch; refuse scope migration';
  END IF;
  UPDATE users SET role='admin' WHERE id='b5787abf-f6fe-414b-a6bf-e3ff03d3dc99'::uuid;
  UPDATE api_keys SET scopes=array_append(scopes,'context:write')
    WHERE id='5e54fa6d-2dcd-49e2-bcc3-668b32d0a977'::uuid
      AND NOT ('context:write'=ANY(scopes));
END $$;
