import {it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
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
