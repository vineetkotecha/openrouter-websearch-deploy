#!/usr/bin/env node
// openrouter-websearch: MCP server exposing a `web_search` tool backed by
// OpenRouter's web search (the `:online` model suffix or the `web` plugin).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY is not set. Get a key at https://openrouter.ai/keys");
  process.exit(1);
}

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o:online";
const SITE_URL = process.env.OPENROUTER_SITE_URL || "https://github.com/vineetkotecha/openrouter-websearch";
const APP_NAME = process.env.OPENROUTER_APP_NAME || "openrouter-websearch";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

async function webSearch({ query, model, max_results }) {
  const useModel = model || DEFAULT_MODEL;
  // Models ending in :online get web access from the suffix. Any other model
  // gets the explicit `web` plugin so search works regardless of model choice.
  const body = {
    model: useModel,
    messages: [
      {
        role: "system",
        content:
          "You are a web search assistant. Answer the query using current web results. " +
          "Be concise, lead with the answer, and cite sources as inline links.",
      },
      { role: "user", content: query },
    ],
  };
  if (!useModel.endsWith(":online")) {
    body.plugins = [{ id: "web", max_results: max_results ?? 5 }];
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SITE_URL,
      "X-Title": APP_NAME,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message ?? {};
  const answer = message.content || "(no answer returned)";

  // The web plugin attaches citations as url_citation annotations.
  const citations = (message.annotations || [])
    .filter((a) => a.type === "url_citation" && a.url_citation)
    .map((a) => `- [${a.url_citation.title || a.url_citation.url}](${a.url_citation.url})`);

  const usage = data.usage
    ? `\n\n_tokens: ${data.usage.total_tokens}, cost: $${data.usage.cost ?? "n/a"}_`
    : "";

  return citations.length
    ? `${answer}\n\nSources:\n${citations.join("\n")}${usage}`
    : `${answer}${usage}`;
}

const server = new McpServer({
  name: "openrouter-websearch",
  version: "0.1.0",
});

server.registerTool(
  "web_search",
  {
    title: "Web Search",
    description:
      "Search the web through OpenRouter. Returns a synthesized answer with source links. " +
      "Use for current events, facts, documentation, prices, and anything beyond the model's training data.",
    inputSchema: {
      query: z.string().describe("The search query, phrased as a question or description of what you need."),
      model: z
        .string()
        .optional()
        .describe(
          "OpenRouter model to use (default: env OPENROUTER_MODEL or openai/gpt-4o:online). " +
            "Append :online to any model for web access.",
        ),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max web results the search engine consults (default 5)."),
    },
  },
  async (args) => {
    try {
      const text = await webSearch(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `web_search failed: ${err.message}` }], isError: true };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
