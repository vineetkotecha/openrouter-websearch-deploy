# Job planner (jobs-v1)

The harness turns one mandate into a small set of search jobs instead of one fan-out.
Source: `src/core/jobs.ts`, wired in `src/core/harness.ts`. Plan inputs come from the
provider routing playbook folded into the build plan on 23 Sep 2026.

## Flow

1. **Classify** from the mandate (intent, category, functional factors, hard constraints and
   context), not from the raw query alone. 11 classes: semantic_discovery, keyword_web,
   news_fresh, local_shopping_maps, site_extract, site_map_crawl, structured_json, entity_kg,
   premium_domain, deep_research, grounded_answer. Also computes freshness need, structure
   need, synthesis request, known URLs, domains and requested fields.
2. **Pick a ladder**: A options/compare, B shopping/local, C known site, D structured fields,
   E premium corpora, F deep research.
3. **Decompose** into jobs (discovery, crawl, structured, premium, deep_research) with a
   primary and a fallback each, capped by `max_jobs` (default 3).
4. **Score** each provider per job:
   `fit + cohort + freshness + structure - cost - token_load - latency - recent_errors`.
   Hard fails, recorded as exclusions: no adapter, disabled/circuit open, not in allowlist,
   excluded by hard constraint, daily quota exhausted (`QUOTA_<PROVIDER>_PER_DAY`),
   no capability for the job, no fit for the class.
5. **Execute**: different jobs run in parallel. Inside a job the primary runs first; the
   fallback runs only if the primary is empty or grades below 0.25 mandate fit. At most 2
   providers per job. Escalation jobs (premium open-web backup, deep research) run once and
   only when earlier jobs failed mandate fit.
6. **Staged extraction**: all candidates are triaged on snippets first; only the top
   survivors (`max_extracts`, default 3) are fetched, each truncated so the total stays
   inside `token_budget` (default 6000 tokens). Known URLs skip discovery entirely.
7. **Rank** against the mandate and return the ranked set, best first.

Jev, when configured, nominates the first discovery provider; budgets, hard fails and
fallback stay deterministic.

## Request limits (all optional)

`max_jobs`, `max_extracts`, `token_budget`, `allow_deep_research` under `limits`.

## Trace

Every response carries `plan`: class, ladder, signals, budget, jobs with scored candidates
and exclusion reasons, runs (primary / fallback / escalation), fallback_used, escalated,
skipped jobs, known URLs, extraction report (attempted, extracted, chars, token estimate,
skipped by budget) and notes.

## Faithfulness (faithfulness-v2)

Source: `src/core/faithfulness.ts`. Scored separately from mandate fit.

- Each extracted survivor's snippet is split into claims. Each claim is checked against the
  fetched page with unigram and bigram overlap; any number, price or percentage in the claim
  must appear on the page or the claim can't be "supported".
- Optional LLM judge (`FAITHFULNESS_JUDGE=gemini` plus a Gemini key) gives per-claim
  verdicts. It can lift a paraphrase, but never overrides a number mismatch.
- Grounded answers (Perplexity and other answer engines) are split per cited source; each
  source keeps only the sentences that cite it and starts "unverified" until extraction
  checks it. Answer text never bypasses the check.
- Per-claim results are stored on the result's raw record for the trace and learning loop.
