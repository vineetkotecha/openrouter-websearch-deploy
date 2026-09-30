import type {SearchRequest} from '../contracts/search.js';
export type IntendedAction={kind:'inspire'|'choose'|'prepare_booking'|'unknown';evidence?:string;question?:string;source:'query'|'caller'|'unresolved';needs_clarification?:boolean};
export function normalizeIntendedAction(raw:unknown,r:SearchRequest):IntendedAction{
 const allowed=['inspire','choose','prepare_booking'];
 const supplied=r.context.find(c=>c.key==='intended_action'&&(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(!c.allowed_uses?.length||c.allowed_uses.includes('search'))&&c.class!=='psychological'&&c.confidence>=.8&&c.evidence?.some(e=>e.reference)&&allowed.includes(String(c.value)));
 if(supplied)return{kind:supplied.value as IntendedAction['kind'],source:'caller',evidence:supplied.evidence!.map(e=>e.reference).join('; ')};
 const x=raw as any;const evidence=typeof x?.query_quote==='string'?x.query_quote.trim():'';
 if(allowed.includes(x?.kind)&&evidence&&r.query.includes(evidence))return{kind:x.kind,source:'query',evidence};
 return{kind:'unknown',source:'unresolved',needs_clarification:x?.needs_clarification===true,question:'Do you want ideas, help choosing one, or something ready to book?'};
}
