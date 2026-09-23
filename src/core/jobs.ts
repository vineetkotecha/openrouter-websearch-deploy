// Mandate -> search jobs -> routed provider calls.
// Implements the job planner: 11-class taxonomy, ladders A-F with an escalation rule,
// staged cost/token gates, primary-then-fallback sequencing, known-URL/site shortcuts,
// and a routing score with hard fails. Every decision is written to the plan trace.
import type { Mandate, ProviderResult, SearchRequest } from "../contracts/search.js";
import type { SearchProvider } from "../providers/base.js";

export const QUERY_CLASSES = [
  "semantic_discovery", "keyword_web", "news_fresh", "local_shopping_maps", "site_extract",
  "site_map_crawl", "structured_json", "entity_kg", "premium_domain", "deep_research", "grounded_answer",
] as const;
export type QueryClass = (typeof QUERY_CLASSES)[number];
export type Ladder = "A" | "B" | "C" | "D" | "E" | "F";
export type JobKind = "discovery" | "extract" | "crawl" | "structured" | "premium" | "deep_research";

export type Capability = {
  classes: QueryClass[];
  kinds: JobKind[];
  cost: number;        // 0 cheap .. 1 expensive (per call)
  latency: number;     // 0 slow .. 1 fast
  freshness: number;   // 0 stale .. 1 live index
  structure: number;   // 0 links only .. 1 schema/JSON output
  token_load: number;  // 0 snippets .. 1 full pages/research dumps
};

// Capability profiles. Providers without an adapter are listed so the planner can
// explain why they were excluded ("no adapter"), per the provider deep dive.
export const CAPABILITIES: Record<string, Capability> = {
  exa: { classes: ["semantic_discovery", "keyword_web", "news_fresh", "deep_research"], kinds: ["discovery"], cost: .45, latency: .7, freshness: .6, structure: .3, token_load: .3 },
  tavily: { classes: ["keyword_web", "news_fresh", "semantic_discovery", "site_map_crawl"], kinds: ["discovery", "crawl"], cost: .4, latency: .75, freshness: .85, structure: .3, token_load: .35 },
  brave: { classes: ["keyword_web", "news_fresh"], kinds: ["discovery"], cost: .25, latency: .9, freshness: .85, structure: .2, token_load: .15 },
  serper: { classes: ["keyword_web", "local_shopping_maps", "news_fresh"], kinds: ["discovery"], cost: .15, latency: .9, freshness: .8, structure: .45, token_load: .1 },
  serpapi: { classes: ["local_shopping_maps", "keyword_web", "news_fresh"], kinds: ["discovery"], cost: .35, latency: .8, freshness: .85, structure: .6, token_load: .15 },
  google_cse: { classes: ["keyword_web"], kinds: ["discovery"], cost: .2, latency: .85, freshness: .6, structure: .2, token_load: .1 },
  valyu: { classes: ["premium_domain", "semantic_discovery", "structured_json"], kinds: ["premium", "discovery"], cost: .5, latency: .6, freshness: .6, structure: .6, token_load: .45 },
  jina: { classes: ["site_extract", "keyword_web"], kinds: ["extract", "discovery"], cost: .1, latency: .8, freshness: .7, structure: .2, token_load: .6 },
  firecrawl: { classes: ["site_extract", "site_map_crawl", "structured_json"], kinds: ["extract", "crawl", "structured", "discovery"], cost: .55, latency: .45, freshness: .7, structure: .8, token_load: .7 },
  perplexity: { classes: ["grounded_answer", "deep_research", "news_fresh"], kinds: ["deep_research"], cost: .7, latency: .5, freshness: .85, structure: .3, token_load: .6 },
  gemini_deep_research: { classes: ["deep_research"], kinds: ["deep_research"], cost: 1, latency: .05, freshness: .7, structure: .3, token_load: 1 },
  linkup: { classes: ["structured_json", "semantic_discovery"], kinds: ["structured", "discovery"], cost: .4, latency: .6, freshness: .7, structure: .95, token_load: .3 },
  parallel: { classes: ["deep_research", "grounded_answer"], kinds: ["deep_research"], cost: .8, latency: .2, freshness: .75, structure: .6, token_load: .8 },
  you: { classes: ["keyword_web", "news_fresh", "grounded_answer"], kinds: ["discovery"], cost: .35, latency: .75, freshness: .8, structure: .3, token_load: .3 },
  apify: { classes: ["local_shopping_maps", "site_map_crawl"], kinds: ["discovery", "crawl"], cost: .5, latency: .3, freshness: .8, structure: .7, token_load: .5 },
  diffbot: { classes: ["entity_kg", "structured_json"], kinds: ["structured"], cost: .6, latency: .6, freshness: .5, structure: 1, token_load: .3 },
};

