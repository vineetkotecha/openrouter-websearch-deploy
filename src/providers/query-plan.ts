import type {Mandate,SearchRequest} from "../contracts/search.js";
import {classify,type TaskClass} from "../core/router.js";

export type Freshness={from?:string;to?:string;relative?:"day"|"week"|"month"|"year"};
export type SourcePolicy={include_domains:string[];exclude_domains:string[];preferred_types:string[];primary_only:boolean};
export type SearchMode="fast"|"balanced"|"deep";
export type ProviderQueryPlan={
 version:1; query:string;objective:string;task_class:TaskClass;max_results:number;
 locale:{language:string;country?:string;location?:string}; freshness:Freshness;
 source_policy:SourcePolicy; mode:SearchMode; extract_content:boolean;
 vertical:{engine:"web"|"shopping"|"local"|"news"|"academic"|"finance";proprietary_sources:string[]};
 trace:Array<{field:string;source:string;value:unknown}>;
};
const list=(v:unknown)=>Array.isArray(v)?v.map(String):typeof v==="string"?v.split(",").map(x=>x.trim()).filter(Boolean):[];
const bool=(v:unknown)=>v===true||v==="true";
const iso=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:undefined;
const pick=(r:SearchRequest,m:Mandate,...keys:string[])=>{
 for(const key of keys){if(Object.hasOwn(r.hard_constraints,key))return{value:r.hard_constraints[key],source:`hard_constraints.${key}`};const f=m.factors.find(x=>x.key===key&&x.value!=null);if(f)return{value:f.value,source:`mandate.factor.${key}`};const c=r.context.find(x=>x.key===key&&x.value!=null);if(c)return{value:c.value,source:`context.${key}`};}return undefined;
};
const daysAgo=(anchor:Date,days:number)=>new Date(anchor.getTime()-days*864e5).toISOString().slice(0,10);
export function buildQueryPlan(request:SearchRequest,mandate:Mandate,now=new Date()):ProviderQueryPlan{
 const task=classify(`${request.query} ${mandate.category}`),trace:ProviderQueryPlan["trace"]=[];
 const get=(...keys:string[])=>{const x=pick(request,mandate,...keys);if(x)trace.push({field:keys[0]!,source:x.source,value:x.value});return x?.value};
 const include_domains=list(get("include_domains","domains","allowed_domains")),exclude_domains=list(get("exclude_domains","blocked_domains"));
 const sourceTypes=list(get("source_types","preferred_source_types")),primary=bool(get("primary_sources_only","primary_only"));
 const from=iso(get("start_date","from_date")),to=iso(get("end_date","to_date"));
 const fresh=String(get("freshness","recency")??"").toLowerCase();let relative:Freshness["relative"];if(/day|24h|today/.test(fresh))relative="day";else if(/week|7d/.test(fresh))relative="week";else if(/month|30d/.test(fresh))relative="month";else if(/year|365d/.test(fresh))relative="year";
 const fromDerived=from??(relative?daysAgo(now,{day:1,week:7,month:30,year:365}[relative]):undefined);if(fromDerived)trace.push({field:"freshness.from",source:from?"explicit date":"derived freshness",value:fromDerived});
 const location=String(get("location","city","region")??"").trim()||undefined,language=request.locale.split(/[-_]/)[0]!.toLowerCase();
 const modeValue=String(get("search_mode","depth")??"").toLowerCase();const mode:SearchMode=modeValue==="deep"?"deep":modeValue==="fast"?"fast":/compare|research|investigate|comprehensive/i.test(request.query)?"deep":"balanced";
 const category=String(mandate.category??request.category_hint??"").toLowerCase();
 const engine:ProviderQueryPlan["vertical"]["engine"]=/shop|product|commerce/.test(category)?"shopping":/local|place|restaurant/.test(category)?"local":task==="shopping"?"shopping":task==="local"?"local":task==="news"?"news":task==="academic"?"academic":task==="finance"?"finance":"web";
 const proprietary=list(get("proprietary_sources","included_sources","datasets"));
 return{version:1,query:request.query,objective:mandate.intent,task_class:task,max_results:request.limits.max_results,locale:{language,country:request.country?.toLowerCase(),location},freshness:{from:fromDerived,to,relative},source_policy:{include_domains,exclude_domains,preferred_types:sourceTypes,primary_only:primary},mode,extract_content:task==="semantic"||mode==="deep",vertical:{engine,proprietary_sources:proprietary},trace};
}
const compact=<T extends Record<string,unknown>>(x:T)=>Object.fromEntries(Object.entries(x).filter(([,v])=>v!==undefined&&(!Array.isArray(v)||v.length))) as Partial<T>;
export function exaParams(p:ProviderQueryPlan){return compact({query:p.query,numResults:p.max_results,type:p.mode==="deep"?"auto":"fast",category:p.vertical.engine==="academic"?"research paper":undefined,includeDomains:p.source_policy.include_domains,excludeDomains:p.source_policy.exclude_domains,startPublishedDate:p.freshness.from,endPublishedDate:p.freshness.to,contents:{text:{maxCharacters:p.extract_content?3000:1200}}});}
export function serpApiParams(p:ProviderQueryPlan){const engine=p.vertical.engine==="shopping"?"google_shopping":p.vertical.engine==="local"?"google_maps":p.vertical.engine==="news"?"google_news":"google";const tbs=p.freshness.relative?`qdr:${{day:"d",week:"w",month:"m",year:"y"}[p.freshness.relative]}`:undefined;return compact({engine,q:p.query,num:p.max_results,gl:p.locale.country,hl:p.locale.language,location:p.locale.location,tbs});}
export function valyuParams(p:ProviderQueryPlan){return compact({query:p.query,search_type:p.vertical.proprietary_sources.length||["finance","academic"].includes(p.vertical.engine)?"proprietary":"all",max_num_results:p.max_results,included_sources:p.vertical.proprietary_sources,start_date:p.freshness.from,end_date:p.freshness.to});}
export function jinaParams(p:ProviderQueryPlan){const operators=[...p.source_policy.include_domains.map(x=>`site:${x}`),...p.source_policy.exclude_domains.map(x=>`-site:${x}`)];return{query:[p.query,...operators].join(" "),headers:compact({"X-Retain-Images":"none","X-Respond-With":"no-content"})};}
export function firecrawlParams(p:ProviderQueryPlan){const source=p.vertical.engine==="news"?"news":"web";const tbs=p.freshness.relative?`qdr:${{day:"d",week:"w",month:"m",year:"y"}[p.freshness.relative]}`:undefined;return compact({query:p.query,limit:p.max_results,sources:[{type:source}],location:p.locale.location,tbs,scrapeOptions:p.extract_content?{formats:["markdown"]}:undefined});}
export function parallelParams(p:ProviderQueryPlan){return compact({objective:p.objective,search_queries:[p.query],max_results:p.max_results,mode:p.mode==="fast"?"fast":"one-shot",source_policy:compact({include_domains:p.source_policy.include_domains,exclude_domains:p.source_policy.exclude_domains,after_date:p.freshness.from,before_date:p.freshness.to})});}
export function linkupParams(p:ProviderQueryPlan){return compact({q:p.query,depth:p.mode==="balanced"?"standard":p.mode,outputType:"searchResults",includeImages:false,includeDomains:p.source_policy.include_domains,excludeDomains:p.source_policy.exclude_domains,fromDate:p.freshness.from,toDate:p.freshness.to});}
export function youParams(p:ProviderQueryPlan){return compact({query:p.query,count:p.max_results,country:p.locale.country,language:p.locale.language,freshness:p.freshness.relative,include_domains:p.source_policy.include_domains,exclude_domains:p.source_policy.exclude_domains});}
export function apifyGoogleParams(p:ProviderQueryPlan){const query=[p.query,...p.source_policy.include_domains.map(x=>`site:${x}`),...p.source_policy.exclude_domains.map(x=>`-site:${x}`)].join(" ");return compact({queries:query,maxPagesPerQuery:1,resultsPerPage:p.max_results,mobileResults:false,countryCode:p.locale.country,languageCode:p.locale.language,locationUule:p.locale.location});}
