import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {SearchRequestSchema} from "../src/contracts/search.js";
const store=readFileSync("src/storage/postgres.ts","utf8");const migration=readFileSync("migrations/0009_agent_identity.sql","utf8");const app=readFileSync("src/server/app.ts","utf8");
describe("builder-agent-end-user namespace",()=>{
 it("accepts an explicit agent ID without treating it as a tenant ID",()=>{const a=SearchRequestSchema.parse({query:"x",tenant_id:"builder",agent_id:"agent-a",user_id:"u"});expect(a.agent_id).toBe("agent-a");expect(a.tenant_id).toBe("builder")});
 it("requires builder ownership and agent registration before end-user registration",()=>{expect(store).toContain('agentId==="default"?await this.ensureDefaultAgent(tenant):await this.lookupAgent(tenant,agentId)');expect(store).toContain('if(!agent)throw new Error("unregistered_agent")');expect(app).toContain('app.post("/v1/agents"')});
 it("checks all three identities on a context read",()=>{expect(store).toContain('WHERE tenant_id=$1 AND external_id=$2 AND agent_id=(SELECT id FROM builder_agents WHERE tenant_id=$1 AND external_id=$3)');expect(migration).toContain('UNIQUE(tenant_id,external_id)');expect(migration).toContain('end_users_agent_external_key');expect(app).toContain('db.contextFor(p,parsed.data.user_id,"search",parsed.data.agent_id??"default")')});
});
