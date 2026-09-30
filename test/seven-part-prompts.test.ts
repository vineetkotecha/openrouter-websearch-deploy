import {it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {intentFormationPrompt,fallbackIntentFormation} from '../src/core/intent-formation.js';
import {parameterPrompt,questionPrompt,auditPrompt,fallbackManifest} from '../src/core/architecture.js';
import {curateParameters} from '../src/core/parameter-curation.js';
import {finalQueryPrompt} from '../src/core/final-query.js';
import {mandatePrompt} from '../src/prompts/mandate-writer-v2.js';
import {decisionBrief} from '../src/prompts/decision-brief.js';
import {providerAnswerPrompt} from '../src/prompts/provider-answer.js';
it('every shared prompt brief names all seven decisions and preserves the actual input',()=>{
 const r=SearchRequestSchema.parse({query:'laptop 16GB RAM for coding under 80000 INR',tenant_id:'t'}),intent=fallbackIntentFormation(r),manifest=fallbackManifest(curateParameters(r));
 const texts=[intentFormationPrompt(r),parameterPrompt(r,intent),questionPrompt(r,manifest),auditPrompt(r,{intent:r.query} as any,[]),finalQueryPrompt(r,intent,manifest,r.query),mandatePrompt(JSON.stringify({request:r})),decisionBrief('choose','known','why','method','answer'),providerAnswerPrompt(r.query)];
 for(const text of texts)for(const label of ['1. Your job','2. What you know','3. Why this job matters','4. The actual input','5. How to decide','6. Output requirement','7. Output structure'])expect(text).toContain(label);
 for(const text of texts.filter(t=>!t.includes('choose\n')))expect(text).toContain(r.query);
});
