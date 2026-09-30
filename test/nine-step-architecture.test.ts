import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {curateParameters} from "../src/core/parameter-curation.js";
import {fallbackIntentFormation,normalizeIntentFormation} from "../src/core/intent-formation.js";
import {validateModelParameters,fallbackManifest,normalizeQuestions,normalizeAudit} from "../src/core/architecture.js";
import {HeuristicMandateWriter} from "../src/core/mandate.js";
import {jevRerank} from "../src/core/jev-rerank.js";
import {SearchHarness,MemoryStore} from "../src/core/harness.js";
import {planJobs} from "../src/core/jobs.js";
const r=SearchRequestSchema.parse({query:"quiet laptop for coding",tenant_id:"builder-one",hard_constraints:{ram:"16GB"},permissions:{may_pull_context:false}});
const intent=normalizeIntentFormation({answer_unit:'product',required_context:[{key:'use_case',question:'What are you using it for?',why:'Changes product fit'}]},r),base=curateParameters(r,undefined,undefined,intent);
const proposed={parameters:[{key:"search_object",class:"functional",why:"item sought",query_reference:"laptop",weight_percent:10,compulsory:true},{key:"ram",class:"functional",why:"exact RAM requirement",weight_percent:25,compulsory:true,hard:true,effect:"eligibility"},{key:"use_case",class:"functional",why:"changes model choice",weight_percent:45,compulsory:true,question:"What will you use it for?"},{key:"portability",class:"psychological",why:"might change ordering",weight_percent:20,compulsory:false,question:"Will you carry it often?"}]};
const cfg:any={SEARCH_TIMEOUT_MS:1000};
describe("nine-step architecture local contract",()=>{
 it("1 isolates tenant and user namespaces",()=>{expect(SearchRequestSchema.safeParse({query:"x"}).success).toBe(false);expect(SearchRequestSchema.parse({...r,user_id:"user-a"}).user_id).toBe("user-a")});
 it("2 carries query as intent evidence, not inferred psychology",()=>{expect(intent.evidence).toEqual([{source:"query",reference:"query"}]);expect(intent.candidate_human_factors).toEqual([])});
 it("3 enforces 100% generated weights and refuses fake personal values or omitted hard rules",()=>{const m=validateModelParameters(proposed,r,intent,base);expect(m.parameters.reduce((n,p)=>n+p.priority,0)).toBe(100);expect(m.parameters.find(p=>p.key==="portability")?.value).toBeUndefined();expect(m.parameters.find(p=>p.key==="ram")?.value).toBe("16GB");expect(()=>validateModelParameters({...proposed,parameters:proposed.parameters.filter(p=>p.key!=="ram")},r,intent,base)).toThrow(/omitted hard/);expect(validateModelParameters({...proposed,parameters:proposed.parameters.map((p,i)=>({...p,weight_percent:i?20:30}))},r,intent,base).parameters.reduce((n,p)=>n+p.priority,0)).toBeCloseTo(100)});
 it("drops an unsafe psychological model proposal without losing valid parameters",()=>{const ps=proposed.parameters.map(p=>({...p,weight_percent:p.weight_percent*.8}));const bad={key:"religion",class:"psychological",why:"unsafe proposal",weight_percent:20,compulsory:true,hard:true};const m=validateModelParameters({parameters:[...ps,bad]},r,intent,base);expect(m.generation).toBe("gemini");expect(m.parameters.some(p=>p.key==="religion")).toBe(false);expect(m.parameters.reduce((n,p)=>n+p.priority,0)).toBeCloseTo(100);expect(m.parameters.some(p=>p.key==="search_object")).toBe(true)});
 it("4 asks caller context before a user when necessary data is missing",async()=>{const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());const out:any=await h.search(SearchRequestSchema.parse({...r,query:"best laptop",hard_constraints:{},permissions:{may_pull_context:true}}));expect(out.kind).toBe("context_request");expect(out.requested_context.some((x:any)=>x.key==="use_case")).toBe(true)});
 it("5 keeps optional factors blank and maps simple questions to required gaps",()=>{const missingReq=SearchRequestSchema.parse({...r,query:"quiet laptop"});const m=validateModelParameters(proposed,missingReq,intent,curateParameters(missingReq,undefined,undefined,intent));expect(normalizeQuestions({questions:[{key:"use_case",question:"What are you using it for?"},{key:"portability",question:"Optional?"}]},m)).toEqual(["What are you using it for?"])});
 it("6 writes a mandate whose decision weights follow the parameter manifest",async()=>{const m=validateModelParameters(proposed,r,intent,base);const mandate=await new HeuristicMandateWriter().write(r,m);expect(mandate.factors.find(f=>f.key==="ram")?.weight).toBe(.25);expect(mandate.factors.find(f=>f.key==="ram")?.hard).toBe(true)});
 it("7 routes only through capability-eligible providers",async()=>{const mandate=await new HeuristicMandateWriter().write(r);const plan=planJobs(r,mandate,[],undefined as any);expect(plan.jobs.every(j=>j.candidates.every(x=>x.excluded||x.provider))).toBe(true)});
 it("8 rejects incomplete source-audit coverage",()=>{const items=[{provider:"a",url:"https://a.test/1",title:"one",snippet:""},{provider:"b",url:"https://b.test/2",title:"two",snippet:""}];expect(()=>normalizeAudit({verdicts:[{url:items[0]!.url,state:"pass",reason:"yes"}]},items)).toThrow(/coverage/)});
 it("9 Jev scores all retrieved candidates rather than eight, but keeps unverified ones last",async()=>{const mandate=await new HeuristicMandateWriter().write(r);const xs=Array.from({length:12},(_,i)=>({provider:"exa",url:`https://x.test/${i}`,title:`Candidate ${i}`,snippet:"quiet laptop",rank:i+1,canonical_url:`https://x.test/${i}`,mandate_fit:.5,faithfulness:{state:i===0?"unverified":"supported",score:.8},reason:"candidate",duplicates:[]}));let calls=0;const out=await jevRerank(r,mandate,xs as any,async()=>{calls++;return .9});expect(calls).toBe(12);expect(out.attempted).toBe(12);expect(out.results.at(-1)?.url).toBe(xs[0]!.url)});
 it("asks about compulsory parameters even when the model omitted a question string",async()=>{const writer:any=new HeuristicMandateWriter();writer.form=async()=>intent;writer.parameters=async(req:any,int:any,base:any)=>validateModelParameters(proposed,req,int,base);const h=new SearchHarness(cfg,writer,[],new MemoryStore());const out:any=await h.search(SearchRequestSchema.parse({...r,query:"quiet laptop"}));expect(out.status).toBe("needs_input");expect(out.kind).toBe("user_question");expect(out.requested_context.map((x:any)=>x.key)).toContain("use_case")});
 it("fallback manifest retains explicit uncertainty",()=>{const m=fallbackManifest(base);expect(m.generation).toBe("fallback");expect(m.parameters.reduce((n,p)=>n+p.priority,0)).toBeCloseTo(100)});
});

