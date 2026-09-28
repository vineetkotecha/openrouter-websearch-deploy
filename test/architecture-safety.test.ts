import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {curateParameters} from "../src/core/parameter-curation.js";
import {fallbackIntentFormation} from "../src/core/intent-formation.js";
import {validateModelParameters,normalizeQuestions} from "../src/core/architecture.js";
const req=(x:any={})=>SearchRequestSchema.parse({query:"watch for formal dinners",tenant_id:"t",...x});
const manifest=(r:any,parameters:any[])=>validateModelParameters({parameters},r,fallbackIntentFormation(r),curateParameters(r));
describe("model parameter and question safety",()=>{
 const object={key:"search_object",class:"functional",why:"what is sought",query_reference:"watch",weight_percent:30,compulsory:true};
 it("permits a must-fill psychological question but never asserts the private motive",()=>{const r=req();const m=manifest(r,[object,{key:"appearance_context",class:"psychological",why:"occasion preferences",weight_percent:70,compulsory:true,question:"Are you buying this for social validation?"}]);expect(m.parameters.find(p=>p.key==="appearance_context")?.state).toBe("missing");expect(normalizeQuestions({questions:[{key:"appearance_context",question:"Do you want people to look up to you?"}]},m)).toEqual(["Is there an example of what feels right to you?"])});
 it("refuses invented query values, sensitive psychology and invalid weights",()=>{const r=req();expect(()=>manifest(r,[{...object,query_reference:"not in query",weight_percent:100}])).toThrow(/exact query phrase/);expect(()=>manifest(r,[{...object,weight_percent:50},{key:"religion",class:"psychological",why:"x",weight_percent:50,compulsory:true}])).toThrow(/sensitive/);expect(()=>manifest(r,[{...object,weight_percent:99}])).toThrow(/100/)});
 it("does not let a model use a query phrase to invent a psychological fact",()=>{const r=req();expect(()=>manifest(r,[object,{key:"social_recognition",class:"psychological",why:"possible motive",query_reference:"formal dinners",weight_percent:70,compulsory:true}])).toThrow(/query_reference requires a functional/)});
});
