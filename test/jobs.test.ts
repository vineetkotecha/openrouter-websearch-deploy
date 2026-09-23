import { describe, it, expect } from "vitest";
import { classifyMandate, planJobs, executePlan, ProviderHealth, scoreCandidates } from "../src/core/jobs.js";
import { SearchHarness, MemoryStore } from "../src/core/harness.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";

const writer = new HeuristicMandateWriter();
const base = { tenant_id: "t", context: [], permissions: { may_pull_context: false, may_ask_user: false, may_retain: false, may_learn: false, scopes: [] }, limits: { latency_ms: 2000, max_provider_calls: 3, max_results: 10 } };
const req = (query: string, extra: any = {}) => SearchRequestSchema.parse({ ...base, query, ...extra });
const res = (provider: string, n: number, words = "quiet laptop battery") => Array.from({ length: n }, (_, i) => ({ provider, url: `https://${provider}.example/${i}`, title: `${words} ${i}`, snippet: `${words} review with detail ${i}`.padEnd(60, ".") }));
const fake = (name: string, out: () => any[], calls: string[]) => ({ name, enabled: () => true, search: async () => { calls.push(name); return out(); } });
const okFetch: any = async () => ({ ok: true, text: async () => "quiet laptop battery review with detail ".repeat(400) });

describe("mandate classification (11 classes)", () => {
  it("uses known URLs and domains before the query text", async () => {
    const r = req("summarize this", { hard_constraints: { urls: ["https://a.example/x"] } });
    expect(classifyMandate(r, await writer.write(r)).query_class).toBe("site_extract");
    const r2 = req("what changed this month site:docs.example.com crawl the docs site");
    expect(classifyMandate(r2, await writer.write(r2)).query_class).toBe("site_map_crawl");
  });
  it("detects structured, premium, local/shopping, fresh and semantic classes", async () => {
    const c = async (q: string, x: any = {}) => { const r = req(q, x); return classifyMandate(r, await writer.write(r)).query_class; };
    expect(await c("fill product data", { hard_constraints: { fields: ["name", "price", "rating"] } })).toBe("structured_json");
    expect(await c("earnings and 10-K filings for Acme")).toBe("premium_domain");
    expect(await c("running shoes under $100 buy")).toBe("local_shopping_maps");
    expect(await c("latest news on the EU AI act")).toBe("news_fresh");
    expect(await c("startups similar to Linear")).toBe("semantic_discovery");
  });
});

describe("routing score and hard fails", () => {
  it("excludes disabled, policy-blocked and quota-exhausted providers with reasons", async () => {
    process.env.QUOTA_SERPAPI_PER_DAY = "1";
    const h = new ProviderHealth(); h.record("serpapi", true);
    const r = req("running shoes buy", { provider_allowlist: ["serpapi", "exa"] });
    const c = classifyMandate(r, await writer.write(r));
    const off = { name: "serper", enabled: () => false, search: async () => [] };
    const s = scoreCandidates("discovery", c, r, [fake("serpapi", () => [], []), fake("exa", () => [], []), off, fake("jina", () => [], [])], h);
    const why = Object.fromEntries(s.map(x => [x.provider, x.excluded]));
    expect(why.serpapi).toBe("quota exhausted");
    expect(why.serper).toMatch(/disabled/);
    expect(why.jina).toMatch(/allowlist/);
    expect(why.linkup).toBe("no adapter");
    delete process.env.QUOTA_SERPAPI_PER_DAY;
  });
  it("penalizes recent errors", async () => {
    const r = req("startups similar to Linear"); const c = classifyMandate(r, await writer.write(r));
    const h = new ProviderHealth(); for (let i = 0; i < 3; i++) h.record("exa", false);
    const s = scoreCandidates("discovery", c, r, [fake("exa", () => [], []), fake("tavily", () => [], [])], h);
    expect(s.find(x => x.provider === "exa")!.terms.recent_errors).toBeGreaterThan(0);
  });
});

