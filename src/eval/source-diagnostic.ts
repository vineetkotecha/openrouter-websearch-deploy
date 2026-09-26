// A fixed, low-volume diagnostic. Never return source text, URLs, query text, or an episode ID.
import { ROUTING_CASES } from './routing-cases.js';
import { SearchRequestSchema } from '../contracts/search.js';
import type { SearchHarness } from '../core/harness.js';

const CASE_IDS = ['R06', 'R09', 'R16'] as const;
const zero = () => ({ attempted: 0, extracted: 0, failed_http: 0, failed_fetch: 0, skipped_budget: 0, supported: 0, partial: 0, unverified: 0 });
export async function runSourceDiagnostic(h: SearchHarness, tenantId: string) {
  const rows: Array<{id:string; status:string; results:number; top3_supported:number; query_class?:string; expected_class?:string; latency_ms:number; extraction:ReturnType<typeof zero>}> = [];
  for (const id of CASE_IDS) {
    const c = ROUTING_CASES.cases.find(x => x.id === id);
    if (!c) throw new Error(`Missing diagnostic case ${id}`);
    const request = SearchRequestSchema.parse({ ...c.request, tenant_id: tenantId,
      permissions: { may_retain:false, may_learn:false, may_ask_user:false, may_pull_context:false },
      limits: { latency_ms:10000, max_provider_calls:3, max_results:10, max_extracts:5, allow_deep_research:false } });
    const started = Date.now();
    try {
      const response = await h.search(request, { surface:'source_diagnostic' });
      const complete = response.status === 'complete' ? response : null;
      const x = complete?.plan?.extraction;
      const extraction = zero();
      for (const key of Object.keys(extraction) as Array<keyof typeof extraction>) extraction[key] = Number(x?.[key] ?? 0);
      rows.push({ id, status: response.status, results:complete?.results.length ?? 0,
        top3_supported:complete?.results.slice(0,3).filter(r => r.faithfulness.state === 'supported').length ?? 0,
        query_class:complete?.plan?.query_class, expected_class:c.expect.query_class,
        latency_ms:Date.now()-started, extraction });
    } catch {
      rows.push({id,status:'error',results:0,top3_supported:0,expected_class:c.expect.query_class,latency_ms:Date.now()-started,extraction:zero()});
    }
  }
  const extraction=zero();
  for (const r of rows) for(const key of Object.keys(extraction) as Array<keyof typeof extraction>) extraction[key]+=r.extraction[key];
  return {version:'source-diagnostic-v1', case_ids:[...CASE_IDS], n:rows.length,
    nonempty:rows.filter(r=>r.results>0).length, class_ok:rows.filter(r=>r.query_class===r.expected_class).length,
    top3_supported:rows.reduce((n,r)=>n+r.top3_supported,0), extraction, rows};
}
