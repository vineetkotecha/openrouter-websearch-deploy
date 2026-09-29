import {it,expect} from 'vitest';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
it('does not route unlike answer types before an answer-unit choice',async()=>{
 const calls:{provider:string;query:string}[]=[];
 const providers=['exa','serper'].map(name=>({name,enabled:()=>true,search:async({request}:any)=>{calls.push({provider:name,query:request.query});return Array.from({length:6},(_,i)=>({provider:name,url:`https://${name}.example/${calls.length}-${i}`,title:request.query,snippet:'An option'}))}}));
 const writer=new HeuristicMandateWriter();
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(r:any)=>writer.write(r),form:async(r:any)=>normalizeIntentFormation({intent_space:[{category:'restaurant',why:'meal'},{category:'outdoor walk',why:'walk'}]},r)},providers as any,new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>''}) as any});
 const r:any=await h.search(SearchRequestSchema.parse({tenant_id:'t',query:'find something to do together',limits:{max_jobs:2,max_provider_calls:2,max_results:10}}));
 expect(r.status).toBe('needs_input');
 expect(r.kind).toBe('user_question');
 expect(r.requested_context.some((x:any)=>x.key==='intent_category')).toBe(true);
 expect(calls).toEqual([]);
});