// Cohort primaries per class (playbook section 7). A small bonus, not a hard rule.
const COHORT_PRIMARY: Partial<Record<QueryClass, string[]>> = {
  semantic_discovery: ["exa"], keyword_web: ["tavily", "brave"], news_fresh: ["tavily", "brave"], local_shopping_maps: ["serpapi"],
  site_extract: ["firecrawl"], site_map_crawl: ["firecrawl"], structured_json: ["linkup"], entity_kg: ["diffbot"],
  premium_domain: ["valyu"], deep_research: ["parallel"], grounded_answer: ["perplexity", "parallel"],
};

// Ladder for each class.
const LADDER_FOR: Record<QueryClass, Ladder> = {
  semantic_discovery: "A", keyword_web: "A", news_fresh: "A", local_shopping_maps: "B", site_extract: "C",
  site_map_crawl: "C", structured_json: "D", entity_kg: "D", premium_domain: "E", deep_research: "F", grounded_answer: "F",
};

export type Classification = {
  query_class: QueryClass;
  ladder: Ladder;
  freshness_need: number;
  structure_need: number;
  synthesis_requested: boolean;
  known_urls: string[];
  domains: string[];
  structured_fields: string[];
  signals: string[];
};

const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const asList = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : [];

// Default quality factors every mandate carries; they say nothing about the query class.
const GENERIC_FACTORS = new Set(["query_relevance", "result_directness", "source_support", "result_specificity", "current_accessibility"]);

function mandateText(r: SearchRequest, m: Mandate) {
  return [m.intent, m.category, r.category_hint ?? "", ...m.factors.filter(f => f.class === "functional" && f.value !== r.query && !GENERIC_FACTORS.has(f.key)).map(f => `${f.key.replace(/_/g, " ")} ${typeof f.value === "string" ? f.value : ""}`)].join(" ").toLowerCase();
}

function factorValue(r: SearchRequest, m: Mandate, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.hasOwn(r.hard_constraints, k)) return r.hard_constraints[k];
    const f = m.factors.find(x => x.key === k && x.value != null);
    if (f) return f.value;
    const c = r.context.find(x => x.key === k && x.value != null);
    if (c) return c.value;
  }
  return undefined;
}

