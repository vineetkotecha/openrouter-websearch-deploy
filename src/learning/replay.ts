// Offline replay/evaluation (issue #1, phase 3). Re-scores logged candidate sets under
// deterministic policies. Logged-candidate replay only: no causal claims until exploration
// or propensity data exists.
import type { Candidate, LearningExample } from "./contract.js";

export type Policy = { name: string; score: (c: Candidate) => number };
export const POLICIES: Policy[] = [
  { name: "logged", score: c => -c.position },
  { name: "fit_only", score: c => c.mandate_fit },
  { name: "fit_plus_faithfulness", score: c => .7 * c.mandate_fit + .3 * c.faithfulness },
];

const dcg = (rels: number[]) => rels.reduce((a, r, i) => a + (2 ** r - 1) / Math.log2(i + 2), 0);
export function ndcgAt(order: Candidate[], k: number) {
  const got = dcg(order.slice(0, k).map(c => c.relevance));
  const ideal = dcg([...order].map(c => c.relevance).sort((a, b) => b - a).slice(0, k));
  return ideal ? got / ideal : 0;
}
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

export function splitByTime(xs: LearningExample[], trainFraction = .8) {
  const s = [...xs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const cut = Math.floor(s.length * trainFraction);
  return { train: s.slice(0, cut), eval: s.slice(cut) };
}

export type ClassReport = { examples: number; labeled: number; reward_mean: number; latency_p50: number; latency_p95: number; cost_mean: number; supported_share_top3: number; ndcg3: Record<string, number>; ndcg10: Record<string, number> };

export function replay(examples: LearningExample[], policies = POLICIES) {
  const byClass = new Map<string, LearningExample[]>();
  for (const e of examples) byClass.set(e.query_class ?? "unknown", [...(byClass.get(e.query_class ?? "unknown") ?? []), e]);
  const report: Record<string, ClassReport> = {};
  for (const [cls, xs] of byClass) {
    const labeled = xs.filter(x => x.candidates.some(c => c.relevance > 0));
    const nd = (k: number) => Object.fromEntries(policies.map(p => [p.name, labeled.length ? +(labeled.reduce((a, x) => a + ndcgAt([...x.candidates].sort((m, n) => p.score(n) - p.score(m)), k), 0) / labeled.length).toFixed(4) : 0]));
    const top3 = xs.flatMap(x => x.candidates.slice(0, 3));
    report[cls] = {
      examples: xs.length, labeled: labeled.length,
      reward_mean: +(xs.reduce((a, x) => a + x.reward.scalar, 0) / xs.length).toFixed(4),
      latency_p50: pct(xs.map(x => x.latency_ms), .5), latency_p95: pct(xs.map(x => x.latency_ms), .95),
      cost_mean: +(xs.reduce((a, x) => a + x.est_cost_usd, 0) / xs.length).toFixed(4),
      supported_share_top3: top3.length ? +(top3.filter(c => c.faithfulness_state === "supported").length / top3.length).toFixed(3) : 0,
      ndcg3: nd(3), ndcg10: nd(10),
    };
  }
  return { method: "logged-candidate replay; no causal claims", classes: report };
}
