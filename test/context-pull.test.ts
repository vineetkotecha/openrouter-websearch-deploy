import { describe, it, expect } from "vitest";
import { SearchHarness, MemoryStore } from "../src/core/harness.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";
import { canonicalContextKey, canonicalGaps, heuristicGaps } from "../src/core/context-pull.js";
const writer = new HeuristicMandateWriter();
const fake = { name: "exa", enabled: () => true, search: async () => [{ provider: "exa", url: "https://a.example.com/1", title: "pizza place", snippet: "pizza" }] };
const okFetch: any = async () => ({ ok: false, text: async () => "" });
const h = () => new SearchHarness({ SEARCH_TIMEOUT_MS: 1000 } as any, writer, [fake as any], new MemoryStore(), { fetcher: okFetch });
const req = (x: any) => SearchRequestSchema.parse({ tenant_id: "t", ...x });
describe("calling-agent context pull", () => {
  it("finds a material location gap only for near-me searches without location", () => {
    expect(heuristicGaps(req({ query: "pizza near me" })).find(g => g.key === "location")?.material).toBe(true);
    expect(heuristicGaps(req({ query: "best laptop" })).find(g => g.key === "use_case")?.material).toBe(true);
    expect(heuristicGaps(req({ query: "plan a weekend trip" })).find(g => g.key === "origin")?.material).toBe(true);
    expect(heuristicGaps(req({ query: "luxury watch for my anniversary" })).find(g => g.key === "recipient")?.material).toBe(true);
    expect(heuristicGaps(req({ query: "pizza near me", country: "IN" })).some(g => g.key === "location")).toBe(true);
    expect(heuristicGaps(req({ query: "pizza in Delhi open now" })).some(g => g.key === "location")).toBe(false);
    expect(heuristicGaps(req({ query: "pizza near me", context:[{key:"location",value:null,source:"caller"}] })).some(g=>g.key==="location")).toBe(true);
    expect(heuristicGaps(req({ query: "history of pizza" }))).toEqual([]);
    expect(heuristicGaps(req({ query: "buy running shoes" })).find(g => g.key === "budget")?.material).toBe(false);
  });
  it("asks the calling agent for context, with scope and how to answer", async () => {
    const out: any = await h().search(req({ query: "pizza near me", permissions: { may_pull_context: true, scopes: ["location:city"] } }));
    expect(out.status).toBe("needs_input"); expect(out.kind).toBe("context_request");
    expect(out.requested_context[0]).toMatchObject({ key: "location", scope: ["location:city"] }); expect(out.how_to_answer).toMatch(/context/);
  });
  it("searches once the caller supplies the key, and shows which context shaped it", async () => {
    const out: any = await h().search(req({ query: "pizza near me", permissions: { may_pull_context: true }, context: [{ key: "location", value: "Koramangala, Bengaluru", source: "caller", confidence: .9 }] }));
    expect(out.status).toBe("complete");
    expect(out.plan.context.items).toEqual([{ key: "location", source: "caller", confidence: .9 }]);
    expect(JSON.stringify(out.plan.context)).not.toContain("Koramangala");
  });
  it("never searches an unrelated city when local location is missing and pull is forbidden", async () => {
    let calls=0; const provider={ name:"exa", enabled:()=>true, search:async()=>{calls++;return []} };
    const harness=new SearchHarness({ SEARCH_TIMEOUT_MS:1000 } as any,writer,[provider as any],new MemoryStore());
    const out:any=await harness.search(req({query:"pharmacy near me open now",country:"IN"}));
    expect(out.status).toBe("complete"); expect(out.results).toEqual([]); expect(calls).toBe(0);
    expect(out.limitations.join(" ")).toMatch(/Location is required/);
  });
});
import { formProviderQuery, localizeQuery } from "../src/core/context-pull.js";
describe("pulled location reaches providers", () => {
  it("replaces near me with the supplied location", () => {
    expect(localizeQuery(req({ query: "pizza near me", context: [{ key: "location", value: "Koramangala, Bengaluru", source: "caller" }] })).query).toBe("pizza in Koramangala, Bengaluru");
    expect(localizeQuery(req({ query: "best pizza open now", context: [{ key: "city", value: "Pune", source: "human" }] })).query).toBe("best pizza open now in Pune");
    expect(localizeQuery(req({ query: "history of pizza", context: [{ key: "location", value: "Pune", source: "caller" }] })).query).toBe("history of pizza");
  });
});

it("skips mandate generation as well as provider calls for an unlocated local query",async()=>{
 let calls=0; const w:any={write:async()=>{calls++;throw new Error("should not be called")}};
 const out:any=await new SearchHarness({ SEARCH_TIMEOUT_MS:1000 } as any,w,[],new MemoryStore()).search(req({query:"pharmacy near me open now"}));
 expect(out.status).toBe("complete");expect(out.results).toEqual([]);expect(calls).toBe(0);
});

describe('alias-safe caller fill',()=>{
  it('asks for one canonical location key and accepts an answered alias',async()=>{
    const w:any={write:async(r:any)=>({...await writer.write(r),gaps:[{key:'user_current_location',material:true,question:'Where is the user now?'}]})};
    const harness=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,w,[fake as any],new MemoryStore(),{fetcher:okFetch});
    const ask:any=await harness.search(req({query:'pharmacy near me open now',permissions:{may_pull_context:true}}));
    expect(ask.requested_context.map((x:any)=>x.key)).toEqual(['location']);
    const filled:any=await harness.search(req({query:'pharmacy near me open now',permissions:{may_pull_context:true},context:[{key:'user_current_location',value:'Pune',source:'caller'}]}));
    expect(filled.status).toBe('complete');
  });
});

