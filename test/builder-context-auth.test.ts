import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
// These source checks preserve the explicit legacy/static and account-key boundary
// even when no DB is configured for the unit suite; the live DB suite exercises it end-to-end.
const app=readFileSync(resolve('src/server/app.ts'),'utf8');
const store=readFileSync(resolve('src/storage/postgres.ts'),'utf8');
const migration=readFileSync(resolve('migrations/0007_vineet_builder_admin.sql'),'utf8');
describe('builder context write policy',()=>{
 it('requires both builder-admin role and context:write scope for both mutations',()=>{
   expect(app.match(/p\.role!=="admin"\|\|!p\.scopes\.some\(scope=>scope==="context:write"\|\|scope==="\*"\)/g)).toHaveLength(2);
 });
 it('grants the initial builder owner the admin role and a scoped key',()=>{
   expect(store).toContain("VALUES($1,$2,$3,$4,$5,'admin')");
   expect(store).toContain("ARRAY['search','mcp']");
   expect(store).toContain('verified_at IS NOT NULL');
 });
 it('uses exact IDs and fails closed on mismatch, without blanket promotion',()=>{
   expect(migration).toContain("id='b5787abf-f6fe-414b-a6bf-e3ff03d3dc99'");
   expect(migration).toContain("id='5e54fa6d-2dcd-49e2-bcc3-668b32d0a977'");
   expect(migration).toContain("RAISE EXCEPTION 'Vineet builder account mismatch");
   expect(migration).toContain("RAISE EXCEPTION 'Vineet builder API key mismatch");
   expect(migration).not.toContain('UPDATE users SET role=\'admin\';');
 });
});
