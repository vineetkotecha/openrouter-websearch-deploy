import type {SearchRequest,SearchResponse} from '../contracts/search.js';
import type {AuditVerdict} from './architecture.js';
import {candidateKey} from './entities.js';
type Ranked=SearchResponse['results'][number];
export type FinalAnswer={status:'supported_options'|'provisional_options'|'insufficient_evidence';summary:string;options:{candidate_key:string;name:string;why:string[];catch:string[];evidence_state:'supported'|'not_checked';links:{url:string;label:string;kind:'specific_option'|'source_info'|'booking';verified_destination:boolean;dates_verified:boolean}[]}[];limitations:string[]};
const root=(url:string)=>{try{const u=new URL(url);return /^\/?$|^\/(?:en|in|en-in|in\/en)\/?$|\/(?:index|home)\.(?:html|php)$/.test(u.pathname)}catch{return true}};
export function buildFinalAnswer(r:SearchRequest,results:Ranked[],audits:AuditVerdict[],limitations:string[],linkChecks:Map<string,any>=new Map()):FinalAnswer{
 const options=results.slice(0,5).map(x=>{
  const supported=Object.entries(x.fields??{}).filter(([,f])=>f.state==='supported'&&f.value!==null);
  const missing=Object.entries(x.fields??{}).filter(([,f])=>f.state==='missing').map(([k])=>k.replace(/_/g,' '));
  const audit=audits.find(a=>(a.candidate_key??a.url)===candidateKey(x));const proven=audit?.state==='pass'&&audit.evidence_state==='supported'&&missing.length===0;
  const why=supported.map(([key,f])=>`${key.replace(/_/g,' ')}: ${f.value}. Source: ${f.evidence??'typed field'}`);
  if(!why.length)why.push(x.entity?`Named in the source: ${x.entity.evidence}`:'Retrieved as a possible match; its decisive facts are not established.');
  if(x.reason&&/Jev|preference/i.test(x.reason))why.push(x.reason);
  const catches=[...missing.map(k=>`${k} not verified.`)];if(!proven)catches.push('Not all explicit requirements are source-proven.');
  const check=linkChecks.get(candidateKey(x));
  const sourceOnly=x.entity?.link_kind==='source_only',home=root(x.url),read=supported.length>0||!!x.entity;
  const linkFailed=check?.opened===true&&!check?.specific;
  const links=home||linkFailed?[]:[{url:x.url,label:sourceOnly?'Read the source mentioning this option':check?.specific?(check.booking?'Open booking for this specific option (dates not checked)':'Open this specific option page'):x.entity?'Open the linked option page (not yet opened)':read?'Open this specific option page':'Open the unverified candidate page',kind:sourceOnly?'source_info' as const:check?.booking?'booking' as const:'specific_option' as const,verified_destination:check?.specific===true||read&&!sourceOnly&&!x.entity,dates_verified:false}];
  if(linkFailed)catches.push('The linked option page could not be confirmed; no actionable link is shown.');
  if(home)catches.push('Only a homepage was found; no useful option link is available.');
  if(/\b(?:trip|travel|destination|hotel|stay|book)\b/i.test(r.query))catches.push('No dated booking page or availability has been verified.');
  return {candidate_key:candidateKey(x),name:x.title,why,catch:catches,evidence_state:proven?'supported' as const:'not_checked' as const,links};
 });
 const status=!options.length?'insufficient_evidence':options.every(x=>x.evidence_state==='supported')?'supported_options':'provisional_options';
 return {status,summary:!options.length?'No source-backed options are available yet.':status==='supported_options'?`${options.length} options have source support for the stated requirements.`:`${options.length} possible options, with the missing checks shown below. This is not a verified shortlist.`,options,limitations:[...new Set(limitations)]};
}
