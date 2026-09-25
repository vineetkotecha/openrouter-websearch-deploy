import { describe,it,expect } from "vitest";
import { decideFill } from "../src/core/parameter-fill.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";
import { SearchHarness,MemoryStore } from "../src/core/harness.js";
const request=(x:any)=>SearchRequestSchema.parse({query:"pizza near me",tenant_id:"t",permissions:{may_pull_context:true},...x});
const writer=new HeuristicMandateWriter();
describe("lean parameter filling",()=>{
 it("batches only material unanswered gaps and leaves optional gaps as declared defaults",async()=>{
   const r=request({query:"buy pizza near me"});const m=await writer.write(r);m.gaps=[{key:"location",material:true,question:"Which area?"},{key:"budget",material:false,question:"What budget?"},{key:"diet",material:true,question:"Any diet?"}];
   const d=decideFill(m,r);expect(d.ask.map(x=>x.key)).toEqual(["location","diet"]);expect(d.defaults.map(x=>x.key)).toEqual(["budget"]);
 });
 it("does not let stale context answer a material gap",async()=>{
   const r=request({context:[{key:"location",value:"Old City",source:"caller",expires_at:"2020-01-01T00:00:00.000Z"}]});const m=await writer.write(r);m.gaps=[{key:"location",material:true,question:"Which area?"}];
   const d=decideFill(m,r);expect(d.ask[0]?.key).toBe("location");expect(d.stale).toEqual(["location"]);
 });
 it("returns one request with multiple context keys",async()=>{
   const h=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,{write:async r=>{const m=await writer.write(r);return {...m,gaps:[{key:"location",material:true,question:"Which area?"},{key:"diet",material:true,question:"Any diet?"}]}}},[],new MemoryStore());
   const out:any=await h.search(request({query:"pizza near me"}));expect(out.kind).toBe("context_request");expect(out.requested_context.map((x:any)=>x.key)).toEqual(["location","diet"]);
 });
});
