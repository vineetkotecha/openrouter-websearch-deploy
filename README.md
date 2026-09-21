# divAIne Search Harness

A production-shaped, open search control plane for AI agents. It turns a consumer search request and permitted context into an inspectable mandate, translates that mandate across search providers, normalizes and deduplicates results, ranks source records against the mandate, preserves provenance, and captures downstream outcomes.

## What is here

- MCP-first `personalized_web_search` tool
- authenticated HTTP control-plane endpoints
- dynamic mandate writing with Gemini 2.5 Flash and a deterministic fallback
- ten adapter slots: Tavily, Exa, Brave, Serper, SerpApi, Google Programmable Search, Perplexity, Jina, Firecrawl and Gemini Deep Research
- bounded parallel fan-out, normalization, canonical-URL deduplication and baseline reranking
- permission-aware `needs_input` response for the one-question human fallback
- outcome contract, 30-day retention semantics, Postgres schema, containers and CI
- architecture decisions in `docs/adr`

This is not a crawler, a search index, or a general answer generator. It returns ranked resources with evidence state so the calling agent owns answer composition.

## Quick start

Requires Node 22.

```bash
cp .env.example .env
npm ci
npm test
npm run build
npm run dev            # MCP over stdio
npm run dev -- --http  # HTTP on :8787
```

No provider key is required to build or test. Runtime persistence uses a cloud `DATABASE_URL`; the production value belongs in a deployment secret manager. Add free-tier search keys to enable adapters. Never commit `.env`.

## HTTP

All non-health endpoints require `Authorization: Bearer <key>`. Development defaults map `dev-key` to tenant `local`; replace `DIVAINe_API_KEYS` outside local development.

```bash
curl -s http://localhost:8787/v1/search \
  -H 'authorization: Bearer dev-key' \
  -H 'content-type: application/json' \
  -d '{
    "query":"quiet laptop for shared office work",
    "tenant_id":"local",
    "user_id":"opaque-user-1",
    "permissions":{"may_pull_context":true,"may_ask_user":false,"may_retain":true},
    "context":[{"key":"budget","value":"under 1200 USD","source":"caller","confidence":1}]
  }'
```

If a material gap remains and `may_ask_user` is true, the response status is `needs_input` with exactly one question and a resumable token. Otherwise it searches with explicit limitations.

## MCP configuration

```json
{
  "mcpServers": {
    "divaine-search": {
      "command": "node",
      "args": ["/absolute/path/openrouter-websearch/dist/cli.js"],
      "env": {"GEMINI_API_KEY": "...", "TAVILY_API_KEY": "..."}
    }
  }
}
```

## Security and data behavior

- API keys are tenant-scoped at ingress. Production deployments should inject them from a secret manager.
- Provider credentials are read from process environment and are never stored in episode records.
- Context use is explicit and evidence-tagged. Human questions are permission-gated.
- Data retention defaults to 30 days. Cross-tenant learning is off by default.
- Provider output is untrusted data. The baseline core ranks metadata and snippets; future page extraction must be sandboxed, size-limited and protected against SSRF before use.

## Current implementation boundary

Gemini Deep Research has an adapter slot but deliberately returns no results until its asynchronous research API lifecycle is wired against a confirmed key/project. Gemini reranking currently falls back to deterministic scoring if the model call is absent or fails. The Postgres schema is deployed to the managed Neon project in Singapore. The in-memory store exists only for isolated tests; production requires `DATABASE_URL`. The next unit is resume handling, deployment, dashboard persistence and source-page faithfulness verification.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Hosted MCP

The production-compatible MCP endpoint is `https://divaine-search-harness.onrender.com/mcp`. It uses Streamable HTTP and the same bearer API key as REST.

Claude/OpenAI-compatible MCP configuration:
```json
{
  "mcpServers": {
    "divaine-search": {
      "url": "https://divaine-search-harness.onrender.com/mcp",
      "headers": {"Authorization": "Bearer dv_REPLACE_WITH_YOUR_KEY"}
    }
  }
}
```
The hosted endpoint was validated with the official Model Context Protocol TypeScript client: initialize, list tools and `personalized_web_search` all complete remotely.
