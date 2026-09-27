import {it,expect} from 'vitest';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
it('searches property-oriented and never returns collection pages or invented dated quotes',async()=>{
 const query='Find a hotel in Koramangala on 30th Sept under ₹1800, clean, well rated, newly built, 3 star preferred';
 const seen:string[]=[];
 const p={name:'serper',enabled:()=>true,search:async({request}:any)=>{seen.push(request.query);return [
  {provider:'serper',url:'https://example.com/hotels-in-koramangala',title:'Hotels in Koramangala',snippet:'Cheap hotel listings'},
  {provider:'serper',url:'https://example.com/hotel/treebo-white-inn',title:'Treebo White Inn Koramangala',snippet:'Rate ₹1237 on another date'},
  {provider:'serper',url:'https://example.com/hotel/expensive',title:'Hotel Expensive Koramangala',snippet:'',fields:{dated_offer_total_inr:{state:'supported',value:1900}}}
 ]}};
 const w=new HeuristicMandateWriter();const h=new SearchHarness({SEARCH_TIMEOUT_MS:1500} as any,w,[p as any],new MemoryStore(),{fetcher:async()=>({ok:false,text:async()=>''}) as any});
 const out:any=await h.search(SearchRequestSchema.parse({tenant_id:'t',query,limits:{max_provider_calls:1,max_jobs:1,max_results:5}}));
 expect(seen).toHaveLength(1);expect(seen[0]).toMatch(/hotel property Koramangala/);expect(out.results.map((x:any)=>x.title)).toEqual(['Treebo White Inn Koramangala']);
 expect(out.results[0].verification.price.status).toBe('unverified');expect(out.results[0].verification.stay_date.status).toBe('unverified');
 expect(out.plan.eligibility.excluded).toHaveLength(2);
});
