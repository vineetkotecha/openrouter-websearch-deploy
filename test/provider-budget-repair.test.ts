import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {SearchHarness,MemoryStore} from "../src/core/harness.js";
import {HeuristicMandateWriter} from "../src/core/mandate.js";
import {ProviderHealth} from "../src/core/jobs.js";
const request=(cap:number)=>SearchRequestSchema.parse({query:"research battery patents",tenant_id:"t",permissions:{},limits:{max_provider_calls:cap,latency_ms:1000,max_results:10}});
const provider=(name:string,calls:string[],result:boolean)=>({name,enabled:()=>true,search:async()=>{calls.push(name);return result?[{provider:name,url:`https://${name}.example.com/patent`,title:"Battery patent",snippet:"A patent"}]:[]}});
describe("global provider-call budget and one repair",()=>{
 it("counts primary, fallback and repair under one cap",async()=>{const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:"fail",reason:"wrong"}));const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider("exa",calls,false),provider("tavily",calls,false),provider("brave",calls,false)] as any,new MemoryStore(),{health:new ProviderHealth(),fetcher:(async()=>({ok:false})) as any});const out:any=await h.search(request(2));expect(out.status).toBe("complete");expect(calls.length).toBeLessThanOrEqual(2);expect(out.route.length).toBe(calls.length)});
 it("permits one alternate repair only with budget left",async()=>{const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:x.provider==="exa"?"fail":"pass",reason:"test",evidence_state:x.provider==="exa"?"contradicted":"supported",evidence_quote:"A patent"}));const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider("exa",calls,true),provider("tavily",calls,true)] as any,new MemoryStore(),{health:new ProviderHealth(),fetcher:(async()=>({ok:false})) as any});const out:any=await h.search(request(2));expect(out.route.length).toBeLessThanOrEqual(2);expect(calls.length).toBe(2);expect(out.plan.eligibility.audit.some((x:any)=>x.state==="pass")).toBe(true)});
});
it("uses remaining call for an alternate when all primary candidates fail eligibility",async()=>{
 const calls:string[]=[];
 const collection={name:"serper",enabled:()=>true,search:async()=>{calls.push("serper");return[{provider:"serper",url:"https://shop.example.com/laptops",title:"Best laptops under 80000",snippet:"A collection"}]}};
 const product={name:"exa",enabled:()=>true,search:async()=>{calls.push("exa");return[{provider:"exa",url:"https://shop.example.com/product/abc",title:"Acer Swift 14 16GB laptop",snippet:"A named laptop"}]}};
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1500} as any,new HeuristicMandateWriter(),[collection,product] as any,new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>""}) as any});
 const out:any=await h.search(SearchRequestSchema.parse({query:"best laptop with 16GB RAM for coding under 80000 INR",tenant_id:"t",limits:{max_provider_calls:2,max_jobs:1,max_results:5}}));
 expect(calls).toHaveLength(2);expect(out.results.map((x:any)=>x.title)).toContain("Acer Swift 14 16GB laptop");expect(out.plan.eligibility.excluded.some((x:any)=>x.url.endsWith("/laptops"))).toBe(true);
});
it("does not discard eligible results when Gemini audit is rate limited",async()=>{
 const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async()=>{throw Error("429")};
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1500} as any,writer,[provider("exa",calls,true)] as any,new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>""}) as any});
 const out:any=await h.search(request(1));expect(out.results).toHaveLength(1);expect(out.limitations).toEqual(expect.arrayContaining([expect.stringContaining("Gemini correctness audit unavailable")]));
});

it("does not spend a repair call merely because initial candidates are not checked",async()=>{
 const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:x.provider==="exa"?"uncertain":"pass",reason:"test",evidence_state:x.provider==="exa"?"contradicted":"supported",evidence_quote:"A patent"}));
 const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider("exa",calls,true),provider("tavily",calls,true)] as any,new MemoryStore(),{health:new ProviderHealth(),fetcher:(async()=>({ok:false})) as any});
 const out:any=await h.search(request(3));expect(out.limitations.some((x:string)=>x.startsWith("One targeted repair"))).toBe(false);expect(out.route.length).toBeLessThanOrEqual(3);
});
