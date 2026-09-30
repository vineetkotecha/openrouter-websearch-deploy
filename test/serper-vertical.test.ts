import {it,expect,vi} from 'vitest';
import {Serper} from '../src/providers/adapters.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
it.each([
 {query:'Best laptop with 16GB RAM for coding under 80000 INR',category:'shopping',endpoint:'shopping',key:'shopping',row:{link:'https://shop.example/p/abc',title:'Acer Swift 14 16GB',price:'₹70,000',source:'Shop'}},
 {query:'Find lunch in Bengaluru',category:'local_business',endpoint:'places',key:'places',row:{website:'https://cafe.example',title:'Cafe Nandi',address:'Bengaluru',category:'Cafe'}},
])('uses $endpoint API for $category',async({query,category,endpoint,key,row})=>{
 const old=globalThis.fetch,oldKey=process.env.SERPER_API_KEY;process.env.SERPER_API_KEY='test';
 const fetcher=vi.fn(async()=>({ok:true,json:async()=>({[key]:[row]})}));globalThis.fetch=fetcher as any;
 try {const request=SearchRequestSchema.parse({query,tenant_id:'t',limits:{max_results:5}});const mandate={...await new HeuristicMandateWriter().write(request),category};const out=await new Serper().search({request,mandate,signal:new AbortController().signal});expect(fetcher.mock.calls[0]![0]).toBe(`https://google.serper.dev/${endpoint}`);expect(out).toHaveLength(1);expect(out[0]?.url).toBe(row.link??row.website)}finally{globalThis.fetch=old;if(oldKey===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=oldKey}
});
it('routes laptop intent to India shopping despite a generic mandate category',async()=>{
 process.env.SERPER_API_KEY='test';let endpoint='',body:any;const old=global.fetch;
 global.fetch=vi.fn(async(url,init)=>{endpoint=String(url);body=JSON.parse(String(init?.body));return new Response(JSON.stringify({shopping:[{link:'https://shop.example.com/product/a',title:'Acer 16GB laptop',price:'₹65,000'}]}))}) as any;
 try{const out=await new Serper().search({request:{query:'Best laptop with 16GB RAM for coding under 80000 INR',locale:'en-IN',country:'IN',hard_constraints:{},context:[],limits:{max_results:5}},mandate:{intent:'find laptop',category:'general_consumer_search',factors:[]},signal:new AbortController().signal} as any);expect(endpoint.endsWith('/shopping')).toBe(true);expect(body).toMatchObject({gl:'in',hl:'en'});expect(out[0].title).toBe('Acer 16GB laptop')}finally{global.fetch=old;delete process.env.SERPER_API_KEY}
});
