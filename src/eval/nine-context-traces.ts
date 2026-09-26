// Nine fixed, distinct agent-style searches. User context is supplied at invocation,
// never embedded in the public repository or persisted as an episode.
import { SearchRequestSchema } from '../contracts/search.js';
import type { SearchHarness } from '../core/harness.js';

export const NINE_CASES = [
  { id:'N01', query:'latest news on the EU AI Act enforcement', requested:[] },
  { id:'N02', query:'pharmacy near me open now', requested:['location'] },
  { id:'N03', query:'patents filed for solid state batteries', requested:[] },
  { id:'N04', query:'running shoes under ₹3000 available in India', requested:['use_case'] },
  { id:'N05', query:'Jain North Indian lunch ideas without onion or garlic', requested:['diet'] },
  { id:'N06', query:'best laptop', requested:['use_case','budget'] },
  { id:'N07', query:'weekend trip', requested:['origin'] },
  { id:'N08', query:'alternatives to Notion for a startup knowledge base', requested:['use_case'] },
  { id:'N09', query:'peer-reviewed papers on retrieval augmented generation faithfulness', requested:['research_interest'] },
] as const;

type Item={case_id:string;key:string;value:string;source:'caller';confidence:number;observed_at?:string};
export async function runNineContextTraces(h:SearchHarness,tenantId:string,provided:Item[],only?:string[]){
  // The caller can provide only the named parameters, not arbitrary private notes.
  const allowed=new Set(['location','origin','diet','use_case','budget','research_interest']);
  if(provided.length>9||provided.some(x=>!NINE_CASES.some(c=>c.id===x.case_id&&(c.requested as readonly string[]).includes(x.key))||!allowed.has(x.key)||typeof x.value!=='string'||x.value.length>160||x.value.length===0||x.source!=='caller'||!Number.isFinite(x.confidence)||x.confidence<0||x.confidence>1))throw new Error('invalid_context');
  const rows=[];
  for(const c of NINE_CASES.filter(c=>!only||only.includes(c.id))){
    const used=provided.filter(x=>x.case_id===c.id&&(c.requested as readonly string[]).includes(x.key));
    const makeRequest=(context:Item[])=>SearchRequestSchema.parse({query:c.query,tenant_id:tenantId,context,
      permissions:{may_pull_context:true,may_ask_user:false,may_retain:false,may_learn:false,scopes:['nine-trace-eval']},
      limits:{latency_ms:10000,max_provider_calls:3,max_results:5,max_extracts:5,allow_deep_research:false}});
    const start=Date.now();
    try{
      // First query is always context-free: show the actual request to the caller.
      // Only retry when a response asks for a key the caller has independently supplied.
      const initial=await h.search(makeRequest([]),{surface:'nine_context_trace'});
      const asked=initial.status==='needs_input'&&'requested_context'in initial?initial.requested_context:[];
      const answered=used.filter(x=>asked.some(y=>y.key===x.key));
      const final=answered.length?await h.search(makeRequest(answered),{surface:'nine_context_trace'}):initial;
      rows.push({id:c.id,query:c.query,parameters_requested:asked,parameters_supplied:answered.map(x=>({case_id:x.case_id,key:x.key,source:x.source,confidence:x.confidence,observed_at:x.observed_at})),
        initial_status:initial.status,status:final.status,latency_ms:Date.now()-start,
        ...(final.status==='complete'?{query_class:final.plan?.query_class??final.route_decision?.task_class,route:final.route,route_decision:final.route_decision,extraction:final.plan?.extraction,
          fallback_used:final.plan?.fallback_used??[],context_trace:final.plan?.context,limitations:final.limitations,
          top_results:final.results.slice(0,3).map(x=>({title:x.title,url:x.url,provider:x.provider,mandate_fit:x.mandate_fit,faithfulness:x.faithfulness,reason:x.reason}))}:
          {context_request:final.status==='needs_input'&&'requested_context'in final?final.requested_context:[],gap:'gap'in final?final.gap:undefined,question:'question'in final?final.question:undefined})});
    }catch(e){rows.push({id:c.id,query:c.query,parameters_requested:[],parameters_supplied:[],status:'error',latency_ms:Date.now()-start,error:String((e as Error)?.message??e).slice(0,160)})}
  }
  return {version:'nine-context-traces-v2',ran_at:new Date().toISOString(),retention:'off',method:'nine distinct authored test questions, optionally filtered; first call requests context from calling agent, then supplied answers are retried without retention',rows};
}
