import { fillFields } from "./fill.js";
import type { ProviderResult } from "../contracts/search.js";
import { gradeDeterministic, gradeWithLlm, type LlmJudge } from "./faithfulness.js";

const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/;

export type ExtractOptions = { max?: number; maxChars?: number; tokenBudget?: number; fetcher?: typeof fetch; judge?: LlmJudge; timeoutMs?: number; fields?: string[] };
export type ExtractReport = { attempted: number; extracted: number; chars: number; tokens_est: number; skipped_budget: number; failed_http: number; failed_fetch: number; supported: number; partial: number; unverified: number };

// Extract only the survivors of discovery triage, within an extract cap and a token budget.
// Pages are truncated to maxChars before any scoring so full pages never blow the grader.
export async function extractSurvivors(input: ProviderResult[], signal?: AbortSignal, o: ExtractOptions = {}): Promise<{ results: ProviderResult[]; report: ExtractReport }> {
  const max = o.max ?? 3, maxChars = o.maxChars ?? 8000, budgetChars = (o.tokenBudget ?? 6000) * 4, f = o.fetcher ?? fetch;
  const report: ExtractReport = { attempted: 0, extracted: 0, chars: 0, tokens_est: 0, skipped_budget: 0, failed_http: 0, failed_fetch: 0, supported: 0, partial: 0, unverified: 0 };
  const targets = input.slice(0, max);
  const out = await Promise.all(targets.map(async x => {
    try {
      const u = new URL(x.url);
      if (!["http:", "https:"].includes(u.protocol) || privateHost.test(u.hostname)) return x;
      report.attempted++;
      const per = AbortSignal.timeout(o.timeoutMs ?? 4000);
      const sig = signal ? AbortSignal.any([signal, per]) : per;
      const r = await f(`https://r.jina.ai/${x.url}`, { headers: { Accept: "text/plain" }, signal: sig });
      if (!r.ok) { report.failed_http++; return x; }
      const remaining = budgetChars - report.chars;
      if (remaining <= 0) { report.skipped_budget++; return x; }
      const body = (await Promise.race([r.text(), new Promise<string>((_, rej) => sig.addEventListener("abort", () => rej(new Error("extract timeout")), { once: true }))])).slice(0, Math.min(maxChars, remaining));
      report.chars += body.length; report.extracted++;
      const fa = o.judge ? await gradeWithLlm(x, body, o.judge) : gradeDeterministic(x, body);
      report[fa.state]++;
      const support = fa.score;
      const title = x.title && x.title !== x.url ? x.title : (body.split("\n").find(l => l.trim())?.replace(/^title:\s*/i, "").slice(0, 200) ?? x.url);
      const fields = o.fields?.length ? fillFields(o.fields, body) : undefined;
      return { ...x, ...(fields ? { fields } : {}), title, snippet: x.snippet || body.slice(0, 400), raw: { ...(typeof x.raw === "object" && x.raw ? x.raw : {}), verified_content: true, support: Number(support.toFixed(3)), faithfulness: fa, passage: body.slice(0, 1200), retrieved_at: new Date().toISOString() } };
    } catch { report.failed_fetch++; return x; }
  }));
  report.tokens_est = Math.ceil(report.chars / 4);
  return { results: [...out, ...input.slice(max)], report };
}

// Backwards-compatible wrapper.
export async function verifyTop(input: ProviderResult[], signal?: AbortSignal) {
  return (await extractSurvivors(input, signal, { max: 8, maxChars: 120000, tokenBudget: 1e9 })).results;
}
