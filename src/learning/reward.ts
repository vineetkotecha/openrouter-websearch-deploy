// Reward v1 (issue #1, phase 2). Components are stored alongside the scalar.
// Behavioral reward is a signal, not ground truth.
export const REWARD_V1 = {
  version: "reward-v1",
  events: { viewed: .1, selected: 1, converted: 3, returned: 1.5, refined: -.25, rejected: -1, failed: -2 } as Record<string, number>,
  conversion_value_cap: 2,        // extra reward from normalized value, capped
  latency_penalty_per_s: .05, latency_penalty_cap: .5,
  cost_penalty_per_cent: .1, cost_penalty_cap: .5,
} as const;

export type OutcomeLike = { type: string; value?: number; occurred_at?: string; result_url?: string };
export type RewardBreakdown = { version: string; scalar: number; components: Record<string, number> };

export function computeReward(events: OutcomeLike[], latency_ms = 0, cost_usd = 0, t = REWARD_V1): RewardBreakdown {
  const components: Record<string, number> = {};
  const sorted = [...events].sort((a, b) => String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")));
  sorted.forEach((e, i) => {
    let w = t.events[e.type] ?? 0;
    // A refinement followed by a success is part of finding the answer, not a failure.
    if (e.type === "refined" && sorted.slice(i + 1).some(x => ["selected", "converted", "returned"].includes(x.type))) w = 0;
    components[e.type] = +((components[e.type] ?? 0) + w).toFixed(4);
    if (e.type === "converted" && typeof e.value === "number" && e.value > 0) components.conversion_value = +Math.min(t.conversion_value_cap, Math.log10(1 + e.value) / 2).toFixed(4);
  });
  components.latency = -Math.min(t.latency_penalty_cap, (latency_ms / 1000) * t.latency_penalty_per_s);
  components.cost = -Math.min(t.cost_penalty_cap, cost_usd * 100 * t.cost_penalty_per_cent);
  const scalar = Object.values(components).reduce((a, b) => a + b, 0);
  return { version: t.version, scalar: +scalar.toFixed(4), components };
}

// Graded relevance for ranking metrics.
export const RELEVANCE: Record<string, number> = { converted: 4, selected: 3, returned: 3, viewed: 1, refined: 0, rejected: 0, failed: 0 };
