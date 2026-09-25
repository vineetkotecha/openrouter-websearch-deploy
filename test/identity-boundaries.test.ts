import {describe,it,expect} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp.js';
import {makeApp} from '../src/server/app.js';
import {SearchHarness,MemoryStore} from '../src/core/harness.js';
import {HeuristicMandateWriter} from '../src/core/mandate.js';
const cfg:any={SEARCH_TIMEOUT_MS:1000,LOG_LEVEL:'silent',PLATFORM_ADMIN_KEY:'platform-secret',apiKeys:new Map([['builder-key','tenant-a']])};
const harness=()=>new SearchHarness(cfg,new HeuristicMandateWriter(),[],new MemoryStore());
describe('identity boundaries',()=>{
 it('platform admin cannot search or create outcomes as a builder',async()=>{const app=await makeApp(cfg,harness(),new MemoryStore());const r=await app.inject({method:'POST',url:'/v1/search',headers:{authorization:'Bearer platform-secret'},payload:{query:'x',tenant_id:'platform'}});expect(r.statusCode).toBe(403);const o=await app.inject({method:'POST',url:'/v1/outcomes',headers:{authorization:'Bearer platform-secret'},payload:{episode_id:'e0000000-0000-4000-8000-000000000001',event_id:'e0000000-0000-4000-8000-000000000002',type:'selected',occurred_at:new Date().toISOString()}});expect(o.statusCode).toBe(403);await app.close()});
 it('hosted MCP rejects an unregistered end-user and never calls search',async()=>{const store=new MemoryStore();const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[],store);const[a,b]=InMemoryTransport.createLinkedPair();await createMcpServer(h,{tenantId:'tenant-a',role:'admin',scopes:['mcp']},async()=>undefined,async()=>[]).connect(a);const cl=new Client({name:'test',version:'1'});await cl.connect(b);const r:any=await cl.callTool({name:'personalized_web_search',arguments:{query:'x',user_id:'stranger'}});expect(r.isError).toBe(true);expect(store.episodes.size).toBe(0);await cl.close()});
});
