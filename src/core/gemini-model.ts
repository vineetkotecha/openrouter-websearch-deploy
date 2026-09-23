// Resolves a Gemini model that the key can actually call. A pinned model name can be
// retired (404) or be off-limits for the key's tier (403) without notice; when that happens
// we list the key's models once and walk stable flash models, newest first, until one answers.
let cached: string | undefined;
let candidates: string[] | undefined;
let deadUntil = 0; // after a full failed walk, skip the walk for 10 minutes

const ver = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
export function flashCandidates(names: string[]): string[] {
  const stable = names.map(n => n.replace(/^models\//, "")).filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
  return stable.sort((a, b) => ver(b) - ver(a) || (a.endsWith("-lite") ? 1 : 0) - (b.endsWith("-lite") ? 1 : 0));
}
export function pickFlash(names: string[]): string | undefined { return flashCandidates(names).find(n => !n.endsWith("-lite")); }

export async function listCandidates(key: string, pinned: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (candidates) return candidates;
  try {
    const r = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const callable = (j.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent")).map((m: any) => String(m.name));
    return (candidates = flashCandidates(callable).filter(n => n !== pinned));
  } catch { return []; }
}

// Back-compat: first candidate after the pinned one.
export async function resolveGeminiModel(key: string, pinned: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (cached) return cached;
  const c = await listCandidates(key, pinned, fetcher);
  return (cached = c.find(n => !n.endsWith("-lite")) ?? c[0] ?? pinned);
}

export const isModelGone = (e: unknown) => /\b(403|404)\b|not found|is not supported|no longer available|permission/i.test(String((e as Error)?.message ?? e));

// Run `gen` on the working model; on a model-access error walk the candidates once and remember the winner.
export async function withWorkingModel<T>(key: string, pinned: string, gen: (model: string) => Promise<T>): Promise<T> {
  const first = cached ?? pinned;
  try { return await gen(first); } catch (e) {
    if (!isModelGone(e)) throw e;
    if (Date.now() < deadUntil) throw e;
    // Google's retirement message names the replacement ("use models/gemini-X"); try that first.
    const suggested = String((e as Error)?.message ?? "").match(/use models\/(gemini-\d+(?:\.\d+)?-[a-z]+(?:-[a-z]+)*)/)?.[1];
    const order = [...new Set([...(suggested ? [suggested] : []), ...await listCandidates(key, pinned)])].filter(m => m !== first);
    const errors: string[] = [];
    for (const m of order) {
      try { const out = await gen(m); cached = m; return out; } catch (err) {
        errors.push(`${m}: ${String((err as Error)?.message ?? err).replace(/^.*?\[(\d{3}[^\]]*)\]/, "[$1]").slice(0, 140)}`);
        if (!isModelGone(err)) throw err;
      }
    }
    deadUntil = Date.now() + 10 * 60_000;
    throw new Error(`no callable Gemini model; pinned ${first} failed; tried ${errors.join(" | ")}`);
  }
}
export function currentGeminiModel() { return cached; }
export function resetGeminiModelCache() { cached = undefined; candidates = undefined; deadUntil = 0; }
