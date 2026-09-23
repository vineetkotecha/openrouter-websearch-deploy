// Source faithfulness, scored separately from mandate fit (product doc: "score faithfulness
// separately from answer quality and preserve source-level provenance").
// Deterministic claim-level grader with an optional LLM grader layered on top.
import type { ProviderResult } from "../contracts/search.js";

export type ClaimCheck = { claim: string; state: "supported" | "partial" | "unsupported"; score: number; missing_numbers: string[] };
export type Faithfulness = { state: "supported" | "partial" | "unverified"; score: number; method: string; claims: ClaimCheck[] };

const STOP = new Set("with from that this have will your their about into over under more most best than then also they them what when where which while were been being does just only very such each other some".split(" "));
const stem = (w: string) => w.replace(/(ings|ing|ers|er|es|s|ed|ly)$/, "");
const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter(w => !STOP.has(w)).map(stem);
const numbers = (s: string) => [...new Set((s.match(/(?:[$₹€£]\s?)?\d[\d,]*(?:\.\d+)?%?/g) ?? []).map(n => n.replace(/[\s,$₹€£]/g, "")).filter(n => n.replace(/\D/g, "").length >= 2))];
const bigrams = (ws: string[]) => new Set(ws.slice(1).map((w, i) => `${ws[i]} ${w}`));

export function splitClaims(text: string): string[] {
  return text.replace(/\[\d+\]/g, "").split(/(?<=[.!?])\s+|\s+[|•·–-]\s+|\n+/).map(s => s.trim()).filter(s => words(s).length >= 3).slice(0, 8);
}

export function checkClaim(claim: string, page: string, pageWords = new Set(words(page)), pageBigrams = bigrams(words(page)), pageNumbers = new Set(numbers(page))): ClaimCheck {
  const cw = words(claim);
  const uni = cw.filter(w => pageWords.has(w)).length / Math.max(1, cw.length);
  const cb = bigrams(cw);
  const bi = cb.size ? [...cb].filter(b => pageBigrams.has(b)).length / cb.size : uni;
  const nums = numbers(claim);
  const missing_numbers = nums.filter(n => !pageNumbers.has(n));
  const numPenalty = nums.length ? missing_numbers.length / nums.length : 0;
  const score = Math.max(0, Math.min(1, .55 * uni + .45 * bi - .5 * numPenalty));
  const state = score >= .6 && !missing_numbers.length ? "supported" : score >= .35 ? "partial" : "unsupported";
  return { claim, state, score: +score.toFixed(3), missing_numbers };
}

export function gradeDeterministic(result: Pick<ProviderResult, "title" | "snippet">, page: string): Faithfulness {
  const claims = splitClaims(`${result.snippet}`);
  const all = claims.length ? claims : splitClaims(`${result.title}. ${result.snippet}`);
  if (!page || !all.length) return { state: "unverified", score: 0, method: "deterministic-v2", claims: [] };
  const pw = new Set(words(page)), pb = bigrams(words(page)), pn = new Set(numbers(page));
  const checks = all.map(c => checkClaim(c, page, pw, pb, pn));
  const score = checks.reduce((a, c) => a + c.score, 0) / checks.length;
  const anyUnsupportedNumber = checks.some(c => c.missing_numbers.length);
  const state = score >= .6 && !anyUnsupportedNumber ? "supported" : score >= .35 ? "partial" : "unverified";
  return { state, score: +score.toFixed(3), method: "deterministic-v2", claims: checks };
}

export type LlmJudge = (prompt: string) => Promise<string>;

// Optional LLM grader: asks for a per-claim verdict and keeps the stricter of the two.
export async function gradeWithLlm(result: Pick<ProviderResult, "title" | "snippet">, page: string, judge: LlmJudge): Promise<Faithfulness> {
  const base = gradeDeterministic(result, page);
  if (!base.claims.length) return base;
  const prompt = `You check whether a source page supports claims. Reply with JSON only: {"verdicts":["supported"|"partial"|"unsupported", ...]} in claim order.\nCLAIMS:\n${base.claims.map((c, i) => `${i + 1}. ${c.claim}`).join("\n")}\nPAGE (truncated):\n${page.slice(0, 12000)}`;
  try {
    const v: string[] = JSON.parse((await judge(prompt)).replace(/^```json|```$/g, "").trim()).verdicts ?? [];
    const val = { supported: 1, partial: .5, unsupported: 0 } as Record<string, number>;
    const claims = base.claims.map((c, i) => {
      const s = val[v[i] ?? ""]; if (s === undefined) return c;
      const score = Math.min(c.score + .3, s) ; // LLM can lift a paraphrase, never above its own verdict
      return { ...c, score: +Math.max(Math.min(c.score, s), score).toFixed(3), state: (s === 1 && !c.missing_numbers.length ? "supported" : s >= .5 ? "partial" : "unsupported") as ClaimCheck["state"] };
    });
    const score = claims.reduce((a, c) => a + c.score, 0) / claims.length;
    const state = claims.every(c => c.state === "supported") ? "supported" : score >= .35 ? "partial" : "unverified";
    return { state, score: +score.toFixed(3), method: "llm+deterministic-v2", claims };
  } catch { return base; }
}

// Grounded answers from answer engines (Perplexity, model search tools) are optional supply.
// Split the answer into per-source items: each cited source gets only the sentences that cite
// it. These items start unverified and must pass the same faithfulness check as any result.
export function splitGroundedAnswer(provider: string, answer: string, citations: string[]): ProviderResult[] {
  const sentences = answer.split(/(?<=[.!?])\s+/);
  return citations.map((url, i) => {
    const mine = sentences.filter(s => new RegExp(`\\[${i + 1}\\]`).test(s)).map(s => s.replace(/\[\d+\]/g, "").trim());
    let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep url */ }
    return { provider, url, title: host, snippet: mine.join(" ").slice(0, 600), raw: { grounded_answer: true, citation_index: i + 1 } };
  }).filter(x => { try { new URL(x.url); return true; } catch { return false; } });
}
