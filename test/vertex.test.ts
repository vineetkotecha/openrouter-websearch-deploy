import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { VertexClient, parseServiceAccount, signedJwt } from "../src/core/vertex.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const saJson = JSON.stringify({ type: "service_account", project_id: "proj-x", client_email: "sa@proj-x.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token" });

describe("vertex client", () => {
  it("parses raw and base64 service-account JSON", () => {
    expect(parseServiceAccount(saJson).project_id).toBe("proj-x");
    expect(parseServiceAccount(Buffer.from(saJson).toString("base64")).client_email).toBe("sa@proj-x.iam.gserviceaccount.com");
    expect(() => parseServiceAccount("{}")).toThrow(/missing/);
  });
  it("signs a verifiable RS256 JWT", () => {
    const jwt = signedJwt(parseServiceAccount(saJson), 1000);
    const [h, b, s] = jwt.split(".");
    const ok = createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s!.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    expect(ok).toBe(true);
    expect(JSON.parse(Buffer.from(b!, "base64").toString()).iss).toBe("sa@proj-x.iam.gserviceaccount.com");
  });
  it("gets a token, calls only the pinned model and location, and caches the token", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":1}" }] } }] }));
    }) as unknown as typeof fetch;
    const v = new VertexClient(saJson, "us-central1", fetcher);
    expect(await v.generate("gemini-2.5-flash", "hi")).toBe("{\"ok\":1}");
    expect(v.current()).toBe("gemini-2.5-flash@us-central1");
    expect(calls.some(u => u.startsWith("https://us-central1-aiplatform.googleapis.com/v1/projects/proj-x/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent"))).toBe(true);
    await v.generate("gemini-2.5-flash", "again");
    expect(calls.filter(u => u.includes("oauth2")).length).toBe(1);
  });
  it("does not silently change model or location on an access error", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => { calls.push(url); return url.includes("oauth2") ? new Response(JSON.stringify({ access_token: "t" })) : new Response(JSON.stringify({ error: {message:"not found"} }), {status:404}); }) as unknown as typeof fetch;
    await expect(new VertexClient(saJson, "us-central1", fetcher).generate("gemini-2.5-flash", "hi")).rejects.toThrow(/404/);
    expect(calls.filter(u => u.includes("aiplatform"))).toHaveLength(1);
  });
  it("does not walk models on an auth failure", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(new VertexClient(saJson, "us-central1", fetcher).generate("m", "p")).rejects.toThrow(/vertex token/);
  });
});

describe("Vertex slow response budget", () => {
  it("gives the generation a 60-second window, keeping token minting bounded separately", async () => {
    const original = AbortSignal.timeout;
    const budgets: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => { budgets.push(ms); return original(ms); });
    try {
      const fetcher = (async (url: string) => url.includes("oauth2")
        ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":1}" }] } }] }))) as unknown as typeof fetch;
      await new VertexClient(saJson, "us-central1", fetcher).generate("gemini-2.5-flash", "slow call");
      expect(budgets).toEqual([8000, 60_000]);
    } finally { spy.mockRestore(); }
  });
});

describe("Vertex capacity recovery",()=>{
 it("backs off and retries 429 on the same pinned model and region",async()=>{
  const urls:string[]=[],delays:number[]=[];let generations=0;
  const fetcher=(async(url:string)=>{urls.push(url);if(url.includes("oauth2"))return new Response(JSON.stringify({access_token:"t",expires_in:3600}));generations++;return generations<3?new Response(JSON.stringify({error:{message:"Resource exhausted"}}),{status:429}):new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]}));}) as unknown as typeof fetch;
  const v=new VertexClient(saJson,"us-central1",fetcher,async ms=>{delays.push(ms)});
  expect(await v.generate("gemini-2.5-flash","hi")).toBe('{"ok":true}');expect(generations).toBe(3);expect(delays).toHaveLength(2);expect(delays[0]).toBeGreaterThanOrEqual(1000);expect(delays[1]).toBeGreaterThanOrEqual(2000);expect(new Set(urls.filter(u=>u.includes("aiplatform"))).size).toBe(1);
 });
 it("stops after three failed capacity attempts",async()=>{
  let count=0;const fetcher=(async(url:string)=>url.includes("oauth2")?new Response(JSON.stringify({access_token:"t",expires_in:3600})):(count++,new Response(JSON.stringify({error:{message:"Resource exhausted"}}),{status:429}))) as unknown as typeof fetch;
  await expect(new VertexClient(saJson,"us-central1",fetcher,async()=>{}).generate("gemini-2.5-flash","hi")).rejects.toThrow(/429/);expect(count).toBe(3);
 });
});
