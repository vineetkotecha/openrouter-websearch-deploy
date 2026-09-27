import { randomUUID } from "node:crypto";
import type { Mandate, SearchRequest } from "../contracts/search.js";
import { canonicalContextKey, canonicalGaps, heuristicGaps } from "./context-pull.js";

export type CuratedParameter = {
  key: string; class: "functional" | "psychological"; value?: unknown;
  state: "resolved" | "missing" | "conflict" | "stale";
  source?: "query" | "caller" | "human" | "prior_outcome";
  evidence: { source: string; reference?: string }[];
  confidence: number; observed_at?: string; expires_at?: string;
  allowed_uses: ("search" | "rerank" | "ask")[];
  hard: boolean; material: boolean; priority: number; effect: "eligibility" | "retrieval" | "ranking";
  question?: string; alternatives?: { source: string; value: unknown }[];
};
export type CuratedParameterManifest = {
  id: string; version: 1; query: string; formed_query: string; created_at: string;
  parameters: CuratedParameter[]; conflicts: string[]; revision_of?: string;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nonempty = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const allow = (c: SearchRequest["context"][number]) => c.allowed_uses?.length ? c.allowed_uses : ["search", "rerank", "ask"] as ("search" | "rerank" | "ask")[];
const materialKeys = new Set(["location", "origin", "use_case", "recipient"]);
const humanOnly = (c: SearchRequest["context"][number]) => c.class === "psychological";
const sensitive = (key:string) => /(?:religion|race|ethnic|gender|sexual|disability|health|medical|politic|age|income|credit|biometric)/i.test(key);
// A direct quote or caller's own understanding with a reference is required for a human factor.
// A query alone, an unreferenced profile, or a model hypothesis cannot create one.
export function curateParameters(r: SearchRequest, m?: Mandate, revision_of?: string): CuratedParameterManifest {
  const now = Date.now();
  const slots = new Map<string, CuratedParameter>();
  const put = (p: CuratedParameter) => slots.set(`${p.class}:${p.key}`, p);
  for (const [raw, value] of Object.entries(r.hard_constraints)) {
    const key=canonicalContextKey(raw);
    put({key,class:"functional",value,state:"resolved",source:"query",evidence:[{source:"query",reference:`hard_constraints.${raw}`}],confidence:1,allowed_uses:["search","rerank"],hard:true,material:true,priority:100,effect:"eligibility"});
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
  // Model-authored values never become curated facts just because a broad query
  // phrase resembles their evidence. The mandate may use them as tentative
  // ranking hints; this manifest contains only explicit constraints/context.
  const gaps=canonicalGaps([...heuristicGaps(r),...(m?.gaps??[])]);
  for(const g of gaps){const key=canonicalContextKey(g.key),old=slots.get(`functional:${key}`);
    if(old?.state==="resolved" && !old.alternatives?.length)continue;
    if(old?.hard)continue;
    if(old) {old.material=materialKeys.has(key) && g.material;old.question=g.question;continue;}
    put({key,class:"functional",state:"missing",evidence:[],confidence:0,allowed_uses:["search","ask"],hard:false,material:materialKeys.has(key)&&g.material,priority:materialKeys.has(key)&&g.material?80:20,effect:materialKeys.has(key)?"retrieval":"ranking",question:g.question});
  }
  return {id:randomUUID(),version:1,query:r.query,formed_query:r.query,created_at:new Date().toISOString(),parameters:[...slots.values()].sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key)),conflicts:[...slots.values()].filter(p=>p.state==="conflict").map(p=>p.key),revision_of};
}
export function curatedRequest(r:SearchRequest, manifest:CuratedParameterManifest):SearchRequest {
  const selected=new Map(manifest.parameters.filter(p=>p.state==="resolved"&&!p.hard).map(p=>[`${p.class}:${p.key}`,p]));
  return {...r,context:r.context.filter(c=>{const p=selected.get(`${c.class==="psychological"?"psychological":"functional"}:${canonicalContextKey(c.key)}`);return p&&p.source===c.source&&equal(p.value,c.value)&&(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(!c.allowed_uses||c.allowed_uses.includes("search")||c.allowed_uses.includes("rerank"))})};
}
