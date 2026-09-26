import { describe, it, expect, vi } from 'vitest';
import { makeApp } from '../src/server/app.js';
import { MemoryStore, SearchHarness } from '../src/core/harness.js';
import { HeuristicMandateWriter } from '../src/core/mandate.js';
import { runSourceDiagnostic } from '../src/eval/source-diagnostic.js';

const config:any={LOG_LEVEL:'silent',SEARCH_TIMEOUT_MS:1000,apiKeys:new Map([['admin-key','tenant-a']])};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
describe('fixed source diagnostic',()=>{
 it('returns counters only, runs exactly three fixed no-retention cases',async()=>{
  const h:any={search:vi.fn(async(req:any)=>({status:'complete',results:[{url:'https://secret.example/one',snippet:'private text',faithfulness:{state:'supported'}}],plan:{query_class:'semantic_discovery',extraction:{attempted:2,extracted:1,failed_http:1,failed_fetch:0,skipped_budget:0,supported:1,partial:0,unverified:0}}}))};
  const out=await runSourceDiagnostic(h,'tenant-a');
  expect(h.search).toHaveBeenCalledTimes(3);
  expect(h.search.mock.calls.map((x:any)=>x[0].query)).toEqual(['latest news on the EU AI Act enforcement','pharmacy near me open now','patents filed for solid state batteries']);
  for(const [req,meta] of h.search.mock.calls){expect(req.tenant_id).toBe('tenant-a');expect(req.permissions).toEqual({may_retain:false,may_learn:false,may_ask_user:false,may_pull_context:false,scopes:[]});expect(meta.surface).toBe('source_diagnostic')}
  expect(out.extraction).toMatchObject({attempted:6,extracted:3,failed_http:3,supported:3});
  expect(JSON.stringify(out)).not.toMatch(/private text|secret\.example|noise cancelling|patents filed|episode_id|snippet/);
 });
 it('requires admin and search scope and accepts only one running job',async()=>{
  const h=new SearchHarness(config,new HeuristicMandateWriter(),[],new MemoryStore());
  const app=await makeApp(config,h,new MemoryStore());
  const unauth=await app.inject({method:'POST',url:'/v1/admin/eval/source-diagnostic'});expect(unauth.statusCode).toBe(401);
  const first=await app.inject({method:'POST',url:'/v1/admin/eval/source-diagnostic',headers:{authorization:'Bearer admin-key'},payload:{query:'outside scope',only:['R01']}});expect(first.statusCode).toBe(202);
  const id=first.json().job_id;let job:any;for(let i=0;i<60;i++){const r=await app.inject({method:'GET',url:`/v1/admin/eval/jobs/${id}`,headers:{authorization:'Bearer admin-key'}});job=r.json();if(job.status!=='running')break;await sleep(20)}
  expect(job.status).toBe('done');expect(job.result.case_ids).toEqual(['R06','R09','R16']);
  expect(JSON.stringify(job.result)).not.toContain('outside scope');await app.close();
 });
});