// Classify from the mandate (intent, category, functional factors, constraints), not from
// regex on the raw query alone. The raw query is only a last-resort signal.
export function classifyMandate(r: SearchRequest, m: Mandate): Classification {
  const text = mandateText(r, m);
  const signals: string[] = [];
  const known_urls = [...new Set([
    ...asList(factorValue(r, m, "urls", "known_urls", "url")),
    ...(m.intent.match(URL_RE) ?? []),
    ...(r.query.match(URL_RE) ?? []),
  ].filter(u => { try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; } }))];
  const domains = [...new Set([...asList(factorValue(r, m, "site", "domain", "include_domains")), ...[...r.query.matchAll(/site:([\w.-]+)/g)].map(x => x[1]!)])];
  const structured_fields = asList(factorValue(r, m, "fields", "structured_fields", "schema_fields"));
  const freshRaw = factorValue(r, m, "freshness", "recency", "published_after");
  const freshness_need = freshRaw != null || /\b(latest|today|this week|this month|breaking|news|current|changed|announce)/.test(text) ? 1 : 0.3;
  const synthesis_requested = factorValue(r, m, "synthesis", "deep_research") === true || /\b(deep[- ]research|deep dive|literature review|synthes\w*|(comprehensive|in-depth|detailed) (research )?report|research report|investigat\w*|state of the art|compare and summari[sz]e)/.test(text);
  const structure_need = structured_fields.length ? 1 : /\b(fill|table of|fields?|json|spec sheet|compare .* (price|rating))/.test(text) ? .7 : .2;
  let q: QueryClass;
  const has = (re: RegExp, sig: string) => { if (re.test(text)) { signals.push(sig); return true; } return false; };
  if (known_urls.length && !domains.length) { q = "site_extract"; signals.push("known_urls"); }
  else if (domains.length && has(/\b(changed|crawl|map|all pages|across the site|docs site)/, "site_scope")) q = "site_map_crawl";
  else if (known_urls.length || domains.length) { q = "site_extract"; signals.push("known_domain"); }
  else if (structure_need >= 1) { q = "structured_json"; signals.push("structured_fields"); }
  else if (has(/\b(filings?|10-[kq]|earnings|sec |patents?|clinical trial|journal|peer.review|papers?|academic)/, "premium_corpus")) q = "premium_domain";
  else if (synthesis_requested) { q = "deep_research"; signals.push("synthesis"); }
  else if (has(/\b(company profile|who is|founders? of|headquarter|org chart|entity)/, "entity")) q = "entity_kg";
  else if (has(/\b(near me|nearby|open now|maps?|directions|restaurant|store hours|buy|price|shopping|deliver|under [₹$€£]|deal)/, "local_shopping")) q = "local_shopping_maps";
  else if (freshness_need >= 1) { q = "news_fresh"; signals.push("freshness"); }
  else if (has(/\b(similar|like this|alternatives|concept|ideas|companies|startups|compare|best)/, "semantic")) q = "semantic_discovery";
  else if (has(/\b(what is|answer|explain|summari[sz]e)/, "answer")) q = "grounded_answer";
  else q = "keyword_web";
  if (structure_need >= 1 && q !== "structured_json" && q !== "site_extract") signals.push("structure_overlay");
  return { query_class: q, ladder: LADDER_FOR[q], freshness_need, structure_need, synthesis_requested, known_urls, domains, structured_fields, signals };
}

export type Budget = { max_jobs: number; max_providers_per_job: number; max_extracts: number; token_budget: number; max_extract_chars: number; allow_deep_research: boolean };

export function budgetFor(r: SearchRequest, c: Classification): Budget {
  const l = r.limits as SearchRequest["limits"] & Partial<{ max_jobs: number; max_extracts: number; token_budget: number; allow_deep_research: boolean }>;
  return {
    max_jobs: l.max_jobs ?? 3,
    max_providers_per_job: Math.min(2, l.max_provider_calls),
    max_extracts: l.max_extracts ?? 3,
    token_budget: l.token_budget ?? 6000,
    max_extract_chars: Math.floor(((l.token_budget ?? 6000) * 4) / Math.max(1, l.max_extracts ?? 3)),
    allow_deep_research: l.allow_deep_research ?? c.synthesis_requested,
  };
}

// Provider health: recent errors and daily quota for the routing score and hard fails.
export class ProviderHealth {
  private errors = new Map<string, number[]>();
  private calls = new Map<string, { day: string; n: number }>();
  constructor(private windowMs = 10 * 60_000, private now = () => Date.now()) {}
  record(name: string, ok: boolean) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const c = this.calls.get(name);
    this.calls.set(name, c && c.day === day ? { day, n: c.n + 1 } : { day, n: 1 });
    if (!ok) this.errors.set(name, [...(this.errors.get(name) ?? []), this.now()]);
  }
  private deep = { day: "", n: 0 };
  recordDeepResearch() { const day = new Date(this.now()).toISOString().slice(0, 10); this.deep = this.deep.day === day ? { day, n: this.deep.n + 1 } : { day, n: 1 }; }
  deepResearchToday() { const day = new Date(this.now()).toISOString().slice(0, 10); return this.deep.day === day ? this.deep.n : 0; }
  recentErrors(name: string) {
    const cut = this.now() - this.windowMs;
    const xs = (this.errors.get(name) ?? []).filter(t => t >= cut);
    this.errors.set(name, xs);
    return Math.min(1, xs.length / 3);
  }
  quotaLeft(name: string) {
    const cap = Number(process.env[`QUOTA_${name.toUpperCase()}_PER_DAY`] ?? "");
    if (!Number.isFinite(cap) || cap <= 0) return true;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    const c = this.calls.get(name);
    return !c || c.day !== day || c.n < cap;
  }
}

