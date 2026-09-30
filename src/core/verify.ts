import {normalizeEntities} from './entities.js';
import {decisiveFields,normalizeDecisiveFacts,type FactReader,type FactVertical} from './decisive-facts.js';
import {productFields} from "./product-fields.js";
import { fillFields } from "./fill.js";
import type { ProviderResult } from "../contracts/search.js";
import { gradeDeterministic, gradeWithLlm, type LlmJudge } from "./faithfulness.js";

const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\])/;

export type ExtractOptions = { max?: number; maxChars?: number; tokenBudget?: number; fetcher?: typeof fetch; judge?: LlmJudge; timeoutMs?: number; fields?: string[]; vertical?:FactVertical; factReader?:FactReader };
export type ExtractReport = { attempted: number; extracted: number; chars: number; tokens_est: number; skipped_budget: number; failed_http: number; failed_fetch: number; supported: number; partial: number; unverified: number; fact_calls:number; fact_errors:number; entities:number };

// Extract only the survivors of discovery triage, within an extract cap and a token budget.
// Pages are truncated to maxChars before any scoring so full pages never blow the grader.
export async function extractSurvivors(input: ProviderResult[], signal?: AbortSignal, o: ExtractOptions = {}): Promise<{ results: ProviderResult[]; report: ExtractReport }> {
  const max = o.max ?? 3, maxChars = o.maxChars ?? 8000, budgetChars = (o.tokenBudget ?? 6000) * 4, f = o.fetcher ?? fetch;
  const report: ExtractReport = { attempted: 0, extracted: 0, chars: 0, tokens_est: 0, skipped_budget: 0, failed_http: 0, failed_fetch: 0, supported: 0, partial: 0, unverified: 0, fact_calls:0, fact_errors:0, entities:0 };
  const targets = input.slice(0, max);
  // Allocate before concurrent reads; every page gets a bounded share.
  const pageChars = Math.min(maxChars, Math.floor(budgetChars / Math.max(1, targets.length)));
  const out = await Promise.all(targets.map(async x => {
    try {
      const u = new URL(x.url);
      if (!["http:", "https:"].includes(u.protocol) || privateHost.test(u.hostname)) return x;
      report.attempted++;
      const per = AbortSignal.timeout(o.timeoutMs ?? 15000);
      const sig = signal ? AbortSignal.any([signal, per]) : per;
      const r = await f(`https://r.jina.ai/${x.url}`, { headers: { Accept: "text/plain", ...(process.env.JINA_API_KEY ? { Authorization: `Bearer ${process.env.JINA_API_KEY.trim()}` } : {}) }, signal: sig });
      if (!r.ok) { report.failed_http++; return x; }
      const remaining = pageChars;
      if (remaining <= 0) { report.skipped_budget++; return x; }
      const body = (await Promise.race([r.text(), new Promise<string>((_, rej) => sig.addEventListener("abort", () => rej(new Error("extract timeout")), { once: true }))])).replace(/!\[[^\]]*\]\([^)]*\)/g, "").slice(0, remaining);
      report.chars += body.length; report.extracted++;
      const fa = o.judge ? await gradeWithLlm(x, body, o.judge) : gradeDeterministic(x, body);
      report[fa.state]++;
      const support = fa.score;
      const title = x.title && x.title !== x.url ? x.title : (body.split("\n").find(l => l.trim())?.replace(/^title:\s*/i, "").slice(0, 200) ?? x.url);
      let fields = o.fields?.length ? {...fillFields(o.fields.filter(f=>!["product_price_inr","ram_gb"].includes(f)),body),...(o.fields.includes("product_price_inr")||o.fields.includes("ram_gb")?productFields(body):{})} : undefined;
      if(o.vertical&&o.factReader){
        const keys=decisiveFields(o.vertical);report.fact_calls++;
        try{const raw=await o.factReader(o.vertical,body,{url:x.url,title},keys);const entities=normalizeEntities(raw,x,body,o.vertical);if(entities.length){report.entities+=entities.length;return entities;}const facts=normalizeDecisiveFacts(raw,o.vertical,body,keys);fields={...fields,...facts};}
        catch{report.fact_errors++;fields={...fields,...Object.fromEntries(keys.map(k=>[k,{value:null,state:'missing' as const}]))};}
      }
      return { ...x, ...(fields ? { fields } : {}), title, snippet: x.snippet || body.slice(0, 400), raw: { ...(typeof x.raw === "object" && x.raw ? x.raw : {}), verified_content: true, support: Number(support.toFixed(3)), faithfulness: fa, passage: body.slice(0, 1200), retrieved_at: new Date().toISOString() } };
    } catch { report.failed_fetch++; return x; }
  }));
  report.tokens_est = Math.ceil(report.chars / 4);
  return { results: [...out.flat(), ...input.slice(max)], report };
}

// Backwards-compatible wrapper.
export async function verifyTop(input: ProviderResult[], signal?: AbortSignal) {
  return (await extractSurvivors(input, signal, { max: 8, maxChars: 120000, tokenBudget: 1e9 })).results;
}
