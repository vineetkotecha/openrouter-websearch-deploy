# API contract

## `POST /v1/search`

Required: `query`, `tenant_id`. Optional opaque user/session handles, category hint, hard constraints, evidence-tagged pushed context, permission flags and latency/fan-out/result limits.

The response is either:

- `needs_input`: one material question, an episode ID and resume token. The calling agent owns display and consent.
- `complete`: immutable mandate v1, ranked normalized resource records, provider route metadata, limitations and optional retention deadline.

Scores are calibrated to `[0,1]`. The baseline ranker is lexical and deterministic. `unverified` or `partial` evidence states must not be described as verified claims.

## `POST /v1/outcomes`

Accepts `viewed`, `selected`, `rejected`, `refined`, `converted`, `returned` and `failed`. `event_id` deduplicates reports. Money values are optional and should not contain payment details.

## Tenant rule

The bearer key resolves to one tenant. Its tenant must exactly match `tenant_id`; mismatches return 403. User and session handles are opaque and never merged across tenants.