export type ScoredCandidate = { provider: string; score: number; terms: Record<string, number>; excluded?: string };

// score = fit + freshness + structure - cost - token_load - latency_penalty - recent_errors
// hard fail when disabled, out of quota, blocked by policy, or no capability for the job.
export function scoreCandidates(kind: JobKind, c: Classification, r: SearchRequest, providers: SearchProvider[], health: ProviderHealth): ScoredCandidate[] {
  const allow = new Set(r.provider_allowlist ?? []);
  const blocked = new Set(asList(r.hard_constraints["exclude_providers"]));
  const names = new Set([...providers.map(p => p.name), ...Object.keys(CAPABILITIES)]);
  const byName = new Map(providers.map(p => [p.name, p]));
  const out: ScoredCandidate[] = [];
  for (const name of names) {
    const cap = CAPABILITIES[name] ?? { classes: ["keyword_web"], kinds: ["discovery"], cost: .5, latency: .5, freshness: .5, structure: .3, token_load: .4 } as Capability;
    const p = byName.get(name);
    const fit = cap.classes.includes(c.query_class) ? 1 : cap.classes.includes("keyword_web") && kind === "discovery" ? .4 : 0;
    const terms = {
      fit: +(fit * .5).toFixed(3),
      freshness: +(cap.freshness * c.freshness_need * .15).toFixed(3),
      structure: +(cap.structure * c.structure_need * .15).toFixed(3),
      cost: +(cap.cost * .12).toFixed(3),
      token_load: +(cap.token_load * .08).toFixed(3),
      latency: +((1 - cap.latency) * .05).toFixed(3),
      recent_errors: +(health.recentErrors(name) * .3).toFixed(3),
      cohort: (COHORT_PRIMARY[c.query_class] ?? []).includes(name) ? .06 : 0,
    };
    const score = +(terms.fit + terms.cohort + terms.freshness + terms.structure - terms.cost - terms.token_load - terms.latency - terms.recent_errors).toFixed(3);
    let excluded: string | undefined;
    if (!p) excluded = "no adapter";
    else if (!p.enabled()) excluded = "disabled (no key or circuit open)";
    else if (allow.size && !allow.has(name)) excluded = "policy: not in provider_allowlist";
    else if (blocked.has(name)) excluded = "policy: excluded by hard constraint";
    else if (!health.quotaLeft(name)) excluded = "quota exhausted";
    else if (!cap.kinds.includes(kind)) excluded = `no ${kind} capability`;
    else if (fit === 0) excluded = `no fit for ${c.query_class}`;
    out.push({ provider: name, score, terms, excluded });
  }
  return out.sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0) || b.score - a.score);
}

export type PlannedJob = {
  id: string;
  kind: JobKind;
  query_class: QueryClass;
  ladder: Ladder;
  primary?: string;
  fallback?: string;
  candidates: ScoredCandidate[];
  reason: string;
};

export type JobPlan = { version: 1; classification: Classification; budget: Budget; jobs: PlannedJob[]; notes: string[] };

function pickJob(id: string, kind: JobKind, c: Classification, r: SearchRequest, providers: SearchProvider[], health: ProviderHealth, reason: string, preferred?: string): PlannedJob {
  const candidates = scoreCandidates(kind, c, r, providers, health);
  const usable = candidates.filter(x => !x.excluded);
  let primary = usable[0]?.provider;
  if (preferred && usable.some(x => x.provider === preferred)) primary = preferred;
  const fallback = usable.find(x => x.provider !== primary)?.provider;
  return { id, kind, query_class: c.query_class, ladder: c.ladder, primary, fallback, candidates, reason };
}

