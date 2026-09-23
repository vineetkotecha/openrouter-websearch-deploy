import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Config } from "../config.js";
import { resolveGeminiModel, isModelGone } from "./gemini-model.js";
import type { LlmJudge } from "./faithfulness.js";

// LLM faithfulness judge. Off unless FAITHFULNESS_JUDGE=gemini and a Gemini key is set;
// the deterministic grader always runs underneath and wins on number mismatches.
export function geminiJudge(c: Config): LlmJudge | undefined {
  if (process.env.FAITHFULNESS_JUDGE !== "gemini" || !c.GEMINI_API_KEY) return undefined;
  let name = c.GEMINI_MODEL;
  const gen = async (n: string, prompt: string) => (await new GoogleGenerativeAI(c.GEMINI_API_KEY!).getGenerativeModel({ model: n, generationConfig: { responseMimeType: "application/json", temperature: 0 } }).generateContent(prompt)).response.text();
  return async prompt => { try { return await gen(name, prompt); } catch (e) { if (!isModelGone(e)) throw e; name = await resolveGeminiModel(c.GEMINI_API_KEY!, c.GEMINI_MODEL); return gen(name, prompt); } };
}
