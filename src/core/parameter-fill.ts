import type { Mandate, SearchRequest } from "../contracts/search.js";
import { openGaps } from "./context-pull.js";

// The first query pass asks the caller only for facts capable of changing the result set.
// Retrieval from the permissioned, fresh context store runs before this function.
export type FillDecision = { ask: { key:string; question:string; reason:string }[]; defaults: { key:string; reason:string }[]; stale: string[] };
export function decideFill(m: Mandate, r: SearchRequest, maxQuestions=3): FillDecision {
  const now=Date.now();
  const fresh=r.context.filter(c=>!c.expires_at||Date.parse(c.expires_at)>now);
  const stale=r.context.filter(c=>c.expires_at&&Date.parse(c.expires_at)<=now).map(c=>c.key);
  const live={...r,context:fresh};
  const gaps=openGaps(m,live);
  const ask:FillDecision["ask"]=[],defaults:FillDecision["defaults"]=[];
  const seen=new Set<string>();
  for(const g of gaps){
    const key=g.key.toLowerCase();if(seen.has(key))continue;seen.add(key);
    if(g.material&&g.question&&ask.length<maxQuestions&&r.permissions.may_pull_context){
      ask.push({key:g.key,question:g.question,reason:"Could change which results qualify or win"});
    }else defaults.push({key:g.key,reason:g.material?"Material gap not asked within caller/batch limit; proceed with declared uncertainty":"Optional preference absent; do not infer it"});
  }
  return {ask,defaults,stale};
}
