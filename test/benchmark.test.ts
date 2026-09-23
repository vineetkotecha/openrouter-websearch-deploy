import { describe, it, expect } from "vitest";
import { runBenchmark } from "../src/eval/benchmark.js";
import { SearchHarness, MemoryStore } from "../src/core/harness.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
describe("live benchmark runner", () => {
  it("runs every routing case and aggregates per class", async () => {
    const mk = (n: string) => ({ name: n, enabled: () => true, search: async () => [1, 2, 3].map(i => ({ provider: n, url: `https://${n}${i}.example.com/p`, title: `result ${i}`, snippet: "s" })) });
    const h = new SearchHarness({ SEARCH_TIMEOUT_MS: 1000 } as any, new HeuristicMandateWriter(), ["exa", "serpapi", "valyu", "jina", "firecrawl"].map(mk) as any, new MemoryStore(), { fetcher: (async () => ({ ok: false })) as any });
    const b = await runBenchmark(h, "t", { concurrency: 4 });
    expect(b.n).toBe(28); expect(b.overall.class_accuracy).toBe(1);
    expect(Object.keys(b.by_class).length).toBeGreaterThanOrEqual(10); expect(b.deep_research).toBe("off");
    expect(b.rows.every(r => r.status === "complete" || r.status === "needs_input")).toBe(true);
  });
});
