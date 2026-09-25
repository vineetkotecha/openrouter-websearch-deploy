// Labeled mandate eval: checks the mandate writer against hand labels.
// - functional: each labeled constraint must appear as a functional factor (and be hard when labeled hard)
// - psychological: never invented; only present when the calling agent supplied it
// - gap: vague queries must raise a material gap with a question; specific ones must not
// Runs the heuristic writer offline, or the production Gemini writer when Vertex credentials or GEMINI_API_KEY are set.
import { readFileSync } from "node:fs";
import { SearchRequestSchema } from "../contracts/search.js";
import { HeuristicMandateWriter, type MandateWriter } from "../core/mandate.js";

type Label = { match: string; hard?: boolean };
export type MandateCase = { id: string; query: string; agent_understanding?: unknown; functional: Label[]; psych_expected?: string[]; gap: boolean };
export type MandateEvalRow = { id: string; functional_recall: number; hard_precision: number; invented_psych: number; psych_recall: number; gap_ok: boolean; missing: string[] };

// Default quality factors every mandate carries echo the raw query; they must not count as extracted constraints.
const DEFAULT_KEYS = new Set(["query_relevance", "result_directness", "source_support", "result_specificity", "current_accessibility"]);
const text = (f: any) => `${f.key} ${f.description} ${typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? "")}`.toLowerCase();

export async function evalMandates(writer: MandateWriter, cases: MandateCase[], concurrency = 2) {
  const rows: MandateEvalRow[] = [];
  const written: any[] = [];
  for (let i = 0; i < cases.length; i += Math.max(1, Math.min(concurrency, 4))) written.push(...await Promise.all(cases.slice(i, i + Math.max(1, Math.min(concurrency, 4))).map(c => writer.write(SearchRequestSchema.parse({ query: c.query, tenant_id: "eval", agent_understanding: c.agent_understanding })).catch(e => ({ factors: [], gaps: [], error: String(e?.message ?? e).slice(0, 200) })))));
  for (const [ci, c] of cases.entries()) {
    const m: any = written[ci];
    const fn = m.factors.filter((f: any) => f.class === "functional" && !DEFAULT_KEYS.has(f.key)), ps = m.factors.filter((f: any) => f.class === "psychological");
    let hit = 0, hardHit = 0, hardWanted = 0; const missing: string[] = [];
    for (const l of c.functional) {
      const re = new RegExp(l.match, "i"), f = (l.hard ? fn.find((x: any) => x.hard && re.test(text(x))) : undefined) ?? fn.find((x: any) => re.test(text(x)));
      if (f) hit++; else missing.push(l.match);
      if (l.hard) { hardWanted++; if (f?.hard) hardHit++; }
    }
    const supplied = !!c.agent_understanding;
    const invented = supplied ? 0 : ps.length;
    const psychRecall = c.psych_expected?.length ? c.psych_expected.filter(k => ps.some((f: any) => new RegExp(k, "i").test(text(f)))).length / c.psych_expected.length : 1;
    const gapRaised = m.gaps.some((g: any) => g.material && g.question);
    rows.push({ ...(m.error ? { error: m.error } : {}), ...(m.fallback_reason ? { fallback_reason: m.fallback_reason } : {}), id: c.id, functional_recall: hit / c.functional.length, hard_precision: hardWanted ? hardHit / hardWanted : 1, invented_psych: invented, psych_recall: psychRecall, gap_ok: gapRaised === c.gap, missing });
  }
  const avg = (k: keyof MandateEvalRow) => +(rows.reduce((a, r) => a + Number(r[k]), 0) / rows.length).toFixed(3);
  const fallbacks = rows.map((r: any) => r.fallback_reason).filter(Boolean);
  return { n: rows.length, writer_fallbacks: fallbacks.length, fallback_reasons: [...new Set(fallbacks)].slice(0, 5), functional_recall: avg("functional_recall"), hard_constraint_rate: avg("hard_precision"), psych_recall: avg("psych_recall"), invented_psych_cases: rows.filter(r => r.invented_psych > 0).length, gap_accuracy: +(rows.filter(r => r.gap_ok).length / rows.length).toFixed(3), rows };
}

if (process.argv[1]?.endsWith("mandate.ts") || process.argv[1]?.endsWith("mandate.js")) {
  const cases: MandateCase[] = JSON.parse(readFileSync(new URL("../../eval/mandate-cases.json", import.meta.url), "utf8"));
  let writer: MandateWriter = new HeuristicMandateWriter(), name = "heuristic";
  if (process.env.GOOGLE_VERTEX_SA_JSON || process.env.GEMINI_API_KEY) { const { GeminiMandateWriter } = await import("../core/mandate.js") as any; const { loadConfig } = await import("../config.js"); writer = new GeminiMandateWriter(loadConfig()); name = "gemini"; }
  const r = await evalMandates(writer, cases);
  console.log(JSON.stringify({ writer: name, ...r, rows: r.rows.filter(x => x.functional_recall < 1 || !x.gap_ok || x.invented_psych) }, null, 2));
}
