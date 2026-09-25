import {describe,it,expect} from 'vitest';
import {makeApp} from '../src/server/app.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const cfg:any={SEARCH_TIMEOUT_MS:1000,LOG_LEVEL:'silent',apiKeys:new Map([['builder-key','tenant-a'],['other-key','tenant-b']])};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
describe('asynchronous evaluation',()=>{
 it('accepts immediately, binds result to tenant and prevents duplicate work',async()=>{
  const writer:any={write:async(r:any)=>{await sleep(60);return new HeuristicMandateWriter().write(r)}};
  const app=await makeApp(cfg,new SearchHarness(cfg,writer,[],new MemoryStore()),new MemoryStore());
  const payload={async:true,only:['price-cap','vague-gift'],concurrency:1};
  const first=await app.inject({method:'POST',url:'/v1/admin/eval/mandate',headers:{authorization:'Bearer builder-key'},payload});
  expect(first.statusCode).toBe(202);const id=first.json().job_id;expect(id).toMatch(/^[0-9a-f]{32}$/);
  const duplicate=await app.inject({method:'POST',url:'/v1/admin/eval/mandate',headers:{authorization:'Bearer builder-key'},payload});expect(duplicate.statusCode).toBe(409);
  const foreign=await app.inject({method:'GET',url:`/v1/admin/eval/jobs/${id}`,headers:{authorization:'Bearer other-key'}});expect(foreign.statusCode).toBe(404);
  let result:any;for(let i=0;i<30;i++){const r=await app.inject({method:'GET',url:`/v1/admin/eval/jobs/${id}`,headers:{authorization:'Bearer builder-key'}});result=r.json();if(result.status!=='running')break;await sleep(15)}
  expect(result.status).toBe('done');expect(result.result.n).toBe(2);expect(result.result.rows.map((x:any)=>x.id)).toEqual(['price-cap','vague-gift']);
  await app.close();
 });
});
