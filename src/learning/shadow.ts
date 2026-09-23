// Shadow policy (issue #1, phase 4). Proposes provider choices from logged rewards but can
// never serve them: callers only log the proposal next to the production choice.
import type { LearningExample } from "./contract.js";

export type ShadowDecision = { policy: string; query_class: string; proposed_primary?: string; production_primary?: string; scores: Record<string, number> };

// UCB1 per (class, provider) over mean reward of episodes where the provider ran as primary.
export class BanditShadow {
  readonly name = "ucb1-provider-v1";
  private stats = new Map<string, { n: number; sum: number }>();
  fit(examples: LearningExample[]) {
    for (const e of examples) {
      const p = e.provider_runs.find(r => (r.role ?? "primary") === "primary")?.provider;
      if (!p) continue;
      const k = `${e.query_class}|${p}`, s = this.stats.get(k) ?? { n: 0, sum: 0 };
      this.stats.set(k, { n: s.n + 1, sum: s.sum + e.reward.scalar });
    }
    return this;
  }
  propose(query_class: string, candidates: string[], production_primary?: string): ShadowDecision {
    const total = candidates.reduce((a, p) => a + (this.stats.get(`${query_class}|${p}`)?.n ?? 0), 0);
    const scores = Object.fromEntries(candidates.map(p => {
      const s = this.stats.get(`${query_class}|${p}`);
      return [p, s && s.n ? +(s.sum / s.n + Math.sqrt((2 * Math.log(Math.max(2, total))) / s.n)).toFixed(4) : Number.POSITIVE_INFINITY];
    }));
    const proposed_primary = candidates.slice().sort((a, b) => (scores[b]! - scores[a]!))[0];
    return { policy: this.name, query_class, proposed_primary, production_primary, scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Number.isFinite(v) ? v : 999])) };
  }
}

// Candidates and production choice for the shadow policy, taken from the served plan.
// Only provider names and the query class are used; query text and results are not.
export function shadowInputs(response: any): { query_class: string; candidates: string[]; production_primary?: string } | null {
  const job = response?.plan?.jobs?.[0];
  if (!job || !response?.plan?.query_class) return null;
  const candidates = (job.candidates ?? []).filter((c: any) => !c.excluded).map((c: any) => c.provider);
  if (!candidates.length) return null;
  return { query_class: response.plan.query_class, candidates, production_primary: job.primary };
}
