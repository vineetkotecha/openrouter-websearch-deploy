import { describe, it, expect, afterEach } from "vitest";
import { SearchRequestSchema } from "../src/contracts/search.js";
import { Parallel, Linkup, YouSearch, DiffbotSearch, allProviders } from "../src/providers/adapters.js";
const ctx: any = { request: SearchRequestSchema.parse({ tenant_id: "t", query: "quiet laptop", limits: { max_results: 5 } }), mandate: { intent: "quiet laptop", factors: [], gaps: [] }, signal: new AbortController().signal };
const g: any = globalThis; const orig = g.fetch; let seen: any[] = [];
const mock = (body: any) => { g.fetch = async (url: string, init: any) => { seen.push({ url: String(url), init }); return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) }; }; };
afterEach(() => { g.fetch = orig; seen = []; for (const k of ["PARALLEL_API_KEY", "LINKUP_API_KEY", "YDC_API_KEY", "DIFFBOT_TOKEN"]) delete process.env[k]; });
describe("new adapters behind enabled()", () => {
  it("are off without keys and registered", () => {
    for (const p of [new Parallel(), new Linkup(), new YouSearch(), new DiffbotSearch()]) expect(p.enabled()).toBe(false);
    const names = allProviders().map(p => p.name);
    for (const n of ["parallel", "linkup", "you", "diffbot", "serper", "perplexity"]) expect(names).toContain(n);
    expect(names).not.toContain("brave"); expect(names).not.toContain("google_cse");
  });
  it("parse each vendor's documented response shape", async () => {
    process.env.PARALLEL_API_KEY = "k"; mock({ results: [{ url: "https://a.example.com", title: "A", excerpts: ["one", "two"] }] });
    expect(await new Parallel().search(ctx)).toEqual([{ provider: "parallel", url: "https://a.example.com", title: "A", snippet: "one two", published_at: undefined }]);
    expect(seen[0].url).toBe("https://api.parallel.ai/v1/search"); expect(seen[0].init.headers["x-api-key"]).toBe("k");
    process.env.LINKUP_API_KEY = "k"; mock({ results: [{ type: "text", name: "B", url: "https://b.example.com", content: "bee" }, { type: "image", url: "https://b.example.com/i.png" }] });
    expect(await new Linkup().search(ctx)).toEqual([{ provider: "linkup", url: "https://b.example.com", title: "B", snippet: "bee" }]);
    process.env.YDC_API_KEY = "k"; mock({ results: { web: [{ url: "https://c.example.com", title: "C", snippets: ["sea"] }], news: [{ url: "https://n.example.com", title: "N", description: "news" }] } });
    const y = await new YouSearch().search(ctx); expect(y.map(x => x.url)).toEqual(["https://c.example.com", "https://n.example.com"]); expect(y[1]!.snippet).toBe("news");
    expect(seen.at(-1).url).toMatch(/^https:\/\/ydc-index\.io\/v1\/search\?query=/);
    process.env.DIFFBOT_TOKEN = "k"; mock({ search_results: [{ pageUrl: "https://d.example.com", title: "D", content: "dee", score: .9 }] });
    expect(await new DiffbotSearch().search(ctx)).toEqual([{ provider: "diffbot", url: "https://d.example.com", title: "D", snippet: "dee", score: .9 }]);
  });
});
