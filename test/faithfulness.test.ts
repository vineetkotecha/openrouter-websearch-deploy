import { describe, it, expect } from "vitest";
import { gradeDeterministic, gradeWithLlm, splitGroundedAnswer, splitClaims } from "../src/core/faithfulness.js";
import { rank } from "../src/core/rank.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";

const page = "The Aero 14 laptop weighs 1.2 kg and costs $1,299. Battery life is rated at 14 hours in reviews. It has a quiet fan.";
describe("faithfulness grader", () => {
  it("supports claims the page states", () => {
    const f = gradeDeterministic({ title: "Aero 14", snippet: "The Aero 14 laptop weighs 1.2 kg. Battery life is rated at 14 hours." }, page);
    expect(f.state).toBe("supported");
  });
  it("flags numbers the page does not contain", () => {
    const f = gradeDeterministic({ title: "Aero 14", snippet: "The Aero 14 laptop costs $899 with battery life rated at 20 hours." }, page);
    expect(f.state).not.toBe("supported");
    expect(f.claims[0]!.missing_numbers.length).toBeGreaterThan(0);
  });
  it("leaves results without a page unverified", () => {
    expect(gradeDeterministic({ title: "x", snippet: "some claim about laptops here" }, "").state).toBe("unverified");
  });
  it("LLM judge cannot override a number mismatch", async () => {
    const f = await gradeWithLlm({ title: "Aero", snippet: "The Aero 14 laptop costs $899 today in stores." }, page, async () => '{"verdicts":["supported"]}');
    expect(f.state).not.toBe("supported");
  });
  it("splits claims and ignores fragments", () => { expect(splitClaims("Good laptop. Ok. Battery lasts all day long [1].").length).toBe(1); });
});

describe("grounded answers", () => {
  it("splits answers per cited source and keeps them unverified until checked", async () => {
    const items = splitGroundedAnswer("perplexity", "The Aero 14 weighs 1.2 kg [1]. Battery lasts 14 hours [2]. Reviewers like the fan [1].", ["https://a.example/r", "https://b.example/r"]);
    expect(items).toHaveLength(2);
    expect(items[0]!.snippet).toContain("1.2 kg");
    expect(items[0]!.snippet).not.toContain("14 hours");
    const r = SearchRequestSchema.parse({ query: "light laptop", tenant_id: "t" });
    const out = rank(await new HeuristicMandateWriter().write(r), items, 5);
    expect(out.every(x => x.faithfulness.state === "unverified")).toBe(true);
  });
});

import{extractSurvivors as _xs}from"../src/core/verify.js";
describe("extract deadline",()=>{it("gives up on a slow page and keeps the snippet",async()=>{const slow:any=(_u:string,i:any)=>new Promise((_,rej)=>i.signal.addEventListener("abort",()=>rej(new Error("aborted"))));const t=Date.now();const r=await _xs([{provider:"exa",url:"https://sec.example.com/10k",title:"10-K",snippet:"s"}],undefined,{fetcher:slow,timeoutMs:200});expect(Date.now()-t).toBeLessThan(1500);expect(r.results[0]!.snippet).toBe("s");expect(r.report.extracted).toBe(0)})});


describe("extraction diagnostics",()=>{
 it("counts HTTP failures and fetch errors separately without logging source bodies",async()=>{
  const rows=[{provider:"t",url:"https://one.example/a",title:"one",snippet:"claim"},{provider:"t",url:"https://two.example/b",title:"two",snippet:"claim"}];
  const fetcher:any=async (u:string)=>{if(u.includes("one.example"))return {ok:false,status:403};throw new Error("timeout")};
  const r=await _xs(rows,undefined,{fetcher,max:2});
  expect(r.report).toMatchObject({attempted:2,extracted:0,failed_http:1,failed_fetch:1,supported:0,partial:0,unverified:0});
  expect(JSON.stringify(r.report)).not.toMatch(/one.example|two.example|claim/);
 });
 it("counts grades only for extracted pages",async()=>{
  const r=await _xs([{provider:"t",url:"https://one.example/a",title:"Aero 14",snippet:"The Aero 14 laptop weighs 1.2 kg. Battery life is rated at 14 hours."}],undefined,{fetcher:(async()=>({ok:true,text:async()=>page})) as any});
  expect(r.report.extracted).toBe(1);expect(r.report.supported).toBe(1);
 });
});

it('authenticates configured survivor reads without leaking credentials into results',async()=>{
 const old=process.env.JINA_API_KEY;process.env.JINA_API_KEY='test-secret';
 try{
  let options:any;
  const r=await _xs([{provider:'exa',url:'https://shop.example/item',title:'Laptop',snippet:'Laptop'}],undefined,{fetcher:(async(_url:any,o:any)=>{options=o;return {ok:true,text:async()=> 'Laptop\nPrice: ₹64,999\n16 GB RAM'}}) as any,fields:['product_price_inr','ram_gb']});
  expect(options.headers.Authorization).toBe('Bearer test-secret');
  expect(options.headers['X-Retain-Images']).toBeUndefined();
  expect(r.results[0]!.fields).toMatchObject({product_price_inr:{value:64999,state:'supported'},ram_gb:{value:16,state:'supported'}});
  expect(JSON.stringify(r)).not.toContain('test-secret');
 }finally{if(old===undefined)delete process.env.JINA_API_KEY;else process.env.JINA_API_KEY=old;}
});
it('allocates a shared extraction token budget before concurrent body reads',async()=>{
 const rows=Array.from({length:3},(_,i)=>({provider:'exa',url:`https://shop.example/${i}`,title:'Laptop',snippet:''}));
 const r=await _xs(rows,undefined,{max:3,maxChars:8000,tokenBudget:500,fetcher:(async()=>({ok:true,text:async()=> 'Laptop '+ 'x'.repeat(10000)})) as any});
 expect(r.report.extracted).toBe(3);expect(r.report.chars).toBeLessThanOrEqual(2000);expect(r.report.tokens_est).toBeLessThanOrEqual(500);
});
