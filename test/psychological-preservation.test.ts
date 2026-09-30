import {it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {normalizeIntentFormation,fallbackIntentFormation} from '../src/core/intent-formation.js';
import {curateParameters} from '../src/core/parameter-curation.js';
import {validateModelParameters} from '../src/core/architecture.js';
const r=SearchRequestSchema.parse({tenant_id:'t',query:'laptop for coding',context:[{key:'brand_familiarity',class:'psychological',value:'prefer brands I know',source:'human',confidence:1,evidence:[{source:'human',reference:'user reply'}]}]});
const intent=normalizeIntentFormation({answer_unit:'product',candidate_human_factors:[{key:'keyboard_comfort_priority',question:'Comfortable keyboard?',why:'Typing ergonomics'},{key:'upgradeability_desire',question:'Upgradeable RAM?',why:'Hardware access'},{key:'gpu_requirement',question:'Need dedicated graphics?',why:'Hardware needs'},{key:'os_preference',question:'Which operating system?',why:'Compatibility'},{key:'brand_preference',question:'Any familiar brands you prefer?',why:'Choice fit'}]},r);
it('separates software/hardware questions from genuine choice factors in understanding',()=>{
 expect(intent.candidate_human_factors.map(x=>x.key)).toEqual(['brand_preference']);expect(intent.unknowns.map(x=>x.key)).toContain('gpu_requirement');expect(intent.unknowns.map(x=>x.key)).toContain('keyboard_comfort_priority');expect(intent.unknowns.map(x=>x.key)).toContain('upgradeability_desire');expect(intent.unknowns.map(x=>x.key)).toContain('os_preference');
});
it('carries evidenced and unanswered choice slots through valid model omissions without inventing values',()=>{
 const b=curateParameters(r,undefined,undefined,intent);const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Item sought',query_reference:'laptop',weight_percent:100,compulsory:false}]},r,intent,b);
 expect(m.parameters.find(x=>x.key==='brand_familiarity')).toMatchObject({class:'psychological',state:'resolved',value:'prefer brands I know',source:'human',hard:false});expect(m.parameters.find(x=>x.key==='brand_preference')).toMatchObject({class:'psychological',state:'missing',hard:false,compulsory:false});expect(m.parameters.reduce((a,b)=>a+b.priority,0)).toBeCloseTo(100);expect(m.parameters.filter(x=>x.class==='psychological').some(x=>x.key==='gpu_requirement')).toBe(false);
});
it('has no forced psychological minimum for purely factual queries',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'laptop model number lookup'}),i=normalizeIntentFormation({answer_unit:'product'},q),b=curateParameters(q,undefined,undefined,i);const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Item',query_reference:'laptop',weight_percent:100,compulsory:false}]},q,i,b);expect(m.parameters.filter(x=>x.class==='psychological')).toEqual([]);
});
it('requires consideration, not a forced factor: relevant families form valueless slots and irrelevant ones do not',async()=>{
 const {validateHumanFactorConsiderations}=await import('../src/core/intent-formation.js');
 const raw={answer_unit:'product',human_factor_considerations:[{family:'social_image_fit',relevant:true,why:'Used in shared work settings where desired look may change fit',question:'What look would feel right in your work setting?',value:'high status'},{family:'buying_comfort',relevant:true,why:'Purchase commitment with alternatives',question:'What would help you feel comfortable choosing one?'},{family:'usage_pattern',relevant:false,why:'Already enough factual use requirements for this lookup'}]};
 expect(()=>validateHumanFactorConsiderations(raw)).not.toThrow();const i=normalizeIntentFormation(raw,r);expect(i.candidate_human_factors.map(x=>x.key)).toEqual(['social_image_fit','buying_comfort']);expect(i.candidate_human_factors.every(x=>!('value' in x))).toBe(true);expect(i.human_factor_considerations).toHaveLength(3);expect(()=>validateHumanFactorConsiderations({human_factor_considerations:[]})).toThrow('consideration');
});

