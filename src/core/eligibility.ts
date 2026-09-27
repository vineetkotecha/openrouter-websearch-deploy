import type {Mandate,ProviderResult,SearchRequest} from '../contracts/search.js';
import {hotelPropertySearch} from './intent-formation.js';

export type Verification = {status:'verified'|'unverified'; evidence?:string};
export type Eligibility = {eligible:boolean; reasons:string[]; verification:Record<string,Verification>};
const collection=/(?:\b(?:best|budget|cheap|top|list of|hotels in|hotels near|hotel deals|hotel offers|hotels around)\b.*\bhotels?\b|\bhotels?\b.*\b(?:in|near|around)\b|\b(?:airbnb|booking\.com|goibibo|makemytrip)\b.*\b(?:stays|hotels|rooms)\b)/i;
const collectionPath=/(?:list-of-|\/listings?\/|\/search(?:[/?]|$)|\/s\/|\/stays\/|\/hotels-(?:in|near)-|\/hotels\/[^/?]*koramangala(?:[/?]|$))/i;
const hotelName=/\b(?:hotel|fabhotel|treebo|oyo|collection o|olive zip|xotel|residency|inn|suites|rooms|stay)\b/i;
const amount=(v:unknown)=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v??'').replace(/,/g,'');const m=s.match(/(?:₹|Rs\.?|INR|\$)\s*(\d+(?:\.\d+)?)/i)??s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);return m?Number(m[1]!):null};
const budget=(r:SearchRequest)=>{
 const structured=Object.entries(r.hard_constraints).find(([k,v])=>/^(?:budget|price|max_price|price_max|price_limit_inr)$/i.test(k)&&amount(v)!==null);
 if(structured)return amount(structured[1]);
 const m=r.query.match(/(?:under|below|within|up to|maximum|max)\s*(?:₹|rs\.?\s*)?\s*([\d,]+)(?:\s*[-–]\s*([\d,]+))?/i);
 return m?Number((m[2]??m[1]!).replace(/,/g,'')):null;
};
const supportedField=(x:ProviderResult,keys:RegExp)=>Object.entries(x.fields??{}).find(([k,v])=>keys.test(k)&&v.state==='supported'&&v.value!=null);
export function eligibility(r:SearchRequest,m:Mandate,x:ProviderResult):Eligibility {
 const reasons:string[]=[],verification:Record<string,Verification>={};
 if(hotelPropertySearch(r)){
  const title=x.title.replace(/\s*[-|:].*$/,'').trim(),path=new URL(x.url).pathname;
  if(collectionPath.test(path)||collection.test(title)&&!/\b(?:fabhotel|treebo|oyo|collection o|olive zip|xotel)\b/i.test(title))reasons.push('collection page, not an individual hotel');
  if(!hotelName.test(title))reasons.push('no named hotel property in result title');
  verification.property={status:'unverified',...(reasons.length?{}:{evidence:`property-shaped result title: ${x.title}`})};
  // A snippet's nightly rate or generic hotel price is not an offer for the requested date.
  for(const k of ['location','stay_date','price','availability','discount','rating','cleanliness','construction_date','star_class']) verification[k]={status:'unverified'};
  for(const [key,re] of Object.entries({location:/^(?:location|city|area)$/,price:/^(?:dated_offer_total_inr|stay_total_inr)$/,rating:/^(?:rating|guest_rating)$/,star_class:/^(?:star_class|hotel_class)$/})){
   const f=supportedField(x,re);if(f)verification[key]={status:'verified',evidence:`${f[0]}: ${String(f[1].value)}`};
  }
  const cap=budget(r),price=supportedField(x,/^(?:dated_offer_total_inr|stay_total_inr)$/);
  if(cap!==null&&price&&amount(price[1].value)!==null&&amount(price[1].value)!>cap)reasons.push(`verified price ${String(price[1].value)} exceeds budget ${cap}`);
  const ratingFloor=Number(r.hard_constraints.rating_min??r.query.match(/rated\s+(?:above|over|at least)\s*([0-5](?:\.\d)?)/i)?.[1]);
  const rating=supportedField(x,/^(?:rating|guest_rating)$/);
  if(Number.isFinite(ratingFloor)&&ratingFloor>0&&rating&&typeof rating[1].value==='number'&&rating[1].value<ratingFloor)reasons.push(`verified rating ${rating[1].value} below ${ratingFloor}`);
  const stars=Number(r.hard_constraints.star_class_min??0),actualStars=supportedField(x,/^(?:star_class|hotel_class)$/);
  if(stars>0&&actualStars&&Number(actualStars[1].value)<stars)reasons.push(`verified star class ${actualStars[1].value} below ${stars}`);
  const expected=String(r.hard_constraints.location??'').toLowerCase().trim();
  const place=supportedField(x,/^(?:location|city|area)$/);
  if(expected&&place&&typeof place[1].value==='string'&&!place[1].value.toLowerCase().includes(expected))reasons.push(`verified location ${place[1].value} excludes ${expected}`);
  // Property-specific source data can describe a hotel, but without the date and a
  // checkout quote it cannot verify date-specific inventory or discounts.
  verification.stay_date={status:'unverified'};verification.availability={status:'unverified'};verification.discount={status:'unverified'};
 }else{
  for(const f of m.factors.filter(f=>f.class==='functional'&&f.hard&&/\b(?:ram|memory)\b/i.test(f.key))){
   const requested=String(f.value??'').match(/(\d+)\s*GB/i),observed=supportedField(x,/^(?:ram|memory)(?:_gb|_capacity)?$/);
   const actual=observed&&String(observed[1].value).match(/(\d+)\s*(?:GB)?/i);
   if(requested&&actual&&Number(actual[1])<Number(requested[1]))reasons.push(`verified RAM ${actual[1]}GB below ${requested[1]}GB`);
   verification[f.key]={status:observed?'verified':'unverified',...(observed?{evidence:`${observed[0]}: ${String(observed[1].value)}`}:{})};
  }
 }
 return{eligible:!reasons.length,reasons,verification};
}
export function gateResults(r:SearchRequest,m:Mandate,xs:ProviderResult[]){const excluded:{url:string;reasons:string[]}[]=[],retained:{result:ProviderResult;verification:Record<string,Verification>}[]=[];for(const x of xs){let g:Eligibility;try{g=eligibility(r,m,x)}catch{g={eligible:true,reasons:[],verification:{}}}if(g.eligible)retained.push({result:x,verification:g.verification});else excluded.push({url:x.url,reasons:g.reasons})}return{retained,excluded};}
