import type {CapabilityObservation} from './provider-capabilities.js';
// Public test query, 2026-09-30: laptop 16GB coding under INR80000. Not tenant traffic.
// One observation per provider+vertical. Source counts are inspected retrieval shapes,
// not verified offers; no price/RAM coverage inferred from unextracted snippets.
const base={version:1 as const,query_class:'local_shopping_maps',answer_unit:'product',kind:'discovery',field_pages:0,field_coverage:null,estimated_cost_usd:null,measured_cost_usd:null,observed_at:'2026-09-30T07:38:00Z',source:'benchmark' as const};
export const BENCHMARK_SEED:CapabilityObservation[]=[
 {...base,provider:'exa',vertical:'web',status:'ok',latency_ms:1407,results:5,direct:3,collection:1,discussion:0,unknown:1,eligible:3,provenance:'raw Exa auto + text; 3 SKU pages, 1 family page, 1 collection'},
 {...base,provider:'tavily',vertical:'web',status:'ok',latency_ms:1660,results:5,direct:0,collection:3,discussion:2,unknown:0,eligible:0,provenance:'raw Tavily basic; lists, YouTube, Scribd and Amazon search'},
 {...base,provider:'serper',vertical:'shopping',status:'failed',latency_ms:8001,results:0,direct:0,collection:0,discussion:0,unknown:0,eligible:0,provenance:'staging job 1bc1e8b2963b2ed39c205d797048a811 shopping timeout'},
 {...base,provider:'serpapi',vertical:'shopping',status:'ok',latency_ms:3537,results:5,direct:0,collection:5,discussion:0,unknown:0,eligible:0,provenance:'same staging job; 5 Google catalog links'},
 {...base,provider:'serper',vertical:'web',status:'ok',latency_ms:1971,results:5,direct:3,collection:1,discussion:1,unknown:0,eligible:3,provenance:'same staging job named-model web repair; merchant/reference URLs, category and video'}
];
