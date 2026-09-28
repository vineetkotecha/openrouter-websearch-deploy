import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {SearchHarness,MemoryStore} from "../src/core/harness.js";
import {HeuristicMandateWriter} from "../src/core/mandate.js";
import {ProviderHealth} from "../src/core/jobs.js";
const request=(cap:number)=>SearchRequestSchema.parse({query:"research battery patents",tenant_id:"t",permissions:{},limits:{max_provider_calls:cap,latency_ms:1000,max_results:10}});
const provider=(name:string,calls:string[],result:boolean)=>({name,enabled:()=>true,search:async()=>{calls.push(name);return result?[{provider:name,url:`https://${name}.example.com/patent`,title:"Battery patent",snippet:"A patent"}]:[]}});
describe("global provider-call budget and one repair",()=>{
 it("counts primary, fallback and repair under one cap",async()=>{const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:"fail",reason:"wrong"}));const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider("exa",calls,false),provider("tavily",calls,false),provider("brave",calls,false)] as any,new MemoryStore(),{health:new ProviderHealth(),fetcher:(async()=>({ok:false})) as any});const out:any=await h.search(request(2));expect(out.status).toBe("complete");expect(calls.length).toBeLessThanOrEqual(2);expect(out.route.length).toBe(calls.length)});
 it("permits one alternate repair only with budget left",async()=>{const calls:string[]=[];const writer:any=new HeuristicMandateWriter();writer.audit=async(_r:any,_m:any,items:any[])=>items.map(x=>({url:x.url,state:x.provider==="exa"?"fail":"pass",reason:"test"}));const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider("exa",calls,true),provider("tavily",calls,true)] as any,new MemoryStore(),{health:new ProviderHealth(),fetcher:(async()=>({ok:false})) as any});const out:any=await h.search(request(2));expect(out.route.length).toBeLessThanOrEqual(2);expect(calls.length).toBe(2);expect(out.plan.eligibility.audit.some((x:any)=>x.state==="pass")).toBe(true)});
});
