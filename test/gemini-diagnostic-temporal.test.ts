import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {curateParameters} from "../src/core/parameter-curation.js";
import {fallbackIntentFormation} from "../src/core/intent-formation.js";
import {auditPrompt,normalizeAudit,parameterPrompt,validateModelParameters} from "../src/core/architecture.js";
import {GeminiMandateWriter} from "../src/core/mandate.js";
const request=SearchRequestSchema.parse({tenant_id:"smoke",query:"latest Artemis II mission updates"});
describe("Gemini diagnostic and temporal grounding",()=>{
 it("passes the exact current date and prevents a stale remembered schedule from vetoing a dated source",()=>{
  const prompt=auditPrompt(request,{intent:"mission updates"} as any,[{provider:"exa",url:"https://nasa.gov/news",title:"NASA update",snippet:"April 2026 mission report"}],new Date("2026-09-28T12:00:00Z"));
  expect(prompt).toContain("Today is 2026-09-28 UTC");expect(prompt).toContain("A dated page before today is not future-dated");expect(prompt).toContain("mark uncertain rather than inventing a contradiction");
 });
 it("downgrades a stale-memory contradiction rather than vetoing a dated result",()=>{const item={provider:"exa",url:"https://nasa.gov/news",title:"NASA update April 20, 2026",snippet:"April 20, 2026 NASA mission report"};const result=normalizeAudit({verdicts:[{url:item.url,state:"fail",reason:"From a current real-world perspective it has not yet launched, planned for late 2025"}]},[item],new Date("2026-09-28T00:00:00Z"));expect(result[0]?.state).toBe("uncertain");const verified=normalizeAudit({verdicts:[{url:item.url,state:"fail",reason:"The article discusses a different mission"}]},[item],new Date("2026-09-28T00:00:00Z"));expect(verified[0]?.state).toBe("fail")});
 it("requires an exact functional phrase and no psychological query_reference in the revised prompt",()=>{
  const p=parameterPrompt(request,fallbackIntentFormation(request));expect(p).toContain("copy an exact phrase");expect(p).toContain("Never put query_reference on psychological parameters");
  const base=curateParameters(request);expect(()=>validateModelParameters({parameters:[{key:"search_object",class:"functional",why:"searched item",weight_percent:100,compulsory:true,query_reference:"not in query"}]},request,fallbackIntentFormation(request),base)).toThrow(/exact query phrase/);
 });
 it("surfaces a bounded validation failure without model payloads or credentials",async()=>{
  const writer=new GeminiMandateWriter({} as any);(writer as any).generate=async()=>({parameters:[{key:"search_object",class:"functional",why:"item",weight_percent:99,compulsory:true,query_reference:"Artemis II"}]});
  const m=await writer.parameters(request,fallbackIntentFormation(request),curateParameters(request));expect(m.generation).toBe("gemini");expect(m.parameters.reduce((n,p)=>n+p.priority,0)).toBeCloseTo(100);
 });
});

it('downgrades a verdict with an invented source excerpt',()=>{
 const item={provider:'exa',url:'https://example.test/1',title:'Actual cafe',snippet:'Lunch cafe in Bengaluru'};
 const verdict=normalizeAudit({verdicts:[{url:item.url,state:'fail',reason:'Wrong location',evidence_quote:'This is in Delhi'}]},[item]);
 expect(verdict[0]?.state).toBe('uncertain');
});
