import {canonicalContextKey} from './context-pull.js';
export type DecisionGroup={key:string;members:string[];role:'eligibility'|'capability'|'physical_fit'|'presentation'|'meaning'|'purchase_confidence'|'routine'|'other';distinct_effect:string;member_effects?:{key:string;answer_sought:string;consequence:string;effect_class?:'functional'|'psychological';independent:boolean;why:string}[]};
// The model identifies equivalent answers; the validator checks coverage and makes
// that grouping operational. It does not guess equivalence from key substrings.
export function decisionGroups(raw:unknown,keys:string[],required=false,requireEffects=false):DecisionGroup[]{
 if(raw===undefined&&!required)return [];
 if(!Array.isArray(raw)||!raw.length)throw new Error('decision_groups required');
 const seen=new Set<string>(),ids=new Set<string>();const roles=['eligibility','capability','physical_fit','presentation','meaning','purchase_confidence','routine','other'];
 const groups:DecisionGroup[]=raw.map((x:any)=>{
  if(!x||typeof x.key!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(x.key)||!roles.includes(x.role)||typeof x.distinct_effect!=='string'||!x.distinct_effect.trim()||!Array.isArray(x.members)||!x.members.length)throw new Error('invalid decision_groups shape');
  let key=canonicalContextKey(x.key);
  const members=x.members.map((m:unknown)=>{if(typeof m!=='string'||!keys.includes(m))throw new Error('unknown decision_groups member');if(seen.has(m))throw new Error('duplicate decision_groups member');seen.add(m);return m;});
  let member_effects:DecisionGroup['member_effects'];
  if(requireEffects||x.member_effects!==undefined){
   if(!Array.isArray(x.member_effects)||x.member_effects.length!==members.length)throw new Error('decision_groups member effects incomplete');
   const checked=new Set<string>();member_effects=x.member_effects.map((e:any)=>{
    if(!e||!members.includes(e.key)||checked.has(e.key)||typeof e.independent!=='boolean'||['answer_sought','consequence','why'].some(k=>typeof e[k]!=='string'||!e[k].trim()))throw new Error('decision_groups invalid member effect');
    if(requireEffects&&!['functional','psychological'].includes(e.effect_class))throw new Error('decision_groups member effect class required');
    if(e.effect_class!==undefined&&!['functional','psychological'].includes(e.effect_class))throw new Error('decision_groups invalid effect class');
    checked.add(e.key);return {key:e.key,effect_class:e.effect_class,answer_sought:e.answer_sought.slice(0,300),consequence:e.consequence.slice(0,500),independent:e.independent,why:e.why.slice(0,500)};
   });
   if(members.length>1&&member_effects?.some(e=>e.independent))throw new Error('decision_groups preserve independent consequence in its own slot');
  }
  const independent=member_effects?.some(e=>e.independent)??false;
  if(independent){
   if(key!==canonicalContextKey(members[0]))throw new Error('decision_groups preserve independent consequence in its own slot');
  }else{
   const family=({presentation:'social_image_fit',purchase_confidence:'buying_comfort',routine:'usage_pattern'} as Record<string,string>)[x.role];
   if(family)key=family;
  }
  if(ids.has(key))throw new Error('duplicate decision_groups key');ids.add(key);
  return {key,members,role:x.role,distinct_effect:x.distinct_effect.trim().slice(0,500),member_effects};
 });
 if(keys.some(k=>!seen.has(k)))throw new Error('decision_groups incomplete coverage');
 // One presentation comparison per group; more require an actually different role,
 // not multiple keys for style, recognition and brand image.
 for(const role of ['presentation','purchase_confidence','routine','meaning'])if(groups.filter(g=>g.role===role&&!g.member_effects?.some(e=>e.independent)).length>1)throw new Error(`overlapping decision_groups role ${role}`);
 return groups;
}
