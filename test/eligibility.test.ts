import {describe,it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {eligibility,gateResults} from '../src/core/eligibility.js';
import {formProviderQuery} from '../src/core/context-pull.js';
import {normalizeIntentFormation} from '../src/core/intent-formation.js';
const r=SearchRequestSchema.parse({tenant_id:'test',query:'I want to find a stay around Koramangala Bangalore for one night 30th Sept Under 1500-1800 rs., pull in all possible discounts for the same. Find hotels which are actually super clean, well rated, newly built, 3 star preferred.'});
const m:any={intent:r.query,factors:[]};
const x=(url:string,title:string,fields?:any)=>({provider:'serper',url,title,snippet:'',fields});
describe('hotel answer unit',()=>{
 it('treats location and date as dimensions, not alternate result categories',()=>{const f=normalizeIntentFormation({intent_space:[{category:'hotel',why:'stay'},{category:'location',why:'where'},{category:'date',why:'when'}]},r);expect(f.strategy).toBe('focused');expect(f.intent_space.map(x=>x.category)).toEqual(['hotel_property']);expect(f.search_branches).toEqual([])});
 it('forms a compact property-specific query, preserving original separately',()=>{const f=formProviderQuery(r,'post_fill');expect(f.original_query).toBe(r.query);expect(f.provider_query).toMatch(/hotel property Koramangala Bangalore under ₹1500-1800 30th Sep 3 star rooms rates reviews/);expect(f.provider_query).not.toContain('I want')});
 it('excludes collections and unrelated pages but retains named hotel properties',()=>{const xs=[x('https://fabhotels.com/list-of-budget-hotels-in-koramangala-bangalore','Budget Hotels in Koramangala Bangalore'),x('https://example.com/want','What is a want?'),x('https://example.com/hotel/olive-zip','Olive Zip Koramangala')];const g=gateResults(r,m,xs);expect(g.excluded).toHaveLength(2);expect(g.retained.map(y=>y.result.title)).toEqual(['Olive Zip Koramangala'])});
 it('gates only supported rating violations and does not invent a three-star minimum from a preference',()=>{const low=x('https://example.com/hotel/c','Hotel C',{rating:{value:3.8,state:'supported'}});const asked=SearchRequestSchema.parse({...r,query:'Find hotels in Jaipur rated above 4.5 with pool'});expect(eligibility(asked,m,low).eligible).toBe(false);expect(eligibility(r,m,low).eligible).toBe(true)});
 it('excludes a verified over-budget rate but does not equate undated snippets with dated offers',()=>{const over=x('https://example.com/hotel/a','Olive Zip Koramangala',{dated_offer_total_inr:{value:1900,state:'supported'}});expect(eligibility(r,m,over).eligible).toBe(false);const generic=x('https://example.com/hotel/g','Treebo White Inn Koramangala',{price_inr:{value:1900,state:'supported'}});expect(eligibility(r,m,generic).eligible).toBe(true);const missing=x('https://example.com/hotel/b','Treebo White Inn Koramangala');const g=eligibility(r,m,missing);expect(g.eligible).toBe(true);expect(g.verification.price.status).toBe('unverified');expect(g.verification.stay_date.status).toBe('unverified');expect(g.verification.discount.status).toBe('unverified')});
});
it('preserves non-hotel broad branching and ordinary product search text',()=>{const product=SearchRequestSchema.parse({tenant_id:'t',query:'find shoes for running under ₹3000'});const f=normalizeIntentFormation({intent_space:[{category:'running shoes',why:'product'},{category:'shoe advice',why:'advice'}]},product);expect(f.strategy).toBe('across_categories');expect(formProviderQuery(product,'post_fill').provider_query).toBe(product.query)});
import {answerStrategy} from '../src/core/answer-units.js';
it('uses different answer-unit dimensions for diverse search types and preserves true ambiguity',()=>{
 const cases:[string,string,string][]=[['flight Bangalore to Goa on 12 October','flight_itinerary','origin'],['buy a laptop with 16GB RAM','product','compatibility'],['pharmacy near me open now','local_business','hours'],['who is the founder of Linear','person','organization'],['peer-reviewed research papers about batteries','research_source','evidence']];
 for(const [query,unit,dimension] of cases){const x=SearchRequestSchema.parse({tenant_id:'t',query});const s=answerStrategy(x);expect(s?.unit).toBe(unit);expect(s?.dimensions).toContain(dimension);expect(normalizeIntentFormation({intent_space:[{category:unit,why:'entity'},{category:'date',why:'filter'}]},x).strategy).toBe('focused')}
 const mixed=SearchRequestSchema.parse({tenant_id:'t',query:'find hotels and flights for my trip'});expect(answerStrategy(mixed)).toBeUndefined();
});
it('uses general supported-field gating for products, not only hotels',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'buy laptop under ₹1800 with 16GB RAM'});
 const model:any={intent:q.query,factors:[{key:'ram',class:'functional',hard:true,value:'16GB'}]};
 const low=x('https://shop.example/laptop-a','Laptop A',{ram_gb:{value:8,state:'supported'},price_inr:{value:1500,state:'supported'}});
 const high=x('https://shop.example/laptop-b','Laptop B',{ram_gb:{value:16,state:'supported'},price_inr:{value:1900,state:'supported'}});
 expect(eligibility(q,model,low).reasons.join(' ')).toMatch(/RAM/);expect(eligibility(q,model,high).reasons.join(' ')).toMatch(/price/);
 const unknown=x('https://shop.example/laptop-c','Laptop C');expect(eligibility(q,model,unknown).eligible).toBe(true);expect(eligibility(q,model,unknown).verification.price.status).toBe('unverified');
});