describe("job planner and execution", () => {
  it("known-URL ladder skips discovery spend entirely", async () => {
    const calls: string[] = [];
    const h = new SearchHarness({ SEARCH_TIMEOUT_MS: 1000 } as any, writer, [fake("exa", () => res("exa", 5), calls), fake("serpapi", () => res("serpapi", 5), calls)], new MemoryStore(), { fetcher: okFetch });
    const r = await h.search(req("pull name price rating from these pages", { hard_constraints: { urls: ["https://shop.example/p1", "https://shop.example/p2"] } }));
    expect(calls).toEqual([]);
    expect(r.plan?.ladder).toBe("C");
    expect(r.plan?.extraction.extracted).toBe(2);
    expect(r.results.map(x => x.url)).toContain("https://shop.example/p1");
  });
  it("fallback fires only when the primary is empty", async () => {
    const calls: string[] = [];
    const r = req("startups similar to Linear"); const m = await writer.write(r);
    const providers = [fake("exa", () => [], calls), fake("tavily", () => res("tavily", 4, "startups similar linear"), calls)];
    const plan = planJobs(r, m, providers);
    expect(plan.jobs[0]!.primary).toBe("exa");
    const call = async (p: any) => ({ status: "ok", latency_ms: 1, results: await p.search() });
    const out = await executePlan(plan, providers, call, xs => xs.length ? .9 : 0, new ProviderHealth());
    expect(calls).toEqual(["exa", "tavily"]);
    expect(out.fallback_used).toEqual(["discovery:tavily"]);
  });
  it("does not call the fallback when the primary is good", async () => {
    const calls: string[] = [];
    const r = req("startups similar to Linear"); const m = await writer.write(r);
    const providers = [fake("exa", () => res("exa", 4), calls), fake("tavily", () => res("tavily", 4), calls)];
    const plan = planJobs(r, m, providers);
    const call = async (p: any) => ({ status: "ok", latency_ms: 1, results: await p.search() });
    await executePlan(plan, providers, call, () => .9, new ProviderHealth());
    expect(calls).toEqual(["exa"]);
  });
  it("extracts only triage survivors within the cap and token budget", async () => {
    let fetched = 0; const f: any = async () => { fetched++; return { ok: true, text: async () => "x".repeat(50000) }; };
    const h = new SearchHarness({ SEARCH_TIMEOUT_MS: 1000 } as any, writer, [fake("exa", () => res("exa", 10), [])], new MemoryStore(), { fetcher: f });
    const r = await h.search(req("best quiet laptop battery", { limits: { ...base.limits, max_extracts: 2, token_budget: 1000 } }));
    expect(fetched).toBe(2);
    expect(r.plan!.extraction.chars).toBeLessThanOrEqual(4000);
    expect(r.results.length).toBe(10);
  });
  it("premium ladder runs the open-web backup only as an escalation", async () => {
    const calls: string[] = [];
    const r = req("10-K filings for Acme"); const m = await writer.write(r);
    const providers = [fake("valyu", () => [], calls), fake("exa", () => res("exa", 3, "acme filings"), calls)];
    const plan = planJobs(r, m, providers);
    expect(plan.classification.ladder).toBe("E");
    const call = async (p: any) => ({ status: "ok", latency_ms: 1, results: await p.search() });
    const out = await executePlan(plan, providers, call, xs => xs.length ? .9 : 0, new ProviderHealth());
    expect(out.escalated).toBe(true);
    expect(calls).toContain("exa");
  });
  it("deep research is never planned unless synthesis is requested", async () => {
    const r = req("latest news on rates"); const m = await writer.write(r);
    const plan = planJobs(r, m, [fake("perplexity", () => [], []), fake("exa", () => [], [])]);
    expect(plan.jobs.some(j => j.kind === "deep_research")).toBe(false);
  });
});
