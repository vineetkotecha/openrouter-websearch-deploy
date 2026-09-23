import { describe, it, expect } from "vitest";
import { computeReward } from "../src/learning/reward.js";
import { deriveExamples } from "../src/learning/contract.js";
import { replay, ndcgAt, splitByTime } from "../src/learning/replay.js";
import { BanditShadow } from "../src/learning/shadow.js";

const ep = (id: string, may_learn: boolean, t = "t1", created = "2026-09-20T00:00:00Z", provider = "exa") => ({ id, tenant_id: t, created_at: created, expires_at: "2099-01-01T00:00:00Z", duration_ms: 1200, mandate: { prompt_version: "mandate-writer-v2" },
  request: { permissions: { may_learn } },
  response: { route_decision: { policy: "jobs-v1" }, plan: { version: 1, query_class: "semantic_discovery", ladder: "A", runs: [{ provider, role: "primary", latency_ms: 900, status: "ok", result_count: 3 }] },
    results: [1, 2, 3].map(i => ({ rank: i, url: `https://x.example/${i}`, provider, mandate_fit: 1 - i / 10, faithfulness: { score: .8, state: "supported" } })) } });

describe("reward v1", () => {
  it("scores events with components and penalties", () => {
    const r = computeReward([{ type: "viewed" }, { type: "selected" }], 2000, .01);
    expect(r.components.selected).toBe(1);
    expect(r.components.latency).toBeLessThan(0);
    expect(r.scalar).toBeCloseTo(1.1 - .1 - .1, 3);
  });
  it("does not punish a refinement that led to success", () => {
    const r = computeReward([{ type: "refined", occurred_at: "1" }, { type: "selected", occurred_at: "2" }]);
    expect(r.components.refined).toBe(0);
  });
});

describe("event contract", () => {
  it("joins outcomes, stamps versions and excludes may_learn=false and other tenants", () => {
    const out = deriveExamples([ep("a", true), ep("b", false), ep("c", true, "t2")], [{ episode_id: "a", payload: { type: "selected", result_url: "https://x.example/2" } }], { tenant_id: "t1" });
    expect(out.examples).toHaveLength(1);
    expect(out.excluded).toEqual({ may_learn_false: 1, expired: 0, other_tenant: 1 });
    const x = out.examples[0]!;
    expect(x.versions).toMatchObject({ mandate_prompt: "mandate-writer-v2", route_policy: "jobs-v1", planner: "jobs-v1", reward: "reward-v1" });
    expect(x.candidates[1]!.relevance).toBe(3);
  });
});

describe("offline replay and shadow", () => {
  it("computes nDCG and per-class report", () => {
    const { examples } = deriveExamples([ep("a", true)], [{ episode_id: "a", payload: { type: "selected", result_url: "https://x.example/3" } }]);
    expect(ndcgAt(examples[0]!.candidates, 3)).toBeLessThan(1);
    const r = replay(examples);
    expect(r.classes.semantic_discovery!.labeled).toBe(1);
    expect(r.method).toMatch(/no causal/);
  });
  it("splits by time and the shadow only proposes", () => {
    const xs = deriveExamples(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((d, i) => ep(`e${i}`, true, "t1", `${d}T00:00:00Z`, i % 2 ? "tavily" : "exa")), []).examples;
    const s = splitByTime(xs); expect(s.train.length).toBe(4); expect(s.eval[0]!.created_at).toContain("09-05");
    const d = new BanditShadow().fit(xs).propose("semantic_discovery", ["exa", "tavily", "linkup"], "exa");
    expect(d.proposed_primary).toBe("linkup");
    expect(d.production_primary).toBe("exa");
  });
});
