import {describe,it,expect} from 'vitest';
import {normalizeModelMandate} from '../src/core/mandate-normalize.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
describe('model mandate normalization',()=>{it('keeps explicit hard constraints, fills sparse factors and drops invented psychology',async()=>{
 const r=SearchRequestSchema.parse({query:'quiet laptop',tenant_id:'t',hard_constraints:{ram:'16GB'}});
 const out=await normalizeModelMandate({intent:'quiet laptop',category:'shopping',factors:[{key:'imagined_risk',class:'psychological',description:'x',value:'high',weight:.9,confidence:.9,hard:false,evidence:[{source:'query'}]},{key:'quiet',class:'functional',description:'low noise',value:'quiet',weight:.8,confidence:.8,hard:false,evidence:[{source:'locale'},{source:'query'}]}],gaps:[]},r,'v2');
 expect(out.factors.length).toBeGreaterThanOrEqual(5);expect(out.factors.find(x=>x.key==='ram')).toMatchObject({hard:true,value:'16GB'});expect(out.factors.some(x=>x.key==='imagined_risk')).toBe(false);expect(out.factors.find(x=>x.key==='quiet')?.evidence).toEqual([{source:'query'}]);
 })});

describe('model gap preservation',()=>{it('keeps a material, specific caller question when its key was not supplied',async()=>{
 const r=SearchRequestSchema.parse({query:'best laptop',tenant_id:'t'});
 const x=await normalizeModelMandate({intent:'find a laptop',category:'shopping',factors:[],gaps:[{key:'use_case',material:true,question:'What will the laptop be used for?'}]},r,'v2');
 expect(x.gaps).toEqual([{key:'use_case',material:true,question:'What will the laptop be used for?'}]);
})});

describe('source-grounded factors',()=>{it('preserves explicitly supplied psychology and hard recency when the model omits them',async()=>{
 const r=SearchRequestSchema.parse({query:'latest RBI repo rate decision this week',tenant_id:'t',agent_understanding:{source:'user_agent',psychological_parameters:[{key:'risk_aversion',value:'high',confidence:.8,evidence:[{source:'caller',reference:'agent profile'}]}]}});
 const x=await normalizeModelMandate({intent:r.query,category:'news',factors:[],gaps:[]},r,'v2');
 expect(x.factors.find(f=>f.key==='risk_aversion')).toMatchObject({class:'psychological',value:'high',hard:false,confidence:.8});
 expect(x.factors.some(f=>f.class==='functional'&&f.hard&&/fresh|week|latest/.test(f.key))).toBe(true);
})});

import { mandatePrompt } from '../src/prompts/mandate-writer-v2.js';
describe('mandate gap instructions',()=>{it('distinguishes blocking context from optional refinements',()=>{
 const p=mandatePrompt('{"query":"quiet laptop for shared office with 16GB RAM"}');
 expect(p).toContain('A detail that could refine ranking is not automatically a material gap');
 expect(p).toContain('near me');
})});