describe("repair and complete-pool audit",()=>{
 it("tries one alternate provider after all first-pass model verdicts fail",async()=>{
  const calls:string[]=[];const query=SearchRequestSchema.parse({query:"research battery patents",tenant_id:"t",permissions:{},limits:{max_provider_calls:3,latency_ms:1000,max_results:10}});
  const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:x.provider==="exa"?"fail":"pass",reason:"test"}));
  const providers=["exa","tavily"].map(name=>({name,enabled:()=>true,search:async()=>{calls.push(name);return[{provider:name,url:`https://${name}.example.com/1`,title:"Battery patent",snippet:"Patent evidence"}]}}));
  const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,providers as any,new MemoryStore(),{fetcher:(async()=>({ok:false})) as any});
  const out:any=await h.search(query);expect(out.status).toBe("complete");expect(new Set(calls).size).toBeLessThanOrEqual(2);expect(calls.filter(x=>x==="tavily").length).toBeLessThanOrEqual(1);expect(out.plan.eligibility.audit.some((x:any)=>x.state==="pass")).toBe(true);
 });
});

it('groups related required fills in one conversational question but covers every key',()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'A place for dinner'});
 const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'city',question:'Where?',why:'Area'},{key:'cuisine',question:'What food?',why:'Taste'}]},r);
 const b=curateParameters(r,undefined,undefined,f);
 const m=fallbackManifest(b);
 expect(normalizeQuestions({questions:[{keys:['location','cuisine'],question:'Where should I look, and what food are you in the mood for?'}]},m)).toEqual(['Where?']);
 expect(normalizeQuestions({questions:[{keys:['location'],question:'Where should I look?'}]},m)).toEqual(['Where should I look?']);
});

it('does not imply a booking from a search-only question',()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'A quiet spot for our anniversary meal tonight'});
 const f=normalizeIntentFormation({answer_unit:'local_business',required_context:[{key:'city',question:'Where should I look?',why:'Area'},{key:'party_size',question:'How many people?',why:'Table size'}]},r);
 const m=fallbackManifest(curateParameters(r,undefined,undefined,f));
 expect(normalizeQuestions({questions:[{keys:['location','party_size'],question:'Where and for how many people will I be making a reservation?'}]},m)).toEqual(['Where should I look?']);
});
