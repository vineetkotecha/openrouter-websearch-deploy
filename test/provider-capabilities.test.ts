import {it,expect} from 'vitest';
import {gradeProvider,summarizeCapabilities,providerVertical,matchCapability,pageShape} from '../src/learning/provider-capabilities.js';
import {BENCHMARK_SEED} from '../src/learning/provider-seed.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {MemoryStore} from '../src/core/harness.js';
it('keeps sparse evidence uncertain and web/shopping/research cohorts separate',()=>{
 const map=summarizeCapabilities(BENCHMARK_SEED);const web=map.find(x=>x.provider==='serper'&&x.vertical==='web')!,shop=map.find(x=>x.provider==='serper'&&x.vertical==='shopping')!;
 expect(web.runs).toBe(1);expect(web.confidence).toBeLessThan(.2);expect(web.adjustment).toBeGreaterThan(shop.adjustment);expect(matchCapability(map,'exa','news_fresh','general','discovery','web')).toBeUndefined();expect(web.measured_cost_usd).toBeNull();
});
it('grades each provider own output, counts unknown pages and does not invent field coverage',async()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'laptop under 80000 INR'}),m=await new HeuristicMandateWriter().write(r);
 const o=gradeProvider({provider:'exa',query_class:'local_shopping_maps',answer_unit:'product',kind:'discovery',vertical:'web',status:'ok',latency_ms:100,results:[{provider:'exa',url:'https://store.example/products/model-x',title:'Model X',snippet:''},{provider:'exa',url:'https://reddit.com/r/laptops/abc',title:'Advice',snippet:''},{provider:'exa',url:'https://store.example/collections/laptops',title:'Laptops',snippet:''},{provider:'exa',url:'https://store.example/model-family',title:'Family',snippet:''}],request:r,mandate:m,fields:['ram_gb','product_price_inr']});
 expect(o).toMatchObject({direct:1,discussion:1,collection:1,unknown:1,field_coverage:null,field_pages:0,measured_cost_usd:null});expect(o.estimated_cost_usd).toBe(.005);expect(JSON.stringify(o)).not.toContain('80000');
 expect(providerVertical('exa',r,m)).toBe('web');expect(providerVertical('serper',r,m)).toBe('shopping');expect(providerVertical('serper',r,m,'web')).toBe('web');
});
it('persists permitted tenant feedback only, ignores expired and may_learn=false',async()=>{
 const store=new MemoryStore();for(const [id,tenant,learn,expiry] of [['a','t1',true,Date.now()+10000],['b','t2',true,Date.now()+10000],['c','t1',false,Date.now()+10000],['d','t1',true,0]] as const)await store.save({id,tenantId:tenant,request:{permissions:{may_learn:learn}},expiresAt:new Date(expiry),response:{plan:{provider_feedback:[{provider:id}]}}});
 expect(await store.capabilityObservations('t1')).toEqual([{provider:'a'}]);
});
it('treats discussion as a type, not inherently junk for research',()=>{
 const o={...BENCHMARK_SEED[1]!,answer_unit:'research_source',eligible:5};expect(summarizeCapabilities([o])[0]!.adjustment).toBeGreaterThan(0);expect(pageShape({provider:'x',url:'https://arxiv.org/abs/1234',title:'Paper',snippet:''})).toBe('direct');
});
it('earned seed affects fallback routing and the next search consumes tenant feedback',async()=>{
 const {SearchHarness}=await import('../src/core/harness.js');const store=new MemoryStore(),calls:string[]=[];
 const providers=['serper','serpapi','tavily','exa'].map(name=>({name,enabled:()=>true,search:async()=>{calls.push(name);return [{provider:name,url:`https://${name}.example/product/laptop-x`,title:'Laptop X 16GB',snippet:'Laptop X 16GB RAM for coding under 80000 INR'}]}}));
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,new HeuristicMandateWriter(),providers,store,{fetcher:(async()=>({ok:true,text:async()=>'<html><body>Laptop X 16GB RAM for coding Rs.70000</body></html>'})) as any});
 const request=SearchRequestSchema.parse({tenant_id:'t1',query:'Best laptop with 16GB RAM for coding under 80000 INR',caller_fill_complete:true,permissions:{may_pull_context:false,may_ask_user:false,may_retain:true,may_learn:true,scopes:[]},limits:{latency_ms:1000,max_provider_calls:1,max_results:5}});
 const first:any=await h.search(request);expect(calls[0]).toBe('serpapi');expect(first.plan.provider_feedback).toHaveLength(1);expect(first.plan.provider_feedback[0]).toMatchObject({provider:'serpapi',source:'search',vertical:'shopping'});expect(await store.capabilityObservations('t1')).toHaveLength(1);
 const second:any=await h.search(request);const learned=second.plan.jobs[0].candidates.find((x:any)=>x.provider==='serpapi');expect(learned.learned.runs).toBe(2);expect(learned.learned.source_counts).toEqual({benchmark:1,search:1});expect(await store.capabilityObservations('t2')).toEqual([]);
});
