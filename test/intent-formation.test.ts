import {describe,it,expect,vi} from 'vitest';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
import {classifyMandate} from '../src/core/jobs.js';
import {validateModelParameters,auditPrompt} from '../src/core/architecture.js';
import {curateParameters} from '../src/core/parameter-curation.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const req=(x:any)=>SearchRequestSchema.parse({tenant_id:'t',query:'find a date place',...x});
const formation=(r:any)=>normalizeIntentFormation({decision:'Pick somewhere to spend time together',intent_space:[{category:'restaurant',why:'One option'},{category:'outdoor walk',why:'A different option'},{category:'activity',why:'Another option'}],unknowns:[{key:'time',question:'When?',why:'It may affect availability',result_changing:true}],candidate_human_factors:[{key:'desire_to_impress',question:'Do you want it to feel impressive?',why:'Could change preferred results',value:'high'}]},r);
const mk=()=>{const calls:string[]=[];const provider={name:'exa',enabled:()=>true,search:async({request}:any)=>{calls.push(request.query);return[{provider:'exa',url:`https://places.example/${calls.length}`,title:request.query,snippet:request.query}]}};const writer=new HeuristicMandateWriter();const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(r:any)=>writer.write(r),form:async(r:any)=>formation(r)},[provider as any],new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>''}) as any});return{h,calls}};
describe('general first-pass intent formation',()=>{
 it('asks what answer type before branching into unlike answers',async()=>{
  const {h,calls}=mk();const out:any=await h.search(req({limits:{max_jobs:3,max_provider_calls:3,max_results:5}}));
  expect(out.status).toBe('needs_input');expect(out.kind).toBe('user_question');expect(calls).toEqual([]);
  expect(out.requested_context.some((x:any)=>x.key==='intent_category')).toBe(true);
 });
 it('keeps a human hypothesis valueless, and uses directly evidenced human context only for ranking',async()=>{
  const r=req({context:[{key:'desire_to_impress',class:'psychological',value:'high',source:'human',confidence:.9,evidence:[{source:'human',reference:'msg-42'}],allowed_uses:['rerank']}],agent_understanding:{source:'user_agent',psychological_parameters:[]}});
  const manifest=curateParameters(r,undefined,undefined,formation(r));
  expect(manifest.parameters.find(p=>p.key==='desire_to_impress')).toMatchObject({state:'resolved',effect:'ranking',hard:false,value:'high'});
  const unsupported=curateParameters(req({context:[{key:'desire_to_impress',class:'psychological',value:'high',source:'caller',confidence:.9}]}),undefined,undefined,formation(req({})));
  expect(unsupported.parameters.find(p=>p.key==='desire_to_impress')).toMatchObject({state:'missing'});
 });
 it('asks every compulsory distinct parameter rather than truncating at three',async()=>{
  const writer=new HeuristicMandateWriter();const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:async(r:any)=>({...await writer.write(r),gaps:['location','origin','use_case','recipient'].map(key=>({key,material:true,question:`Provide ${key}?`}))})},[],new MemoryStore());
  const out:any=await h.search(req({query:'best laptop near me for my anniversary weekend trip',permissions:{may_pull_context:true}}));
  expect(out.requested_context.map((x:any)=>x.key)).toEqual(['location','origin','use_case']);
 });
});

it('respects an explicit category without inventing alternatives',()=>{
 const r=req({category_hint:'museum'});
 expect(normalizeIntentFormation({intent_space:[{category:'restaurant',why:'possible'},{category:'museum',why:'caller'}]},r)).toMatchObject({category_state:'explicit',strategy:'focused',search_branches:[]});
});

