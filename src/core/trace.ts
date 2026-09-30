/** Caller-visible, ordered execution trace. Only emitted to the authorized search caller;
 * server logs continue to contain stage names/timings, not private context values. */
export const TRACE_HEADINGS = [
  'Query Understanding', 'Parameters Curated', 'Parameters Answered',
  'Question Asked', 'Parameter Refilled', 'Mandate Created', 'Query Updated',
  'How has the query been dis-integrated',
  'Routing - and grading trace - where and how has the query been routed?'
] as const;
export type TraceEvent = {stage:string; elapsed_ms:number; data:unknown};
export function nineStageTrace(events:TraceEvent[], status:string) {
  const first=(name:string)=>events.find(x=>x.stage===name)?.data as any;
  const all=(name:string)=>events.filter(x=>x.stage===name).map(x=>x.data);
  const understood=first('1a_prefill_query_formation');
  const curated=first('2_initial_parameter_curation')?.manifest??first('1_baseline_parameters');
  const request=first('1_request');
  const initial=first('1b_parameter_curation_first_pass');
  const mandate=first('6_final_mandate_after_fill');
  const updated=first('5a_postfill_query_formation');
  const plan=first('5_job_plan');
  const questions=[...all('5_user_question'),...all('5_user_question_or_incomplete')];
  const userQuestionIssued=all('5_user_question').length>0;
  const requested=[...all('3_caller_context_request')];
  const value=(x:any)=>x===undefined?null:x;
  const sections=[
    {heading:TRACE_HEADINGS[0],data:value({query:request?.query,intent:understood?.intent,formed_query:understood?.provider_query})},
    {heading:TRACE_HEADINGS[1],data:curated?{generation:curated.generation,fallback_reason:curated.fallback_reason,parameters:curated.parameters,validated_model_manifest:initial??null}:null},
    {heading:TRACE_HEADINGS[2],data:curated?{answered:curated.parameters.filter((p:any)=>p.state==='resolved'),missing:curated.parameters.filter((p:any)=>p.state!=='resolved'),caller_context:request?.context,psychological_check:first('2_psychological_curation_check')}:null},
    {heading:TRACE_HEADINGS[3],data:{questions,caller_requests:requested,asked_user:userQuestionIssued}},
    {heading:TRACE_HEADINGS[4],data:curated?{revision_of:request?.curation_revision_of??null,caller_fill_complete:request?.caller_fill_complete??null,filled:curated.parameters.filter((p:any)=>p.state==='resolved').map((p:any)=>({key:p.key,value:p.value,source:p.source,evidence:p.evidence})),unfilled:curated.parameters.filter((p:any)=>p.state!=='resolved').map((p:any)=>p.key)}:null},
    {heading:TRACE_HEADINGS[5],data:value(mandate)},
    {heading:TRACE_HEADINGS[6],data:value(updated)},
    {heading:TRACE_HEADINGS[7],data:plan?{jobs:plan.jobs.map((j:any)=>({id:j.id,kind:j.kind,query:j.query,reason:j.reason,factor_keys:j.factor_keys})),notes:plan.notes,budget:plan.budget}:null},
    {heading:TRACE_HEADINGS[8],data:plan?{routes:all('7_subquery_route'),repair_routes:all('7_repair_route'),jobs:plan.jobs.map((j:any)=>({id:j.id,query:j.query,primary:j.primary,fallback:j.fallback,candidates:j.candidates})),capability_map:first('7_provider_capability_map'),feedback:first('6_provider_feedback'),grades:all('6_provider_grade'),execution:first('6_provider_execution'),audits:all('6_result_audit'),eligibility:first('7_triage_and_dedupe'),rerank:first('10_jev_rerank'),decisive_fact_schema:first('8_decisive_fact_schema'),answer:first('11_answer_synthesis')}:null}
  ];
  return {version:1,status,sections:sections.map(s=>({...s,available:s.data!==null})),events:events.map(({stage,elapsed_ms})=>({stage,elapsed_ms}))};
}
