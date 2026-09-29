import {describe,it,expect} from "vitest";
import {SearchRequestSchema} from "../src/contracts/search.js";
import {curateParameters} from "../src/core/parameter-curation.js";
import {fallbackIntentFormation} from "../src/core/intent-formation.js";
import {validateModelParameters,normalizeQuestions} from "../src/core/architecture.js";
const req=(x:any={})=>SearchRequestSchema.parse({query:"watch for formal dinners",tenant_id:"t",...x});
const manifest=(r:any,parameters:any[])=>validateModelParameters({parameters},r,fallbackIntentFormation(r),curateParameters(r));
describe("model parameter and question safety",()=>{
 const object={key:"search_object",class:"functional",why:"what is sought",query_reference:"watch",weight_percent:30,compulsory:true};
 it("does not promote an ungrounded private motive into a compulsory question",()=>{const r=req();const m=manifest(r,[object,{key:"appearance_context",class:"psychological",why:"occasion preferences",weight_percent:70,compulsory:true,question:"Are you buying this for social validation?"}]);expect(m.parameters.find(p=>p.key==="appearance_context")).toMatchObject({state:"missing",compulsory:false});expect(normalizeQuestions({questions:[{key:"appearance_context",question:"Do you want people to look up to you?"}]},m)).toEqual([])});
 it("refuses invented query values, sensitive psychology and invalid weights",()=>{const r=req();expect(()=>manifest(r,[{...object,query_reference:"not in query",weight_percent:100}])).toThrow(/exact query phrase/);expect(manifest(r,[{...object,weight_percent:50},{key:"religion",class:"psychological",why:"x",weight_percent:50,compulsory:true}]).parameters.map(p=>p.key)).toEqual(["search_object"]);expect(()=>manifest(r,[{...object,weight_percent:99}])).toThrow(/100/)});
 it("does not let a model use a query phrase to invent a psychological fact",()=>{const r=req();expect(()=>manifest(r,[object,{key:"social_recognition",class:"psychological",why:"possible motive",query_reference:"formal dinners",weight_percent:70,compulsory:true}])).toThrow(/query_reference requires a functional/)});
});
