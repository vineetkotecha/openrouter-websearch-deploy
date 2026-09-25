import {describe,it,expect} from 'vitest';
import {normalizeModelMandate} from '../src/core/mandate-normalize.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
describe('model mandate normalization',()=>{it('keeps explicit hard constraints, fills sparse factors and drops invented psychology',async()=>{
 const r=SearchRequestSchema.parse({query:'quiet laptop',tenant_id:'t',hard_constraints:{ram:'16GB'}});
 const out=await normalizeModelMandate({intent:'quiet laptop',category:'shopping',factors:[{key:'imagined_risk',class:'psychological',description:'x',value:'high',weight:.9,confidence:.9,hard:false,evidence:[{source:'query'}]},{key:'quiet',class:'functional',description:'low noise',value:'quiet',weight:.8,confidence:.8,hard:false,evidence:[{source:'locale'},{source:'query'}]}],gaps:[]},r,'v2');
 expect(out.factors.length).toBeGreaterThanOrEqual(5);expect(out.factors.find(x=>x.key==='ram')).toMatchObject({hard:true,value:'16GB'});expect(out.factors.some(x=>x.key==='imagined_risk')).toBe(false);expect(out.factors.find(x=>x.key==='quiet')?.evidence).toEqual([{source:'query'}]);
 })});
