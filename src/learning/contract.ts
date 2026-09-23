// Training-grade event contract (issue #1, phase 1). Joins outcomes to episodes and the full
// candidate set, stamps every component version, and enforces permissions.may_learn at
// derivation time. Tenant-local by default: no cross-tenant pooling.
import { computeReward, RELEVANCE, type OutcomeLike, type RewardBreakdown } from "./reward.js";

export type EpisodeRow = { id: string; tenant_id: string; created_at: string; expires_at?: string; request: any; response: any; mandate?: any; duration_ms?: number | null };
export type OutcomeRow = { episode_id: string; payload: OutcomeLike & { event_id?: string } };

export type Candidate = { position: number; url: string; provider: string; mandate_fit: number; faithfulness: number; faithfulness_state: string; relevance: number; events: string[] };
export type LearningExample = {
  episode_id: string; tenant_id: string; created_at: string; expires_at?: string;
  versions: { mandate_prompt?: string; route_policy?: string; planner?: string; ranker: string; faithfulness?: string; reward: string };
  query_class?: string; ladder?: string; latency_ms: number; est_cost_usd: number;
  provider_runs: { provider: string; role?: string; latency_ms: number; status: string; result_count: number }[];
  candidates: Candidate[]; reward: RewardBreakdown; outcome_count: number;
};

export const RANKER_VERSION = "rank-v2";
const COST: Record<string, number> = { exa: .005, serpapi: .01, valyu: .006, jina: .002, firecrawl: .004, tavily: .008, perplexity: .005, serper: .001, brave: .003 };

export type DeriveOptions = { tenant_id?: string; now?: Date };
export type DeriveReport = { examples: LearningExample[]; excluded: { may_learn_false: number; expired: number; other_tenant: number } };

export function deriveExamples(episodes: EpisodeRow[], outcomes: OutcomeRow[], o: DeriveOptions = {}): DeriveReport {
  const now = o.now ?? new Date();
  const byEp = new Map<string, OutcomeRow["payload"][]>();
  for (const x of outcomes) byEp.set(x.episode_id, [...(byEp.get(x.episode_id) ?? []), x.payload]);
  const excluded = { may_learn_false: 0, expired: 0, other_tenant: 0 };
  const examples: LearningExample[] = [];
  for (const e of episodes) {
    if (o.tenant_id && e.tenant_id !== o.tenant_id) { excluded.other_tenant++; continue; }
    if (e.request?.permissions?.may_learn !== true) { excluded.may_learn_false++; continue; }
    if (e.expires_at && new Date(e.expires_at) < now) { excluded.expired++; continue; }
    const events = byEp.get(e.id) ?? [];
    const r = e.response ?? {};
    const runs = (r.plan?.runs ?? r.route ?? []) as LearningExample["provider_runs"];
    const est_cost_usd = +runs.reduce((a, x) => a + (COST[x.provider] ?? .005), 0).toFixed(4);
    const candidates: Candidate[] = (r.results ?? []).map((x: any, i: number) => {
      const evs = events.filter(ev => ev.result_url && ev.result_url === x.url).map(ev => ev.type);
      return { position: x.rank ?? i + 1, url: x.url, provider: x.provider, mandate_fit: x.mandate_fit ?? 0, faithfulness: x.faithfulness?.score ?? 0, faithfulness_state: x.faithfulness?.state ?? "unverified", relevance: Math.max(0, ...evs.map(t => RELEVANCE[t] ?? 0)), events: evs };
    });
    const latency_ms = e.duration_ms ?? runs.reduce((a, x) => Math.max(a, x.latency_ms ?? 0), 0);
    examples.push({
      episode_id: e.id, tenant_id: e.tenant_id, created_at: e.created_at, expires_at: e.expires_at,
      versions: { mandate_prompt: e.mandate?.prompt_version, route_policy: r.route_decision?.policy, planner: r.plan ? `jobs-v${r.plan.version}` : undefined, ranker: RANKER_VERSION, faithfulness: r.results?.[0]?.faithfulness ? "faithfulness-v2" : undefined, reward: "reward-v1" },
      query_class: r.plan?.query_class ?? r.route_decision?.task_class, ladder: r.plan?.ladder, latency_ms, est_cost_usd, provider_runs: runs,
      candidates, reward: computeReward(events, latency_ms, est_cost_usd), outcome_count: events.length,
    });
  }
  return { examples, excluded };
}
