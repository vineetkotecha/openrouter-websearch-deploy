import type {ProviderContext,SearchProvider} from './base.js';
export const providerTimeout=(name:string,base:number,remaining:number)=>Math.min(remaining,name==='serpapi'?15000:name==='jina'?20000:base);
// Retry only transient transport/server failures, never rejected credentials.
export async function invokeProvider(p:SearchProvider,c:Omit<ProviderContext,'signal'>,base:number,remaining:number){
 const started=Date.now(),attempts=p.name==='serpapi'?2:1;let last:unknown;
 for(let attempt=0;attempt<attempts;attempt++){
  const ms=providerTimeout(p.name,base,remaining-(Date.now()-started));if(ms<=0)break;
  const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([p.search({...c,signal:ctl.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{ctl.abort();reject(new Error(`${p.name} deadline exceeded`))},ms)})])}
  catch(e){last=e;const text=String((e as Error)?.message??e);if(!/aborted|deadline|timeout|fetch failed|HTTP (429|500|502|503|504)/i.test(text)||attempt+1>=attempts)throw e;await new Promise(resolve=>setTimeout(resolve,250));}
  finally{if(timer)clearTimeout(timer)}
 }
 throw last??new Error(`${p.name} deadline exceeded`);
}
