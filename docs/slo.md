# Service levels (v1 targets)

These are the targets the harness is held to. They are not yet enforced by alerting. Measured
numbers come from the Sep 24, 2026 overnight live checks against production (Render, mirror 8e0ea9d).

| Surface | Metric | Target | Measured (Sep 24) |
|---|---|---|---|
| `/v1/search`, MCP `personalized_web_search` | Availability (non-5xx) | 99.5% monthly | Was 0% for the static key until the 500 fix (ec75e96) |
| Same | p50 latency, ladder A/B | under 4 s | 2.6-4.6 s |
| Same | p95 latency, all ladders | under 15 s | Up to 16 s on ladder E before the 4 s extraction limit; 6.5 s after |
| Same | Zero-result rate on answerable queries | under 2% | One 0-result run from a Tavily 401; fixed by error fallback |
| Mandate writer | LLM path used (not heuristic fallback) | 99% | 0% - Gemini project blocked (403) |
| Mandate eval (24 labeled cases) | Functional recall | 0.85 or better | 0.00 (heuristic fallback) |
| Mandate eval | Invented psychological factors | 0 cases | 0 |
| Mandate eval | Question accuracy | 0.90 or better | 0.83 |
| Provider calls | Per-provider timeout | 8 s search, 4 s per extracted page | Enforced in code |

## How each number is measured
- Availability and latency: Render request logs (`responseTime`, `statusCode`) for `/v1/search` and `/mcp`.
- Zero-result rate: `route[].result_count` summed per episode, from stored episodes.
- Mandate fallback: `limitations` contains "Mandate writer fell back to heuristic".
- Mandate eval: `POST /v1/admin/eval/mandate` (admin key) or `npm run eval:mandate`.

## Error budget policy
If availability or p95 latency misses target for 2 days in a week, feature work pauses until the
cause is fixed and a regression test exists.
