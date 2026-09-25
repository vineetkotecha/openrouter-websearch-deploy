import { describe, it, expect } from "vitest";
import { SearchHarness, MemoryStore } from "../src/core/harness.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";
import { heuristicGaps } from "../src/core/context-pull.js";
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
import { localizeQuery } from "../src/core/context-pull.js";
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