it('preserves relevant image and usage slots through both safety gates without treating age substrings as demographics',()=>{
 const i=normalizeIntentFormation({answer_unit:'product',human_factor_considerations:[
  {family:'social_image_fit',relevant:true,why:'Desired look may change choice among laptops',question:'What look feels right?'},
  {family:'buying_comfort',relevant:true,why:'Purchase confidence affects brand choice',question:'What would make choosing comfortable?'},
  {family:'usage_pattern',relevant:true,why:'Coding routine may change choice',question:'Where do you normally code?'}],
  candidate_human_factors:[{key:'age_group',question:'Age group?',why:'Demographic'}]},r);
 const b=curateParameters(r,undefined,undefined,i);
 const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Item sought',query_reference:'laptop',weight_percent:95,compulsory:false},{key:'age',class:'psychological',why:'Demographic',weight_percent:5,compulsory:false}]},r,i,b);
 for(const key of ['social_image_fit','buying_comfort','usage_pattern']){
  expect(b.parameters.find(p=>p.key===key)).toMatchObject({class:'psychological',state:'missing'});
  expect(m.parameters.find(p=>p.key===key)).toMatchObject({class:'psychological',state:'missing',compulsory:false});
  expect(m.parameters.find(p=>p.key===key)?.value).toBeUndefined();
 }
 expect(b.parameters.some(p=>p.key==='age_group')).toBe(false);
 expect(m.parameters.some(p=>p.key==='age')).toBe(false);
 expect(m.parameters.reduce((sum,p)=>sum+p.priority,0)).toBeCloseTo(100);
});

it('canonicalizes model-renamed decision families without duplicate slots or weight inflation',()=>{
 const i=normalizeIntentFormation({answer_unit:'product',candidate_human_factors:[{key:'usage_pattern',question:'Where do you code?',why:'Routine affects fit'},{key:'social_image_fit',question:'What look feels right?',why:'Visual fit'},{key:'buying_comfort',question:'What helps you choose?',why:'Purchase confidence'}]},r);
 const b=curateParameters(r,undefined,undefined,i);
 const proposal=(key:string,weight:number)=>({key,class:'psychological',why:'Relevant choice factor',weight_percent:weight,compulsory:false,question:'Optional choice?'});
 const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Item sought',query_reference:'laptop',weight_percent:70,compulsory:false},proposal('usage_pattern',5),proposal('usage_pattern_daily',10),proposal('social_image_fit_preferences',10),proposal('buying_comfort_preference',10)]},r,i,b);
 for(const key of ['usage_pattern','social_image_fit','buying_comfort'])expect(m.parameters.filter(p=>p.key===key)).toHaveLength(1);
 expect(m.parameters.some(p=>p.key==='usage_pattern_daily')).toBe(false);
 expect(m.parameters.find(p=>p.key==='usage_pattern')!.priority/m.parameters.find(p=>p.key==='search_object')!.priority).toBeCloseTo(10/70);
 expect(m.parameters.find(p=>p.key==='usage_pattern')?.value).toBeUndefined();
 expect(m.parameters.reduce((sum,p)=>sum+p.priority,0)).toBeCloseTo(100);
});

it('classifies observed gaming, ports and noise keys as functional and merges noise tolerance aliases',()=>{
 const i=normalizeIntentFormation({answer_unit:'product',candidate_human_factors:[{key:'gaming_capability',question:'Gaming bonus?',why:'GPU workload'},{key:'ports_needed',question:'Which ports?',why:'Connectivity'},{key:'noise_level',question:'Quiet under load?',why:'Acoustic output'}]},r);
 expect(i.candidate_human_factors).toEqual([]);
 const b=curateParameters(r,undefined,undefined,i);
 const proposal=(key:string,weight:number)=>({key,class:'psychological',why:'Hardware requirement',weight_percent:weight,compulsory:false});
 const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Item sought',query_reference:'laptop',weight_percent:70,compulsory:false},proposal('gaming_capability',10),proposal('ports_needed',10),proposal('noise_level',5),proposal('noise_level_tolerance',10)]},r,i,b);
 for(const key of ['gaming_capability','ports_needed','noise_level'])expect(m.parameters.filter(p=>p.key===key)).toEqual([expect.objectContaining({class:'functional',state:'missing'})]);
 expect(m.parameters.some(p=>p.key==='noise_level_tolerance')).toBe(false);
 expect(m.parameters.reduce((sum,p)=>sum+p.priority,0)).toBeCloseTo(100);
});

