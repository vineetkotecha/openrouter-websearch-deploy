import type {DecisiveFact} from './fact-schema.js';
import {collectionSource} from './entities.js';
import type {Mandate,ProviderResult,SearchRequest} from '../contracts/search.js';
import {answerStrategy,type AnswerUnit} from './answer-units.js';

export type Verification={status:'verified'|'unverified';evidence?:string};
export type Eligibility={eligible:boolean;reasons:string[];verification:Record<string,Verification>};
const listingPath=/(?:list-of-|\/listings?\/|\/search(?:[/?]|$)|\/s(?:[/?]|$)|\/stays\/|\/hotels-(?:in|near)-|\/hotels\/[^/?]+(?:[/?]|$))/i;
const collectionTitle=/\b(?:best|budget|cheap|top|list of|hotels|products|items|stores|people)\b.*\b(?:hotels?|products?|items?|near|in)\b/i;
const hotelName=/\b(?:hotel|fabhotel|treebo|oyo|collection o|olive zip|xotel|residency|inn|suites|rooms|stay)\b/i;
const productCollectionTitle=/\b(?:best|top|cheap|budget|list of|deals? on|buy|shop)\b.*\b(?:laptops?|phones?|shoes?|chargers?|headphones?|earbuds?|jackets?|toys?)\b|\b(?:laptops?|phones?|shoes?|chargers?|headphones?|earbuds?|jackets?|toys?)\b.*\b(?:under|collection|list|deals?|on sale|compare|202[0-9])\b/i;
const socialOrEditorial=/\b(?:facebook|instagram|youtube|tiktok|reddit|quora|pinterest)\.com$/i;
const amount=(v:unknown):number|null=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v??'').replace(/,/g,'');const m=s.match(/(?:₹|Rs\.?|INR|\$)\s*(\d+(?:\.\d+)?)/i)??s.match(/^\s*(\d+(?:\.\d+)?)\s*$/);return m?Number(m[1]!):null};
const titlePrice=(title:string):number|null=>{
 // A single explicitly labelled title price is a visible contradiction, not
 // proof of a live checkout price. Multiple amounts are ambiguous.
 const amounts=[...title.matchAll(/(?:₹|Rs\.?|INR|\$)\s*([\d,]+(?:\.\d+)?)/gi)].map(m=>Number(m[1]!.replace(/,/g,''))).filter(Number.isFinite);
 return amounts.length===1?amounts[0]!:null;
};
// "Latest" uses a conservative seven-day policy; without a dated source we
// withhold the candidate rather than guess recency.
const freshWindow=(query:string,now=Date.now()):number|null=>/\b(?:this week|latest)\b/i.test(query)?now-7*864e5:/\b(?:today|last 24 hours)\b/i.test(query)?now-864e5:null;
const supportedField=(x:ProviderResult,key:RegExp)=>Object.entries(x.fields??{}).find(([k,v])=>key.test(k)&&v.state==='supported'&&v.value!==null);
function explicitBudget(r:SearchRequest){const structured=Object.entries(r.hard_constraints).find(([k,v])=>/^(?:budget|price|max_price|price_max|price_limit_inr)$/i.test(k)&&amount(v)!==null);if(structured)return amount(structured[1]);const m=r.query.match(/(?:under|below|within|up to|maximum|max)\s*(?:₹|rs\.?\s*)?\s*([\d,]+)(?:\s*[-–]\s*([\d,]+))?/i);return m?Number((m[2]??m[1]!).replace(/,/g,'')):null}
export function eligibility(r:SearchRequest,m:Mandate,x:ProviderResult,answerUnit?:AnswerUnit,schema?:DecisiveFact[]):Eligibility{
 const reasons:string[]=[],verification:Record<string,Verification>={},strategy=answerUnit?{unit:answerUnit,requiresNamedEntity:answerUnit!=="flight_itinerary"&&answerUnit!=="research_source"}:answerStrategy(r);
 let url:URL;try{url=new URL(x.url)}catch{return{eligible:false,reasons:['invalid URL'],verification}};
 if(strategy?.requiresNamedEntity&&!x.entity){
  const title=x.title.replace(/\s*[-|:].*$/,'').trim();
  if(socialOrEditorial.test(url.hostname))reasons.push('social or discussion page, not a direct answer listing');
  if(strategy.unit==='hotel_property'){
   if(listingPath.test(url.pathname)||collectionTitle.test(title)&&!/^\s*(?:fabhotel|treebo|oyo|collection o|olive zip|xotel)\b/i.test(title))reasons.push('collection page, not an individual hotel');
   if(!hotelName.test(title)||/^(?:this|the|a|our)\s+hotel\b|\bthis hotel\b/i.test(title)||/^[+\d\s()\-]{8,}/.test(title))reasons.push('no named hotel property in result title');
  }else if(strategy.unit==='local_business'){
   if(collectionSource(x))reasons.push('collection page, not an individual place');
   // Search/discovery apps are not the restaurant, cafe or venue the person can visit.
   if(/\b(?:find|discover|search|choose|pick|recommend|curat\w*|match|decide)\b/i.test(x.snippet.slice(0,700)) &&
      /\b(?:restaurants?|places?|spots?|date)\b/i.test(x.snippet.slice(0,700)) &&
      /\b(?:app|platform|tool|service|AI-powered|sign up|start with|how it works)\b/i.test(x.snippet.slice(0,700)))
     reasons.push('discovery service, not an individual place to visit');
  }else if(strategy.unit==='product'){
   if(listingPath.test(url.pathname)||/\/laptops\/(?:aspire|ideapad|vivobook)\/[^/.]+\/?$/i.test(url.pathname)||/\/(?:laptops|phones|headphones|products|collections)\/?$/i.test(url.pathname)||productCollectionTitle.test(title))reasons.push('collection page, not an individual product');
  }else if(listingPath.test(url.pathname)||collectionTitle.test(title))reasons.push('collection page, not an individual answer');
  verification[strategy.unit]={status:'unverified',...(reasons.length?{}:{evidence:`entity-shaped title: ${x.title}`})};
 }
 if(x.entity)verification[strategy?.unit??'entity']={status:'verified',evidence:`Named in source: ${x.entity.name}. This does not verify all requirements.`};
 // Only source-supported, typed fields can exclude an item. Snippet numbers and
 // model assertions never become verified prices, ratings, inventory or dates.
 const cap=explicitBudget(r),price=supportedField(x,/^(?:dated_offer_total_inr|stay_total_inr|product_price_inr|price_for_two_inr|price_inr)$/);
 const priceApplicable=price&&(strategy?.unit==='hotel_property'?/^(?:dated_offer_total_inr|stay_total_inr)$/.test(price[0]):true);
 verification.price={status:priceApplicable?'verified':'unverified',...(priceApplicable?{evidence:`${price[0]}: ${String(price[1].value)}`}:{})};
 if(cap!==null&&priceApplicable&&amount(price[1].value)!==null&&amount(price[1].value)!>cap)reasons.push(`verified price ${String(price[1].value)} exceeds budget ${cap}`);
 if(cap!==null&&strategy?.unit==='product'&&titlePrice(x.title)!==null&&titlePrice(x.title)!>cap)reasons.push(`title advertises price ${titlePrice(x.title)} above budget ${cap}; current price unverified`);
 const since=freshWindow(r.query),published=x.published_at?Date.parse(x.published_at):NaN;
 if(since!==null){
  verification.publication_date={status:Number.isFinite(published)&&published>=since&&published<=Date.now()+864e5?'verified':'unverified',...(x.published_at?{evidence:`provider published_at: ${x.published_at}`}:{})};
  if(!Number.isFinite(published)||published<since||published>Date.now()+864e5)reasons.push(x.published_at?`publication date ${x.published_at} outside requested recent window`:'publication date missing for requested recent window');
 }
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
 for(const fact of schema??[]){const f=x.fields?.[fact.key];verification[fact.key]={status:f?.state==='supported'?'verified':'unverified',...(f?.evidence?{evidence:f.evidence}:{})};const a=fact.requirement;if(!a||f?.state!=='supported'||f.value===null)continue;const actual=f.value;const ok=a.op==='eq'?actual===a.value:typeof actual==='number'&&typeof a.value==='number'&&(a.op==='gt'?actual>a.value:a.op==='lt'?actual<a.value:a.op==='gte'?actual>=a.value:actual<=a.value);if(!ok)reasons.push(`verified ${fact.key} ${actual} contradicts ${a.op} ${a.value} (${fact.requirement_quote})`);}
 return{eligible:!reasons.length,reasons,verification};
}
export function gateResults(r:SearchRequest,m:Mandate,xs:ProviderResult[],answerUnit?:AnswerUnit,schema?:DecisiveFact[]){const excluded:{url:string;reasons:string[]}[]=[],retained:{result:ProviderResult;verification:Record<string,Verification>}[]=[];for(const x of xs){const g=eligibility(r,m,x,answerUnit,schema);if(g.eligible)retained.push({result:x,verification:g.verification});else excluded.push({url:x.url,reasons:g.reasons})}return{retained,excluded}}
