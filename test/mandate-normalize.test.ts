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
 expect(p).toContain('A detail that only refines ranking is good to have');
 expect(p).toContain('near me');
})});

describe('strict factor provenance',()=>{it('rejects fabricated human evidence and invented hard dates',async()=>{
 const r=SearchRequestSchema.parse({query:'weekend trip',tenant_id:'t'});
 const x=await normalizeModelMandate({intent:r.query,category:'travel',factors:[
  {key:'source_reliability',class:'functional',description:'reputable',value:'reputable',weight:.7,confidence:.8,hard:false,evidence:[{source:'human',reference:'general search quality'}]},
  {key:'trip_duration',class:'functional',description:'two or three days',value:3,weight:1,confidence:1,hard:true,evidence:[{source:'query',reference:'weekend trip'}]}
 ],gaps:[]},r,'v2');
 expect(x.factors.some(f=>f.key==='source_reliability')).toBe(false);
 expect(x.factors.find(f=>f.key==='trip_duration')?.hard).toBe(false);
});});

it('rejects a model-invented rating cutoff from a broad best laptop query',async()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'best laptop'});
 const x=await normalizeModelMandate({factors:[{key:'average_user_rating',class:'functional',description:'at least four stars',value:{min_rating:4,scale:5},weight:.8,confidence:.7,hard:false,evidence:[{source:'query',reference:'best laptop'}]}]},r,'test');
 expect(x.factors.some(f=>f.key==='average_user_rating')).toBe(false);
});


describe('input-grounded hard specifications',()=>{
 const factor=(value:string)=>({key:'ram',class:'functional',description:'RAM capacity',value,weight:.9,confidence:.8,hard:false,evidence:[{source:'query',reference:'query'}]});
 it('promotes with 16GB RAM even if the model called it soft',async()=>{
  const r=SearchRequestSchema.parse({tenant_id:'t',query:'quiet laptop for a shared office with 16GB RAM'});
  const x=await normalizeModelMandate({factors:[factor('16GB')],gaps:[]},r,'test');
  expect(x.factors.find(f=>f.key==='ram')?.hard).toBe(true);
 });
 it('does not promote invented specs from broad adjectives or mismatched values',async()=>{
  for(const query of ['best laptop','quiet laptop with 8GB RAM']) {
   const r=SearchRequestSchema.parse({tenant_id:'t',query});
   const x=await normalizeModelMandate({factors:[{...factor('16GB'),hard:true}],gaps:[]},r,'test');
   expect(x.factors.find(f=>f.key==='ram')?.hard).toBe(false);
  }
 });
});

describe('material gap grounding',()=>{
 it('rejects a model gap for weekend getaway from Delhi',async()=>{
  const r=SearchRequestSchema.parse({tenant_id:'t',query:'weekend getaway from Delhi'});
  const x=await normalizeModelMandate({factors:[],gaps:[
   {key:'departure_city',material:true,question:'Where are you leaving from?'},
   {key:'budget',material:true,question:'What is your budget?'},
   {key:'destination',material:true,question:'Where would you like to go?'}
  ]},r,'test');
  expect(x.gaps).toEqual([]);
 });
 it('rejects an origin question answered in a weekend trip query',async()=>{
  const r=SearchRequestSchema.parse({tenant_id:'t',query:'weekend trip from Delhi'});
  const x=await normalizeModelMandate({factors:[],gaps:[{key:'departure_city',material:true,question:'Where are you leaving from?'}]},r,'test');
  expect(x.gaps).toEqual([]);
 });
});

it('promotes the real Gemini structured RAM factor only on exact query support',async()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'quiet laptop for a shared office with 16GB RAM'});
 const f={key:'ram_capacity_gb',class:'functional',description:'The laptop must have at least the specified amount of RAM.',value:{operator:'greater_than_or_equal_to',unit:'GB',value:16},weight:1,confidence:1,hard:true,evidence:[{source:'query',reference:'16GB RAM'}]};
 const x=await normalizeModelMandate({factors:[f],gaps:[]},r,'test');
 expect(x.factors.find(z=>z.key==='ram_capacity_gb')?.hard).toBe(true);
 const other=SearchRequestSchema.parse({tenant_id:'t',query:'quiet laptop with 8GB RAM'});
 const y=await normalizeModelMandate({factors:[{...f,evidence:[{source:'query',reference:'query'}]}],gaps:[]},other,'test');
 expect(y.factors.find(z=>z.key==='ram_capacity_gb')?.hard).toBe(false);
});
