import {noul,TypeSafeClient} from "@typesafe-ai/sdk";
import type {Mandate,SearchRequest,SearchResponse} from "../contracts/search.js";
type Ranked=SearchResponse["results"][number];
type Scorer=(r:SearchRequest,m:Mandate,x:Ranked)=>Promise<number>;
const eligible=(m:Mandate,x:Ranked)=>{
  // A failed explicit structured field or evidence gate is never promoted.
  if(x.faithfulness.state==="unverified")return false;
  return !m.factors.some(f=>f.hard&&x.fields?.[f.key]?.state==="missing");
};
export async function jevRerank(r:SearchRequest,m:Mandate,items:Ranked[],score?:Scorer):Promise<{results:Ranked[];attempted:number;successful:number;usage:{input_tokens:number;output_tokens:number}}> {
  if(process.env.JEV_RERANK_ENABLED!=="true"&&!score)return {results:items,attempted:0,successful:0,usage:{input_tokens:0,output_tokens:0}};
  const cap=Math.min(8,items.length),short=items.slice(0,cap),indices=short.map((x,i)=>eligible(m,x)?i:-1).filter(i=>i>=0);
  if(indices.length<2)return {results:items,attempted:0,successful:0,usage:{input_tokens:0,output_tokens:0}};
  const client=score?null:new TypeSafeClient({apiKey:process.env.TYPESAFE_API_KEY,timeout:2500,retry:{maxRetries:0}} as any);
  if(!score&&!process.env.TYPESAFE_API_KEY)return {results:items,attempted:0,successful:0,usage:{input_tokens:0,output_tokens:0}};
  let input_tokens=0,output_tokens=0;
  const graded=await Promise.all(indices.map(async i=>{const x=short[i]!;try{
    if(score)return {i,value:await score(r,m,x)};
    const out=await client!.systemOne({model:process.env.JEV_MODEL??"jev-1.13.0",state:{query:r.query,intent:m.intent,hard_constraints:JSON.parse(JSON.stringify(r.hard_constraints)),source:{title:x.title,snippet:x.snippet.slice(0,800),reason:x.reason,faithfulness:x.faithfulness}},questions:{fit:noul("Does this source directly serve the mandate while respecting the stated constraints?",{true:"Direct and supported fit",false:"Tangential, contradictory or unsupported"})}});
    input_tokens+=out.usage.input_tokens||0;output_tokens+=out.usage.output_tokens||0;
    return {i,value:out.answers.fit.noul};
  }catch{return {i,value:NaN}}}));
  const good=graded.filter(x=>Number.isFinite(x.value)&&x.value>=0&&x.value<=1);
  if(good.length!==indices.length)return {results:items,attempted:indices.length,successful:good.length,usage:{input_tokens,output_tokens}};
  const ordered=[...good].sort((a,b)=>b.value-a.value||a.i-b.i).map(x=>short[x.i]!);
  const out=[...items];indices.forEach((i,k)=>out[i]=ordered[k]!);
  return {results:out.map((x,i)=>({...x,rank:i+1})),attempted:indices.length,successful:good.length,usage:{input_tokens,output_tokens}};
}
