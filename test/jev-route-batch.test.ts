import {it,expect,vi,afterEach} from 'vitest';
const calls=vi.hoisted(()=>({count:0,state:null as any,keys:[] as string[],fail:false}));
vi.mock('@typesafe-ai/sdk',()=>({choice:(question:string,options:unknown)=>({question,options}),TypeSafeClient:class{async systemOne(input:any){calls.count++;calls.state=input.state;calls.keys=Object.keys(input.questions);if(calls.fail)throw Error('down');return{model:'jev-test',answers:{count_0:{choice:'1',confidence:.9},provider_0_0:{choice:'serper',confidence:.91},count_1:{choice:'1',confidence:.9},provider_1_0:{choice:'valyu',confidence:.87}},usage:{input_tokens:40,output_tokens:3}}}}}));
import {routeSubqueries} from '../src/core/jev-router.js';
import {SearchRequestSchema} from '../src/contracts/search.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
afterEach(()=>{delete process.env.TYPESAFE_API_KEY;calls.count=0;calls.keys=[];calls.state=null;calls.fail=false});
it('selects providers separately for two subqueries in one bounded Jev call',async()=>{
 process.env.TYPESAFE_API_KEY='test';const r=SearchRequestSchema.parse({tenant_id:'t',query:'find company news and filings'}),m=await new HeuristicMandateWriter().write(r);
 const jobs=[{id:'news',query:'company news',candidates:[{provider:'exa',learned:{runs:7,vertical:'web',direct:12}},{provider:'serper'}]},{id:'filings',query:'company filings',candidates:[{provider:'serper'},{provider:'valyu'}]}];
 const decisions=await routeSubqueries(r,m,jobs);
 expect(calls.count).toBe(1);expect(calls.state.subqueries[0].available_providers[0].earned_capability).toEqual({runs:7,vertical:'web',direct:12});expect(calls.keys).toEqual(['count_0','provider_0_0','provider_0_1','count_1','provider_1_0','provider_1_1']);expect(calls.state.subqueries.map((x:any)=>x.query)).toEqual(['company news','company filings']);expect(decisions.map(x=>x.selected)).toEqual(['serper','valyu']);
});
it('falls back when Jev fails and skips a singleton eligible route',async()=>{
 process.env.TYPESAFE_API_KEY='test';calls.fail=true;const r=SearchRequestSchema.parse({tenant_id:'t',query:'test'}),m=await new HeuristicMandateWriter().write(r);
 const out=await routeSubqueries(r,m,[{id:'one',query:'test',candidates:[{provider:'exa'},{provider:'valyu',excluded:'not capable'}]}]);
 expect(calls.count).toBe(0);expect(out[0]).toMatchObject({selected:undefined,policy:'capability-v1'});
});