describe('query-understanding contract',()=>{
 const req=(query:string)=>SearchRequestSchema.parse({tenant_id:'t',query});
 it('accepts a model venue interpretation beyond literal restaurant words and makes location compulsory',()=>{
  const r=req('A quiet spot for our anniversary meal tonight');
  const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'city',question:'Where should I look?',why:'Local search needs an area'}]},r);
  expect(f.answer_unit).toBe('local_business');
  expect(f.category_state).toBe('explicit');
  const p=curateParameters(r,undefined,undefined,f);
  expect(p.parameters.find(x=>x.key==='location')).toMatchObject({state:'missing',compulsory:true,question:'Where should I look?'});
  expect(classifyMandate(r, {intent:r.query,category:'general_consumer_search',factors:[]} as any,f).query_class).toBe('local_shopping_maps');
 });
 it('does not erase model-query conflict; asks for answer type before retrieval',()=>{
  const r=req('Find a date place for lunch');
  const f=normalizeIntentFormation({answer_unit:'product',intent_space:[{category:'product',why:'model'}]},r);
  expect(f).toMatchObject({answer_unit:undefined,category_state:'ambiguous'});
  expect(curateParameters(r,undefined,undefined,f).parameters.find(x=>x.key==='intent_category')).toMatchObject({compulsory:true,state:'missing'});
 });
 it('does not let a model omit a first-stage required key from parameter proposals',()=>{
  const r=req('A quiet spot for our anniversary meal tonight');
  const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'city',question:'Which city?',why:'Needed for local results'}]},r);
  const b=curateParameters(r,undefined,undefined,f);
  expect(()=>validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'target',weight_percent:100,compulsory:true,query_reference:'spot'}]},r,f,b)).toThrow('omitted required context location');
 });
});

it('orders first-stage context ahead of model extras and deduplicates canonical keys',async()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'A quiet spot for our anniversary meal tonight',permissions:{may_pull_context:true}});
 const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'city',question:'Which city?',why:'Area'},{key:'geographic_location',question:'Where?',why:'Area'},{key:'availability_check',question:'Have you checked availability?',why:'Current access'}]},r);
 const base=curateParameters(r,undefined,undefined,f);
 expect(base.parameters.filter(x=>x.key==='location')).toHaveLength(1);
 const writer=new HeuristicMandateWriter();
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(x:any)=>writer.write(x),form:async()=>f,parameters:async()=>({...base,generation:'gemini' as const,weight_total_percent:100,parameters:[{...base.parameters[0]!,key:'cuisine_preference',state:'missing' as const,priority:90,compulsory:true},...base.parameters]})},[],new MemoryStore());
 const out:any=await h.search(r);
 expect(out.kind).toBe('context_request');
 expect(out.requested_context[0].key).toBe('location');
 expect(out.requested_context.filter((x:any)=>x.key==='location')).toHaveLength(1);
 expect(out.requested_context.some((x:any)=>x.key==='availability_check')).toBe(false);
});

it('gives the audit the same first-stage answer unit used by routing',()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'A quiet spot for our anniversary meal tonight'});
 const f=normalizeIntentFormation({answer_unit:'local_business'},r);
 const prompt=auditPrompt(r,{intent:r.query} as any,[],new Date('2026-09-29T10:00:00Z'),f);
 expect(prompt).toContain('"answer_unit":"local_business"');
 expect(prompt).toContain('app page about finding the answer is not the answer unit');
});

it('puts location ahead of other first-stage preferences for a local search',async()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'A quiet spot for our anniversary meal tonight',permissions:{may_pull_context:true}});
 const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'cuisine_preference',question:'What food?',why:'Taste'},{key:'city',question:'Where?',why:'Area'}]},r);
 const b=curateParameters(r,undefined,undefined,f);
 const w=new HeuristicMandateWriter();
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(x:any)=>w.write(x),form:async()=>f,parameters:async()=>({...b,generation:'gemini' as const,weight_total_percent:100,parameters:b.parameters.map(x=>({...x,priority:x.key==='cuisine_preference'?80:20}))})},[],new MemoryStore());
 const out:any=await h.search(r);
 expect(out.gap).toBe('location');expect(out.requested_context.map((x:any)=>x.key).slice(0,2)).toEqual(['location','cuisine_preference']);
});
