import { describe, it, expect } from "vitest";
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
