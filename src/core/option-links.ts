import type {ProviderResult} from '../contracts/search.js';
export async function verifyOptionLinks(xs:ProviderResult[],max:number,fetcher:typeof fetch=fetch){
 let calls=0;return Promise.all(xs.map(async x=>{
  if(!x.entity||x.entity.link_kind!=='direct'||calls>=max)return x;calls++;
  try{
   const r=await fetcher(`https://r.jina.ai/${x.url}`,{headers:{Accept:'text/plain',...(process.env.JINA_API_KEY?{Authorization:`Bearer ${process.env.JINA_API_KEY.trim()}`}:{})},signal:AbortSignal.timeout(15000)});if(!r.ok)return {...x,raw:{...(x.raw as any),option_link_check:{opened:true,specific:false,booking:false,dated:false}}};
   const page=(await r.text()).replace(/!\[[^\]]*\]\([^)]*\)/g,'').slice(0,10000);
   const words=x.entity.name.toLowerCase().match(/[a-z0-9]{3,}/g)??[];
   const heading=page.split('\n').filter(l=>/^Title:|^#{1,3}\s/.test(l)).join(' ').toLowerCase();
   const identity=words.length>0&&words.every(w=>heading.includes(w));
   const source=page.match(/^URL Source:\s*(https?:\/\/\S+)/m)?.[1];
   const redirected=source&&new URL(source).hostname!==new URL(x.url).hostname;
   const homepage=/^\/?$|^\/(?:en|in|en-in|in\/en)\/?$|\/(?:index|home)\.(?:html|php)$/.test(new URL(x.url).pathname);
   const accessible=identity&&!redirected&&!homepage&&!/\b(?:page not found|404 not found|access denied|captcha|enable javascript)\b/i.test(page);
   return {...x,raw:{...(x.raw as any),option_link_check:{opened:true,specific:accessible,booking:accessible&&/\b(?:book a table|reserve a table|select rooms|reserve now|check availability)\b/i.test(page),dated:false,passage:accessible?page.slice(0,800):undefined}}};
  }catch{return {...x,raw:{...(x.raw as any),option_link_check:{opened:true,specific:false,booking:false,dated:false}}}}
 }));
}
