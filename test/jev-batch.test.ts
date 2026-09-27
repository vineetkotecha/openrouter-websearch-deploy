import {it,expect,vi,afterEach} from 'vitest';
const calls=vi.hoisted(()=>({count:0,questionKeys:[] as string[],fail:false}));
vi.mock('@typesafe-ai/sdk',()=>({
 noul:(question:string,choices:unknown)=>({question,choices}),
 TypeSafeClient:class{async systemOne(input:any){calls.count++;calls.questionKeys=Object.keys(input.questions);if(calls.fail)throw new Error('down');return {answers:{fit_0:{noul:.1},fit_1:{noul:.9}},usage:{input_tokens:19,output_tokens:4}}}}
}));
import {jevRerank} from '../src/core/jev-rerank.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
const r=SearchRequestSchema.parse({tenant_id:'t',query:'laptop with 16GB RAM'});
const item=(i:number)=>({provider:'exa',url:`https://example.com/${i}`,title:`Laptop ${i}`,snippet:'16GB RAM',rank:i,canonical_url:`https://example.com/${i}`,mandate_fit:.8,faithfulness:{state:'supported',score:.9},reason:'test',duplicates:[]});
afterEach(()=>{delete process.env.JEV_RERANK_ENABLED;delete process.env.TYPESAFE_API_KEY;calls.count=0;calls.questionKeys=[];calls.fail=false});
it('makes one batch Jev call to rerank two eligible results',async()=>{process.env.JEV_RERANK_ENABLED='true';process.env.TYPESAFE_API_KEY='test';const m=await new HeuristicMandateWriter().write(r);const out=await jevRerank(r,m,[item(1),item(2)] as any);expect(calls.count).toBe(1);expect(calls.questionKeys).toEqual(['fit_0','fit_1']);expect(out.attempted).toBe(2);expect(out.successful).toBe(2);expect(out.results.map(x=>x.url)).toEqual(['https://example.com/2','https://example.com/1']);expect(out.usage).toEqual({input_tokens:19,output_tokens:4})});
it('falls back unchanged after one batch failure',async()=>{process.env.JEV_RERANK_ENABLED='true';process.env.TYPESAFE_API_KEY='test';calls.fail=true;const m=await new HeuristicMandateWriter().write(r);const out=await jevRerank(r,m,[item(1),item(2)] as any);expect(calls.count).toBe(1);expect(out.reason).toBe('model_failed_fallback');expect(out.results.map(x=>x.url)).toEqual(['https://example.com/1','https://example.com/2'])});
