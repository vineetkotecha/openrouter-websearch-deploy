// Offline routing eval: query categories against expected class, ladder and provider pick,
// using the documented capability profiles and the live provider set. No keys required.
import { readFileSync } from "node:fs";
import { SearchRequestSchema } from "../contracts/search.js";
import { HeuristicMandateWriter } from "../core/mandate.js";
import { planJobs, ProviderHealth } from "../core/jobs.js";

type Case = { id: string; request: Record<string, unknown>; expect: { query_class: string; ladder: string; primary_in: string[] } };
export type RoutingEvalRow = { id: string; query: string; class_ok: boolean; ladder_ok: boolean; primary_ok: boolean; got: { query_class: string; ladder: string; primary?: string } };

export async function runRoutingEval(path = "eval/routing-cases.json") {
  const spec = JSON.parse(readFileSync(path, "utf8")) as { live_providers: string[]; cases: Case[] };
  const providers = spec.live_providers.map(name => ({ name, enabled: () => true, search: async () => [] }));
  const writer = new HeuristicMandateWriter();
  const rows: RoutingEvalRow[] = [];
  for (const c of spec.cases) {
    const req = SearchRequestSchema.parse({ tenant_id: "eval", ...c.request });
    const plan = planJobs(req, await writer.write(req), providers, new ProviderHealth());
    const primary = plan.jobs[0]?.primary;
    rows.push({
      id: c.id, query: String(c.request.query),
      class_ok: plan.classification.query_class === c.expect.query_class,
      ladder_ok: plan.classification.ladder === c.expect.ladder,
      primary_ok: c.expect.primary_in.length ? !!primary && c.expect.primary_in.includes(primary) : plan.jobs.length === 0,
      got: { query_class: plan.classification.query_class, ladder: plan.classification.ladder, primary },
    });
  }
  const pct = (k: keyof RoutingEvalRow) => rows.filter(r => r[k] === true).length / rows.length;
  return { cases: rows.length, class_accuracy: pct("class_ok"), ladder_accuracy: pct("ladder_ok"), primary_accuracy: pct("primary_ok"), failures: rows.filter(r => !r.class_ok || !r.ladder_ok || !r.primary_ok) };
}

if (process.argv[1]?.endsWith("routing.js") || process.argv[1]?.endsWith("routing.ts")) {
  runRoutingEval().then(r => console.log(JSON.stringify(r, null, 2)));
}
