# Earned provider capability map

Two different feedback paths:

* Retrieval-quality feedback records what each provider call returned, automatically after a completed search. This is a proxy for usefulness, not user satisfaction.
* Explicit agent/user outcome events keep the existing reward and shadow-policy path. They are not replaced by retrieval grades.

The September 23 Provider Integration & Routing Playbook is the unmeasured planning prior: class taxonomy, provider capability eligibility, cheap discovery, staged extraction, known-URL shortcuts and bounded escalation. Its suggested cohort is not an earned provider ranking. There is no provider-name bonus in the new routing scorer.

## Evidence key and privacy

Provider + query class + answer unit + job kind + actual adapter vertical. Serper/SerpApi shopping and web runs never mix. Product and research grades never mix. Non-SERP adapters use web unless their adapter actually selects a proprietary corpus. Both Jev and its deterministic fallback see matching evidence. Other providers remain eligible without observations.

New grades live in `plan.provider_feedback` in each episode. Postgres reconstructs the map from the last 200 unexpired, learn-enabled episodes for the exact tenant. No global tenant traffic pooling, no private query or page contents in aggregate grades, no separate retention beyond the episode's 30-day expiry. A non-retained or learn-disabled search gets visible current grades but contributes no future learned state. In-memory operation uses the same permissions and expiry checks.

The fixed public benchmark seed has five provider/vertical observations of one laptop query from September 30. It is explicitly labelled benchmark evidence, with n=1, confidence=1/6. It cannot affect news, local restaurants, papers or other unmatched answer types. Its raw retrieval variant is in provenance. It is a test observation, not a guarantee. Actual live calls gradually dominate it.

## Grade and routing

Every actual call, including failures, fallbacks and the bounded repair, gets its own grade:

* Retrieved count, direct-page-shaped count, collection count, discussion count and unknown-shape count.
* Hard-gate eligibility. URL shape alone never means a supported offer or factual truth.
* Source-supported field coverage only for pages actually tested by extraction. Untested pages are unknown, not missing. Borrowing extracted evidence by exact URL is allowed when providers found the same page; ownership of the retrieval remains separate.
* Failure rate and observed latency.
* Existing planning cost estimates labelled estimates, measured costs null when not reported. Neither is described as an invoice.

Confidence is n/(n+5). A bounded, confidence-shrunk adjustment uses success, eligibility, direct-page shape for named-entity requests, tested field coverage and latency. Discussion/collection pages are not inherently bad for research. Jev gets the metrics and sample count next to each eligible option, with instructions to distinguish measured evidence from the capability prior. If Jev is unavailable, the same adjustment changes deterministic ordering. Caller allowlist, provider capabilities, quota, credential status and total call ceiling still hard-gate execution.

## Limits

URL/title classifiers are conservative heuristics and expose unknown shape. Eligibility is not semantic relevance or an independent factual verification. Field coverage is conditioned on triage and extraction budget. Sparse cohorts stay low confidence. Planning prices need billing reconciliation. Mode-specific benchmark differences remain in provenance; adapter APIs may evolve. This map does not claim merchant price/stock verification, solve numeric extraction, or replace explicit outcomes.
