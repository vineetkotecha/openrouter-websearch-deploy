// Provider tool cards (playbook section 4): use / avoid / how we call / stack role.
// A planning catalog; `status` is computed live from the adapters actually loaded.
import type { SearchProvider } from "../providers/base.js";

export type ToolCard = {
  provider: string; group: "discovery" | "extract" | "answer" | "skip";
  stack_role: string; use: string; avoid: string; input: string; output: string; knobs: string[]; risk?: string;
};
export type LiveToolCard = ToolCard & { status: "live" | "disabled" | "no_adapter" | "skip" };

export const TOOL_CARDS: ToolCard[] = [
  { provider: "exa", group: "discovery", stack_role: "primary semantic_discovery", use: "Similar-to, long-tail and conceptual discovery", avoid: "Exact keyword or very fresh news", input: "Neural prose built from the mandate", output: "Links with passages", knobs: ["domains", "date range", "result count"] },
  { provider: "tavily", group: "discovery", stack_role: "workhorse keyword_web / news_fresh", use: "General web and current events", avoid: "Deep long-tail similarity", input: "Keyword query", output: "Links with extracted content", knobs: ["freshness", "domains", "depth"] },
  { provider: "brave", group: "discovery", stack_role: "independent keyword/fresh index", use: "Second opinion on conventional web", avoid: "Excluded for now: card-gated signup", input: "Keyword query", output: "SERP links and snippets", knobs: ["freshness", "country"] },
  { provider: "serper", group: "discovery", stack_role: "budget discovery", use: "Cheap Google-style SERP", avoid: "Anything needing page content", input: "Keyword query", output: "SERP links and snippets", knobs: ["country", "language"] },
  { provider: "serpapi", group: "discovery", stack_role: "local_shopping_maps", use: "Shopping, maps/local and news verticals", avoid: "Semantic discovery", input: "Keyword query plus engine and location", output: "Organic, shopping, local and news arrays", knobs: ["engine", "location", "tbs freshness"] },
  { provider: "google_cse", group: "discovery", stack_role: "site-restricted keyword search", use: "Searching inside known domains", avoid: "Open-web discovery at volume (low quota)", input: "Keyword query", output: "SERP links and snippets", knobs: ["site restriction"] },
  { provider: "parallel", group: "discovery", stack_role: "rare deep_research", use: "Multi-hop research objectives", avoid: "Simple lookups (slow, costly)", input: "Objective statement", output: "Cited findings", knobs: ["processor tier"], risk: "Long runs; cap before grading" },
  { provider: "linkup", group: "discovery", stack_role: "structured_json", use: "Answers that must fill a schema", avoid: "Browsing-style discovery", input: "Query plus output schema", output: "JSON with sources", knobs: ["schema", "depth"] },
  { provider: "valyu", group: "discovery", stack_role: "premium_domain", use: "Filings, finance, academic and other proprietary corpora", avoid: "Consumer shopping and local", input: "Query plus source filters", output: "Passages from premium sources", knobs: ["search_type", "included_sources", "date range"] },
  { provider: "you", group: "discovery", stack_role: "optional discovery", use: "Extra coverage when others are thin", avoid: "Primary routing", input: "Keyword query", output: "Links with snippets", knobs: ["count"] },
  { provider: "firecrawl", group: "extract", stack_role: "primary extract", use: "Known URLs and site crawls to markdown", avoid: "Discovery", input: "URL or site", output: "Markdown, optional schema JSON", knobs: ["formats", "limit", "crawl depth"], risk: "Full pages and crawls blow token budgets; cap before grader" },
  { provider: "jina", group: "extract", stack_role: "budget extract and reader", use: "Reading survivor pages cheaply", avoid: "Crawling whole sites", input: "URL", output: "Plain text / markdown", knobs: ["respond-with", "retain-images"], risk: "Slow PDFs; 4 s per-page limit applies" },
  { provider: "diffbot", group: "extract", stack_role: "entity_kg", use: "Entity and knowledge-graph lookups", avoid: "Free-text discovery", input: "Entity or URL", output: "Structured entity JSON", knobs: ["entity type"] },
  { provider: "perplexity", group: "answer", stack_role: "optional deep/answer supply", use: "Grounded answers with citations", avoid: "Skipping the faithfulness check", input: "Question", output: "Cited answer", knobs: ["model", "recency"], risk: "Answer text must pass faithfulness; citations only count as sources" },
  { provider: "gemini_deep_research", group: "answer", stack_role: "optional deep research adapter", use: "Long research tasks when enabled", avoid: "Default routing", input: "Objective", output: "Report with citations", knobs: [], risk: "Stub adapter today; returns nothing" },
  { provider: "suggestapi", group: "skip", stack_role: "skip", use: "On-site autocomplete only", avoid: "Web search", input: "-", output: "-", knobs: [] },
];

export function liveToolCards(providers: SearchProvider[]): LiveToolCard[] {
  const byName = new Map(providers.map(p => [p.name, p]));
  return TOOL_CARDS.map(c => {
    const p = byName.get(c.provider);
    const status = c.group === "skip" ? "skip" : !p ? "no_adapter" : p.enabled() ? "live" : "disabled";
    return { ...c, status };
  });
}
