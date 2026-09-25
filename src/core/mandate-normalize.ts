import type {SearchRequest} from "../contracts/search.js";
import {MandateSchema, type Mandate} from "../contracts/search.js";

import {randomUUID} from "node:crypto";
const sources=new Set(["query","caller","human","prior_outcome"]);
// Schema-safe normalization. The deterministic baseline preserves explicit constraints and
// five quality factors; model factors can add detail only after provenance is checked.
export async function normalizeModelMandate(raw:any,r:SearchRequest,promptVersion:string):Promise<Mandate>{
  if(!raw||typeof raw!=="object"||!Array.isArray(raw.factors))throw new Error("model mandate missing factors");
  const defaultFactor=(key:string,description:string,value:unknown,weight:number,hard=false)=>({key,class:"functional" as const,description,value,weight,confidence:1,hard,evidence:[{source:"query" as const,reference:hard?`hard_constraints.${key}`:"query"}]});
  const base={category:r.category_hint??"general_consumer_search",factors:[...Object.entries(r.hard_constraints).map(([k,v])=>defaultFactor(k,`Require ${k}.`,v,1,true)),defaultFactor("query_relevance","Match the explicit search objective.",r.query,1),defaultFactor("result_directness","Prefer direct results.",r.query,.8),defaultFactor("source_support","Prefer checkable source support.","verifiable",.7),defaultFactor("result_specificity","Prefer specific usable results.",r.query,.65),defaultFactor("current_accessibility","Prefer accessible results.",true,.55)]};const valid:any[]=[];
  const permitted=new Set([...Object.keys(r.hard_constraints),...r.context.map(c=>c.key),...r.agent_understanding?.psychological_parameters.map(c=>c.key)??[]]);
  for(const f of raw.factors.slice(0,50)){
    if(!f||typeof f!=="object"||typeof f.key!=="string")continue;
    const psychological=f.class==="psychological";
    const supplied=psychological&&(r.agent_understanding?.psychological_parameters.some(p=>p.key===f.key)||r.context.some(c=>c.key===f.key&&c.class==="psychological"&&!!c.evidence?.length));
    if(psychological&&!supplied)continue;
    const evidence=Array.isArray(f.evidence)?f.evidence.filter((e:any)=>e&&sources.has(e.source)&&(!e.reference||typeof e.reference==="string")):[];
    if(!evidence.length)continue;
    const next={...f,evidence,hard:psychological?false:f.hard};
    const parsed=MandateSchema.shape.factors.element.safeParse(next);
    if(parsed.success)valid.push(parsed.data);
  }
  const keys=new Set(valid.map(f=>f.key));
  const factors=[...valid];
  // Hard constraints from request override any model interpretation.
  for(const f of base.factors){if(f.hard){const i=factors.findIndex(x=>x.key===f.key);if(i>=0)factors.splice(i,1);factors.unshift(f)}else if(factors.length<5&&!keys.has(f.key)){factors.push(f);keys.add(f.key)}}
  const gaps=Array.isArray(raw.gaps)?raw.gaps.filter((g:any)=>g&&typeof g.key==="string"&&(permitted.has(g.key)||g.key==="location"||g.key==="budget")).slice(0,3):[];
  return MandateSchema.parse({id:randomUUID(),version:2,prompt_version:promptVersion,intent:typeof raw.intent==="string"&&raw.intent.trim()?raw.intent:r.query,category:typeof raw.category==="string"&&raw.category.trim()?raw.category:base.category,factors:factors.slice(0,50),gaps,policy:r.permissions,created_at:new Date().toISOString()});
}
