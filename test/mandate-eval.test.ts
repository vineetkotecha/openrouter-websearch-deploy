import{describe,it,expect}from"vitest";import{readFileSync}from"node:fs";import{evalMandates}from"../src/eval/mandate.js";
const cases=JSON.parse(readFileSync(new URL("../eval/mandate-cases.json",import.meta.url),"utf8"));
describe("mandate eval",()=>{it("scores a perfect stub writer at 1 and flags invented psychology",async()=>{
const good:any={write:async(r:any)=>{const c=cases.find((x:any)=>x.query===r.query);return{factors:[...c.functional.map((l:any,i:number)=>({key:"k"+i,class:"functional",description:r.query+" "+l.match.split("|").join(" "),hard:!!l.hard})),...(c.psych_expected??[]).map((k:string)=>({key:k,class:"psychological",description:k}))],gaps:c.gap?[{key:"g",material:true,question:"?"}]:[]}}};
const r=await evalMandates(good,cases);expect(r.n).toBeGreaterThanOrEqual(24);expect(r.gap_accuracy).toBe(1);expect(r.invented_psych_cases).toBe(0);expect(r.hard_constraint_rate).toBe(1);
const bad:any={write:async()=>({factors:[{key:"status_anxiety",class:"psychological",description:"x"}],gaps:[]})};const b=await evalMandates(bad,cases);expect(b.invented_psych_cases).toBeGreaterThan(20);expect(b.functional_recall).toBe(0)})});