it('asks for query-specific decision impact without a psychological quota and mandate preserves that allocation',async()=>{
 const {parameterPrompt}=await import('../src/core/architecture.js');
 const {mandatePrompt}=await import('../src/prompts/mandate-writer-v2.js');
 const p=parameterPrompt(r,intent);
 expect(p).toContain('not from a default functional/psychological split');
 expect(p).toContain('Separate hard eligibility from ranking importance');
 expect(p).toContain('relevance and likely decision impact are not confidence in a personal answer');
 expect(p).toContain('Do not cap psychological factors');
 expect(p).toContain('not category stereotypes');
 expect(mandatePrompt('{}')).toContain('Preserve those validated weights exactly');
});

it('keeps motives conditional, consolidates overlapping choice comparisons and asks direct fit rather than gender',async()=>{
 const {parameterPrompt}=await import('../src/core/architecture.js');
 const {intentFormationPrompt}=await import('../src/core/intent-formation.js');
 for(const p of [parameterPrompt(r,intent),intentFormationPrompt(r)]){
  expect(p).toContain('Treat every unconfirmed motive as a conditional possibility');
  expect(p).toContain('does not establish a desire for status');
  expect(p).toContain('group overlapping choice questions by the underlying answer');
  expect(p).toContain('independent ranking effect');
  expect(p).toContain('optional wrist size, preferred case dimensions');
  expect(p).toContain('Do not ask gender to infer');
 }
});

it('consolidates model-authored comparisons, covers baseline omissions, and rejects unverifiable group claims',()=>{
 const i=normalizeIntentFormation({answer_unit:'product',candidate_human_factors:[{key:'social_image_fit',question:'Style in your professional or social settings?',why:'Could affect fit'},{key:'brand_preference',question:'Preferred brand?',why:'Presentation'}]},r);
 expect(i.candidate_human_factors[0]?.question).toContain('or does that not matter');
 const b=curateParameters(r,undefined,undefined,i);
 const raw={parameters:[{key:'search_object',class:'functional',why:'Item',query_reference:'laptop',weight_percent:60,compulsory:false},{key:'design_philosophy',class:'psychological',why:'Presentation',weight_percent:25,compulsory:false,question:'Style in professional settings?'}],decision_groups:[
  {key:'search_object',members:['search_object'],role:'eligibility',distinct_effect:'Requested object'},
  {key:'social_image_fit',members:['design_philosophy','social_image_fit','brand_preference'],role:'presentation',distinct_effect:'One desired presentation comparison'},
  {key:'brand_familiarity',members:['brand_familiarity'],role:'other',distinct_effect:'Separately sourced familiar brand comfort'}]};
 const m=validateModelParameters(raw,r,i,b,true);
 expect(m.parameters.filter(p=>p.key==='social_image_fit')).toHaveLength(1);
 expect(m.parameters.some(p=>p.key==='brand_preference'||p.key==='design_philosophy')).toBe(false);
 expect(m.parameters.find(p=>p.key==='social_image_fit')?.question).toContain('or does that not matter');
 expect(m.parameters.find(p=>p.key==='social_image_fit')!.priority/m.parameters.find(p=>p.key==='search_object')!.priority).toBeCloseTo(25/60);
 expect(m.parameters.reduce((sum,p)=>sum+p.priority,0)).toBeCloseTo(100);
 expect(()=>validateModelParameters({...raw,decision_groups:undefined},r,i,b,true)).toThrow('decision_groups');
 expect(()=>validateModelParameters({...raw,decision_groups:raw.decision_groups.slice(0,2)},r,i,b,true)).toThrow('coverage');
 expect(()=>validateModelParameters({...raw,decision_groups:[...raw.decision_groups,{key:'other',members:['invented'],role:'other',distinct_effect:'Unsupported'}]},r,i,b,true)).toThrow('unknown');
});

