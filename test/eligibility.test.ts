import {HeuristicMandateWriter} from "../src/core/mandate.js";
import {describe,it,expect} from 'vitest';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {eligibility,gateResults} from '../src/core/eligibility.js';
import {formProviderQuery,heuristicGaps} from '../src/core/context-pull.js';
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
it('treats product comparisons as dimensions and preserves ordinary product search text',()=>{const product=SearchRequestSchema.parse({tenant_id:'t',query:'find shoes for running under ₹3000'});const f=normalizeIntentFormation({intent_space:[{category:'running shoes',why:'product'},{category:'shoe advice',why:'advice'}]},product);expect(f.strategy).toBe('focused');expect(f.intent_space.map(x=>x.category)).toEqual(['product']);expect(formProviderQuery(product,'post_fill').provider_query).toBe(product.query)});
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

it('does not branch on model-imagined price and availability categories for one answer unit',()=>{const flight=SearchRequestSchema.parse({tenant_id:'t',query:'flights from Bangalore to Goa on 12 October'});const f=normalizeIntentFormation({intent_space:[{category:'Flight Search',why:'route'},{category:'Price Inquiry',why:'cost'},{category:'Availability Check',why:'date'},{category:'Itinerary Planning',why:'trip'}]},flight);expect(f.strategy).toBe('focused');expect(f.intent_space.map(x=>x.category)).toEqual(['flight_itinerary']);expect(f.search_branches).toEqual([])});

it('rejects social videos with an incidental hotel mention as direct properties',()=>{const y=x('https://www.facebook.com/bhavaniresidency/videos/123','+91 95130 60062 ( HEMANTH ) This hotel has 3 single bed ...');const g=eligibility(r,m,y);expect(g.eligible).toBe(false);expect(g.reasons.join(' ')).toMatch(/social or discussion page/);expect(g.reasons.join(' ')).toMatch(/no named hotel property/)});

it('excludes generic product collections but keeps a named item for later field verification',()=>{const q=SearchRequestSchema.parse({tenant_id:'t',query:'laptop 16GB RAM under ₹50000 in India'});const m:any={intent:q.query,factors:[]};const g=gateResults(q,m,[x('https://example.com/collection/laptops-under-50000','Laptops Under 50000'),x('https://example.com/laptops/acer-aspire-lite-al15','Acer Aspire Lite AL15-52 16GB RAM')]);expect(g.excluded).toHaveLength(1);expect(g.retained.map(v=>v.result.title)).toEqual(['Acer Aspire Lite AL15-52 16GB RAM']);expect(g.retained[0]?.verification.price.status).toBe('unverified')});

it('a date-lunch place is a local venue, not a discovery app',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'Find a perfect date place for me for tomorrow lunch.',permissions:{may_pull_context:true}});
 expect(answerStrategy(q)?.unit).toBe('local_business');
 expect(heuristicGaps(q).map((g:any)=>g.key)).toContain('location');
 const m:any={intent:q.query,factors:[]};
 const g=gateResults(q,m,[{...x('https://www.seemor.ai/','Seemor | The Right Restaurant. Every Time.'),snippet:'This app helps you find and choose the right restaurant for your date.'},x('https://example.com/places/olive','Olive Bistro Koramangala')]);
 expect(g.excluded.map(z=>z.url)).toContain('https://www.seemor.ai/');
 expect(g.retained.map(z=>z.result.title)).toContain('Olive Bistro Koramangala');
});

it('rejects an explicit over-budget product title without claiming the live price was verified',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'Best laptop under 80000 INR'});
 const bad=x('https://shop.example/laptop','Dell Inspiron 16 Rs.110000 Price in India');
 const verdict=eligibility(q,m,bad);expect(verdict.eligible).toBe(false);expect(verdict.reasons.join(' ')).toMatch(/title advertises price/);expect(verdict.verification.price.status).toBe('unverified');
 const ambiguous=x('https://shop.example/laptop2','Dell Rs.110000 now Rs.75000');expect(eligibility(q,m,ambiguous).eligible).toBe(true);
});
it('requires a provider publication date for an explicitly bounded fresh news query',()=>{
 const q=SearchRequestSchema.parse({tenant_id:'t',query:'latest space mission launch this week'});
 const undated=x('https://news.example/story','Mission launch');expect(eligibility(q,m,undated).reasons.join(' ')).toMatch(/publication date missing/);
 const old={...undated,published_at:new Date(Date.now()-14*864e5).toISOString()};expect(eligibility(q,m,old).eligible).toBe(false);
 const fresh={...undated,published_at:new Date(Date.now()-864e5).toISOString()};expect(eligibility(q,m,fresh).eligible).toBe(true);
 const latestOnly=SearchRequestSchema.parse({...q,query:'latest mission launch'});expect(eligibility(latestOnly,m,undated).eligible).toBe(false);
});
it('excludes merchant search collections even when the title is just the merchant name',async()=>{
 const r=SearchRequestSchema.parse({query:'Best laptop with 16GB RAM for coding under 80000 INR',tenant_id:'t'});
 const m=await new HeuristicMandateWriter().write(r);
 const x={provider:'tavily',url:'https://www.amazon.in/Laptops/s?rh=n%3A1375424031',title:'Amazon.in',snippet:'Laptops under 80000'};
 expect(eligibility(r,m,x,'product').eligible).toBe(false);
});
it('excludes a manufacturer category root but keeps its individual model URL',()=>{
 const r=SearchRequestSchema.parse({tenant_id:'t',query:'Best laptop with 16GB RAM under 80000 INR'});
 expect(eligibility(r,m,x('https://www.lenovo.com/in/en/laptops/','Laptops for Business, Gaming, Students | Lenovo India'),'product').eligible).toBe(false);
 expect(eligibility(r,m,x('https://www.lenovo.com/in/en/p/laptops/ideapad/slim3/len101','IdeaPad Slim 3 Gen 8'),'product').eligible).toBe(true);
});
it('excludes a laptop series category with no individual SKU',()=>{const r=SearchRequestSchema.parse({query:'Best laptop with 16GB RAM under 80000 INR',tenant_id:'t'});expect(eligibility(r,m,x('https://store.acer.com/en-in/laptops/aspire/aspire-lite','Aspire Lite - Laptops'),'product').eligible).toBe(false)});
