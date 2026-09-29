import {describe,it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
import {requiredSearchArea,purposeTerms,validatedFinalQuery} from '../src/core/final-query.js';
const input=SearchRequestSchema.parse({tenant_id:'test',query:'Find a perfect date place for me for tomorrow lunch.',context:[{key:'location',value:'Bengaluru',source:'caller',confidence:1,evidence:[{source:'caller',reference:'synthetic fixture'}]}],limits:{max_provider_calls:1,max_results:5,latency_ms:1000}});
const intent=normalizeIntentFormation({answer_unit:'local_business',decision:'Find a date-lunch venue',required_context:[{key:'location',question:'Where?',why:'Local search'}]},input);
describe('post-fill final query reaches executed provider',()=>{
 it('rejects model query that dropped a necessary area',()=>{expect(requiredSearchArea(input,intent)).toBe('Bengaluru');expect(purposeTerms(input)).toEqual(['date','lunch','tomorrow']);expect(validatedFinalQuery('date lunch in Bengaluru','date lunch tomorrow in Bengaluru','Bengaluru',purposeTerms(input))).toBe('date lunch tomorrow in Bengaluru');expect(validatedFinalQuery('date lunch venues','date lunch in Bengaluru','Bengaluru')).toBe('date lunch in Bengaluru');expect(validatedFinalQuery('restaurants in Bengaluru','date lunch in Bengaluru','Bengaluru',['date','lunch'])).toBe('date lunch in Bengaluru')});
 it('uses the final LLM query, and rejects an area-erasing decomposition',async()=>{
  const seen:string[]=[];const base=new HeuristicMandateWriter();
  const writer:any={form:async()=>intent,write:(r:any,m:any)=>base.write(r,m),finalQuery:async()=> 'date lunch restaurants tomorrow in Bengaluru',decompose:async()=>({discovery:'date lunch apps'})};
  const provider:any={name:'exa',enabled:()=>true,search:async({request}:any)=>{seen.push(request.query);return[]}};
  const out:any=await new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider],new MemoryStore()).search(input);
  expect(out.status).toBe('complete');expect(seen).toContain('date lunch restaurants tomorrow in Bengaluru');
  expect(out.plan.jobs[0].query).toBe('date lunch restaurants tomorrow in Bengaluru');expect(out.plan.formation.post).toContain('tomorrow');expect(out.plan.jobs[0].query).toContain('tomorrow');
 });
 it('uses a safe fallback when final model output omits the area',async()=>{
  const seen:string[]=[];const base=new HeuristicMandateWriter();
  const writer:any={form:async()=>intent,write:(r:any,m:any)=>base.write(r,m),finalQuery:async()=> 'date lunch apps'};
  const provider:any={name:'exa',enabled:()=>true,search:async({request}:any)=>{seen.push(request.query);return[]}};
  await new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider],new MemoryStore()).search(input);
  expect(seen[0]).toContain('Bengaluru');
 });
});

it('does not let a model mandate collapse a lunch date to restaurants or inject romantic',async()=>{
 const base=new HeuristicMandateWriter();const writer:any={form:async()=>({...intent,decision:'Find a romantic restaurant lunch date'}),write:async(r:any,m:any)=>({...await base.write(r,m),intent:'Choose a romantic restaurant',category:'Restaurant'}),finalQuery:async()=> 'date lunch tomorrow in Bengaluru'};
 const out:any=await new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[],new MemoryStore()).search(input);
 expect(out.status).toBe('complete');expect(out.trace.sections[0].data.intent.decision).toBe(input.query);
 expect(out.trace.sections[5].data.mandate.category).toBe('local_business');expect(out.trace.sections[5].data.mandate.intent).toBe(input.query);
});
