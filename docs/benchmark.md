# Live benchmark (item 21)

Run: `POST /v1/admin/eval/benchmark` (admin key; body `{"concurrency":3,"only":["R01",...]}`).
It sends the 28 routing cases (`eval/routing-cases.json`) through the production harness and live
providers with deep research off, and reports per query class. Run it in chunks of about 5 cases per request;
the whole set in one request can exceed the connection timeout.

## Run 1 - Sep 24, 2026, ~2:57 AM IST (production, static key)

Live providers: exa, serpapi, valyu, firecrawl, jina (tavily 401, serper 403, perplexity deep-research only).
Mandate writer: heuristic (Gemini project blocked, 403).

| Metric | Value |
| --- | --- |
| Cases | 28 |
| Non-empty result sets | 28 / 28 |
| Query class accuracy | 1.00 |
| Latency p50 / p95 | 1.9 s / 5.9 s |
| Top-3 labelled "supported" | 6% |
| Mean top-3 mandate fit | 0.41 |
| Searches with a fallback | 3 (serper 403 on 2 shopping cases) |

Primary provider used: serpapi 9, exa 8, valyu 5, serper 2 (failed, fell back), firecrawl 2, known URL 2.

Per class (n, p50, top-3 supported share, top-3 fit): semantic_discovery 5, 2.0 s, 0.07, 0.47;
local_shopping_maps 5, 1.5 s, 0.00, 0.28; premium_domain 5, 2.5 s, 0.07, 0.56; news_fresh 3, 1.5 s,
0.00, 0.34; site_extract 3, 1.5 s, 0.22, 0.29; keyword_web 2, 5.0 s, 0.17, 0.47; site_map_crawl 1, 6.5 s;
structured_json 1, 1.8 s; entity_kg 1, 1.1 s; deep_research 1, 1.3 s; grounded_answer 1, 2.1 s.

What this says:
- Routing and coverage hold: every class routes as designed and returns results.
- Faithfulness is the weak metric. Only the top 3 extracted pages are graded, and the grader is the
  strict deterministic one while the LLM judge is blocked, so most top-3 results stay "partial" or
  "unverified". This is a labelling ceiling as much as a quality signal.
- Shopping/local mandate fit (0.28) is the lowest class. SERP shopping snippets are short; the
  heuristic mandate has few functional factors to match.
- Serper's rejected key cost two fallbacks. Since this run, a 401/403 keeps a provider out for an hour.

Limits: relevance is proxied by mandate fit and faithfulness labels, not human judgments. One run, no
repeats, no per-provider head-to-head (needs more live keys).
