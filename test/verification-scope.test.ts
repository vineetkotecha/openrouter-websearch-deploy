import {describe,it,expect,vi,afterEach} from 'vitest';
import {makeApp} from '../src/server/app.js';
import {PostgresStore} from '../src/storage/postgres.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const cfg:any={LOG_LEVEL:'silent',SEARCH_TIMEOUT_MS:1000,apiKeys:new Map(),RESEND_API_KEY:'test',EMAIL_FROM:'verify@search.divaine.io',APP_URL:'https://search.divaine.io'};
const h=()=>new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());
const fake=(principal:any)=>{
 const store=Object.create(PostgresStore.prototype) as PostgresStore;
 store.authenticate=vi.fn(async(key:string)=>key==='token'?principal:null);
 store.consume=vi.fn(async()=>true);store.createApiKey=vi.fn(async()=>({api_key:'dv_test',scopes:['search','mcp']}));
 return store;
};
afterEach(()=>vi.unstubAllGlobals());
describe('verified access and scopes',()=>{
 it('does not expose a signup API key or verification token',async()=>{
  const store=fake(null);store.signup=vi.fn(async()=>({tenant_id:'t',user_id:'u',verification_token:'private',api_key:'never_return'}));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true})));
  const app=await makeApp(cfg,h(),store);const r=await app.inject({method:'POST',url:'/v1/signup',payload:{email:'pilot@example.com',password:'long-password'}});
  expect(r.statusCode).toBe(201);expect(r.json()).toEqual({tenant_id:'t',verification_required:true});expect(JSON.stringify(r.json())).not.toMatch(/private|api_key/);
  expect(fetch).toHaveBeenCalledOnce();await app.close();
 });
 it('fails signup closed when verification email is not configured',async()=>{
  const store=fake(null);store.signup=vi.fn();const app=await makeApp({...cfg,RESEND_API_KEY:undefined},h(),store);
  const r=await app.inject({method:'POST',url:'/v1/signup',payload:{email:'pilot@example.com',password:'long-password'}});
  expect(r.statusCode).toBe(503);expect(store.signup).not.toHaveBeenCalled();await app.close();
 });
 it('rejects login for an unverified account',async()=>{
  const store=fake(null);store.login=vi.fn(async()=>({error:'email_not_verified'}));const app=await makeApp(cfg,h(),store);
  const r=await app.inject({method:'POST',url:'/v1/login',payload:{email:'pilot@example.com',password:'long-password'}});
  expect(r.statusCode).toBe(403);expect(r.json().error).toBe('email_not_verified');await app.close();
 });
 it('enforces distinct REST and MCP scopes before quota or search',async()=>{
  const p={tenantId:'t',userId:'u',role:'user',scopes:['dashboard']};const store=fake(p);const app=await makeApp(cfg,h(),store);
  for(const url of ['/v1/search','/mcp']){
   const r=await app.inject({method:'POST',url,headers:{authorization:'Bearer token'},payload:{tenant_id:'t',query:'x'}});
   expect(r.statusCode).toBe(403);expect(r.json().error).toBe(url==='/mcp'?'mcp_scope_required':'search_scope_required');
  }
  expect(store.consume).not.toHaveBeenCalled();await app.close();
 });
 it('issues a scoped key only to a verified admin principal',async()=>{
  const store=fake({tenantId:'t',userId:'u',role:'admin',scopes:['dashboard']});const app=await makeApp(cfg,h(),store);
  const r=await app.inject({method:'POST',url:'/v1/api-keys',headers:{authorization:'Bearer token'},payload:{name:'pilot'}});
  expect(r.statusCode).toBe(200);expect(r.json().scopes).toEqual(['search','mcp']);expect(store.createApiKey).toHaveBeenCalledOnce();await app.close();
 });
});
