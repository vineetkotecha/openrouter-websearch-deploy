import {describe,it,expect,vi} from 'vitest';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
import {curateParameters} from '../src/core/parameter-curation.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const req=(x:any)=>SearchRequestSchema.parse({tenant_id:'t',query:'find a date place',...x});
const formation=(r:any)=>normalizeIntentFormation({decision:'Pick somewhere to spend time together',intent_space:[{category:'restaurant',why:'One option'},{category:'outdoor walk',why:'A different option'},{category:'activity',why:'Another option'}],unknowns:[{key:'time',question:'When?',why:'It may affect availability',result_changing:true}],candidate_human_factors:[{key:'desire_to_impress',question:'Do you want it to feel impressive?',why:'Could change preferred results',value:'high'}]},r);
const mk=()=>{const calls:string[]=[];const provider={name:'exa',enabled:()=>true,search:async({request}:any)=>{calls.push(request.query);return[{provider:'exa',url:`https://places.example/${calls.length}`,title:request.query,snippet:request.query}]}};const writer=new HeuristicMandateWriter();const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:(r:any)=>writer.write(r),form:async(r:any)=>formation(r)},[provider as any],new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>''}) as any});return{h,calls}};
describe('general first-pass intent formation',()=>{
 it('does not assume a food category and explores separate search branches',async()=>{
  const {h,calls}=mk();const out:any=await h.search(req({limits:{max_jobs:3,max_provider_calls:3,max_results:5}}));
  expect(out.status).toBe('complete');expect(calls.length).toBeGreaterThanOrEqual(2);
  expect(calls.join(' ')).toContain('outdoor walk');expect(calls.join(' ')).toContain('restaurant');
  expect(out.plan.curation.intent.category_state).toBe('ambiguous');
  expect(out.plan.curation.parameters.find((p:any)=>p.key==='intent_category')).toMatchObject({state:'missing',compulsory:false});
  expect(out.plan.curation.parameters.find((p:any)=>p.key==='desire_to_impress')).toMatchObject({class:'psychological',state:'missing',compulsory:false});
  expect(out.plan.curation.parameters.find((p:any)=>p.key==='time')).toMatchObject({state:'missing',compulsory:false});
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
