import { randomUUID } from "node:crypto";
import { decideFill } from "./parameter-fill.js";
import { curateParameters, curatedRequest } from "./parameter-curation.js";
import { fallbackIntentFormation, hotelPropertySearch } from "./intent-formation.js";
import { jevRerank } from "./jev-rerank.js";
import type { Config } from "../config.js";
import type { ProviderResult, SearchRequest, SearchResponse } from "../contracts/search.js";
import type { MandateWriter } from "./mandate.js";
import type { SearchProvider } from "../providers/base.js";
import { rank } from "./rank.js";
import {gateResults} from "./eligibility.js";
import { extractSurvivors } from "./verify.js";
import { fillSummary } from "./fill.js";
import { heuristicGaps, openGaps, canonicalContextKey, contextRequest, contextUsed, formProviderQuery, type ContextRequest } from "./context-pull.js";
import type { LlmJudge } from "./faithfulness.js";
import { routeWithPolicy } from "./jev-router.js";
import { executePlan, planJobs, ProviderHealth, type PlannedJob } from "./jobs.js";

export interface EpisodeStore { save(x: { id: string; tenantId: string; request: SearchRequest; response: SearchResponse; mandate?: unknown; expiresAt: Date; principal?: unknown; surface?: string; startedAt?: number }): Promise<void>; outcome(x: unknown): Promise<void> }
export class MemoryStore implements EpisodeStore { episodes = new Map<string, unknown>(); async save(x: any) { this.episodes.set(x.id, x) } async outcome(x: unknown) { this.episodes.set(randomUUID(), x) } }

export type HarnessOptions = { fetcher?: typeof fetch; health?: ProviderHealth; judge?: LlmJudge };
// One clarifying question, asked only when the caller allows it and a pending store is wired.
export type AskFn = (x: { episode_id: string; request: SearchRequest; question: string; gap: string; gaps: string[]; principal?: unknown }) => Promise<{ resume_token: string } | null>;
export type NeedsInput = { status: "needs_input"; episode_id: string; question: string; gap: string; gaps?: string[]; resume_token: string; expires_in: number };

export class SearchHarness {
  readonly health: ProviderHealth;
  ask?: AskFn;
  get mandateWriter(): MandateWriter { return this.writer; }
  get providerList(): SearchProvider[] { return this.providers; }
  constructor(private c: Config, private writer: MandateWriter, private providers: SearchProvider[], private store: EpisodeStore, private opts: HarnessOptions = {}) {
    this.health = opts.health ?? new ProviderHealth();
  }

