// Provider benchmark: does the harness top-3 beat or match the best single provider?
// Runs against a deployed harness. Usage:
//   DIVAINE_API_URL=https://divaine-search-harness.onrender.com DIVAINE_API_KEY=... npm run benchmark
// Output: per query, mean mandate_fit and faithfulness of the top 3 for each single provider
// (provider_allowlist=[p]) and for the harness default route; summary win/tie/loss.
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.DIVAINE_API_URL ?? "http://localhost:8787";
const key = process.env.DIVAINE_API_KEY;
if (!key) { console.error("DIVAINE_API_KEY is required"); process.exit(1); }
const spec = JSON.parse(readFileSync(new URL("../eval/benchmark-queries.json", import.meta.url), "utf8"));

export async function runBenchmark(fetchImpl = fetch, base = url, apiKey = key) {
  const top3 = r => { const xs = (r.results ?? []).slice(0, 3); const m = f => xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0; return { fit: +m(x => x.mandate_fit).toFixed(3), faith: +m(x => x.faithfulness.score).toFixed(3), n: xs.length }; };
  const call = async (query, allow) => { const r = await fetchImpl(`${base}/v1/search`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query, ...(allow ? { provider_allowlist: allow, limits: { max_provider_calls: 1 } } : {}) }) }); return r.ok ? r.json() : { results: [], error: r.status }; };
  const rows = [];
  for (const q of spec.queries) {
    const singles = {};
    for (const p of spec.providers) singles[p] = top3(await call(q, [p]));
    const harness = top3(await call(q));
    const best = Math.max(...Object.values(singles).map(s => s.fit + s.faith));
    const h = harness.fit + harness.faith;
    rows.push({ query: q, harness, singles, outcome: h > best + .02 ? "win" : h >= best - .02 ? "tie" : "loss" });
  }
  const count = o => rows.filter(r => r.outcome === o).length;
  return { at: new Date().toISOString(), queries: rows.length, win: count("win"), tie: count("tie"), loss: count("loss"), gate_pass: count("loss") === 0 || count("win") + count("tie") >= .8 * rows.length, rows };
}

const out = await runBenchmark();
writeFileSync(`eval/benchmark-${out.at.slice(0, 10)}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ queries: out.queries, win: out.win, tie: out.tie, loss: out.loss, gate_pass: out.gate_pass }));
