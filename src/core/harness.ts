import { nineStageTrace, type TraceEvent } from "./trace.js";
import { randomUUID } from "node:crypto";
import { fallbackManifest, type ModelManifest, type AuditVerdict } from "./architecture.js";
import { curateParameters, curatedRequest } from "./parameter-curation.js";
import { fallbackIntentFormation, hotelPropertySearch, validatedIntentRequirements } from "./intent-formation.js";
import { jevRerank } from "./jev-rerank.js";
import type { Config } from "../config.js";
import type { ProviderResult, SearchRequest, SearchResponse } from "../contracts/search.js";
import type { MandateWriter } from "./mandate.js";
import type { SearchProvider } from "../providers/base.js";
import { rank } from "./rank.js";
import {gateResults} from "./eligibility.js";
import { extractSurvivors } from "./verify.js";
import { fillSummary } from "./fill.js";
import { heuristicGaps, canonicalContextKey, contextRequest, contextUsed, formProviderQuery, type ContextRequest } from "./context-pull.js";
import type { LlmJudge } from "./faithfulness.js";
import {requiredSearchArea,requiredQueryTerms,purposeTerms,validatedFinalQuery} from "./final-query.js";import { routeSubqueries } from "./jev-router.js";
import { executePlan, planJobs, ProviderHealth, type PlannedJob } from "./jobs.js";

export interface EpisodeStore { save(x: { id: string; tenantId: string; request: SearchRequest; response: SearchResponse; mandate?: unknown; expiresAt: Date; principal?: unknown; surface?: string; startedAt?: number }): Promise<void>; outcome(x: unknown): Promise<void> }
export class MemoryStore implements EpisodeStore { episodes = new Map<string, unknown>(); async save(x: any) { this.episodes.set(x.id, x) } async outcome(x: unknown) { this.episodes.set(randomUUID(), x) } }

