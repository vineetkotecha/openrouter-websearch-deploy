import {it,expect} from 'vitest';
import {normalizeDecisiveFacts,decisiveFactPrompt} from '../src/core/decisive-facts.js';
import {extractSurvivors} from '../src/core/verify.js';
const page='ThinkPad E16\nMRP: ₹107,990\n₹70,991 34% off Incl. Shipping & all Taxes\nInstalled memory: 16 GB RAM';
const raw={entity_match:true,fields:{product_price_inr:{state:'supported',value:70991,evidence_quote:'₹70,991 34% off Incl. Shipping & all Taxes',entity_quote:'ThinkPad E16'},ram_gb:{state:'supported',value:16,evidence_quote:'Installed memory: 16 GB RAM',entity_quote:'ThinkPad E16'}}};
it('reads an unlabelled sale block and explicit RAM only with literal entity/value evidence',()=>{expect(normalizeDecisiveFacts(raw,'product',page,['product_price_inr','ram_gb'])).toMatchObject({product_price_inr:{state:'supported',value:70991},ram_gb:{state:'supported',value:16}})});
it('rejects invented value, entity, quote and inferred shorthand',()=>{
 for(const patch of [{value:55991},{entity_quote:'Other laptop'},{evidence_quote:'Price INR 70991'}])expect(normalizeDecisiveFacts({...raw,fields:{product_price_inr:{...raw.fields.product_price_inr,...patch}}},'product',page,['product_price_inr']).product_price_inr.state).toBe('missing');
 expect(normalizeDecisiveFacts({...raw,fields:{ram_gb:{...raw.fields.ram_gb,evidence_quote:'ThinkPad E16'}}},'product',page,['ram_gb']).ram_gb.state).toBe('missing');
 expect(normalizeDecisiveFacts({...raw,entity_match:false},'product',page,['product_price_inr']).product_price_inr.state).toBe('missing');
});
it('does not infer two-person restaurant cost from per-person pricing',()=>{
 const p='One Cafe in Indiranagar. Price ₹1200 per person';
 const f={entity_match:true,fields:{price_for_two_inr:{state:'supported',value:2400,evidence_quote:'Price ₹1200 per person',entity_quote:'One Cafe'},location:{state:'supported',value:'Indiranagar',evidence_quote:'One Cafe in Indiranagar',entity_quote:'One Cafe'}}};
 expect(normalizeDecisiveFacts(f,'local_business',p,['price_for_two_inr','location'])).toMatchObject({price_for_two_inr:{state:'missing'},location:{state:'supported',value:'Indiranagar'}});
});
it('bounds LLM fact reads to fetched extraction targets and leaves failure missing',async()=>{
 let calls=0;const input=[1,2].map(i=>({provider:'exa',url:`https://shop.example/${i}`,title:'ThinkPad E16',snippet:''}));
 const out=await extractSurvivors(input,undefined,{max:1,vertical:'product',fields:['product_price_inr','ram_gb'],fetcher:(async()=>({ok:true,text:async()=>page})) as any,factReader:async()=>{calls++;return raw}});
 expect(calls).toBe(1);expect(out.report.fact_calls).toBe(1);expect(out.results[0]?.fields?.product_price_inr.value).toBe(70991);expect(out.results[1]?.fields).toBeUndefined();
 const fail=await extractSurvivors(input,undefined,{max:1,vertical:'product',fields:['product_price_inr'],fetcher:(async()=>({ok:true,text:async()=>page})) as any,factReader:async()=>{throw Error('timeout')}});expect(fail.report.fact_errors).toBe(1);expect(fail.results[0]?.fields?.product_price_inr.state).toBe('missing');
 expect(decisiveFactPrompt('product',page,{url:input[0]!.url,title:'ThinkPad E16'},['ram_gb'])).toContain('16G shorthand alone is not explicit installed RAM evidence');
});
