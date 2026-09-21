# ADR 0004: model and search supply

Status: accepted, 2026-09-21

Gemini 2.5 Flash writes mandates and will rerank when configured; deterministic heuristics keep local and test runs operational without a key. Supply adapters cover Tavily, Exa, Brave, Serper, SerpApi, Google Programmable Search, Perplexity and Gemini Deep Research. Missing credentials disable adapters without failing the process. Both builder-owned and divAIne-managed keys are valid operating modes.