export type HarnessOptions = { fetcher?: typeof fetch; health?: ProviderHealth; judge?: LlmJudge };
// One clarifying question, asked only when the caller allows it and a pending store is wired.
export type AskFn = (x: { episode_id: string; request: SearchRequest; question: string; gap: string; gaps: string[]; principal?: unknown }) => Promise<{ resume_token: string } | null>;
export type NeedsInput = { status: "needs_input"; kind:"user_question"; episode_id: string; question: string; gap: string; gaps?: string[]; resume_token: string; expires_in: number };

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
    const traceEvents:TraceEvent[]=[];
    const record=(stage:string,data:unknown)=>{traceEvents.push({stage,data,elapsed_ms:Date.now()-startedAt});meta?.trace?.(stage,data)};
    const finish=<T extends SearchResponse|NeedsInput|ContextRequest>(out:T):T=>({...out,trace:nineStageTrace(traceEvents,out.status)});
    const activeRequest={...request,context:request.context.filter(c=>(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(canonicalContextKey(c.key)!=="location"||!c.observed_at||Date.now()-Date.parse(c.observed_at)<15*60_000))};
    record('1_request', {query:request.query, tenant_id:request.tenant_id, caller_fill_complete:request.caller_fill_complete,curation_revision_of:request.curation_revision_of, context:contextUsed(activeRequest),permissions:request.permissions,limits:request.limits});
    const intent=await this.writer.form?.(activeRequest)??fallbackIntentFormation(activeRequest);
    record('1a_prefill_query_formation',{...formProviderQuery(activeRequest,"pre_fill"),intent});
    const baseline = curateParameters(activeRequest, undefined, request.curation_revision_of,intent);
    record("1_baseline_parameters",baseline);
    // A local search with no search area cannot retrieve anything honestly.
    // Stop after understanding, before spending a second model round on
    // preferences that cannot change this prerequisite.
    const area=baseline.parameters.find(p=>p.class==='functional'&&p.key==='location');
    if(intent.answer_unit==='local_business'&&area?.state!=='resolved'){
      const question=area?.question??'Which city or area should I search?';
      const requested_context=[{key:'location',why:'A local result needs a search area.',accepted_sources:request.caller_fill_complete?['human' as const]:['caller' as const,'prior_outcome' as const],scope:request.permissions.scopes.length?request.permissions.scopes:['this_search']}];
      if(request.permissions.may_pull_context&&!request.caller_fill_complete){
        const out:ContextRequest={status:'needs_input',kind:'context_request',episode_id,gap:'location',question:'Check whether the caller knows the city or area for this search.',requested_context,how_to_answer:'Return a sourced area if permitted; otherwise call again with caller_fill_complete:true.',curation_id:baseline.id};
        record('3_caller_context_request',out);return finish(out);
      }
      if(request.permissions.may_ask_user&&request.permissions.may_retain&&this.ask){
        const pending=await this.ask({episode_id,request,question,gap:'location',gaps:['location'],principal:meta?.principal}).catch(()=>null);
        if(pending){record('5_user_question',{gaps:['location'],question});return finish({status:'needs_input',kind:'user_question',episode_id,question,gap:'location',gaps:['location'],resume_token:pending.resume_token,expires_in:86400});}
      }
      const out:ContextRequest={status:'needs_input',kind:'user_question',episode_id,gap:'location',question,requested_context:[{...requested_context[0]!,accepted_sources:['human']}],how_to_answer:'Ask for the area only if permitted. Supply an evidenced answer with caller_fill_complete:true; no provider was called.',curation_id:baseline.id,remaining_user_question:question};
      record('5_user_question_or_incomplete',out);return finish(out);
    }
    const firstPass = await (this.writer.parameters?.(activeRequest,intent,baseline)??Promise.resolve(fallbackManifest(baseline)));
    record('1b_parameter_curation_first_pass', firstPass);
    // Stage 5 asks the calling agent to inspect only its own permitted context.
    // No mandate is written until the two fill stages are finished.
    const curated=firstPass;
    const understoodOrder=validatedIntentRequirements(activeRequest,intent).map(x=>canonicalContextKey(x.key));
    const missing=curated.parameters.filter(p=>p.state!=="resolved"&&p.allowed_uses.includes("ask"));
    // First-stage requirements outrank model-produced extras, regardless of the
    // second-stage percentage weights. Never ask duplicate canonical keys.
    missing.sort((a,b)=>{
      const ai=understoodOrder.indexOf(canonicalContextKey(a.key)),bi=understoodOrder.indexOf(canonicalContextKey(b.key));
      return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);
    });
    const distinctMissing=[...new Map(missing.map(p=>[`${p.class}:${canonicalContextKey(p.key)}`,p])).values()];
    const necessary=distinctMissing.filter(p=>p.compulsory);
    const optional=distinctMissing.filter(p=>!p.compulsory);
    record('2_initial_parameter_curation',{manifest:curated,missing:distinctMissing.map(p=>p.key)});
    if(necessary.length&&request.permissions.may_pull_context&&!request.caller_fill_complete){
      const first=necessary[0]!;const out=contextRequest(episode_id,{key:first.key,question:first.question??`What should I know about ${first.key.replace(/_/g," ")}?`},request);
      out.requested_context=necessary.map(p=>({key:p.key,why:`Check permitted agent context for ${p.key}.`,accepted_sources:["caller" as const,"prior_outcome" as const],scope:request.permissions.scopes.length?request.permissions.scopes:["this_search"]}));
      out.question="Return only permitted agent-known context for the requested parameters.";out.curation_id=curated.id;
      out.how_to_answer="Caller context stage only. Do not ask the user here. Supply evidenced agent-known values, then call again with caller_fill_complete:true to grade any remainder.";
      record('3_caller_context_request',out);return finish(out);
    }
    record('4_grade_after_agent_fill',{necessary:necessary.map(p=>p.key),good_to_have:optional.map(p=>p.key)});
    if(necessary.length){
      const first=necessary[0]!,questions=await (this.writer.questions?.(activeRequest,{...curated,parameters:[...necessary,...curated.parameters.filter(p=>!necessary.includes(p))]})??Promise.resolve(necessary.map(p=>p.question||`What should I know about ${p.key.replace(/_/g," ")}?`)));
      const question=questions.join(" "),gaps=necessary.map(p=>p.key);
      // A necessary user question must be handled via the caller. Neither an
      // unavailable resume store nor a declined question licenses retrieval.
      if(request.permissions.may_ask_user&&request.permissions.may_retain&&this.ask){
        const pending=await this.ask({episode_id,request,question,gap:first.key,gaps,principal:meta?.principal}).catch(()=>null);
        if(pending){record('5_user_question',{gaps,question});return finish({status:"needs_input",kind:"user_question",episode_id,question,gap:first.key,gaps,resume_token:pending.resume_token,expires_in:86400});}
      }
      const out:ContextRequest={status:"needs_input",kind:"user_question",episode_id,gap:first.key,question,requested_context:necessary.map(p=>({key:p.key,why:"Necessary after caller context was checked.",accepted_sources:["human"],scope:request.permissions.scopes.length?request.permissions.scopes:["this_search"]})),how_to_answer:"The calling agent may ask the user only if its own authority allows it. Return evidenced human answers and caller_fill_complete:true; otherwise report the search incomplete. No providers were called.",curation_id:curated.id,remaining_user_question:question};
      record('5_user_question_or_incomplete',out);return finish(out);
    }
    const effective=curatedRequest(activeRequest,curated);
    const finalMandate=await this.writer.write(effective,curated);
    if(curated.generation==="fallback")record("parameter_generation_fallback",{reason:curated.fallback_reason??"Gemini parameter generation unavailable or invalid; deterministic baseline used"});
    if(intent.strategy==="across_categories")finalMandate.category="general_consumer_search";
    for(const p of curated.parameters.filter(p=>p.class==="psychological"&&p.state==="resolved"&&p.source==="query")){
      if(finalMandate.factors.some(f=>f.key===p.key&&f.class==="psychological"))continue;
      finalMandate.factors.push({key:p.key,class:"psychological",description:`Use the stated ${p.key.replace(/_/g," ")} to rank otherwise eligible results.`,value:p.value,weight:p.priority/100,confidence:1,hard:false,evidence:[{source:"query",reference:p.evidence[0]?.reference}]});
    }
    record('6_final_mandate_after_fill',{mandate:finalMandate,curation_id:curated.id});
    const fillDecision={ask:[],defaults:optional.map(p=>({key:p.key,reason:"Good-to-have parameter absent; do not infer it"})),stale:curated.parameters.filter(p=>p.state==="stale").map(p=>p.key)};
    // The final query is model-written after fill. Validate the area before any
    // decomposition; model-generated job queries cannot erase that area either.
    const formed=formProviderQuery(effective,"post_fill",intent.answer_unit);
    const requiredArea=requiredSearchArea(effective,intent);
    const requiredTerms=[...requiredQueryTerms(effective),...purposeTerms(effective)];
    let finalQuery=formed.provider_query;
    if(this.writer.finalQuery){
      try {finalQuery=validatedFinalQuery(await this.writer.finalQuery(effective,intent,curated,formed.provider_query),formed.provider_query,requiredArea,requiredTerms)}
      catch { /* deterministic safe fallback stays visible in the trace */ }
    }
    record('5a_postfill_query_formation',{...formed,final_query:finalQuery,model_written:finalQuery!==formed.provider_query});
    const plan = planJobs(effective, finalMandate, this.providers, this.health, undefined, curated);
    const queryRequest={...effective,query:finalQuery};
    try { const proposed=plan.jobs.length?await this.writer.decompose?.(queryRequest,finalMandate,plan.jobs.map(j=>({id:j.id,query:finalQuery})),intent):undefined;if(proposed)for(const job of plan.jobs)if(proposed[job.id])job.query=validatedFinalQuery(proposed[job.id],finalQuery,requiredArea,requiredTerms); } catch {plan.notes.push("Gemini decomposition unavailable; retained final query for capability-based job plan.");}
    const branchQueries=intent.strategy==="across_categories"&&!effective.context.some(c=>canonicalContextKey(c.key)==="intent_category")?intent.search_branches:[];
    if(branchQueries.length){
      const first=plan.jobs.find(j=>j.kind==="discovery");
      if(first){
        const allowed=Math.min(branchQueries.length,Math.max(1,plan.budget.max_jobs));
        const branches=Array.from({length:allowed},(_,i)=>({...first,id:`category_${i+1}`,query:validatedFinalQuery(branchQueries[i]!.query,finalQuery,requiredArea,requiredTerms),reason:`Explore ${branchQueries[i]!.category} without presuming a single category.`,priority:80}));
        plan.jobs=[...branches,...plan.jobs.filter(j=>j!==first)].slice(0,plan.budget.max_jobs);
      }else plan.notes.push("Ambiguous category: no discovery-capable job; category branches were not searched.");
    }
    for(const job of plan.jobs)job.query=validatedFinalQuery(job.query,finalQuery,requiredArea,requiredTerms);
    const decisions=await routeSubqueries(effective,finalMandate,plan.jobs.map(j=>({id:j.id,query:j.query!,candidates:j.candidates})));
    for(const [i,job] of plan.jobs.entries()){
      const decision=decisions[i]!;
      if(decision.selected){job.primary=decision.selected;job.fallback=job.candidates.find(c=>!c.excluded&&c.provider!==decision.selected)?.provider;}
      job.routing_policy=decision.policy;
      record('7_subquery_route',{job:job.id,query:job.query,policy:decision.policy,selected:job.primary,candidates:job.candidates});
    }
    record('5_job_plan',plan);
    const deadline = Math.min(this.c.SEARCH_TIMEOUT_MS, request.limits.latency_ms);

    const providerRequest={...effective,query:finalQuery};
    const call = async (p: SearchProvider, job: PlannedJob) => {
      const ctl = new AbortController(), s = Date.now();
      const providerDeadline = p.name === "serpapi" ? Math.min(deadline, 6000) : deadline;
      const t = setTimeout(() => ctl.abort(), providerDeadline);
      const base={...providerRequest,query:job.query??providerRequest.query};
      const req = job.id === "site_search" && plan.classification.domains.length
        ? { ...base, hard_constraints: { ...base.hard_constraints, include_domains: plan.classification.domains } }
        : base;
      try {
        const results = await Promise.race([p.search({ request: req, mandate: finalMandate, signal: ctl.signal }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${p.name} deadline exceeded`)), providerDeadline + 250))]);
        return { status: "ok", latency_ms: Date.now() - s, results };
      } catch (e) { return { status: e instanceof Error ? e.message : "error", latency_ms: Date.now() - s, results: [] as ProviderResult[] }; }
      finally { clearTimeout(t); }
    };
    const grade = (xs: ProviderResult[]) => { const gate=gateResults(effective,finalMandate,xs,intent.answer_unit);const top=rank(finalMandate,gate.retained.map(x=>x.result),3);const score=top.length?top.reduce((a,x)=>a+x.mandate_fit,0)/top.length:0;record("6_provider_grade",{input_count:xs.length,eligible_count:gate.retained.length,excluded:gate.excluded,top:top.map(x=>({url:x.url,mandate_fit:x.mandate_fit})),score});return score; };
    const exec = await executePlan(plan, this.providers, call, grade, this.health);
    record('6_provider_execution',{runs:exec.runs,result_count:exec.results.length,candidates:exec.results.map(x=>({provider:x.provider,url:x.url,title:x.title})),fallback_used:exec.fallback_used,escalated:exec.escalated,skipped:exec.skipped});

    // Known-URL shortcut: the URLs themselves are the candidates; no discovery spend.
    const known: ProviderResult[] = plan.classification.known_urls.map(url => ({ provider: "known_url", url, title: url, snippet: "" }));
    let pool = [...known, ...exec.results];
    const repairRuns:typeof exec.runs = [];
    const limitations: string[] = [];
    // Gemini checks the *entire retrieved pool* against the original query before
    // any shortlist. Failure is explicit; hard eligibility remains a separate gate.
    let audit:AuditVerdict[]=[];
    const runAudit=async(items:ProviderResult[])=>{if(!this.writer.audit||!items.length)return [] as AuditVerdict[];try{return await this.writer.audit(effective,finalMandate,items,intent)}catch{limitations.push("Gemini correctness audit unavailable; source checks and hard gates remain, but the full model audit was not completed.");return [] as AuditVerdict[]}};
    audit=await runAudit(pool);record("6_result_audit",{phase:"initial",verdicts:audit});
    // One bounded repair is attempted only when the first retrieval is empty or
    // every candidate visibly fails the model check, and remaining provider budget allows it.
    const firstGate=gateResults(effective,finalMandate,pool,intent.answer_unit);
    const noViableCandidates=pool.length>0&&firstGate.retained.every(x=>audit.some(v=>v.url===x.result.url&&v.state==="fail"));
    if((!pool.length||noViableCandidates)&&exec.runs.length<request.limits.max_provider_calls){
      const failedProviders=new Set(exec.runs.map(x=>x.provider));
      const repair=plan.jobs.flatMap(j=>j.candidates.filter(c=>!c.excluded&&!failedProviders.has(c.provider)).map(c=>({job:j,provider:c.provider}))).find(x=>this.providers.some(p=>p.name===x.provider&&p.enabled()));
      if(repair){const provider=this.providers.find(p=>p.name===repair.provider)!;const run=await call(provider,repair.job);this.health.record(provider.name,run.status==="ok",run.status);repairRuns.push({job:repair.job.id,provider:repair.provider,role:"fallback",latency_ms:run.latency_ms,status:run.status,result_count:run.results.length});if(run.status==="ok"&&run.results.length){pool=[...pool,...run.results];audit=await runAudit(pool);record("6_result_audit",{phase:"after_repair",verdicts:audit});limitations.push(`One targeted repair used ${repair.provider}; no further repair calls were made.`)}else limitations.push(`One targeted repair with ${repair.provider} did not add results.`)}
    }
    if((!pool.length||noViableCandidates)&&!repairRuns.length&&this.providers.some(p=>p.enabled()))limitations.push("No eligible alternate-provider repair was available within the call budget.");
    // Keep all retrieval records for the one final Jev pass, even model-rejected
    // records. Eligibility determines what can be returned, not what is scored.
    // Staged gate: triage on snippets first, then extract only the survivors.
    const earlyGate=gateResults(effective,finalMandate,pool,intent.answer_unit);
    const eligiblePool=earlyGate.retained.map(x=>x.result);
    const triaged = rank(finalMandate, eligiblePool, Math.max(request.limits.max_results * 2, 10));
    const byCanon = new Map<string, ProviderResult>();
    for (const x of eligiblePool) { if (!byCanon.has(x.url)) byCanon.set(x.url, x); }
    const ordered = triaged.map(t => byCanon.get(t.url)!).filter(Boolean);
    const known_first = [...ordered.filter(x => x.provider === "known_url"), ...ordered.filter(x => x.provider !== "known_url")];
    record('7_triage_and_dedupe',{pool_count:pool.length,eligibility:{retained:earlyGate.retained.length,excluded:earlyGate.excluded},audit,triaged:triaged.map(x=>({rank:x.rank,url:x.url,title:x.title,mandate_fit:x.mandate_fit,faithfulness:x.faithfulness})),ordered_urls:known_first.map(x=>x.url)});
    const { results: extracted, report } = await extractSurvivors(known_first, undefined, { max: Math.max(plan.budget.max_extracts, known.length ? Math.min(known.length, 5) : 0), maxChars: plan.budget.max_extract_chars, tokenBudget: plan.budget.token_budget, fetcher: this.opts.fetcher, judge: this.opts.judge , fields: plan.classification.structured_fields});
    const rest = eligiblePool.filter(x => !known_first.includes(x));
    record('8_extraction',{report,extracted:extracted.map(x=>({provider:x.provider,url:x.url,title:x.title,fields:x.fields})),untriaged_count:rest.length});

    if(branchQueries.length){
      const attempted=exec.runs.filter(run=>run.job.startsWith("category_")).map(run=>branchQueries[Number(run.job.slice(9))-1]?.category).filter(Boolean);
      limitations.push(attempted.length?`Category was not specified; searched across ${[...new Set(attempted)].join(", ")} rather than assuming one.`:"Category was ambiguous, but no provider could search the alternate categories; results may miss whole categories.");
      if(attempted.length<branchQueries.length) limitations.push(`Search budget covered ${attempted.length} of ${branchQueries.length} plausible categories; other categories may be missing.`);
    }
    const anyEnabled = this.providers.some(p => p.enabled());
    if (!anyEnabled && !known.length) limitations.push("No provider key is configured; returning an empty ranked set.");

    if(curated.generation==="fallback"&&this.writer.parameters)limitations.push(`Gemini parameter generation fell back (${curated.fallback_reason??"reason unavailable"}); a limited deterministic set was used.`);
    if(curated.conflicts.length)limitations.push(`Conflicting context was not used: ${curated.conflicts.join(", ")}.`);
    const hardDisagreements=curated.parameters.filter(p=>p.hard&&p.alternatives?.length).map(p=>p.key);
    if(hardDisagreements.length)limitations.push(`Explicit hard constraints took priority over conflicting context: ${hardDisagreements.join(", ")}.`);
    for(const d of fillDecision.defaults) limitations.push(`Defaulted ${d.key}: ${d.reason}.`);
    for(const k of fillDecision.stale) limitations.push(`Stale context ignored: ${k}.`);
    if ((finalMandate as any).fallback_reason) limitations.push(`Mandate writer fell back to heuristic (${(finalMandate as any).fallback_reason}).`);
    for (const n of plan.notes) if (/no .* provider live/i.test(n)) limitations.push(n);
    if(hotelPropertySearch(effective))limitations.push("Hotel date-specific prices, room availability and discounts remain unverified unless backed by a dated booking quote.");
    if(report.failed_fetch)limitations.push(`${report.failed_fetch} of ${report.attempted} source pages could not be fetched; their claims were not verified.`);
    if(report.unverified)limitations.push(`${report.unverified} extracted sources remained unverified.`);
    if(/\b(?:Jain|without onion|without garlic|no onion|no garlic)\b/i.test(request.query))limitations.push('Ingredient lists and preparation were not independently checked for Jain or onion/garlic restrictions; verify the full recipe before use.');
    if(/\bpeer.reviewed\b/i.test(request.query))limitations.push('Peer-review status was not checked against a journal or proceedings record; repository pages alone do not prove it.');
    if(/\b(?:buy|available|under [₹$€£]|price)\b/i.test(request.query))limitations.push('Current price, stock and purchasability were not verified against a merchant listing.');
    if(/\b(?:latest|open now|today|current)\b/i.test(request.query))limitations.push('Freshness, current hours or publication date were not independently verified.');
    // Audit the full pool again with extracted source evidence, not only snippets.
    // Keep records that failed early triage in the audit; they cannot be promoted by it.
    const extractedByUrl=new Map(extracted.map(x=>[x.url,x]));
    const auditInputs=pool.map(x=>extractedByUrl.get(x.url)??x);
    const sourceAudit=extractedByUrl.size?await runAudit(auditInputs):[];
    if(sourceAudit.length){const previous=new Map(audit.map(v=>[v.url,v]));audit=sourceAudit.map(v=>previous.get(v.url)?.state==="fail"&&v.state!=="fail"&&!(previous.get(v.url)!.reason.startsWith("Temporal contradiction was not established"))?{...v,state:"fail" as const,reason:`First-pass audit failed: ${previous.get(v.url)!.reason}; post-extraction: ${v.reason}`}:v)}
    const firstJob = plan.jobs[0];
    const lateGate=gateResults(effective,finalMandate,[...extracted, ...rest],intent.answer_unit);
    const verification=new Map(lateGate.retained.map(x=>[x.result.url,x.verification]));
    // The audit sees the complete retrieved pool, not a preselected top-eight shortlist.
    const veto=new Set(audit.filter(x=>x.state==="fail").map(x=>x.url));
    const uncertain=audit.filter(x=>x.state==="uncertain").length;
    if(uncertain)limitations.push(`${uncertain} source candidates had uncertain Gemini verdicts; they were not treated as verified.`);
    const rankedAll=[...new Map([...extracted,...rest,...pool.filter(x=>earlyGate.excluded.some(e=>e.url===x.url))].map(x=>[x.url,x])).values()].flatMap(x=>rank(finalMandate,[x],1));
    const allowed=new Set(lateGate.retained.map(x=>x.result.url).filter(url=>!veto.has(url)));
    const initialRank=rankedAll.map(x=>allowed.has(x.url)?x:{...x,faithfulness:{state:"unverified" as const,score:x.faithfulness.score}});
    record('9_initial_rank',initialRank);
    const eligibleForJev=initialRank.filter(x=>allowed.has(x.url));
    const reranked=await jevRerank(effective,finalMandate,eligibleForJev);
    if(reranked.reason!=="reranked")limitations.push(`Jev rerank not completed: ${reranked.reason}.`);
    record('10_jev_rerank',reranked);
    const response: SearchResponse = {
      status: "complete", episode_id,
      results: reranked.results.filter(x=>allowed.has(x.url)).slice(0,5).map(x=>({...x,verification:verification.get(x.url)??{},citations:[{url:x.url,claim:x.title,support:x.faithfulness.state,kind:"source_claim" as const}]})),
      route: [...exec.runs,...repairRuns].map(x => ({ provider: x.provider, latency_ms: x.latency_ms, status: x.status, result_count: x.result_count })),
      limitations,
      route_decision: {
        task_class: plan.classification.query_class,
        policy: firstJob?.routing_policy ? `jobs-v1+${firstJob.routing_policy}` : "jobs-v1",
        candidates: (firstJob?.candidates ?? []).map(x => ({ provider: x.provider, score: x.score, reason: x.excluded ? `excluded: ${x.excluded}` : Object.entries(x.terms).map(([k, v]) => `${k} ${v}`).join(", ") })),
        selected: [...new Set([...exec.runs,...repairRuns].map(x => x.provider))],
      },
      retention_until: request.permissions.may_retain ? new Date(Date.now() + 30 * 864e5).toISOString() : undefined,
      plan: {
        version: 1, query_class: plan.classification.query_class, ladder: plan.classification.ladder, signals: plan.classification.signals,
        budget: plan.budget, jobs: plan.jobs.map(j => ({ id: j.id, kind: j.kind, query:j.query, routing_policy:j.routing_policy, primary: j.primary, fallback: j.fallback, reason: j.reason, priority:j.priority, factor_keys:j.factor_keys, candidates: j.candidates })),
        runs: [...exec.runs,...repairRuns], fallback_used: exec.fallback_used, escalated: exec.escalated, skipped: exec.skipped,
        known_urls: plan.classification.known_urls, extraction: report, context: contextUsed(effective), curation:curated, eligibility:{excluded:[...earlyGate.excluded,...lateGate.excluded],retained:allowed.size,audit}, formation:{first:firstPass.formed_query,post:finalQuery,revision_of:request.curation_revision_of,used_keys:formed.context_keys}, gaps: finalMandate.gaps.map(g => ({ key: g.key, material: g.material })), fill: plan.classification.structured_fields.length ? fillSummary(plan.classification.structured_fields, extracted.map(x => (x as any).fields)) : undefined, notes: [...plan.notes,...fillDecision.defaults.map(x=>`default:${x.key} - ${x.reason}`),`jev_rerank: ${reranked.successful}/${reranked.attempted}; ${reranked.reason}; ${reranked.latency_ms} ms; tokens ${reranked.usage.input_tokens}/${reranked.usage.output_tokens}`],
      },
    };
    response.trace=nineStageTrace(traceEvents,response.status);
    record('11_response',{status:response.status,episode_id:response.episode_id,result_count:response.results.length});
    // Storage must never fail a search: record the failure and still return results.
    let stored=false;
    if (request.permissions.may_retain) await Promise.resolve().then(() => this.store.save({ id: episode_id, tenantId: request.tenant_id, request, response, mandate: finalMandate, principal: meta?.principal, surface: meta?.surface, startedAt, expiresAt: new Date(Date.now() + 30 * 864e5) })).then(()=>{stored=true}).catch(e => { console.error("episode save failed", String((e as Error)?.message ?? e).slice(0, 200)); response.limitations.push("History and usage were not recorded for this search."); });
    record('12_decision_learning',{episode_id,storage:stored?'retained':'not_retained',outcome:'not_submitted',may_learn:request.permissions.may_learn,learning_update:stored&&request.permissions.may_learn?'awaiting_explicit_outcome':'not_run',reason:stored&&request.permissions.may_learn?'An outcome event will derive and store a tenant-local learning example.':stored?'Learning not permitted.':'No stored episode for a later outcome; no learning update.'});
    return response;
  }
}
