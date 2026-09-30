// Retrieval quality is an observed proxy, not user satisfaction. Never pool tenant episodes.
import type {Mandate, ProviderResult, SearchRequest} from '../contracts/search.js';
import {eligibility} from '../core/eligibility.js';
import type {AnswerUnit} from '../core/answer-units.js';
import {buildQueryPlan} from '../providers/query-plan.js';
export type CapabilityObservation = {
 version:1; provider:string; query_class:string; answer_unit:string; kind:string; vertical:string;
 status:'ok'|'failed'; latency_ms:number; results:number; direct:number; collection:number; discussion:number; unknown:number;
 eligible:number; field_pages:number; field_coverage:number|null; estimated_cost_usd:number|null; measured_cost_usd:number|null;
 observed_at:string; source:'benchmark'|'search'; provenance?:string;
};
export type CapabilitySummary = {
 provider:string; query_class:string; answer_unit:string; kind:string; vertical:string; runs:number; successful_runs:number;
 results:number; direct:number; collection:number; discussion:number; unknown:number; eligible:number;
 field_pages:number; field_coverage:number|null; avg_latency_ms:number; estimated_cost_usd:number|null; measured_cost_usd:number|null;
 confidence:number; adjustment:number; last_observed_at:string; source_counts:Record<string,number>;
};
// Existing planning estimates only. These are not invoices or observed billing.
export const PLANNING_COST_USD:Record<string,number>={exa:.005,tavily:.008,serper:.001,serpapi:.015,valyu:.01,jina:.002,firecrawl:.01};
export function providerVertical(provider:string,r:SearchRequest,m:Mandate,override?:string){
 const v=override??buildQueryPlan(r,m).vertical.engine;
 // These adapters route a specialised endpoint; the other adapters search general web.
 return ['serper','serpapi'].includes(provider)?v:provider==='valyu'&&['finance','academic'].includes(v)?'proprietary':'web';
}
export function pageShape(x:ProviderResult):'direct'|'collection'|'discussion'|'unknown'{
 let u:URL;try{u=new URL(x.url)}catch{return 'unknown'}
 if(/(?:^|\.)(?:reddit|quora|youtube|facebook|instagram|tiktok|scribd)\.com$/i.test(u.hostname))return 'discussion';
 if(/\/s(?:[/?]|$)|\/search(?:[/?]|$)|\/collections?(?:[/?]|$)|\/list(?:-of-|s?\/)|\/catalog(?:[/?]|$)|\/shopping\//i.test(u.pathname)||/\b(?:best|top|list of)\b.*\b(?:laptops|phones|hotels|restaurants|products)\b/i.test(x.title))return 'collection';
 if(/\/(?:dp|product|products|p|article|articles|papers|abs|news)\/.+|\.html$|\/[^/]+\.pdf$/i.test(u.pathname))return 'direct';
 return 'unknown';
}
export function gradeProvider(input:{provider:string;query_class:string;answer_unit?:AnswerUnit;kind:string;vertical:string;status:string;latency_ms:number;results:ProviderResult[];request:SearchRequest;mandate:Mandate;fields?:string[]}):CapabilityObservation{
 const shapes=input.results.map(pageShape),fields=input.fields??[];
 const tested=input.results.filter(x=>fields.some(k=>Object.hasOwn(x.fields??{},k)));
 const coverage=fields.length&&tested.length?tested.reduce((a,x)=>a+fields.filter(k=>x.fields?.[k]?.state==='supported').length/fields.length,0)/tested.length:null;
 return {version:1,provider:input.provider,query_class:input.query_class,answer_unit:input.answer_unit??'general',kind:input.kind,vertical:input.vertical,
 status:input.status==='ok'?'ok':'failed',latency_ms:input.latency_ms,results:input.results.length,
 direct:shapes.filter(x=>x==='direct').length,collection:shapes.filter(x=>x==='collection').length,discussion:shapes.filter(x=>x==='discussion').length,unknown:shapes.filter(x=>x==='unknown').length,
 eligible:input.results.filter(x=>eligibility(input.request,input.mandate,x,input.answer_unit).eligible).length,
 field_pages:tested.length,field_coverage:coverage,estimated_cost_usd:PLANNING_COST_USD[input.provider]??null,measured_cost_usd:null,observed_at:new Date().toISOString(),source:'search'};
}
export function summarizeCapabilities(rows:CapabilityObservation[]):CapabilitySummary[]{
 const groups=new Map<string,CapabilityObservation[]>();
 for(const x of rows){const key=JSON.stringify([x.provider,x.query_class,x.answer_unit,x.kind,x.vertical]);groups.set(key,[...(groups.get(key)??[]),x])}
 return [...groups.values()].map(xs=>{
 const x=xs[0]!,sum=(k:'results'|'direct'|'collection'|'discussion'|'unknown'|'eligible'|'field_pages'|'latency_ms')=>xs.reduce((a,b)=>a+b[k],0);
 const n=xs.length,results=sum('results'),ok=xs.filter(x=>x.status==='ok').length,confidence=n/(n+5),pages=sum('field_pages');
 const coverage=pages?xs.reduce((a,b)=>a+(b.field_coverage??0)*b.field_pages,0)/pages:null;
 // Entity requests benefit from direct pages. Research can use discussions/collections;
 // eligibility and success remain useful across answer types. Unknown shape is not a failure.
 const entity=['product','hotel_property','local_business','person'].includes(x.answer_unit);
 const useful=results?(entity?(sum('eligible')/results+sum('direct')/results)/2:sum('eligible')/results):0;
 const quality=.35*ok/n+.65*useful;
 const average=(key:'estimated_cost_usd'|'measured_cost_usd')=>{const known=xs.map(x=>x[key]).filter((v):v is number=>v!==null);return known.length?known.reduce((a,b)=>a+b,0)/known.length:null};
 return {provider:x.provider,query_class:x.query_class,answer_unit:x.answer_unit,kind:x.kind,vertical:x.vertical,runs:n,successful_runs:ok,results,direct:sum('direct'),collection:sum('collection'),discussion:sum('discussion'),unknown:sum('unknown'),eligible:sum('eligible'),field_pages:pages,field_coverage:coverage,avg_latency_ms:sum('latency_ms')/n,estimated_cost_usd:average('estimated_cost_usd'),measured_cost_usd:average('measured_cost_usd'),confidence,adjustment:confidence*(2*(quality-.5)-.1*Math.min(1,sum('latency_ms')/n/10000)+.15*((coverage??.5)-.5)),last_observed_at:xs.map(x=>x.observed_at).sort().at(-1)!,source_counts:Object.fromEntries([...new Set(xs.map(x=>x.source))].map(s=>[s,xs.filter(x=>x.source===s).length]))};
 });
}
export function matchCapability(map:CapabilitySummary[],provider:string,queryClass:string,unit:string,kind:string,vertical:string){return map.find(x=>x.provider===provider&&x.query_class===queryClass&&x.answer_unit===unit&&x.kind===kind&&x.vertical===vertical)}