describe('visible evidence limits',()=>{it('states unverified freshness instead of silent limitations',async()=>{
 const provider={name:'exa',enabled:()=>true,search:async()=>[{provider:'exa',url:'https://a.example.com/story',title:'old story',snippet:'old story'}]};
 const harness=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider as any],new MemoryStore(),{fetcher:okFetch});
 const out:any=await harness.search(req({query:'latest news on batteries'}));
 expect(out.status).toBe('complete');expect(out.limitations.join(' ')).toMatch(/Freshness/);
 expect(out.limitations.join(' ')).toMatch(/Freshness/);
});});


describe('origin alias normalization',()=>{it('collapses origin_location and origin to one request',()=>{
 expect(canonicalGaps([{key:'origin_location',material:true,question:'From where?'},{key:'origin',material:true,question:'Where would you leave from?'}])).toEqual([{key:'origin',material:true,question:'From where?'}]);
});});


describe('dietary source limits',()=>{it('warns when Jain exclusions were not independently checked',async()=>{
 const provider={name:'exa',enabled:()=>true,search:async()=>[{provider:'exa',url:'https://recipe.example/jain-palak-paneer',title:'Jain palak paneer',snippet:'No onion or garlic'}]};
 const out:any=await new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,writer,[provider as any],new MemoryStore(),{fetcher:okFetch}).search(req({query:'Jain North Indian lunch ideas without onion or garlic'}));
 expect(out.status).toBe('complete');expect(out.limitations.join(' ')).toMatch(/Ingredient lists and preparation were not independently checked/);
});});


it('normalizes intended_use_case to a single use_case request',()=>{
 expect(canonicalContextKey('intended_use_case')).toBe('use_case');
 expect(canonicalGaps([{key:'intended_use_case',material:true,question:'What is the intended use?'},{key:'use_case',material:true,question:'What will it be used for?'}]).map(x=>x.key)).toEqual(['use_case']);
});


describe('explicit two-pass provider query formation',()=>{
 it('shows no invented prefill and uses an evidenced high-confidence use case only after fill',()=>{
 const r=req({query:'best laptop',context:[{key:'use_case',value:'coding and agent work',source:'caller',confidence:.95}]});
 expect(formProviderQuery(r,'pre_fill')).toMatchObject({provider_query:'best laptop',context_keys:[],changed:false});
 expect(formProviderQuery(r,'post_fill')).toMatchObject({provider_query:'best laptop for coding and agent work',context_keys:['use_case'],changed:true});
 });
 it('does not turn stale, low-confidence, or psychologically classified context into a provider query',()=>{
 const cases=[{key:'origin',value:'Bangalore',source:'caller',confidence:.3},{key:'origin',value:'Bangalore',source:'caller',confidence:.9,expires_at:'2020-01-01T00:00:00Z'},{key:'origin',value:'Bangalore',source:'caller',confidence:1,class:'psychological'}];
 for(const c of cases)expect(formProviderQuery(req({query:'weekend trip',context:[c]}),'post_fill').provider_query).toBe('weekend trip');
 });
 it('rewrites a supplied current location but never adds a residence absent from the request',()=>{
 expect(formProviderQuery(req({query:'pharmacy near me open now'}),'pre_fill').provider_query).toBe('pharmacy near me open now');
 expect(formProviderQuery(req({query:'pharmacy near me open now',context:[{key:'location',value:'Pune',source:'caller',confidence:.95}]}),'post_fill').provider_query).toBe('pharmacy in Pune open now');
 });
});


describe('weekend trip distinct origin',()=>{it('does not request a conflated origin-or-destination parameter',async()=>{
 const w:any={write:async(r:any)=>({...await writer.write(r),gaps:[{key:'origin_or_destination',material:true,question:'Where from or to?'}]})};
 const harness=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,w,[],new MemoryStore());
 const out:any=await harness.search(req({query:'weekend trip',permissions:{may_pull_context:true}}));
 expect(out.requested_context.map((x:any)=>x.key)).toEqual(['origin']);
})});


it('answers broad Notion alternatives instead of requiring unspecified startup particulars',async()=>{
 const w:any={write:async(r:any)=>({...await writer.write(r),gaps:[{key:'startup_specific_needs',material:true,question:'What particular integrations or budget?'}]})};
 const harness=new SearchHarness({SEARCH_TIMEOUT_MS:1000} as any,w,[],new MemoryStore());
 const out:any=await harness.search(req({query:'alternatives to Notion for a startup knowledge base',permissions:{may_pull_context:true}}));
 expect(out.status).toBe('complete');
});


it('collapses location_of_origin and origin without merging destination',()=>{
 expect(canonicalGaps([{key:'location_of_origin',material:true,question:'Where do you start?'},{key:'origin',material:true,question:'From where?'}]).map(x=>x.key)).toEqual(['origin']);
 expect(canonicalContextKey('origin_or_destination')).toBe('origin_or_destination');
});