it('merges model price spelling with a sourced numeric ceiling without weakening the veto',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'watch under 100000 INR'}),i=normalizeIntentFormation({answer_unit:'product'},q),b=curateParameters(q,undefined,undefined,i);
 const m=validateModelParameters({parameters:[{key:'search_object',class:'functional',why:'Object',query_reference:'watch',weight_percent:10,compulsory:false},{key:'price_inr',class:'functional',why:'Budget',query_reference:'under 100000 INR',weight_percent:90,compulsory:false}],decision_groups:[{key:'search_object',members:['search_object'],role:'eligibility',distinct_effect:'Requested item'},{key:'price_max_inr',members:['price_inr','price_max_inr'],role:'eligibility',distinct_effect:'One exact price ceiling'}]},q,i,b,true);
 expect(m.parameters.filter(p=>p.key.startsWith('price'))).toEqual([expect.objectContaining({key:'price_max_inr',value:100000,hard:true})]);
});

it('preserves independent durability semantics regardless of product key spelling',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'watch under 100000 INR'}),i=normalizeIntentFormation({answer_unit:'product',unknowns:[{key:'surface_choice',question:'Which surface?',why:'Appearance and durability under daily wear',result_changing:false}],candidate_human_factors:[{key:'social_image_fit',question:'Any visual preference?',why:'Optional look'}]},q),b=curateParameters(q,undefined,undefined,i);
 const raw={parameters:[{key:'search_object',class:'functional',query_reference:'watch',why:'Object',weight_percent:10,compulsory:false},{key:'social_image_fit',class:'psychological',why:'Look',weight_percent:90,compulsory:false}],decision_groups:[{key:'search_object',members:['search_object'],role:'eligibility',distinct_effect:'Object'},{key:'price_max_inr',members:['price_max_inr'],role:'eligibility',distinct_effect:'Budget'},{key:'social_image_fit',members:['social_image_fit','surface_choice'],role:'presentation',distinct_effect:'Appearance',member_effects:[{key:'social_image_fit',answer_sought:'Look',effect_class:'psychological' as const,consequence:'Visual fit',independent:false,why:'Same comparison'},{key:'surface_choice',answer_sought:'Surface',consequence:'Durability',independent:true,why:'Durability is not appearance'}]}]};
 expect(()=>validateModelParameters(raw,q,i,b,true)).toThrow('independent consequence');
 raw.decision_groups[2]!.members=['social_image_fit'];raw.decision_groups[2]!.member_effects=raw.decision_groups[2]!.member_effects?.slice(0,1);raw.decision_groups.push({key:'surface_choice',members:['surface_choice'],role:'capability',distinct_effect:'Durability independently of appearance',member_effects:[{key:'surface_choice',answer_sought:'Surface',consequence:'Durability',independent:true,why:'Independent property'}]});
 const m=validateModelParameters(raw,q,i,b,true);expect(m.parameters.find(p=>p.key==='surface_choice')).toMatchObject({class:'functional',state:'missing',question:'Which surface?'});
});

it('protects independent consequences across domains without matching domain words or keys',async()=>{
 const {decisionGroups}=await import('../src/core/decision-groups.js');
 for(const consequence of ['Makes quiet conversation possible','Avoids unwanted observation','Allows walking access','Avoids unacceptable hazard','Allows an eater to use the result','Resists wear']){
  const group={key:'social_image_fit',members:['vibe','axis_z'],role:'presentation',distinct_effect:'Look',member_effects:[{key:'vibe',answer_sought:'Look',effect_class:'psychological' as const,consequence:'Visual fit',independent:false,why:'Same answer'},{key:'axis_z',answer_sought:'Distinct need',effect_class:'functional' as const,consequence,independent:true,why:'Separate answer changes viability'}]};
  expect(()=>decisionGroups([group],['vibe','axis_z'],true,true)).toThrow('independent consequence');
  group.members=['vibe'];group.member_effects=group.member_effects.slice(0,1);
  expect(()=>decisionGroups([group,{key:'axis_z',members:['axis_z'],role:'capability',distinct_effect:consequence,member_effects:[{key:'axis_z',answer_sought:'Distinct need',effect_class:'functional' as const,consequence,independent:true,why:'Preserved separately'}]}],['vibe','axis_z'],true,true)).not.toThrow();
 }
 expect(()=>decisionGroups([{key:'search_object',members:['search_object'],role:'eligibility',distinct_effect:'Item'}],['search_object'],true,true)).toThrow('member effects');
});

