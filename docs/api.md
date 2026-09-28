# API contract

## `POST /v1/search`

Required: `query`, `tenant_id`. Optional opaque user/session handles, category hint, hard constraints, evidence-tagged pushed context, permission flags and latency/fan-out/result limits.

The response is one of:

- `needs_input`, `kind: context_request`: the caller should check its permitted context only, then retry with evidenced values and `caller_fill_complete: true`. No final mandate or retrieval has run.
- `needs_input`, `kind: user_question`: necessary values remain after caller fill. The calling agent owns presenting the question and returning evidenced human answers. A resume token is present only when a pending store and the retention/question permissions allow one. No retrieval has run.
- `complete`: a post-fill internal mandate, up to five ranked source records, per-job subquery routing, limitations and an optional retention deadline.

Scores are calibrated to `[0,1]`. The baseline ranker is lexical and deterministic. `unverified` or `partial` evidence states must not be described as verified claims.

## `POST /v1/outcomes` and MCP `record_search_outcome`

Accepts `viewed`, `selected`, `rejected`, `refined`, `converted`, `returned` and `failed`. `event_id` deduplicates reports. For searches with a builder-owned `user_id`, send the same `end_user_id` with the outcome; otherwise it is rejected rather than attributed to the wrong person. For a retained episode with `may_learn: true`, an accepted outcome rebuilds its tenant-local learning example; retrying a duplicate event can repair a missing derived example. No learned policy is served. Money values are optional and should not contain payment details.

## Tenant rule

The bearer key resolves to one tenant. Its tenant must exactly match `tenant_id`; mismatches return 403. User and session handles are opaque and never merged across tenants.