// Decompose a mandate into jobs. Discovery -> evidence is the default; known URLs skip
// discovery; structured and premium paths run first where the class calls for them.
export function planJobs(r: SearchRequest, m: Mandate, providers: SearchProvider[], health = new ProviderHealth(), preferredDiscovery?: string): JobPlan {
  const c = classifyMandate(r, m);
  const budget = budgetFor(r, c);
  const jobs: PlannedJob[] = [];
  const notes: string[] = [];
  switch (c.ladder) {
    case "C":
      if (c.query_class === "site_map_crawl") jobs.push(pickJob("crawl", "crawl", c, r, providers, health, "Ladder C: known domain, map/crawl only, no open-web discovery."));
      else if (c.known_urls.length) notes.push("Ladder C: known URLs, discovery skipped; extract only.");
      else jobs.push(pickJob("site_search", "discovery", { ...c, query_class: "keyword_web" }, r, providers, health, "Ladder C: known domain, search restricted to that site.", preferredDiscovery));
      break;
    case "D": {
      const s = pickJob("structured", "structured", c, r, providers, health, "Ladder D: schema path first.");
      if (s.primary) jobs.push(s);
      else { notes.push("Ladder D: no structured provider live; falling back to discovery + extract + fill."); jobs.push(pickJob("discovery", "discovery", { ...c, query_class: "semantic_discovery" }, r, providers, health, "Ladder D fallback: discover then extract and fill ourselves.", preferredDiscovery)); }
      break;
    }
    case "E": {
      jobs.push(pickJob("premium", "premium", c, r, providers, health, "Ladder E: premium corpus first."));
      jobs.push(pickJob("open_web_backup", "discovery", { ...c, query_class: "semantic_discovery" }, r, providers, health, "Ladder E: open-web backup, runs only if the premium job is empty or weak."));
      break;
    }
    case "F": {
      // Deep research is the last resort: run the cheaper discovery ladder first.
      jobs.push(pickJob("discovery", "discovery", { ...c, query_class: "semantic_discovery" }, r, providers, health, "Ladder F: cheaper discovery first; deep research only on escalation.", preferredDiscovery));
      break;
    }
    default:
      jobs.push(pickJob("discovery", "discovery", c, r, providers, health, c.ladder === "B" ? "Ladder B: shopping/local SERP supply." : "Ladder A: discover, triage, extract survivors.", preferredDiscovery));
  }
  // Deep-research gate (playbook cost gate 5, ladder F): on any ladder, a deep-research job is
  // planned only when the mandate asks for synthesis (or the caller explicitly opts in), the
  // daily deep-research cap is not spent, and a provider is live. It still runs only if every
  // cheaper job leaves mandate fit weak, and at most once per search.
  const gate = deepResearchGate(c, budget, health);
  if (gate.open) {
    const d = pickJob("deep_research", "deep_research", { ...c, query_class: "deep_research" }, r, providers, health, "Deep research: one call, only if cheaper jobs fail mandate fit.");
    if (d.primary) { jobs.push(d); notes.push(`Deep research gate open (${gate.reason}).`); }
    else notes.push("Deep research gate open but no deep-research provider live.");
  } else notes.push(`Deep research gate closed (${gate.reason}).`);
  if (c.signals.includes("structure_overlay")) notes.push("Structure requested: survivors are extracted for field fill.");
  const capped = jobs.slice(0, budget.max_jobs);
  if (capped.length < jobs.length) notes.push(`Job cap ${budget.max_jobs} applied.`);
  return { version: 1, classification: c, budget, jobs: capped, notes };
}

export const DEEP_RESEARCH_DAILY_CAP = () => { const n = Number(process.env.DEEP_RESEARCH_PER_DAY ?? "20"); return Number.isFinite(n) && n >= 0 ? n : 20; };
export function deepResearchGate(c: Classification, budget: Budget, health: ProviderHealth): { open: boolean; reason: string } {
  if (!budget.allow_deep_research) return { open: false, reason: c.synthesis_requested ? "caller disallowed" : "no synthesis requested" };
  if (health.deepResearchToday() >= DEEP_RESEARCH_DAILY_CAP()) return { open: false, reason: `daily cap ${DEEP_RESEARCH_DAILY_CAP()} reached` };
  return { open: true, reason: c.synthesis_requested ? "synthesis requested" : "caller opted in" };
}