it('normalizes equivalent family names by role but preserves independently consequential singleton names',async()=>{
 const {decisionGroups}=await import('../src/core/decision-groups.js');
 const effect=(key:string,independent=false)=>({key,answer_sought:'Answer',effect_class:'psychological' as const,consequence:'Choice changes',independent,why:independent?'Separate answer needed':'Same answer preserves this effect'});
 const groups=decisionGroups([
  {key:'venue_vibe',members:['vibe'],role:'presentation',distinct_effect:'Appearance',member_effects:[effect('vibe')]},
  {key:'formality',members:['formality'],role:'presentation',distinct_effect:'Dress and service expectation',member_effects:[effect('formality',true)]},
  {key:'venue_assurance',members:['reviews'],role:'purchase_confidence',distinct_effect:'Reliability',member_effects:[effect('reviews')]}
 ],['vibe','formality','reviews'],true,true);
 expect(groups.map(g=>g.key)).toEqual(['social_image_fit','formality','buying_comfort']);
 expect(()=>decisionGroups([{key:'renamed',members:['formality'],role:'presentation',distinct_effect:'Expectation',member_effects:[effect('formality',true)]}],['formality'],true,true)).toThrow('independent consequence');
 expect(()=>decisionGroups([{key:'vibe',members:['vibe','formality'],role:'presentation',distinct_effect:'Appearance',member_effects:[effect('vibe'),effect('formality',true)]}],['vibe','formality'],true,true)).toThrow('independent consequence');
 expect(()=>decisionGroups([{key:'vibe',members:['vibe'],role:'presentation',distinct_effect:'Appearance',member_effects:[effect('vibe')]},{key:'look',members:['look'],role:'presentation',distinct_effect:'Appearance',member_effects:[effect('look')]}],['vibe','look'],true,true)).toThrow('duplicate');
});

it('classifies declared functional consequences independently of routine role and opaque spelling',async()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'laptop'}),i=fallbackIntentFormation(q),b=curateParameters(q,undefined,undefined,i);
 const raw={parameters:[{key:'search_object',class:'functional',why:'Object',query_reference:'laptop',weight_percent:0,compulsory:false},{key:'axis_z',class:'psychological',why:'Physical comfort at the input mechanism',weight_percent:50,compulsory:false},{key:'keyboard_trackpad_quality',class:'psychological',why:'Ergonomics',weight_percent:50,compulsory:false}],decision_groups:[
  {key:'search_object',members:['search_object'],role:'eligibility',distinct_effect:'Object',member_effects:[{key:'search_object',answer_sought:'Object',consequence:'Product category',effect_class:'functional',independent:true,why:'Exact object'}]},
  ...['axis_z','keyboard_trackpad_quality'].map(key=>({key,members:[key],role:'routine',distinct_effect:'Physical comfort',member_effects:[{key,answer_sought:'Input requirements',consequence:'Physical comfort and productivity',effect_class:'functional',independent:true,why:'Requirement independent of workflow context'}]}))
 ]};
 const m=validateModelParameters(raw,q,i,b,true,true);
 expect(m.parameters.filter(p=>p.key!=='search_object').every(p=>p.class==='functional')).toBe(true);
 const {parameterPrompt}=await import('../src/core/architecture.js');expect(parameterPrompt(q,i)).toContain('must not duplicate a physical mobility');
});
