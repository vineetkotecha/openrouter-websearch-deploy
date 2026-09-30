import {physicalProperty} from './parameter-class.js';
import { randomUUID } from "node:crypto";
import type { Mandate, SearchRequest } from "../contracts/search.js";
import { canonicalContextKey, canonicalGaps, heuristicGaps } from "./context-pull.js";
import {validatedIntentRequirements,type IntentFormation} from "./intent-formation.js";

export type CuratedParameter = {
  key: string; class: "functional" | "psychological"; value?: unknown;
  state: "resolved" | "missing" | "conflict" | "stale";
  source?: "query" | "caller" | "human" | "prior_outcome";
  evidence: { source: string; reference?: string }[];
  confidence: number; observed_at?: string; expires_at?: string;
  allowed_uses: ("search" | "rerank" | "ask")[];
  hard: boolean; material: boolean; priority: number; criticality:number; compulsory:boolean; effect: "eligibility" | "retrieval" | "ranking";
  question?: string; alternatives?: { source: string; value: unknown }[];
};
export type CuratedParameterManifest = {
  id: string; version: 1; query: string; formed_query: string; created_at: string;
  parameters: CuratedParameter[]; conflicts: string[]; revision_of?: string; intent?:IntentFormation; criticality_cutoff: number;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nonempty = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const allow = (c: SearchRequest["context"][number]) => c.allowed_uses?.length ? c.allowed_uses : ["search", "rerank", "ask"] as ("search" | "rerank" | "ask")[];
const materialKeys = new Set(["location", "origin", "use_case", "recipient"]);
const humanOnly = (c: SearchRequest["context"][number]) => c.class === "psychological";
// These are questions, not inferred values. Ask only for an open-ended choice
// where different answers could reverse which eligible option wins.
const openChoice=(r:SearchRequest)=>/\b(?:best|recommend|choose|pick|which)\b/i.test(r.query)&&!r.category_hint;
const hotelChoice=(r:SearchRequest)=>openChoice(r)&&/\b(?:hotels?|stays?|lodg(?:ing|es?))\b/i.test(r.query);
const sensitive = (key:string) => /(?:religion|race|ethnic|gender|sexual|disability|health|medical|politic|age|income|credit|biometric)/i.test(key);
// A direct quote or caller's own understanding with a reference is required for a human factor.
// A query alone, an unreferenced profile, or a model hypothesis cannot create one.
export function curateParameters(r: SearchRequest, m?: Mandate, revision_of?: string, intent?:IntentFormation): CuratedParameterManifest {
  const now = Date.now();
  const slots = new Map<string, CuratedParameter>();
  const put = (p: Omit<CuratedParameter,"criticality"|"compulsory">) => slots.set(`${p.class}:${p.key}`, {...p,criticality:p.material?80:p.effect==="ranking"?10:40,compulsory:p.material});
  put({key:"search_object",class:"functional",value:r.query,state:"resolved",source:"query",evidence:[{source:"query",reference:r.query}],confidence:1,allowed_uses:["search","rerank"],hard:false,material:false,priority:20,effect:"retrieval"});
  for (const [raw, value] of Object.entries(r.hard_constraints)) {
    const key=canonicalContextKey(raw);
    put({key,class:"functional",value,state:"resolved",source:"query",evidence:[{source:"query",reference:`hard_constraints.${raw}`}],confidence:1,allowed_uses:["search","rerank"],hard:true,material:true,priority:100,effect:"eligibility"});
  }
  // Explicit numeric requirements in the original query are constraints, not
  // model preferences. Preserve them even if parameter generation drops hard.
  const ram=r.query.match(/\b(\d+)\s*GB\s*RAM\b/i);
  if(ram&&!/\b(?:prefer|ideally|optional)\b/i.test(r.query.slice(Math.max(0,ram.index!-25),ram.index)))
    put({key:"ram",class:"functional",value:ram[0],state:"resolved",source:"query",evidence:[{source:"query",reference:ram[0]}],confidence:1,allowed_uses:["search","rerank"],hard:true,material:true,priority:100,effect:"eligibility"});
  const cap=r.query.match(/\b(?:under|below|maximum|max|up to)\s*(?:₹|INR|Rs\.?\s*)?([\d,]+)\s*(?:INR|rupees|rs\.?)?/i);
  if(cap&&(/(?:₹|INR|rupees|rs\.?)/i.test(cap[0])||intent?.answer_unit==="product"&&r.country==="IN"&&!/\b(?:kg|grams|hours|days|dollars|usd|eur|gb)\b/i.test(r.query.slice(cap.index!+cap[0].length,cap.index!+cap[0].length+15))))put({key:"price_max_inr",class:"functional",value:Number(cap[1]!.replace(/,/g,"")),state:"resolved",source:"query",evidence:[{source:"query",reference:cap[0]}],confidence:1,allowed_uses:["search","rerank"],hard:true,material:true,priority:100,effect:"eligibility"});
  if(intent?.answer_unit==="local_business"){
    const area=r.query.match(/\b(?:in|near|around)\s+(?!me\b|my\b|the\b)([A-Z][\p{L}\s,-]{2,80})/u);
    if(area)put({key:"location",class:"functional",value:area[1]!.trim(),state:"resolved",source:"query",evidence:[{source:"query",reference:area[0]}],confidence:1,allowed_uses:["search","rerank"],hard:false,material:true,priority:80,effect:"retrieval"});
  }
  const context = [...r.context].sort((a,b)=>({human:4,caller:3,query:2,prior_outcome:1}[b.source]-{human:4,caller:3,query:2,prior_outcome:1}[a.source]));
  for (const c of context) {
    const key=canonicalContextKey(c.key), cls=humanOnly(c)?"psychological":"functional";
    if (cls==="psychological" && (sensitive(key)||c.source==="query" || !c.evidence?.some(e=>e.reference && e.source===c.source))) continue;
    const id=`${cls}:${key}`, old=slots.get(id), tooOld=key==="location" && !!c.observed_at && now-Date.parse(c.observed_at)>=15*60_000, expired=tooOld || !!c.expires_at && (!Number.isFinite(Date.parse(c.expires_at)) || Date.parse(c.expires_at)<=now);
    const evidence=c.evidence?.length?c.evidence.map(e=>({source:e.source,reference:e.reference})):[{source:c.source,reference:`context.${c.key}`}];
    if (old?.hard) { if (!expired && nonempty(c.value) && !equal(c.value,old.value)) old.alternatives=[...(old.alternatives??[]),{source:c.source,value:c.value}]; continue; }
    if (old?.state==="conflict") continue;
    if (expired || !nonempty(c.value)) {if (!old) put({key,class:cls,state:"stale",source:c.source,evidence,confidence:0,observed_at:c.observed_at,expires_at:c.expires_at,allowed_uses:allow(c),hard:false,material:materialKeys.has(key),priority:materialKeys.has(key)?80:20,effect:cls==="psychological"?"ranking":"retrieval"}); continue;}
    if (old?.state==="resolved" && !equal(old.value,c.value)) {
      old.state="conflict";old.alternatives=[{source:old.source??"unknown",value:old.value},{source:c.source,value:c.value}];delete old.value;continue;
    }
    if (old?.state==="resolved") continue;
    put({key,class:cls,value:c.value,state:"resolved",source:c.source,evidence,confidence:c.confidence,observed_at:c.observed_at,expires_at:c.expires_at,allowed_uses:allow(c),hard:false,material:materialKeys.has(key),priority:materialKeys.has(key)?80:20,effect:cls==="psychological"?"ranking":"retrieval"});
  }
  for (const p of r.agent_understanding?.psychological_parameters??[]) {
    if (sensitive(p.key)||!p.evidence.some(e=>e.reference && e.source!=="prior_outcome")) continue;
    const key=canonicalContextKey(p.key);if(slots.has(`psychological:${key}`))continue;
    put({key,class:"psychological",value:p.value,state:"resolved",source:"caller",evidence:p.evidence,confidence:p.confidence,allowed_uses:["rerank"],hard:false,material:false,priority:10,effect:"ranking"});
  }
  if(hotelChoice(r)) for(const [key,question] of [
    ["travel_party","Who is this stay for (solo, business, family, or someone else)?"],
    ["trip_purpose","What is the main purpose of the stay?"],
  ] as const){
    const supplied=[...slots.values()].some(p=>p.state==="resolved"&&p.class==="psychological"&&p.key===key);
    const statedValue=key==="travel_party"?r.query.match(/\b(solo|alone|family|with (?:kids|children|partner|friends|colleagues))\b/i)?.[0]:r.query.match(/\b(business|work trip|conference|vacation|holiday|leisure)\b/i)?.[0];
    if(!supplied&&statedValue)put({key,class:"psychological",value:statedValue,state:"resolved",source:"query",evidence:[{source:"query",reference:statedValue}],confidence:1,allowed_uses:["rerank"],hard:false,material:false,priority:30,effect:"ranking"});
    else if(!supplied)put({key,class:"psychological",state:"missing",evidence:[],confidence:0,allowed_uses:["rerank","ask"],hard:false,material:true,priority:80,effect:"ranking",question});
  }
  if(intent?.category_state==="ambiguous"&&!r.category_hint){
    put({key:"intent_category",class:"functional",state:"missing",evidence:[],confidence:0,allowed_uses:["search","ask"],hard:false,material:true,priority:80,effect:"retrieval",question:`Which kind of result would you like? ${intent.intent_space.map(x=>x.category).join(", ")}?`});
  }
  for(const g of intent?validatedIntentRequirements(r,intent):[]){
    const key=canonicalContextKey(g.key), old=slots.get(`functional:${key}`);
    if(old?.state==='resolved')continue;
    if(old){old.material=true;old.criticality=80;old.compulsory=true;old.question=g.question;continue;}
    put({key,class:'functional',state:'missing',evidence:[],confidence:0,allowed_uses:['search','ask'],hard:false,material:true,priority:80,effect:'retrieval',question:g.question});
  }
  for(const g of intent?.unknowns??[]){
    if(slots.has(`functional:${g.key}`)||g.key==="intent_category")continue;
    put({key:g.key,class:"functional",state:"missing",evidence:[],confidence:0,allowed_uses:["search","ask"],hard:false,material:false,priority:g.result_changing?55:20,effect:"retrieval",question:g.question});
  }
  for(const h of intent?.candidate_human_factors??[]){
    const key=canonicalContextKey(h.key),cls=physicalProperty(key)?"functional":"psychological";
    if(slots.has(`${cls}:${key}`)||sensitive(key))continue;
    put({key,class:cls,state:"missing",evidence:[],confidence:0,allowed_uses:["rerank","ask"],hard:false,material:false,priority:10,effect:"ranking",question:h.question});
  }
  // Model-authored values never become curated facts just because a broad query
  // phrase resembles their evidence. The mandate may use them as tentative
  // ranking hints; this manifest contains only explicit constraints/context.
  const gaps=canonicalGaps([...heuristicGaps(r),...(m?.gaps??[])]);
  for(const g of gaps){const key=canonicalContextKey(g.key),old=slots.get(`functional:${key}`);
    if(old?.state==="resolved" && !old.alternatives?.length)continue;
    if(old?.hard)continue;
    if(old) {old.material=materialKeys.has(key) && g.material;old.criticality=old.material?80:old.effect==="ranking"?10:40;old.compulsory=old.criticality>=70;old.question=g.question;continue;}
    put({key,class:"functional",state:"missing",evidence:[],confidence:0,allowed_uses:["search","ask"],hard:false,material:materialKeys.has(key)&&g.material,priority:materialKeys.has(key)&&g.material?80:20,effect:materialKeys.has(key)?"retrieval":"ranking",question:g.question});
  }
  return {criticality_cutoff:70,id:randomUUID(),version:1,query:r.query,formed_query:r.query,created_at:new Date().toISOString(),parameters:[...slots.values()].sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key)),conflicts:[...slots.values()].filter(p=>p.state==="conflict").map(p=>p.key),revision_of,intent};
}
export function curatedRequest(r:SearchRequest, manifest:CuratedParameterManifest):SearchRequest {
  const selected=new Map(manifest.parameters.filter(p=>p.state==="resolved"&&!p.hard).map(p=>[`${p.class}:${p.key}`,p]));
  return {...r,
    context:r.context.filter(c=>{const p=selected.get(`${c.class==="psychological"?"psychological":"functional"}:${canonicalContextKey(c.key)}`);return p&&p.source===c.source&&equal(p.value,c.value)&&(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(!c.allowed_uses||c.allowed_uses.includes("search")||c.allowed_uses.includes("rerank"))}),
    agent_understanding:r.agent_understanding?{...r.agent_understanding,psychological_parameters:r.agent_understanding.psychological_parameters.filter(x=>{const p=selected.get(`psychological:${canonicalContextKey(x.key)}`);return p?.source==="caller"&&equal(p.value,x.value)&&p.evidence.some(e=>!!e.reference)})}:undefined,
  };
}
