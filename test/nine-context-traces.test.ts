import {describe,it,expect,vi} from 'vitest';
import {runNineContextTraces,NINE_CASES} from '../src/eval/nine-context-traces.js';
import {makeApp} from '../src/server/app.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const cfg:any={LOG_LEVEL:'silent',SEARCH_TIMEOUT_MS:1000,apiKeys:new Map([['key','t']])};
describe('nine context traces',()=>{
 it('runs nine distinct fixed calls, no retention, case-scoped context, and marks missing location',async()=>{
  const h:any={search:vi.fn(async(req:any)=>(req.query.includes('near me')||req.query==='best laptop')&&!req.context.length?{status:'needs_input',kind:'context_request',gap:req.query==='best laptop'?'use_case':'location',question:'Which area?',requested_context:[{key:req.query==='best laptop'?'use_case':'location'}]}:{status:'complete',results:[],route:[],limitations:[]})};
  const result=await runNineContextTraces(h,'t',[{case_id:'N06',key:'use_case',value:'AI coding',source:'caller',confidence:1}]);
  expect(h.search).toHaveBeenCalledTimes(10);expect(new Set(h.search.mock.calls.map((c:any)=>c[0].query)).size).toBe(9);
  for(const [r] of h.search.mock.calls){expect(r.permissions).toMatchObject({may_retain:false,may_learn:false,may_ask_user:false,may_pull_context:true});}
  expect(result.rows[1].status).toBe('needs_input');expect(result.rows[1]).toHaveProperty('context_request');
  expect(h.search.mock.calls[5][0].context).toHaveLength(0);
  expect(h.search.mock.calls[6][0].context).toMatchObject([{key:'use_case',value:'AI coding'}]);
  expect(h.search.mock.calls[3][0].context).toHaveLength(0);
  expect(NINE_CASES).toHaveLength(9);
 });
 it('accepts a caller parameter when the model requests an alias for that key',async()=>{
  const h:any={search:vi.fn(async(req:any)=>req.context.length?{status:'complete',results:[],route:[],limitations:[]}:{status:'needs_input',kind:'context_request',gap:'user_current_location',question:'Where?',requested_context:[{key:'user_current_location'}]})};
  const result=await runNineContextTraces(h,'t',[{case_id:'N02',key:'location',value:'Bengaluru',source:'caller',confidence:1}],['N02']);
  expect(h.search).toHaveBeenCalledTimes(2);
  expect(h.search.mock.calls[1][0].context).toMatchObject([{key:'location',value:'Bengaluru'}]);
  expect(result.rows[0].parameters_supplied).toMatchObject([{key:'location'}]);
 });
 it('rejects unapproved context keys and unauthenticated route',async()=>{
  const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());
  const app=await makeApp(cfg,h,new MemoryStore());
  const no=await app.inject({method:'POST',url:'/v1/admin/eval/nine-context-traces'});expect(no.statusCode).toBe(401);
  const invalid=await app.inject({method:'POST',url:'/v1/admin/eval/nine-context-traces',headers:{authorization:'Bearer key'},payload:{context:[{case_id:'N01',key:'private_note',value:'secret',source:'caller',confidence:1}]}});expect(invalid.statusCode).toBe(400);
  await app.close();
 });
});
