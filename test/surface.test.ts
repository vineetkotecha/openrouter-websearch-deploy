import{describe,it,expect}from"vitest";import{Client}from"@modelcontextprotocol/sdk/client/index.js";import{InMemoryTransport}from"@modelcontextprotocol/sdk/inMemory.js";
import{createMcpServer}from"../src/mcp.js";import{SearchHarness,MemoryStore}from"../src/core/harness.js";import{HeuristicMandateWriter}from"../src/core/mandate.js";import{makeApp}from"../src/server/app.js";
const prov:any={name:"exa",enabled:()=>true,search:async()=>[{provider:"exa",url:"https://example.com/a",title:"A result",snippet:"quiet laptop review"}]};
const cfg:any={SEARCH_TIMEOUT_MS:1000,LOG_LEVEL:"silent",apiKeys:new Map([["k-prod","production"]])};
const harness=()=>new SearchHarness(cfg,new HeuristicMandateWriter(),[prov],new MemoryStore());

describe("MCP client contract",()=>{
  it("lists the search tool and returns structured results a client can parse",async()=>{
    const[a,b]=InMemoryTransport.createLinkedPair();const srv=createMcpServer(harness());await srv.connect(a);
    const cl=new Client({name:"check",version:"1"});await cl.connect(b);
    const tools=await cl.listTools();const t=tools.tools.find(x=>x.name==="personalized_web_search");expect(t).toBeTruthy();expect((t!.inputSchema as any).required).toContain("query");
    const r:any=await cl.callTool({name:"personalized_web_search",arguments:{query:"quiet laptop",tenant_id:"t1"}});
    expect(r.isError).toBeFalsy();const body=JSON.parse(r.content[0].text);expect(body.status).toBe("complete");expect(body.results[0].url).toBe("https://example.com/a");expect(body.plan).toBeTruthy();await cl.close()});
  it("errors cleanly without a tenant on local stdio",async()=>{
    const[a,b]=InMemoryTransport.createLinkedPair();await createMcpServer(harness()).connect(a);const cl=new Client({name:"c",version:"1"});await cl.connect(b);
    const r:any=await cl.callTool({name:"personalized_web_search",arguments:{query:"x"}});expect(r.isError).toBe(true);expect(r.content[0].text).toMatch(/tenant_id required/);await cl.close()});
  it("ignores a spoofed tenant_id when an authenticated principal is bound",async()=>{
    const store=new MemoryStore();const h=new SearchHarness(cfg,new HeuristicMandateWriter(),[prov],store);const[a,b]=InMemoryTransport.createLinkedPair();
    await createMcpServer(h,{tenantId:"real-tenant",role:"user",scopes:["mcp"]}).connect(a);const cl=new Client({name:"c",version:"1"});await cl.connect(b);
    await cl.callTool({name:"personalized_web_search",arguments:{query:"x",tenant_id:"someone-else"}});const ep:any=[...store.episodes.values()][0];expect(ep.tenantId).toBe("real-tenant");await cl.close()});
  it("rejects malformed tool arguments",async()=>{
    const[a,b]=InMemoryTransport.createLinkedPair();await createMcpServer(harness()).connect(a);const cl=new Client({name:"c",version:"1"});await cl.connect(b);
    const r:any=await cl.callTool({name:"personalized_web_search",arguments:{query:42}}).catch(e=>({isError:true,content:[{text:String(e)}]}));expect(r.isError).toBe(true);await cl.close()});
});

describe("REST negative paths",()=>{
  const post=async(url:string,body:any,key?:string)=>{const app=await makeApp(cfg,harness(),new MemoryStore());return app.inject({method:"POST",url,headers:{"content-type":"application/json",...(key?{authorization:`Bearer ${key}`}:{})},payload:JSON.stringify(body)})};
  it("401 without a key",async()=>{expect((await post("/v1/search",{query:"x",tenant_id:"production"})).statusCode).toBe(401)});
  it("401 with a wrong key",async()=>{expect((await post("/v1/search",{query:"x",tenant_id:"production"},"nope")).statusCode).toBe(401)});
  it("403 on tenant mismatch",async()=>{const r=await post("/v1/search",{query:"x",tenant_id:"other"},"k-prod");expect(r.statusCode).toBe(403);expect(r.json().error).toBe("tenant_mismatch")});
  it("400 on an invalid body",async()=>{const r=await post("/v1/search",{tenant_id:"production"},"k-prod");expect(r.statusCode).toBe(400);expect(r.json().error).toBe("invalid_request")});
  it("400 on an oversized result limit",async()=>{expect((await post("/v1/search",{query:"x",tenant_id:"production",limits:{max_results:100000}},"k-prod")).statusCode).toBe(400)});
  it("503 on resume without a database",async()=>{expect((await post("/v1/resume",{resume_token:"x",answer:"y"},"k-prod")).statusCode).toBe(503)});
  it("200 happy path for the static key",async()=>{const r=await post("/v1/search",{query:"quiet laptop",tenant_id:"production"},"k-prod");expect(r.statusCode).toBe(200);expect(r.json().status).toBe("complete")});
});

describe("CORS",()=>{it("does not 500 on a disallowed origin and allows MCP headers for the dashboard",async()=>{const app=await makeApp(cfg,harness(),new MemoryStore());const bad=await app.inject({method:"POST",url:"/v1/search",headers:{origin:"https://evil.example",authorization:"Bearer k-prod","content-type":"application/json"},payload:JSON.stringify({query:"x",tenant_id:"production"})});expect(bad.statusCode).not.toBe(500);expect(bad.headers["access-control-allow-origin"]).toBeUndefined();const pre=await app.inject({method:"OPTIONS",url:"/mcp",headers:{origin:"https://x.vercel.app","access-control-request-method":"POST","access-control-request-headers":"authorization,content-type,mcp-session-id"}});expect(String(pre.headers["access-control-allow-headers"])).toMatch(/mcp-session-id/)})});
describe("MCP over HTTP",()=>{it("keeps CORS headers on the hijacked MCP response",async()=>{const app=await makeApp(cfg,harness(),new MemoryStore());const r=await app.inject({method:"POST",url:"/mcp",headers:{origin:"https://x.vercel.app",authorization:"Bearer k-prod","content-type":"application/json",accept:"application/json, text/event-stream"},payload:JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"t",version:"1"}}})});expect(r.statusCode).toBe(200);expect(r.headers["access-control-allow-origin"]).toBe("https://x.vercel.app");expect(r.json().result.serverInfo.name).toBe("divaine-search")})});
describe("tool cards",()=>{it("exposes cards with live status over REST and MCP",async()=>{const app=await makeApp(cfg,harness(),new MemoryStore());const r=await app.inject({method:"GET",url:"/v1/providers",headers:{authorization:"Bearer k-prod"}});const j=r.json();expect(j.providers).toEqual(["exa"]);const exa=j.cards.find((c:any)=>c.provider==="exa");expect(exa.status).toBe("live");expect(j.cards.find((c:any)=>c.provider==="valyu").status).toBe("no_adapter");expect(JSON.stringify(j)).not.toMatch(/api_key|secret/i);
const[a,b]=InMemoryTransport.createLinkedPair();await createMcpServer(harness()).connect(a);const cl=new Client({name:"c",version:"1"});await cl.connect(b);const res=await cl.readResource({uri:"divaine://providers/cards"});expect(JSON.parse((res.contents[0] as any).text).length).toBeGreaterThan(10);const t=(await cl.listTools()).tools[0]!;expect(t.annotations?.readOnlyHint).toBe(true);await cl.close()})});
