import{describe,it,expect}from"vitest";import{rank}from"../src/core/rank.js";describe("rank",()=>{it("canonicalizes and merges duplicate sources",()=>{const m:any={intent:"quiet laptop",factors:[]};const r=rank(m,[{provider:"a",url:"https://www.example.com/x?utm_source=a",title:"Quiet laptop",snippet:"A quiet laptop for office work with long battery life."},{provider:"b",url:"https://example.com/x",title:"Quiet laptop",snippet:"Same page."}]);expect(r).toHaveLength(1);expect(r[0]?.duplicates).toHaveLength(1)});it("never leaks raw payload",()=>{const r=rank({intent:"phone"} as any,[{provider:"a",url:"https://x.test/p",title:"phone",snippet:"phone details",raw:{secret:"x"}}]);expect(r[0]).not.toHaveProperty("raw")})});

describe("psychological ranking",()=>{it("uses agent-supplied psychological factors to reorder viable results",()=>{const m:any={intent:"choose a laptop",factors:[{key:"quiet_operation",class:"psychological",description:"Prefer quiet operation",value:"quiet silent",weight:1,confidence:1,hard:false,evidence:[{source:"caller"}]}]};const r=rank(m,[{provider:"a",url:"https://fast.test",title:"Fast laptop",snippet:"Powerful benchmark leader"},{provider:"b",url:"https://quiet.test",title:"Quiet laptop",snippet:"Silent low-noise operation"}]);expect(r[0]?.url).toBe("https://quiet.test")})});

describe("evidence-aware ordering",()=>{it("promotes a comparably relevant supported page above an unverified snippet, not a tangential page",()=>{
 const m:any={intent:"battery patent",factors:[]};
 const x=(url:string,title:string,faithfulness?:{state:string,score:number})=>({provider:"test",url,title,snippet:title,score:.5,raw:faithfulness?{faithfulness}:undefined});
 const r=rank(m,[x("https://a.test","battery patent invention"),x("https://b.test","battery patent",{state:"supported",score:.8}),x("https://c.test","unrelated blog",{state:"supported",score:.8})]);
 expect(r[0]?.url).toBe("https://b.test");expect(r[2]?.url).toBe("https://c.test");
})});


describe("snippet evidence discipline",()=>{it("does not present provider snippets as independently supported",()=>{
 const r=rank({intent:"battery patent",factors:[]} as any,[{provider:"test",url:"https://patents.example/a",title:"Battery patent",snippet:"This detailed provider snippet claims the battery patent is valid and licensed worldwide."}]);
 expect(r[0]?.faithfulness).toEqual({state:"unverified",score:.2});expect(r[0]?.reason).toContain("source support is unverified");
})});

it("keeps the human-readable support reason aligned with the graded state",()=>{
 const r=rank({intent:"battery patent",factors:[]} as any,[{provider:"test",url:"https://patents.example/a",title:"Battery patent",snippet:"A battery patent with detailed claims",raw:{verified_content:true,faithfulness:{state:"partial",score:.72}}}]);
 expect(r[0]?.faithfulness.state).toBe("partial");expect(r[0]?.reason).toContain("source support is partial");
});
