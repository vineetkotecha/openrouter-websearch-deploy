// Live benchmark (item 21): runs the routing cases through the real harness and live providers,
// then reports per query class what callers actually get. Deep research is off to bound cost.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SearchRequestSchema } from "../contracts/search.js";
import type { SearchHarness } from "../core/harness.js";

type Case = { id: string; request: Record<string, unknown>; expect: { query_class: string; ladder: string; primary_in: string[] } };
export type BenchRow = { id: string; query_class: string; expected_class: string; status: string; latency_ms: number; results: number; primary?: string; fallback: boolean; error?: string; top3_supported: number; top3_fit: number; top3_domains: number };
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
const mean = (xs: number[]) => xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : 0;

export async function runBenchmark(h: SearchHarness, tenant_id: string, o: { path?: string; concurrency?: number; only?: string[] } = {}) {
  const tries = [o.path, "eval/routing-cases.json", fileURLToPath(new URL("../../eval/routing-cases.json", import.meta.url))].filter(Boolean) as string[];
  const path = tries.find(p => existsSync(p)); if (!path) throw new Error("routing-cases.json not found");
  const spec = JSON.parse(readFileSync(path, "utf8")) as { cases: Case[] };
  const cases = spec.cases.filter(c => !o.only?.length || o.only.includes(c.id));
  const rows: BenchRow[] = [];
  const one = async (c: Case) => {
    const t = Date.now();
    try {
      const req = SearchRequestSchema.parse({ ...c.request, tenant_id, limits: { latency_ms: 10000, max_results: 10, ...(c.request.limits as object ?? {}), allow_deep_research: false } });
      const r: any = await h.search(req, { surface: "benchmark" });
      const top = (r.results ?? []).slice(0, 3);
      rows.push({
        id: c.id, query_class: r.plan?.query_class ?? r.kind ?? "?", expected_class: c.expect.query_class, status: r.status, latency_ms: Date.now() - t,
        results: (r.results ?? []).length, primary: r.plan?.runs?.find((x: any) => x.role === "primary" && x.status === "ok")?.provider ?? r.plan?.jobs?.[0]?.primary,
        fallback: !!r.plan?.fallback_used?.length, error: (r.plan?.runs ?? []).filter((x: any) => x.status !== "ok").map((x: any) => `${x.provider}: ${x.status}`).join("; ") || undefined,
        top3_supported: top.filter((x: any) => x.faithfulness?.state === "supported").length, top3_fit: mean(top.map((x: any) => x.mandate_fit ?? 0)),
        top3_domains: new Set(top.map((x: any) => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return x.url; } })).size,
      });
    } catch (e) { rows.push({ id: c.id, query_class: "?", expected_class: c.expect.query_class, status: "error", latency_ms: Date.now() - t, results: 0, fallback: false, error: String((e as Error)?.message ?? e).slice(0, 200), top3_supported: 0, top3_fit: 0, top3_domains: 0 }); }
  };
  const queue = [...cases]; const n = Math.max(1, Math.min(o.concurrency ?? 3, 5));
  await Promise.all(Array.from({ length: n }, async () => { for (let c = queue.shift(); c; c = queue.shift()) await one(c); }));
  const byClass: Record<string, any> = {};
  for (const cls of [...new Set(rows.map(r => r.expected_class))]) {
    const rs = rows.filter(r => r.expected_class === cls);
    byClass[cls] = { n: rs.length, class_ok: rs.filter(r => r.query_class === cls).length, non_empty: rs.filter(r => r.results > 0).length, p50_ms: pct(rs.map(r => r.latency_ms), .5), top3_supported_share: mean(rs.map(r => r.top3_supported / 3)), top3_fit: mean(rs.map(r => r.top3_fit)), fallback: rs.filter(r => r.fallback).length, errors: rs.filter(r => r.error).length };
  }
  const lat = rows.map(r => r.latency_ms);
  return {
    benchmark: "routing-cases-live-v1", n: rows.length, ran_at: new Date().toISOString(), deep_research: "off",
    overall: { non_empty: rows.filter(r => r.results > 0).length, class_accuracy: mean(rows.map(r => r.query_class === r.expected_class ? 1 : 0)), p50_ms: pct(lat, .5), p95_ms: pct(lat, .95), top3_supported_share: mean(rows.map(r => r.top3_supported / 3)), top3_fit: mean(rows.map(r => r.top3_fit)), fallback_searches: rows.filter(r => r.fallback).length, searches_with_provider_errors: rows.filter(r => r.error).length },
    by_class: byClass, primaries: rows.reduce((a: Record<string, number>, r) => { if (r.primary) a[r.primary] = (a[r.primary] ?? 0) + 1; return a; }, {}),
    rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    limits: "Relevance is proxied by mandate fit and faithfulness labels, not human judgments. One run, no repeats.",
  };
}
