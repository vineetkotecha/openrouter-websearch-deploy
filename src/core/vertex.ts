// Vertex AI Gemini client. Auth is a service-account JSON key (env GOOGLE_VERTEX_SA_JSON, raw JSON or base64).
// We mint an OAuth access token from the key with a signed JWT (RS256, node:crypto) - no extra dependency.
import { createSign } from "node:crypto";

export type ServiceAccount = { client_email: string; private_key: string; project_id: string; token_uri?: string };

export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw.trim() : Buffer.from(raw.trim(), "base64").toString("utf8");
  const j = JSON.parse(text);
  if (!j.client_email || !j.private_key || !j.project_id) throw new Error("service account JSON is missing client_email, private_key or project_id");
  return { client_email: j.client_email, private_key: String(j.private_key).replace(/\\n/g, "\n"), project_id: j.project_id, token_uri: j.token_uri };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signedJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(sa.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

export class VertexClient {
  private token?: { value: string; exp: number };
  private workingModel?: string;
  private workingLocation?: string;
  readonly sa: ServiceAccount;
  constructor(raw: string, private location = "us-central1", private fetcher: typeof fetch = fetch) { this.sa = parseServiceAccount(raw); }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.exp - 60_000) return this.token.value;
    const r = await this.fetcher(this.sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedJwt(this.sa) }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`vertex token [${r.status}] ${String(j.error_description ?? j.error ?? "").slice(0, 200)}`);
    this.token = { value: j.access_token, exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  endpoint(model: string, location: string) {
    const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${this.sa.project_id}/locations/${location}/publishers/google/models/${model}:generateContent`;
  }

  private async call(model: string, location: string, prompt: string, temperature?: number): Promise<string> {
    const r = await this.fetcher(this.endpoint(model, location), {
      method: "POST", headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", ...(temperature === undefined ? {} : { temperature }) } }),
      signal: AbortSignal.timeout(30_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`vertex ${model}@${location} [${r.status}] ${String(j.error?.message ?? "").slice(0, 200)}`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    if (!text) throw new Error(`vertex ${model}@${location} returned no text (${j.candidates?.[0]?.finishReason ?? "no candidates"})`);
    return text;
  }

  // Never silently change model or data location: these are user-owned choices.
  async generate(pinned: string, prompt: string, temperature?: number): Promise<string> {
    const out = await this.call(pinned, this.location, prompt, temperature);
    this.workingModel = pinned;
    this.workingLocation = this.location;
    return out;
  }
  current() { return this.workingModel ? `${this.workingModel}@${this.workingLocation}` : undefined; }
}
