import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import type { ProviderResult, SearchRequest, SearchResponse } from "../contracts/search.js";
import type { MandateWriter } from "./mandate.js";
import type { SearchProvider } from "../providers/base.js";
import { rank } from "./rank.js";
import { extractSurvivors } from "./verify.js";
import { fillSummary } from "./fill.js";
import { heuristicGaps, openGaps, contextRequest, contextUsed, type ContextRequest } from "./context-pull.js";
import type { LlmJudge } from "./faithfulness.js";
import { routeWithPolicy } from "./jev-router.js";
import { executePlan, planJobs, ProviderHealth, type PlannedJob } from "./jobs.js";

export interface EpisodeStore { save(x: { id: string; tenantId: string; request: SearchRequest; response: SearchResponse; mandate?: unknown; expiresAt: Date; principal?: unknown; surface?: string; startedAt?: number }): Promise<void>; outcome(x: unknown): Promise<void> }
export class MemoryStore implements EpisodeStore { episodes = new Map<string, unknown>(); async save(x: any) { this.episodes.set(x.id, x) } async outcome(x: unknown) { this.episodes.set(randomUUID(), x) } }

export type HarnessOptions = { fetcher?: typeof fetch; health?: ProviderHealth; judge?: LlmJudge };
// One clarifying question, asked only when the caller allows it and a pending store is wired.
export type AskFn = (x: { episode_id: string; request: SearchRequest; question: string; gap: string; principal?: unknown }) => Promise<{ resume_token: string } | null>;
export type NeedsInput = { status: "needs_input"; episode_id: string; question: string; gap: string; resume_token: string; expires_in: number };

export class SearchHarness {
  readonly health: ProviderHealth;
  ask?: AskFn;
  get mandateWriter(): MandateWriter { return this.writer; }
  get providerList(): SearchProvider[] { return this.providers; }
  constructor(private c: Config, private writer: MandateWriter, private providers: SearchProvider[], private store: EpisodeStore, private opts: HarnessOptions = {}) {
    this.health = opts.health ?? new ProviderHealth();
  }

