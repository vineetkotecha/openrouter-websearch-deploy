# openrouter-websearch

An MCP server that gives any agent web search through [OpenRouter](https://openrouter.ai).
One tool in, answers with citations out.

## The tool

**`web_search`**

| Input | Type | Description |
| --- | --- | --- |
| `query` | string (required) | What to search for, in natural language. |
| `model` | string (optional) | OpenRouter model. Defaults to `OPENROUTER_MODEL` or `openai/gpt-4o:online`. |
| `max_results` | int (optional) | How many web results the engine consults (1-20, default 5). |

Returns a synthesized answer with source links, plus token/cost usage when
OpenRouter reports it.

How it works: OpenRouter adds live web search to any chat model, either with
the `:online` model suffix or the `web` plugin. This server picks the right one
automatically, so search works whatever model you point it at.

## Setup

```bash
npm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys
npm start
```

Optional env:

- `OPENROUTER_MODEL` - default model (default `openai/gpt-4o:online`)
- `OPENROUTER_SITE_URL` / `OPENROUTER_APP_NAME` - attribution headers shown on your OpenRouter dashboard

## MCP client config

Claude Desktop / any MCP host:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/path/to/openrouter-websearch/src/index.js"],
      "env": { "OPENROUTER_API_KEY": "sk-or-..." }
    }
  }
}
```

Requires Node.js 18+.