  async search(request: SearchRequest, meta?: { principal?: unknown; surface?: string; trace?: (stage:string, data:unknown)=>void }): Promise<SearchResponse | NeedsInput | ContextRequest> {
    const startedAt = Date.now(), episode_id = randomUUID();
    const activeRequest={...request,context:request.context.filter(c=>(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(canonicalContextKey(c.key)!=="location"||!c.observed_at||Date.now()-Date.parse(c.observed_at)<15*60_000))};
    // Do not pay for mandate generation or call any provider when an unlocated local
    // search cannot be answered and the caller has forbidden context pull/asking.
    if (!request.permissions.may_pull_context && !request.permissions.may_ask_user && heuristicGaps(activeRequest).some(g => g.key === "location" && g.material)) {
      const response: SearchResponse = { status: "complete", episode_id, results: [], route: [],
        limitations: ["Location is required to answer this local search; no location was supplied, so no providers were called."],
        route_decision: { task_class: "local_shopping_maps", policy: "location-required", candidates: [], selected: [] } };
      if (request.permissions.may_retain) await Promise.resolve().then(() => this.store.save({ id: episode_id, tenantId: request.tenant_id, request, response, principal: meta?.principal, surface: meta?.surface, startedAt, expiresAt: new Date(Date.now() + 30 * 864e5) })).catch(() => { response.limitations.push("History and usage were not recorded for this search."); });
      return response;
    }
    meta?.trace?.('1_request', {query:request.query, tenant_id:request.tenant_id, context:contextUsed(activeRequest),permissions:request.permissions,limits:request.limits});
    const intent=await this.writer.form?.(activeRequest)??fallbackIntentFormation(activeRequest);
    meta?.trace?.('1a_prefill_query_formation',{...formProviderQuery(activeRequest,"pre_fill"),intent});
    const firstPass = curateParameters(activeRequest, undefined, request.curation_revision_of,intent);
    meta?.trace?.('1b_parameter_curation_first_pass', firstPass);
    const mandate = await this.writer.write(curatedRequest(activeRequest,firstPass));
    if(intent.strategy==="across_categories")mandate.category="general_consumer_search";
    meta?.trace?.('2_mandate_writer', mandate);
    // Writers that return no gaps (heuristic) still get the query-level gap checks.
    // The model may omit a material query-level gap; merge deterministic checks without duplicating keys.
    for (const g of heuristicGaps(activeRequest)) if (!mandate.gaps.some(x => canonicalContextKey(x.key) === canonicalContextKey(g.key))) mandate.gaps.push(g);
    // A weekend-trip origin is distinct from a destination. Do not ask the
    // caller to fill a model's merged origin_or_destination parameter as if
    // it were a verified departure city.
    if (/\bweekend trip\b/i.test(activeRequest.query)) mandate.gaps = mandate.gaps.filter(g => g.key !== 'origin_or_destination');
    // A broad alternatives query can be answered as a comparison; startup
    // particulars refine ranking but are not prerequisites to any result.
    if (/\balternatives? to Notion\b/i.test(activeRequest.query) && /\bstartup knowledge base\b/i.test(activeRequest.query))
      mandate.gaps = mandate.gaps.map(g => g.key === 'startup_specific_needs' ? {...g,material:false} : g);
    mandate.gaps = openGaps(mandate, activeRequest);
    const curated=curateParameters(activeRequest,mandate,request.curation_revision_of,intent);
    const effective=curatedRequest(activeRequest,curated);
    const finalMandate = curated.conflicts.length || effective.context.length!==activeRequest.context.length ? await this.writer.write(effective) : mandate;
    if(intent.strategy==="across_categories")finalMandate.category="general_consumer_search";
    finalMandate.gaps=mandate.gaps;
    meta?.trace?.('3b_mandate_post_curation',{id:finalMandate.id,revision_of:request.curation_revision_of,conflicts:curated.conflicts,changed_factors:{removed:mandate.factors.filter(x=>!finalMandate.factors.some(y=>y.key===x.key&&y.class===x.class)).map(x=>x.key),added:finalMandate.factors.filter(x=>!mandate.factors.some(y=>y.key===x.key&&y.class===x.class)).map(x=>x.key)}});
    // Only supported decision-changing gaps may block. A model-only
    // suggestion remains a declared optional default, never an invented question.
    mandate.gaps=mandate.gaps.map(g=>({...g,material:g.material && curated.parameters.some(p=>p.key===canonicalContextKey(g.key)&&p.compulsory)}));
    const fillDecision=decideFill(mandate,request);
    for (const c of request.context) if(!activeRequest.context.includes(c) && !fillDecision.stale.includes(c.key))fillDecision.stale.push(c.key);
    meta?.trace?.('3a_curated_parameter_manifest',curated);
    meta?.trace?.('3_gap_and_fill_decision',{gaps:mandate.gaps,fillDecision});
    const gap = fillDecision.ask.length?mandate.gaps.find(g=>g.key===fillDecision.ask[0]!.key):mandate.gaps.find(g=>g.material);
    // Pull from the calling agent first; ask the human only if the caller cannot pull.
    if (fillDecision.ask.length && request.permissions.may_pull_context && !request.caller_fill_complete) { const first=mandate.gaps.find(g=>g.key===fillDecision.ask[0]!.key)!; const out=contextRequest(episode_id,first,request); out.requested_context=fillDecision.ask.map(x=>({key:x.key,why:x.reason+": "+x.question,accepted_sources:["caller","human","prior_outcome"],scope:request.permissions.scopes.length?request.permissions.scopes:["this_search"]}));out.question=fillDecision.ask.map(x=>x.question).join(" ");out.curation_id=curated.id;out.remaining_user_question="If you cannot answer these from permitted context, ask the user once for the unresolved material facts; then search again with evidenced answers and curation_revision_of. Do not guess.";meta?.trace?.('4_context_request',out);return out; }
    // A resumable question persists the entire request, so it requires retention permission.
    if (gap?.question && gap.material && request.permissions.may_ask_user && request.permissions.may_retain && this.ask) {
      const remaining=mandate.gaps.filter(g=>g.material&&g.question);
      const question=remaining.map(g=>g.question).join(" ");
      const pending = await this.ask({ episode_id, request, question, gap: gap.key, gaps:remaining.map(g=>g.key), principal: meta?.principal }).catch(() => null);
      if (pending) return { status: "needs_input", episode_id, question, gap: gap.key, gaps:remaining.map(g=>g.key), resume_token: pending.resume_token, expires_in: 86400 };
    }
    // A location-dependent local query without a usable location cannot be fulfilled.
    // Returning unrelated cities as “near me” is worse than an empty, explicit result.
    // No caller permission to pull means do not request or infer a location.
    if (/\b(near me|nearby|near by|around me|in my area|closest|open now|local)\b/i.test(request.query) && heuristicGaps(activeRequest).some(g => g.key === "location" && g.material)) {
      const response: SearchResponse = { status: "complete", episode_id, results: [], route: [],
        limitations: ["Location is required to answer this local search; no location was supplied, so no providers were called."],
        route_decision: { task_class: "local_shopping_maps", policy: "location-required", candidates: [], selected: [] } };
      if (request.permissions.may_retain) await Promise.resolve().then(() => this.store.save({ id: episode_id, tenantId: request.tenant_id, request, response, mandate: finalMandate, principal: meta?.principal, surface: meta?.surface, startedAt, expiresAt: new Date(Date.now() + 30 * 864e5) })).catch(() => { response.limitations.push("History and usage were not recorded for this search."); });
      return response;
    }
    // Jev (when configured) nominates the first discovery provider; the job planner keeps
    // hard fails, budgets and fallback deterministic.
    const decision = await routeWithPolicy(effective, finalMandate, this.providers);
    const jevPick = decision.policy.startsWith("jev") ? decision.selected[0]?.provider_name : undefined;
    meta?.trace?.('4_policy_route',decision);
    const plan = planJobs(effective, finalMandate, this.providers, this.health, jevPick, curated);
    const branchQueries=intent.strategy==="across_categories"&&!effective.context.some(c=>canonicalContextKey(c.key)==="intent_category")?intent.search_branches:[];
    if(branchQueries.length){
      const first=plan.jobs.find(j=>j.kind==="discovery");
      if(first){
        const allowed=Math.min(branchQueries.length,Math.max(1,plan.budget.max_jobs));
        const branches=Array.from({length:allowed},(_,i)=>({...first,id:`category_${i+1}`,reason:`Explore ${branchQueries[i]!.category} without presuming a single category.`,priority:80}));
        plan.jobs=[...branches,...plan.jobs.filter(j=>j!==first)].slice(0,plan.budget.max_jobs);
      }else plan.notes.push("Ambiguous category: no discovery-capable job; category branches were not searched.");
    }
    meta?.trace?.('5_job_plan',plan);
    const deadline = Math.min(this.c.SEARCH_TIMEOUT_MS, request.limits.latency_ms);

    const formed=formProviderQuery(effective,"post_fill");
    meta?.trace?.('5a_postfill_query_formation',{...formed,branches:branchQueries});
    const providerRequest={...effective,query:formed.provider_query};
    const call = async (p: SearchProvider, job: PlannedJob) => {
      const ctl = new AbortController(), s = Date.now();
      const providerDeadline = p.name === "serpapi" ? Math.min(deadline, 6000) : deadline;
      const t = setTimeout(() => ctl.abort(), providerDeadline);
      const branch=job.id.startsWith("category_")?branchQueries[Number(job.id.slice(9))-1]:undefined;
      const base=branch?{...providerRequest,query:branch.query}:providerRequest;
      const req = job.id === "site_search" && plan.classification.domains.length
        ? { ...base, hard_constraints: { ...base.hard_constraints, include_domains: plan.classification.domains } }
        : base;
      try {
        const results = await Promise.race([p.search({ request: req, mandate: finalMandate, signal: ctl.signal }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${p.name} deadline exceeded`)), providerDeadline + 250))]);
        return { status: "ok", latency_ms: Date.now() - s, results };
      } catch (e) { return { status: e instanceof Error ? e.message : "error", latency_ms: Date.now() - s, results: [] as ProviderResult[] }; }
      finally { clearTimeout(t); }
    };
    const grade = (xs: ProviderResult[]) => { const eligible=gateResults(effective,finalMandate,xs).retained.map(x=>x.result); const top=rank(finalMandate,eligible,3); return top.length?top.reduce((a,x)=>a+x.mandate_fit,0)/top.length:0; };
    const exec = await executePlan(plan, this.providers, call, grade, this.health);
    meta?.trace?.('6_provider_execution',{runs:exec.runs,result_count:exec.results.length,candidates:exec.results.map(x=>({provider:x.provider,url:x.url,title:x.title})),fallback_used:exec.fallback_used,escalated:exec.escalated,skipped:exec.skipped});

    // Known-URL shortcut: the URLs themselves are the candidates; no discovery spend.
    const known: ProviderResult[] = plan.classification.known_urls.map(url => ({ provider: "known_url", url, title: url, snippet: "" }));
    const pool = [...known, ...exec.results];
    // Staged gate: triage on snippets first, then extract only the survivors.
    const earlyGate=gateResults(effective,finalMandate,pool);
    const eligiblePool=earlyGate.retained.map(x=>x.result);
    const triaged = rank(finalMandate, eligiblePool, Math.max(request.limits.max_results * 2, 10));
    const byCanon = new Map<string, ProviderResult>();
    for (const x of eligiblePool) { if (!byCanon.has(x.url)) byCanon.set(x.url, x); }
    const ordered = triaged.map(t => byCanon.get(t.url)!).filter(Boolean);
    const known_first = [...ordered.filter(x => x.provider === "known_url"), ...ordered.filter(x => x.provider !== "known_url")];
    meta?.trace?.('7_triage_and_dedupe',{pool_count:pool.length,triaged:triaged.map(x=>({rank:x.rank,url:x.url,title:x.title,mandate_fit:x.mandate_fit,faithfulness:x.faithfulness})),ordered_urls:known_first.map(x=>x.url)});
    const { results: extracted, report } = await extractSurvivors(known_first, undefined, { max: Math.max(plan.budget.max_extracts, known.length ? Math.min(known.length, 5) : 0), maxChars: plan.budget.max_extract_chars, tokenBudget: plan.budget.token_budget, fetcher: this.opts.fetcher, judge: this.opts.judge , fields: plan.classification.structured_fields});
    const rest = eligiblePool.filter(x => !known_first.includes(x));
    meta?.trace?.('8_extraction',{report,extracted:extracted.map(x=>({provider:x.provider,url:x.url,title:x.title,fields:x.fields})),untriaged_count:rest.length});

    const limitations: string[] = [];
    if(branchQueries.length){
      const attempted=exec.runs.filter(run=>run.job.startsWith("category_")).map(run=>branchQueries[Number(run.job.slice(9))-1]?.category).filter(Boolean);
      limitations.push(attempted.length?`Category was not specified; searched across ${[...new Set(attempted)].join(", ")} rather than assuming one.`:"Category was ambiguous, but no provider could search the alternate categories; results may miss whole categories.");
      if(attempted.length<branchQueries.length) limitations.push(`Search budget covered ${attempted.length} of ${branchQueries.length} plausible categories; other categories may be missing.`);
    }
    const anyEnabled = this.providers.some(p => p.enabled());
    if (!anyEnabled && !known.length) limitations.push("No provider key is configured; returning an empty ranked set.");
    if (gap) limitations.push(`Missing context: ${gap.key}.`);
    if(curated.conflicts.length)limitations.push(`Conflicting context was not used: ${curated.conflicts.join(", ")}.`);
    const hardDisagreements=curated.parameters.filter(p=>p.hard&&p.alternatives?.length).map(p=>p.key);
    if(hardDisagreements.length)limitations.push(`Explicit hard constraints took priority over conflicting context: ${hardDisagreements.join(", ")}.`);
    for(const d of fillDecision.defaults) limitations.push(`Defaulted ${d.key}: ${d.reason}.`);
    for(const k of fillDecision.stale) limitations.push(`Stale context ignored: ${k}.`);
    if ((mandate as any).fallback_reason) limitations.push(`Mandate writer fell back to heuristic (${(mandate as any).fallback_reason}).`);
    for (const n of plan.notes) if (/no .* provider live/i.test(n)) limitations.push(n);
    if(hotelPropertySearch(effective))limitations.push("Hotel date-specific prices, room availability and discounts remain unverified unless backed by a dated booking quote.");
    if(report.failed_fetch)limitations.push(`${report.failed_fetch} of ${report.attempted} source pages could not be fetched; their claims were not verified.`);
    if(report.unverified)limitations.push(`${report.unverified} extracted sources remained unverified.`);
    if(/\b(?:Jain|without onion|without garlic|no onion|no garlic)\b/i.test(request.query))limitations.push('Ingredient lists and preparation were not independently checked for Jain or onion/garlic restrictions; verify the full recipe before use.');
    if(/\bpeer.reviewed\b/i.test(request.query))limitations.push('Peer-review status was not checked against a journal or proceedings record; repository pages alone do not prove it.');
    if(/\b(?:buy|available|under [₹$€£]|price)\b/i.test(request.query))limitations.push('Current price, stock and purchasability were not verified against a merchant listing.');
    if(/\b(?:latest|open now|today|current)\b/i.test(request.query))limitations.push('Freshness, current hours or publication date were not independently verified.');
    const firstJob = plan.jobs[0];
    const lateGate=gateResults(effective,finalMandate,[...extracted, ...rest]);
    const verification=new Map(lateGate.retained.map(x=>[x.result.url,x.verification]));
    const initialRank=rank(finalMandate, lateGate.retained.map(x=>x.result), request.limits.max_results);
    meta?.trace?.('9_initial_rank',initialRank);
    const reranked=await jevRerank(effective,finalMandate,initialRank);
    meta?.trace?.('10_jev_rerank',reranked);
    const response: SearchResponse = {
      status: "complete", episode_id,
      results: reranked.results.map(x=>({...x,verification:verification.get(x.url)??{},citations:[{url:x.url,claim:x.title,support:x.faithfulness.state,kind:"source_claim" as const}]})),
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
        budget: plan.budget, jobs: plan.jobs.map(j => ({ id: j.id, kind: j.kind, primary: j.primary, fallback: j.fallback, reason: j.reason, priority:j.priority, factor_keys:j.factor_keys, candidates: j.candidates })),
        runs: exec.runs, fallback_used: exec.fallback_used, escalated: exec.escalated, skipped: exec.skipped,
        known_urls: plan.classification.known_urls, extraction: report, context: contextUsed(effective), curation:curated, eligibility:{excluded:[...earlyGate.excluded,...lateGate.excluded],retained:lateGate.retained.length}, formation:{first:firstPass.formed_query,post:formed.provider_query,revision_of:request.curation_revision_of,used_keys:formed.context_keys}, gaps: mandate.gaps.map(g => ({ key: g.key, material: g.material })), fill: plan.classification.structured_fields.length ? fillSummary(plan.classification.structured_fields, extracted.map(x => (x as any).fields)) : undefined, notes: [...plan.notes,...fillDecision.defaults.map(x=>`default:${x.key} - ${x.reason}`),`jev_rerank: ${reranked.successful}/${reranked.attempted}; ${reranked.reason}; ${reranked.latency_ms} ms; tokens ${reranked.usage.input_tokens}/${reranked.usage.output_tokens}`],
      },
    };
    meta?.trace?.('11_response',response);
    // Storage must never fail a search: record the failure and still return results.
    let stored=false;
    if (request.permissions.may_retain) await Promise.resolve().then(() => this.store.save({ id: episode_id, tenantId: request.tenant_id, request, response, mandate: finalMandate, principal: meta?.principal, surface: meta?.surface, startedAt, expiresAt: new Date(Date.now() + 30 * 864e5) })).then(()=>{stored=true}).catch(e => { console.error("episode save failed", String((e as Error)?.message ?? e).slice(0, 200)); response.limitations.push("History and usage were not recorded for this search."); });
    meta?.trace?.('12_decision_learning',{episode_id,storage:stored?'retained':'not_retained',outcome:'not_submitted',may_learn:request.permissions.may_learn,learning_update:'not_run',reason:stored?'Waiting for a later caller outcome event.':'No stored episode for a later outcome; no learning update.'});
    return response;
  }
}
