import {it,expect} from 'vitest';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
it('routes and records each decomposed subquery independently, returning no more than five',async()=>{
 const calls:{provider:string;query:string}[]=[];
 const providers=['exa','serper'].map(name=>({name,enabled:()=>true,search:async({request}:any)=>{calls.push({provider:name,query:request.query});return Array.from({length:6},(_,i)=>({provider:name,url:`https://${name}.example/${calls.length}-${i}`,title:request.query,snippet:'An option'}))}}));
 const writer=new HeuristicMandateWriter();
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(r:any)=>writer.write(r),form:async(r:any)=>normalizeIntentFormation({intent_space:[{category:'restaurant',why:'meal'},{category:'outdoor walk',why:'walk'}]},r)},providers as any,new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>''}) as any});
 const r:any=await h.search(SearchRequestSchema.parse({tenant_id:'t',query:'find a date place',limits:{max_jobs:2,max_provider_calls:2,max_results:10}}));
 expect(r.status).toBe('complete');
 expect(r.plan.jobs.map((j:any)=>j.query)).toEqual(['find a date place restaurant','find a date place outdoor walk']);
 expect(r.plan.jobs.every((j:any)=>j.routing_policy&&j.primary)).toBe(true);
 expect(calls.map(x=>x.query)).toContain('find a date place restaurant');
 expect(calls.map(x=>x.query)).toContain('find a date place outdoor walk');
 expect(r.results.length).toBeLessThanOrEqual(5);
});
