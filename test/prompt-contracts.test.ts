import {it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {normalizeIntentFormation,intentFormationPrompt} from '../src/core/intent-formation.js';
import {finalQueryPrompt,validatedFinalQuery} from '../src/core/final-query.js';
import {parameterPrompt,validateModelParameters} from '../src/core/architecture.js';
import {curateParameters} from '../src/core/parameter-curation.js';
const r=SearchRequestSchema.parse({tenant_id:'t',query:'Find a perfect date place for me for tomorrow lunch.',context:[{key:'location',value:'Bengaluru',source:'caller',confidence:1}]});
const intent=normalizeIntentFormation({answer_unit:'local_business',answer_forms:[{kind:'cafe',why:'lunch'},{kind:'restaurant',why:'lunch'},{kind:'other lunch experience',why:'date'}]},r);
it('keeps one user intent while widening possible date-lunch answer forms',()=>{
 const prompt=intentFormationPrompt(r);
 expect(prompt).toContain('answer_forms');expect(prompt).toContain('one intent');expect(prompt).toContain('Do not declare that a restaurant is required');
 expect(intent.answer_unit).toBe('local_business');expect(intent.strategy).toBe('focused');expect(intent.answer_forms).toHaveLength(3);
 const final=finalQueryPrompt(r,intent,curateParameters(r,undefined,undefined,intent),'date lunch in Bengaluru');
 expect(final).toContain('other lunch experience');expect(final).toContain('Do not narrow to restaurants');
 expect(validatedFinalQuery('cafes and restaurants in Bengaluru','date lunch in Bengaluru','Bengaluru',['date','lunch'])).toBe('date lunch in Bengaluru');
});
it('normalizes a 95-point model parameter proposal rather than discarding it',()=>{
 const proposal={parameters:[{key:'search_object',class:'functional',why:'object',query_reference:'date place',weight_percent:60,compulsory:true},{key:'location',class:'functional',why:'area',weight_percent:35,compulsory:true}]};
 const m=validateModelParameters(proposal,r,intent,curateParameters(r,undefined,undefined,intent));
 expect(m.generation).toBe('gemini');expect(m.parameters.reduce((n,p)=>n+p.priority,0)).toBeCloseTo(100);
 expect(parameterPrompt(r,intent)).toContain('validator will normalize');
});
