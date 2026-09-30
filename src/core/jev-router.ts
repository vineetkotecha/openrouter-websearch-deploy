import{choice,TypeSafeClient}from"@typesafe-ai/sdk";import type{SearchRequest,Mandate}from"../contracts/search.js";import type{SearchProvider}from"../providers/base.js";import{route as deterministicRoute,type TaskClass}from"./router.js";
const descriptions:Record<string,string>={tavily:"Agent-ready current web research with summaries and content",exa:"Semantic and long-tail discovery",brave:"Independent conventional web index",serper:"Google-style web, shopping, local and news results",serpapi:"Specialist SERP engines for shopping, maps, jobs, images and news",google_cse:"Search over a configured approved corpus",perplexity:"Answer-oriented current web research",valyu:"Specialist financial, filings, academic, patent and proprietary datasets",jina:"General web discovery and clean page reading",firecrawl:"Search followed by managed page or site extraction",gemini_deep_research:"Slow multi-hop research and sourced synthesis"};
export async function routeWithPolicy(request:SearchRequest,mandate:Mandate,providers:SearchProvider[]){const fallback=deterministicRoute(request,mandate,providers),enabled=fallback.candidates.map(x=>x.provider_name);if(!process.env.TYPESAFE_API_KEY||enabled.length<2)return fallback;try{const client=new TypeSafeClient({apiKey:process.env.TYPESAFE_API_KEY,timeout:10_000,retry:{maxRetries:0}} as any);const criteria=Object.fromEntries(enabled.map(x=>[x,descriptions[x]??"General web search provider"]));const r=await client.systemOne({model:process.env.JEV_MODEL??"jev-1.13.0",state:{query:request.query,intent:mandate.intent,hard_constraints:JSON.parse(JSON.stringify(request.hard_constraints)),available_providers:enabled},questions:{task_class:choice("Which search task class best matches this request?",{navigational:"Known official page or site",local:"Nearby place, hours or maps",shopping:"Products, prices, merchants or delivery",news:"Current general news",academic:"Papers, studies or journals",finance:"Company filings, earnings, stocks or financial data",semantic:"Conceptual discovery where pages may use different words",general:"General web lookup"}),first_provider:choice("Which available provider should be searched first?",criteria)}});const tc=r.answers.task_class,fp=r.answers.first_provider;const chosen=String(fp.choice);if(fp.confidence<.45||!enabled.includes(chosen))return fallback;const ordered=[chosen,...enabled.filter(x=>x!==chosen)];const byName=new Map(fallback.candidates.map(x=>[x.provider_name,x]));const selected=ordered.slice(0,request.limits.max_provider_calls).map(x=>byName.get(x)!).filter(Boolean);return{...fallback,task_class:String(tc.choice) as TaskClass,policy:`jev:${r.model}`,candidates:ordered.map((x,i)=>({...byName.get(x)!,score:i===0?Number(fp.confidence):byName.get(x)!.score,reason:i===0?`Jev selected ${x}; confidence ${fp.confidence.toFixed(2)}; task ${String(tc.choice)} (${tc.confidence.toFixed(2)})`:byName.get(x)!.reason})),selected}}catch{return fallback}}

// One Jev call for all decomposed subqueries. Per-job provider candidates remain
// capability-checked by the planner; a model choice outside that list is ignored.
export type SubqueryDecision={job:string;selected?:string;providers?:string[];policy:string;reason?:string;confidence?:number};
export async function routeSubqueries(request:SearchRequest, mandate:Mandate, jobs:{id:string;query:string;candidates:{provider:string;excluded?:string}[]}[]):Promise<SubqueryDecision[]>{
 const fallback=jobs.map(j=>({job:j.id,selected:undefined as string|undefined,policy:'capability-v1',reason:'Routing model unavailable or invalid; bounded deterministic fallback.'}));
 if(!process.env.TYPESAFE_API_KEY||!jobs.some(j=>j.candidates.filter(c=>!c.excluded).length>1))return fallback;
 try{
  const questions:Record<string,ReturnType<typeof choice>>={};
  jobs.forEach((job,i)=>{const usable=job.candidates.filter(c=>!c.excluded);const cap=Math.min(usable.length,request.limits.max_provider_calls);
   if(usable.length>1){questions[`count_${i}`]=choice(`How many distinct providers should be fired for subquery ${i}? Choose the fewest sufficient for its evidence and diversity needs, not the ceiling. Total across jobs cannot exceed ${request.limits.max_provider_calls}.`,Object.fromEntries(Array.from({length:cap},(_,n)=>[String(n+1),`${n+1} providers`])));
    for(let n=0;n<cap;n++)questions[`provider_${i}_${n}`]=choice(`Provider ${n+1} for subquery ${i}: ${job.query.slice(0,180)}? Only slots within the chosen count execute. Do not repeat providers.`,Object.fromEntries(usable.map(c=>[c.provider,descriptions[c.provider]??'General web search provider'])));
   }
  });
  if(!Object.keys(questions).length)return fallback;
  const client=new TypeSafeClient({apiKey:process.env.TYPESAFE_API_KEY,timeout:10_000,retry:{maxRetries:0}} as any);
  const out=await client.systemOne({model:process.env.JEV_MODEL??'jev-1.13.0',state:{query:request.query,intent:mandate.intent,hard_constraints:JSON.parse(JSON.stringify(request.hard_constraints)),limits:request.limits,subqueries:jobs.map(j=>({id:j.id,query:j.query,available_providers:j.candidates.filter(c=>!c.excluded).map(c=>({provider:c.provider,description:descriptions[c.provider]??'General web search provider'}))}))},questions});
  let left=request.limits.max_provider_calls;
  return jobs.map((job,i)=>{const usable=job.candidates.filter(c=>!c.excluded),answers=out.answers as any;
   if(usable.length<=1){if(usable.length)left=Math.max(0,left-1);return {...fallback[i]!,reason:'Only one eligible provider; model count not needed.'};}
   const count=Number(answers[`count_${i}`]?.choice),confidence=Number(answers[`count_${i}`]?.confidence);
   if(!Number.isInteger(count)||count<1||count>Math.min(usable.length,request.limits.max_provider_calls)||confidence<.45)return fallback[i]!;
   const names=Array.from({length:count},(_,n)=>answers[`provider_${i}_${n}`]);
   if(names.some(a=>!a||a.confidence<.45||!usable.some(c=>c.provider===String(a.choice)))||new Set(names.map(a=>String(a.choice))).size!==count)return fallback[i]!;
   const chosen=names.map(a=>String(a.choice)).slice(0,left);left-=chosen.length;
   return{job:job.id,selected:chosen[0],providers:chosen,policy:`jev-fanout:${out.model}`,confidence,reason:`Routing LLM chose ${count} distinct provider(s); ${chosen.length} fit the remaining global call ceiling.`};
  });
 }catch{return fallback}
}
