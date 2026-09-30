import {normalizeContextFacts} from './context-facts.js';
import type {DecisiveFact} from './fact-schema.js';
import {createHash} from 'node:crypto';
import type {ProviderResult} from '../contracts/search.js';
import {decisiveFields,normalizeDecisiveFacts,type FactVertical} from './decisive-facts.js';
import {pageShape} from '../learning/provider-capabilities.js';
export const candidateKey=(x:Pick<ProviderResult,'url'|'entity'>)=>x.entity?.id??x.url;
export const collectionSource=(x:ProviderResult)=>!x.entity&&(pageShape(x)==='collection'||/\b(?:restaurants?|cafes?|destinations?|places)\b.*\b(?:in|for|to visit)\b/i.test(x.title)||/\/blog\//i.test(x.url));
export function normalizeEntities(raw:unknown,source:ProviderResult,page:string,vertical:FactVertical|DecisiveFact[],max=5):ProviderResult[]{
 const r=raw as any;if(r?.page_kind!=='collection'||!Array.isArray(r.entities))return [];
 const out:ProviderResult[]=[];const seen=new Set<string>();
 for(const e of r.entities.slice(0,max)){
  if(typeof e?.name!=='string'||e.name.length<2||e.name.length>160||typeof e.evidence_quote!=='string'||e.evidence_quote.length>2000||!e.evidence_quote.includes(e.name)||!page.includes(e.evidence_quote))continue;
  const name=e.name.trim();if(seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());
  let url=source.url,direct=false;
  if(typeof e.url==='string'&&e.url){try{const u=new URL(e.url);if(['http:','https:'].includes(u.protocol)&&!/(?:^|\.)localhost$|^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)&&page.includes(e.url)&&typeof e.link_quote==='string'&&e.link_quote.includes(e.name)&&e.link_quote.includes(e.url)&&page.includes(e.link_quote)){url=u.href;direct=true}}catch{}}
  const id='entity-'+createHash('sha256').update(`${name.toLowerCase()}|${direct?url:source.url}`).digest('hex').slice(0,24);
  const fields=Array.isArray(vertical)?normalizeContextFacts({entity_match:true,fields:e.fields},e.evidence_quote,vertical):normalizeDecisiveFacts({entity_match:true,fields:e.fields},vertical,e.evidence_quote,decisiveFields(vertical));
  out.push({...source,url,title:name,snippet:e.evidence_quote,fields,entity:{id,name,source_url:source.url,evidence:e.evidence_quote,link_kind:direct?'direct':'source_only'},raw:{verified_content:true,support:1,passage:e.evidence_quote,faithfulness:{state:'supported',score:1,method:'literal_entity_quote',claims:[]},retrieved_at:new Date().toISOString()}});
 }
 return out;
}
