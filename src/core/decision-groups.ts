import {canonicalContextKey} from './context-pull.js';
export type DecisionGroup={key:string;members:string[];role:'eligibility'|'capability'|'physical_fit'|'presentation'|'meaning'|'purchase_confidence'|'routine'|'other';distinct_effect:string};
// The model identifies equivalent answers; the validator checks coverage and makes
// that grouping operational. It does not guess equivalence from key substrings.
export function decisionGroups(raw:unknown,keys:string[],required=false):DecisionGroup[]{
 if(raw===undefined&&!required)return [];
 if(!Array.isArray(raw)||!raw.length)throw new Error('decision_groups required');
 const seen=new Set<string>(),ids=new Set<string>();const roles=['eligibility','capability','physical_fit','presentation','meaning','purchase_confidence','routine','other'];
 const groups:DecisionGroup[]=raw.map((x:any)=>{
  if(!x||typeof x.key!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(x.key)||!roles.includes(x.role)||typeof x.distinct_effect!=='string'||!x.distinct_effect.trim()||!Array.isArray(x.members)||!x.members.length)throw new Error('invalid decision_groups shape');
  const key=canonicalContextKey(x.key);const family=({presentation:'social_image_fit',purchase_confidence:'buying_comfort',routine:'usage_pattern'} as Record<string,string>)[x.role];if(family&&key!==family)throw new Error('decision_groups use canonical family key');if(ids.has(key))throw new Error('duplicate decision_groups key');ids.add(key);
  const members=x.members.map((m:unknown)=>{if(typeof m!=='string'||!keys.includes(m))throw new Error('unknown decision_groups member');if(seen.has(m))throw new Error('duplicate decision_groups member');seen.add(m);return m;});
  return {key,members,role:x.role,distinct_effect:x.distinct_effect.trim().slice(0,500)};
 });
 if(keys.some(k=>!seen.has(k)))throw new Error('decision_groups incomplete coverage');
 // One presentation comparison per group; more require an actually different role,
 // not multiple keys for style, recognition and brand image.
 for(const role of ['presentation','purchase_confidence','routine','meaning'])if(groups.filter(g=>g.role===role).length>1)throw new Error(`overlapping decision_groups role ${role}`);
 return groups;
}
