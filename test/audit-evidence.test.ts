import {it,expect} from 'vitest';
import {normalizeAudit,reconcileAudits} from '../src/core/architecture.js';
const item={provider:'serper',url:'https://cafe.example/one',title:'One Cafe',snippet:'Dinner in Indiranagar'};
it('does not veto missing requirements even with a real source quote',()=>{
 const [v]=normalizeAudit({verdicts:[{url:item.url,state:'fail',evidence_state:'contradicted',reason:'The snippet does not provide pricing to confirm budget.',evidence_quote:'Dinner in Indiranagar'}]},[item]);
 expect(v).toMatchObject({state:'uncertain',evidence_state:'not_checked'});
});
it('requires exact evidence for proof or contradiction, never merely a model assertion',()=>{
 for(const state of ['pass','fail'])expect(normalizeAudit({verdicts:[{url:item.url,state,evidence_state:state==='pass'?'supported':'contradicted',reason:'Assertion'}]},[item])[0]?.state).toBe('uncertain');
});
it('allows not-checked to become proven after extraction while preserving grounded contradictions',()=>{
 const unknown=normalizeAudit({verdicts:[{url:item.url,state:'uncertain',reason:'Price missing',evidence_state:'not_checked'}]},[item]);
 const page={...item,raw:{passage:'Dinner in Indiranagar. Price for two: INR 2500.'}};
 const proven=normalizeAudit({verdicts:[{url:item.url,state:'pass',reason:'Location and budget supported',evidence_state:'supported',evidence_quote:'Dinner in Indiranagar. Price for two: INR 2500.'}]},[page]);
 expect(reconcileAudits(unknown,proven)[0]?.state).toBe('pass');
 const bad={...item,snippet:'Dinner in Delhi'};
 const contradicted=normalizeAudit({verdicts:[{url:item.url,state:'fail',reason:'Delhi is outside Indiranagar',evidence_state:'contradicted',evidence_quote:'Dinner in Delhi'}]},[bad]);
 expect(reconcileAudits(contradicted,proven)[0]?.state).toBe('fail');
});
it('rechecks a missing-price candidate after extraction instead of preserving a fake failure',async()=>{
 const {SearchRequestSchema}=await import('../src/contracts/search.js');
 const {SearchHarness,MemoryStore}=await import('../src/core/harness.js');const {HeuristicMandateWriter}=await import('../src/core/mandate.js');
 const writer:any=new HeuristicMandateWriter();let reads=0,audits=0;
 writer.audit=async(_r:any,_m:any,items:any[])=>{audits++;return items.map(x=>({url:x.url,state:x.raw?.passage?'pass':'fail',evidence_state:x.raw?.passage?'supported':'contradicted',reason:x.raw?.passage?'All requested facts supplied':'No pricing information shown',evidence_quote:x.raw?.passage?'One Cafe in Indiranagar. Price for two: INR 2500.':'Dinner in Indiranagar'}));};
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[{name:'serper',enabled:()=>true,search:async()=>[item]}] as any,new MemoryStore(),{fetcher:(async()=>{reads++;return {ok:true,text:async()=> 'One Cafe in Indiranagar. Price for two: INR 2500.'}}) as any});
 const out:any=await h.search(SearchRequestSchema.parse({tenant_id:'t',query:'dinner in Indiranagar under 3000 INR for two',limits:{max_provider_calls:1,max_extracts:1}}));
 expect(reads).toBe(1);expect(audits).toBe(2);expect(out.results).toHaveLength(1);expect(out.plan.eligibility.audit[0]).toMatchObject({state:'pass',evidence_state:'supported'});
});