export type JobRun = { job: string; provider: string; role: "primary" | "fallback" | "escalation"; latency_ms: number; status: string; result_count: number };
export type ExecutedPlan = { results: ProviderResult[]; runs: JobRun[]; fallback_used: string[]; escalated: boolean; skipped: string[] };

export type CallFn = (p: SearchProvider, job: PlannedJob) => Promise<{ status: string; latency_ms: number; results: ProviderResult[] }>;
export type GradeFn = (results: ProviderResult[]) => number;

// Execute: different jobs in parallel, never duplicate discovery. Within a job the primary
// runs first; the fallback runs only on empty or low-grade results. Escalation jobs
// (open-web backup, deep research) run once, only if earlier jobs failed mandate fit.
export async function executePlan(plan: JobPlan, providers: SearchProvider[], call: CallFn, grade: GradeFn, health: ProviderHealth, lowGrade = .25): Promise<ExecutedPlan> {
  const byName = new Map(providers.map(p => [p.name, p]));
  const runs: JobRun[] = [];
  const fallback_used: string[] = [];
  const skipped: string[] = [];
  const escalationIds = new Set(["open_web_backup", "deep_research"]);
  const runOne = async (job: PlannedJob, name: string | undefined, role: JobRun["role"]) => {
    const p = name ? byName.get(name) : undefined;
    if (!p) return [] as ProviderResult[];
    const r = await call(p, job);
    health.record(p.name, r.status === "ok");
    runs.push({ job: job.id, provider: p.name, role, latency_ms: r.latency_ms, status: r.status, result_count: r.results.length });
    return r.results;
  };
  const runJob = async (job: PlannedJob, role: JobRun["role"]) => {
    let res = await runOne(job, job.primary, role);
    if ((res.length === 0 || grade(res) < lowGrade) && job.fallback && plan.budget.max_providers_per_job > 1) {
      fallback_used.push(`${job.id}:${job.fallback}`);
      res = [...res, ...(await runOne(job, job.fallback, "fallback"))];
      // A provider that errored (bad key, 4xx, timeout) spent no useful budget: try the next
      // live candidate once so an auth failure never leaves the user with zero results.
      const lastRun = runs.filter(r => r.job === job.id).at(-1);
      if (res.length === 0 && lastRun && lastRun.status !== "ok") {
        const tried = new Set(runs.filter(r => r.job === job.id).map(r => r.provider));
        const next = job.candidates.find(c => !c.excluded && !tried.has(c.provider) && byName.get(c.provider)?.enabled() && health.quotaLeft(c.provider) && health.recentErrors(c.provider) < 1);
        if (next) { fallback_used.push(`${job.id}:${next.provider}`); res = [...res, ...(await runOne(job, next.provider, "fallback"))]; }
      }
    }
    return res;
  };
  const first = plan.jobs.filter(j => !escalationIds.has(j.id));
  const later = plan.jobs.filter(j => escalationIds.has(j.id));
  let results = (await Promise.all(first.map(j => runJob(j, "primary")))).flat();
  let escalated = false;
  let backupUsed = false, deepUsed = false;
  for (const job of later) {
    const weak = results.length === 0 || grade(results) < lowGrade;
    const allowed = job.id === "deep_research" ? !deepUsed : !backupUsed;
    if (weak && allowed) {
      escalated = true;
      if (job.id === "deep_research") { deepUsed = true; health.recordDeepResearch(); } else backupUsed = true;
      results = [...results, ...(await runJob(job, "escalation"))];
    } else skipped.push(`${job.id}: ${weak ? "escalation already used" : "earlier jobs met mandate fit"}`);
  }
  return { results, runs, fallback_used, escalated, skipped };
}
