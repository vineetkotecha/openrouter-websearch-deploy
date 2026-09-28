import {it,expect} from 'vitest';
import {PostgresStore} from '../src/storage/postgres.js';
const id='10000000-0000-4000-8000-000000000001',tenant='20000000-0000-4000-8000-000000000001';
it('stores an explicit outcome and derives only a permitted, tenant-local learning example',async()=>{
 const queries:string[]=[];const events:any[]=[];let derived:any;
 const episode={id,tenant_id:tenant,created_at:new Date('2026-09-28T00:00:00Z'),expires_at:new Date('2099-01-01T00:00:00Z'),request:{permissions:{may_learn:true}},response:{results:[{url:'https://example.com/a',provider:'exa',rank:1}],plan:{version:1,query_class:'semantic_discovery',runs:[]}}};
 const store=new PostgresStore('postgres://unused');
 (store as any).pool={query:async(sql:string,args:any[])=>{queries.push(sql);if(sql.startsWith('SELECT id,tenant_id'))return {rowCount:1,rows:[episode]};if(sql.startsWith('INSERT INTO outcomes')){events.push({episode_id:id,payload:args[2]});return {rowCount:1,rows:[{id:args[0]}]}}if(sql.startsWith('SELECT episode_id,payload'))return{rows:events};if(sql.startsWith('INSERT INTO learning_examples')){derived=args[2];return{rowCount:1}}throw Error(sql)}};
 expect(await store.recordOutcome({episode_id:id,event_id:'30000000-0000-4000-8000-000000000001',type:'selected',result_url:'https://example.com/a',occurred_at:'2026-09-28T00:00:00Z'},{tenantId:tenant,role:'admin',scopes:[]})).toBe(true);
 expect(queries[0]).toContain("request->>'user_id'=$4");expect(queries[0]).toContain("request->>'agent_id'");expect(derived.tenant_id).toBe(tenant);expect(derived.outcome_count).toBe(1);expect(derived.candidates[0].relevance).toBe(3);expect(queries.filter(q=>q.startsWith('INSERT INTO learning_examples'))).toHaveLength(1);
});
it('does not derive without learn permission, but repairs a prior event missing its example on retry',async()=>{
 for(const may_learn of [false] as const){const queries:string[]=[];const store=new PostgresStore('postgres://unused');(store as any).pool={query:async(sql:string)=>{queries.push(sql);if(sql.startsWith('SELECT id,tenant_id'))return{rowCount:1,rows:[{request:{permissions:{may_learn}}}]};if(sql.startsWith('INSERT INTO outcomes'))return{rowCount:1,rows:[{id}]};throw Error(sql)}};expect(await store.recordOutcome({episode_id:id},{tenantId:tenant,role:'admin',scopes:[]})).toBe(true);expect(queries).toHaveLength(2)}
});

it('rebuilds a missing learning example from an already recorded outcome',async()=>{
 const store=new PostgresStore('postgres://unused');const queries:string[]=[];const ep={id,tenant_id:tenant,created_at:new Date('2026-09-28T00:00:00Z'),expires_at:new Date('2099-01-01T00:00:00Z'),request:{permissions:{may_learn:true}},response:{results:[],plan:{runs:[]}}};
 (store as any).pool={query:async(sql:string)=>{queries.push(sql);if(sql.startsWith('SELECT id,tenant_id'))return{rowCount:1,rows:[ep]};if(sql.startsWith('INSERT INTO outcomes'))return{rowCount:0,rows:[]};if(sql.startsWith('SELECT episode_id,payload'))return{rows:[{episode_id:id,payload:{type:'selected',occurred_at:'2026-09-28T00:00:00Z'}}]};if(sql.startsWith('INSERT INTO learning_examples'))return{rowCount:1};throw Error(sql)}};
 expect(await store.recordOutcome({episode_id:id,event_id:'30000000-0000-4000-8000-000000000001'},{tenantId:tenant,role:'admin',scopes:[]})).toBe(true);
 expect(queries.some(q=>q.startsWith('INSERT INTO learning_examples'))).toBe(true);
});

it('rejects platform admin without reading or writing a builder episode',async()=>{
 const store=new PostgresStore('postgres://unused');(store as any).pool={query:async()=>{throw Error('must not touch builder data')}};
 expect(await store.recordOutcome({episode_id:id},{tenantId:'platform',role:'platform_admin',scopes:[]})).toBe(false);
});
