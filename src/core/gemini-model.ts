// Resolves a Gemini model that the key can actually call. A pinned model name can be
// retired (404) without notice; when that happens we list the key's models once and
// pick the newest stable "gemini-<version>-flash" that supports generateContent.
let cached: string | undefined;

export function pickFlash(names: string[]): string | undefined {
  const stable = names.map(n => n.replace(/^models\//, "")).filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n));
  const ver = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)![1]);
  return stable.sort((a, b) => ver(b) - ver(a))[0];
}

export async function resolveGeminiModel(key: string, pinned: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (cached) return cached;
  try {
    const r = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return pinned;
    const j: any = await r.json();
    const callable = (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name));
    if (callable.includes(`models/${pinned}`)) return (cached = pinned);
    return (cached = pickFlash(callable) ?? pinned);
  } catch { return pinned; }
}

export const isModelGone = (e: unknown) => /\b404\b|not found|is not supported/i.test(String((e as Error)?.message ?? e));
export function resetGeminiModelCache() { cached = undefined; }