  async search(request: SearchRequest, meta?: { principal?: unknown; surface?: string }): Promise<SearchResponse | NeedsInput | ContextRequest> {
    const startedAt = Date.now(), episode_id = randomUUID();
    const mandate = await this.writer.write(request);
    // Writers that return no gaps (heuristic) still get the query-level gap checks.
    if (!mandate.gaps.length) mandate.gaps = heuristicGaps(request);
    mandate.gaps = openGaps(mandate, request);
    const gap = mandate.gaps.find(g => g.material);
    // Pull from the calling agent first; ask the human only if the caller cannot pull.
    if (gap && request.permissions.may_pull_context) return contextRequest(episode_id, gap, request);
    if (gap?.question && request.permissions.may_ask_user && this.ask) {
      const pending = await this.ask({ episode_id, request, question: gap.question, gap: gap.key, principal: meta?.principal }).catch(() => null);
      if (pending) return { status: "needs_input", episode_id, question: gap.question, gap: gap.key, resume_token: pending.resume_token, expires_in: 86400 };
    }
    // Jev (when configured) nominates the first discovery provider; the job planner keeps
    // hard fails, budgets and fallback deterministic.
    const decision = await routeWithPolicy(request, mandate, this.providers);
    const jevPick = decision.policy.startsWith("jev") ? decision.selected[0]?.provider_name : undefined;
    const plan = planJobs(request, mandate, this.providers, this.health, jevPick);
    const deadline = Math.min(this.c.SEARCH_TIMEOUT_MS, request.limits.latency_ms);

    const call = async (p: SearchProvider, job: PlannedJob) => {
      const ctl = new AbortController(), s = Date.now();
      const t = setTimeout(() => ctl.abort(), deadline);
      const req = job.id === "site_search" && plan.classification.domains.length
        ? { ...request, hard_constraints: { ...request.hard_constraints, include_domains: plan.classification.domains } }
        : request;
      try {
        const results = await Promise.race([p.search({ request: req, mandate, signal: ctl.signal }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${p.name} deadline exceeded`)), deadline + 250))]);
        return { status: "ok", latency_ms: Date.now() - s, results };
      } catch (e) { return { status: e instanceof Error ? e.message : "error", latency_ms: Date.now() - s, results: [] as ProviderResult[] }; }
      finally { clearTimeout(t); }
    };
    const grade = (xs: ProviderResult[]) => { const top = rank(mandate, xs, 3); return top.length ? top.reduce((a, x) => a + x.mandate_fit, 0) / top.length : 0; };
    const exec = await executePlan(plan, this.providers, call, grade, this.health);

    // Known-URL shortcut: the URLs themselves are the candidates; no discovery spend.
    const known: ProviderResult[] = plan.classification.known_urls.map(url => ({ provider: "known_url", url, title: url, snippet: "" }));
    const pool = [...known, ...exec.results];
    // Staged gate: triage on snippets first, then extract only the survivors.
    const triaged = rank(mandate, pool, Math.max(request.limits.max_results * 2, 10));
    const byCanon = new Map<string, ProviderResult>();
    for (const x of pool) { if (!byCanon.has(x.url)) byCanon.set(x.url, x); }
    const ordered = triaged.map(t => byCanon.get(t.url)!).filter(Boolean);
    const known_first = [...ordered.filter(x => x.provider === "known_url"), ...ordered.filter(x => x.provider !== "known_url")];
    const { results: extracted, report } = await extractSurvivors(known_first, undefined, { max: Math.max(plan.budget.max_extracts, known.length ? Math.min(known.length, 5) : 0), maxChars: plan.budget.max_extract_chars, tokenBudget: plan.budget.token_budget, fetcher: this.opts.fetcher, judge: this.opts.judge , fields: plan.classification.structured_fields});
    const rest = pool.filter(x => !known_first.includes(x));

    const limitations: string[] = [];
    const anyEnabled = this.providers.some(p => p.enabled());
    if (!anyEnabled && !known.length) limitations.push("No provider key is configured; returning an empty ranked set.");
    if (gap) limitations.push(`Missing context: ${gap.key}.`);
    if ((mandate as any).fallback_reason) limitations.push(`Mandate writer fell back to heuristic (${(mandate as any).fallback_reason}).`);
    for (const n of plan.notes) if (/no .* provider live/i.test(n)) limitations.push(n);
    const firstJob = plan.jobs[0];
    const response: SearchResponse = {
      status: "complete", episode_id,
      results: rank(mandate, [...extracted, ...rest], request.limits.max_results),
      route: exec.runs.map(x => ({ provider: x.provider, latency_ms: x.latency_ms, status: x.status, result_count: x.result_count })),
      limitations,
      route_decision: {
        task_class: plan.classification.query_class,
        policy: jevPick ? `jobs-v1+${decision.policy}` : "jobs-v1",
        candidates: (firstJob?.candidates ?? []).map(x => ({ provider: x.provider, score: x.score, reason: x.excluded ? `excluded: ${x.excluded}` : Object.entries(x.terms).map(([k, v]) => `${k} ${v}`).join(", ") })),
        selected: [...new Set(exec.runs.map(x => x.provider))],
      },
      retention_until: request.permissions.may_retain ? new Date(Date.now() + 30 * 864e5).toISOString() : undefined,
      plan: {
        version: 1, query_class: plan.classification.query_class, ladder: plan.classification.ladder, signals: plan.classification.signals,
        budget: plan.budget, jobs: plan.jobs.map(j => ({ id: j.id, kind: j.kind, primary: j.primary, fallback: j.fallback, reason: j.reason, candidates: j.candidates })),
        runs: exec.runs, fallback_used: exec.fallback_used, escalated: exec.escalated, skipped: exec.skipped,
        known_urls: plan.classification.known_urls, extraction: report, context: contextUsed(request), gaps: mandate.gaps.map(g => ({ key: g.key, material: g.material })), fill: plan.classification.structured_fields.length ? fillSummary(plan.classification.structured_fields, extracted.map(x => (x as any).fields)) : undefined, notes: plan.notes,
      },
    };
    await this.store.save({ id: episode_id, tenantId: request.tenant_id, request, response, mandate, principal: meta?.principal, surface: meta?.surface, startedAt, expiresAt: new Date(Date.now() + 30 * 864e5) });
    return response;
  }
}
