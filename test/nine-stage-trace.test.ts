import {describe,it,expect} from 'vitest';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {TRACE_HEADINGS} from '../src/core/trace.js';
const cfg={SEARCH_TIMEOUT_MS:1000} as any;
const req=(query:string,more:any={})=>SearchRequestSchema.parse({tenant_id:'trace-fixture',query,limits:{latency_ms:1000,max_provider_calls:1,max_results:5},...more});
describe('nine-stage caller trace',()=>{
 it('retains all nine headings and marks early-stop stages unavailable',async()=>{
  const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());
  const out:any=await h.search(req('pizza near me',{permissions:{may_pull_context:true}}));
  expect(out.status).toBe('needs_input');expect(out.trace.sections.map((x:any)=>x.heading)).toEqual(TRACE_HEADINGS);
  expect(out.trace.sections[0].available).toBe(true);
  expect(out.trace.sections[1].data.parameters.some((x:any)=>x.key==='location')).toBe(true);
  expect(out.trace.sections[3].data.caller_requests).toHaveLength(1);
  expect(out.trace.sections[5].available).toBe(false);
 });
 it('includes plan, query, routing grades and execution in completed run without changing results',async()=>{
  const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());
  const out:any=await h.search(req('battery patents'));
  expect(out.status).toBe('complete');expect(out.trace.sections.map((x:any)=>x.heading)).toEqual(TRACE_HEADINGS);
  expect(out.trace.sections[5].data.mandate.id).toBeTruthy();
  expect(out.trace.sections[6].data.final_query).toBeTruthy();
  expect(out.trace.sections[7].data.jobs).toBeInstanceOf(Array);
  expect(out.trace.sections[8].data.jobs).toBeInstanceOf(Array);
  expect(out.trace.events.every((e:any)=>typeof e.elapsed_ms==='number')).toBe(true);
 });
});
