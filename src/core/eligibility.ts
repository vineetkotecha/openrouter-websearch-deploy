import type {Mandate,ProviderResult,SearchRequest} from '../contracts/search.js';
import {answerStrategy} from './answer-units.js';

export type Verification={status:'verified'|'unverified';evidence?:string};
export type Eligibility={eligible:boolean;reasons:string[];verification:Record<string,Verification>};
const listingPath=/(?:list-of-|\/listings?\/|\/search(?:[/?]|$)|\/s\/|\/stays\/|\/hotels-(?:in|near)-|\/hotels\/[^/?]+(?:[/?]|$))/i;
const collectionTitle=/\b(?:best|budget|cheap|top|list of|hotels|products|items|stores|people)\b.*\b(?:hotels?|products?|items?|near|in)\b/i;
const hotelName=/\b(?:hotel|fabhotel|treebo|oyo|collection o|olive zip|xotel|residency|inn|suites|rooms|stay)\b/i;
const productCollectionTitle=/\b(?:best|top|cheap|budget|list of|deals? on|buy|shop)\b.*\b(?:laptops?|phones?|shoes?|chargers?|headphones?|earbuds?|jackets?|toys?)\b|\b(?:laptops?|phones?|shoes?|chargers?|headphones?|earbuds?|jackets?|toys?)\b.*\b(?:under|collection|list|deals?|on sale|compare|202[0-9])\b/i;
const socialOrEditorial=/\b(?:facebook|instagram|youtube|tiktok|reddit|quora|pinterest)\.com$/i;
const amount=(v:unknown):number|null=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v??'').replace(/,/g,'');const m=s.match(/(?:₹|Rs\.?|INR|\$)\s*(\d+(?:\.\d+)?)/i)??s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);return m?Number(m[1]!):null};
const supportedField=(x:ProviderResult,key:RegExp)=>Object.entries(x.fields??{}).find(([k,v])=>key.test(k)&&v.state==='supported'&&v.value!==null);
function explicitBudget(r:SearchRequest){const structured=Object.entries(r.hard_constraints).find(([k,v])=>/^(?:budget|price|max_price|price_max|price_limit_inr)$/i.test(k)&&amount(v)!==null);if(structured)return amount(structured[1]);const m=r.query.match(/(?:under|below|within|up to|maximum|max)\s*(?:₹|rs\.?\s*)?\s*([\d,]+)(?:\s*[-–]\s*([\d,]+))?/i);return m?Number((m[2]??m[1]!).replace(/,/g,'')):null}
export function eligibility(r:SearchRequest,m:Mandate,x:ProviderResult):Eligibility{
 const reasons:string[]=[],verification:Record<string,Verification>={},strategy=answerStrategy(r);
 let url:URL;try{url=new URL(x.url)}catch{return{eligible:false,reasons:['invalid URL'],verification}};
 if(strategy?.requiresNamedEntity){
  const title=x.title.replace(/\s*[-|:].*$/,'').trim();
  if(socialOrEditorial.test(url.hostname))reasons.push('social or discussion page, not a direct answer listing');
  if(strategy.unit==='hotel_property'){
   if(listingPath.test(url.pathname)||collectionTitle.test(title)&&!/^\s*(?:fabhotel|treebo|oyo|collection o|olive zip|xotel)\b/i.test(title))reasons.push('collection page, not an individual hotel');
   if(!hotelName.test(title)||/^(?:this|the|a|our)\s+hotel\b|\bthis hotel\b/i.test(title)||/^[+\d\s()\-]{8,}/.test(title))reasons.push('no named hotel property in result title');
  }else if(strategy.unit==='product'){
   if(listingPath.test(url.pathname)||productCollectionTitle.test(title))reasons.push('collection page, not an individual product');
  }else if(listingPath.test(url.pathname)||collectionTitle.test(title))reasons.push('collection page, not an individual answer');
  verification[strategy.unit]={status:'unverified',...(reasons.length?{}:{evidence:`entity-shaped title: ${x.title}`})};
 }
 // Only source-supported, typed fields can exclude an item. Snippet numbers and
 // model assertions never become verified prices, ratings, inventory or dates.
 const cap=explicitBudget(r),price=supportedField(x,/^(?:dated_offer_total_inr|stay_total_inr|product_price_inr|price_inr)$/);
 const priceApplicable=price&&(strategy?.unit==='hotel_property'?/^(?:dated_offer_total_inr|stay_total_inr)$/.test(price[0]):true);
 verification.price={status:priceApplicable?'verified':'unverified',...(priceApplicable?{evidence:`${price[0]}: ${String(price[1].value)}`}:{})};
 if(cap!==null&&priceApplicable&&amount(price[1].value)!==null&&amount(price[1].value)!>cap)reasons.push(`verified price ${String(price[1].value)} exceeds budget ${cap}`);
 const floor=Number(r.hard_constraints.rating_min??r.query.match(/rated\s+(?:above|over|at least)\s*([0-5](?:\.\d)?)/i)?.[1]);
 const rating=supportedField(x,/^(?:rating|guest_rating)$/);verification.rating={status:rating?'verified':'unverified',...(rating?{evidence:`${rating[0]}: ${String(rating[1].value)}`}:{})};
 if(Number.isFinite(floor)&&floor>0&&rating&&typeof rating[1].value==='number'&&rating[1].value<floor)reasons.push(`verified rating ${rating[1].value} below ${floor}`);
 const expected=String(r.hard_constraints.location??'').toLowerCase().trim(),place=supportedField(x,/^(?:location|city|area)$/);
 verification.location={status:place?'verified':'unverified',...(place?{evidence:`${place[0]}: ${String(place[1].value)}`}:{})};
 if(expected&&place&&typeof place[1].value==='string'&&!place[1].value.toLowerCase().includes(expected))reasons.push(`verified location ${place[1].value} excludes ${expected}`);
 const stars=Number(r.hard_constraints.star_class_min??0),actualStars=supportedField(x,/^(?:star_class|hotel_class)$/);
 if(stars>0&&actualStars&&Number(actualStars[1].value)<stars)reasons.push(`verified star class ${actualStars[1].value} below ${stars}`);
 for(const f of m.factors.filter(f=>f.class==='functional'&&f.hard&&/\b(?:ram|memory)\b/i.test(f.key))){const requested=String(f.value??'').match(/(\d+)\s*GB/i),observed=supportedField(x,/^(?:ram|memory)(?:_gb|_capacity)?$/),actual=observed&&String(observed[1].value).match(/(\d+)\s*(?:GB)?/i);if(requested&&actual&&Number(actual[1])<Number(requested[1]))reasons.push(`verified RAM ${actual[1]}GB below ${requested[1]}GB`);verification[f.key]={status:observed?'verified':'unverified',...(observed?{evidence:`${observed[0]}: ${String(observed[1].value)}`}:{})}}
 if(strategy?.unit==='hotel_property')for(const key of ['stay_date','availability','discount','cleanliness','construction_date','star_class'])verification[key]={status:'unverified'};
 return{eligible:!reasons.length,reasons,verification};
}
export function gateResults(r:SearchRequest,m:Mandate,xs:ProviderResult[]){const excluded:{url:string;reasons:string[]}[]=[],retained:{result:ProviderResult;verification:Record<string,Verification>}[]=[];for(const x of xs){const g=eligibility(r,m,x);if(g.eligible)retained.push({result:x,verification:g.verification});else excluded.push({url:x.url,reasons:g.reasons})}return{retained,excluded}}
