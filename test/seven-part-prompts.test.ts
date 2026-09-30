import {it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {intentFormationPrompt,fallbackIntentFormation} from '../src/core/intent-formation.js';
import {parameterPrompt,questionPrompt,auditPrompt,fallbackManifest} from '../src/core/architecture.js';
import {curateParameters} from '../src/core/parameter-curation.js';
import {finalQueryPrompt} from '../src/core/final-query.js';
import {mandatePrompt} from '../src/prompts/mandate-writer-v2.js';
import {decisionBrief} from '../src/prompts/decision-brief.js';
import {providerAnswerPrompt} from '../src/prompts/provider-answer.js';
it('briefs cover the job and data without exposing the seven-point preparation scaffold',()=>{
 const r=SearchRequestSchema.parse({query:'laptop 16GB RAM for coding under 80000 INR',tenant_id:'t'}),intent=fallbackIntentFormation(r),manifest=fallbackManifest(curateParameters(r));
 const texts=[intentFormationPrompt(r),parameterPrompt(r,intent),questionPrompt(r,manifest),auditPrompt(r,{intent:r.query} as any,[]),finalQueryPrompt(r,intent,manifest,r.query),mandatePrompt(JSON.stringify({request:r})),decisionBrief('choose','known','why','method','answer'),providerAnswerPrompt(r.query)];
 for(const text of texts){expect(text).not.toContain('1. Your job');expect(text).not.toContain('7. Output structure');expect(text).toMatch(/data/);}
 for(const text of texts.filter(t=>!t.startsWith('choose')))expect(text).toContain(r.query);
});

it('understanding produces an enhanced query for the next parameter-curation step, while preserving raw evidence',()=>{const r=SearchRequestSchema.parse({query:'laptop for coding',tenant_id:'t'});const p=intentFormationPrompt(r);expect(p).toContain('enhanced_query');expect(p).toContain('Next we will curate the parameters');expect(p).toContain('Example to reason from, not the current task');expect(p).toContain('laptop for coding');});
