// Offline learning report. Usage:
//   DATABASE_URL=... LEARN_TENANT=<tenant> npm run learn:report
//   npm run learn:report -- --file episodes.json   (JSON {episodes, outcomes})
import { readFileSync } from "node:fs";
import pg from "pg";
import { deriveExamples } from "./contract.js";
import { replay, splitByTime } from "./replay.js";

const fileArg = process.argv.indexOf("--file");
let episodes: any[] = [], outcomes: any[] = [];
if (fileArg > 0) ({ episodes, outcomes } = JSON.parse(readFileSync(process.argv[fileArg + 1]!, "utf8")));
else {
  const tenant = process.env.LEARN_TENANT;
  if (!process.env.DATABASE_URL || !tenant) { console.error("Set DATABASE_URL and LEARN_TENANT (tenant-local only), or pass --file"); process.exit(1); }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  episodes = (await pool.query("SELECT id,tenant_id,created_at,expires_at,request,response,mandate,duration_ms FROM episodes WHERE tenant_id=$1 AND expires_at>now()", [tenant])).rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString(), expires_at: new Date(r.expires_at).toISOString() }));
  outcomes = (await pool.query("SELECT o.episode_id,o.payload FROM outcomes o JOIN episodes e ON e.id=o.episode_id WHERE e.tenant_id=$1", [tenant])).rows;
  await pool.end();
}
const { examples, excluded } = deriveExamples(episodes, outcomes, { tenant_id: process.env.LEARN_TENANT });
const { train, eval: ev } = splitByTime(examples);
console.log(JSON.stringify({ examples: examples.length, excluded, split: { train: train.length, eval: ev.length }, eval_report: replay(ev), note: "No learned policy is serving. Shadow proposals are logged only." }, null, 2));
