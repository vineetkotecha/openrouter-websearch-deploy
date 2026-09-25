import {describe,it,expect} from "vitest";
import {jevRerank} from "../src/core/jev-rerank.js";
import {HeuristicMandateWriter} from "../src/core/mandate.js";
import {SearchRequestSchema} from "../src/contracts/search.js";
const request=SearchRequestSchema.parse({query:"quiet laptop",tenant_id:"t",hard_constraints:{ram:"16GB"}});
const item=(rank:number,state:"supported"|"partial"|"unverified",ram:"supported"|"missing"="supported")=>({provider:"exa",url:`https://example.com/${rank}`,title:`Laptop ${rank}`,snippet:"Quiet with 16GB",rank,canonical_url:`https://example.com/${rank}`,mandate_fit:1-rank/10,faithfulness:{state,score:state==="unverified"?.1:.7},reason:"sample",duplicates:[],fields:{ram:{value:"16GB",state:ram}}});
describe("Jev rerank gates",()=>{
 it("only reorders eligible candidates and leaves failed evidence or explicit fields in place",async()=>{
  const mandate=await new HeuristicMandateWriter().write(request);const xs=[item(1,"partial"),item(2,"supported"),item(3,"unverified"),item(4,"supported","missing")];
  const out=await jevRerank(request,mandate,xs as any,async(_r,_m,x)=>x.url.endsWith("/2")?.99:.01);
  expect(out.results.map(x=>x.url)).toEqual([xs[1].url,xs[0].url,xs[2].url,xs[3].url]);expect(out.attempted).toBe(2);
 });
 it("falls back to initial rank when any scoring call fails",async()=>{
  const mandate=await new HeuristicMandateWriter().write(request);const xs=[item(1,"supported"),item(2,"partial")];const out=await jevRerank(request,mandate,xs as any,async(_r,_m,x)=>{if(x.url.endsWith("/2"))throw new Error("down");return .2});expect(out.results.map(x=>x.url)).toEqual(xs.map(x=>x.url));expect(out.successful).toBe(1);
 });
});
