import { describe,it,expect,vi } from "vitest";
import { SearchRequestSchema } from "../src/contracts/search.js";
import { curateParameters,curatedRequest } from "../src/core/parameter-curation.js";
import { SearchHarness,MemoryStore } from "../src/core/harness.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SerpApi } from "../src/providers/adapters.js";
const req=(x:any)=>SearchRequestSchema.parse({query:"best laptop",tenant_id:"t",...x});
const harness=(writer:any=new HeuristicMandateWriter(),providers:any[]=[])=>new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,providers as any,new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>""}) as any});
describe("curation and two-stage fill",()=>{
 it("curates before the writer, asks once, and rebuilds a revised mandate after evidenced caller answers",async()=>{
  const write=vi.fn(async(r:any)=>new HeuristicMandateWriter().write(r));const h=harness({write});const r=req({permissions:{may_pull_context:true}});
  const first:any=await h.search(r);expect(first.kind).toBe("context_request");expect(first.curation_id).toMatch(/[a-f0-9-]{36}/);expect(first.requested_context.map((x:any)=>x.key)).toEqual(["use_case"]);
  const second:any=await h.search(req({permissions:{may_pull_context:true},caller_fill_complete:true,curation_revision_of:first.curation_id,context:[{key:"use_case",value:"coding",source:"caller",confidence:.95,evidence:[{source:"caller",reference:"user-agent:42"}]}]}));
  expect(second.status).toBe("complete");expect(write).toHaveBeenCalledTimes(2);expect(second.plan.curation.revision_of).toBe(first.curation_id);expect(second.plan.formation.post).toBe("best laptop for coding");expect(second.plan.curation.parameters.find((x:any)=>x.key==="use_case").source).toBe("caller");
 });
 it("does not promote a model-invented gap, budget, or unevidenced human trait to a blocking factor",async()=>{
  const w={write:async(r:any)=>({...await new HeuristicMandateWriter().write(r),gaps:[{key:"mystery_trait",material:true,question:"Tell us your trait?"}]})};
  const out:any=await harness(w).search(req({permissions:{may_pull_context:true},agent_understanding:{source:"user_agent",psychological_parameters:[]}}));
  expect(out.requested_context.map((x:any)=>x.key)).toEqual(["use_case"]);
  const m=curateParameters(req({query:"buy shoes",context:[{key:"personality",class:"psychological",value:"bold",source:"caller",confidence:1}]}));
  expect(m.parameters.some(p=>p.key==="personality")).toBe(false);
 });
 it("keeps hard constraint over context, records conflicts and rejects stale or forbidden-use facts",()=>{
  const m=curateParameters(req({hard_constraints:{origin:"Pune"},context:[{key:"origin",value:"Delhi",source:"caller"},{key:"use_case",value:"gaming",source:"caller",expires_at:"2020-01-01T00:00:00Z"},{key:"style",class:"psychological",value:"minimal",source:"human",evidence:[{source:"human",reference:"message-1"}],allowed_uses:["rerank"]}]}));
  expect(m.parameters.find(p=>p.key==="origin")?.value).toBe("Pune");expect(m.parameters.find(p=>p.key==="origin")?.alternatives).toHaveLength(1);
  expect(m.parameters.find(p=>p.key==="use_case")?.state).toBe("stale");expect(curatedRequest(req({context:[{key:"use_case",value:"gaming",source:"caller",expires_at:"2020-01-01T00:00:00Z"}]}),m).context).toEqual([]);
  expect(m.parameters.find(p=>p.key==="style")?.effect).toBe("ranking");
 });
 it("caps SerpApi even when a vertical returns forty",async()=>{
  process.env.SERPAPI_API_KEY="test";const old=globalThis.fetch;
  globalThis.fetch=vi.fn(async()=>({ok:true,json:async()=>({shopping_results:Array.from({length:40},(_,i)=>({product_link:`https://shop.example/${i}`,title:`Shoe ${i}`}))})})) as any;
  try{const r=await new SerpApi().search({request:req({query:"buy shoes",limits:{max_results:5}}),mandate:await new HeuristicMandateWriter().write(req({query:"buy shoes"})),signal:new AbortController().signal});expect(r).toHaveLength(5)}finally{globalThis.fetch=old;delete process.env.SERPAPI_API_KEY}
 });
});

describe("curation safety and routing trace",()=>{
 it("invalidates two contrary values rather than silently choosing",()=>{
  const m=curateParameters(req({context:[{key:"use_case",value:"coding",source:"human",evidence:[{source:"human",reference:"msg1"}]},{key:"use_case",value:"gaming",source:"caller",evidence:[{source:"caller",reference:"msg2"}]}]}));
  expect(m.conflicts).toEqual(["use_case"]);expect(curatedRequest(req({context:[{key:"use_case",value:"coding",source:"human"}]}),m).context).toEqual([]);
 });
 it("treats aged current location as stale even without an explicit expiry",async()=>{
  const m=curateParameters(req({query:"pharmacy near me",context:[{key:"location",value:"Pune",source:"caller",observed_at:new Date(Date.now()-16*60_000).toISOString()}]}));
  expect(m.parameters.find(p=>p.key==="location")?.state).toBe("stale");
  const r:any=await harness().search(req({query:"pharmacy near me",context:[{key:"location",value:"Pune",source:"caller",observed_at:new Date(Date.now()-16*60_000).toISOString()}],permissions:{may_pull_context:true}}));
  expect(r.kind).toBe("context_request");expect(r.gap).toBe("location");
 });
 it("returns a source-claim citation record, not a claim of verified price or stock",async()=>{
  const p={name:"exa",enabled:()=>true,search:async()=>[{provider:"exa",url:"https://shop.example/p",title:"Laptop offer",snippet:"A laptop"}]};
  const r:any=await harness(new HeuristicMandateWriter(),[p]).search(req({query:"laptop offers"}));
  expect(r.results[0].citations[0]).toEqual({url:"https://shop.example/p",claim:"Laptop offer",support:r.results[0].faithfulness.state,kind:"source_claim"});
  expect(r.plan.jobs[0]).toHaveProperty("priority");expect(r.plan).toHaveProperty("curation");
 });
});

it("does not launder a model's invented rating into the curated record from a broad query",async()=>{
 const r=req({query:"best laptop"}),m=await new HeuristicMandateWriter().write(r);
 m.factors.push({key:"average_user_rating",class:"functional",description:"At least four stars",value:4,weight:.8,confidence:.7,hard:false,evidence:[{source:"query",reference:"best laptop"}]});
 expect(curateParameters(r,m).parameters.some(x=>x.key==="average_user_rating")).toBe(false);
});
