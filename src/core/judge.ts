import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Config } from "../config.js";
import { withWorkingModel } from "./gemini-model.js";
import { VertexClient } from "./vertex.js";
import type { LlmJudge } from "./faithfulness.js";

// LLM faithfulness judge. Off unless FAITHFULNESS_JUDGE=gemini and Vertex credentials or a Gemini key are set;
// the deterministic grader always runs underneath and wins on number mismatches.
export function geminiJudge(c: Config): LlmJudge | undefined {
  if (process.env.FAITHFULNESS_JUDGE !== "gemini") return undefined;
  if (c.GOOGLE_VERTEX_SA_JSON) { const v = new VertexClient(c.GOOGLE_VERTEX_SA_JSON, c.VERTEX_LOCATION); return async prompt => v.generate(c.GEMINI_MODEL, prompt, 0); }
  if (!c.GEMINI_API_KEY) return undefined;
  const name = c.GEMINI_MODEL;
  const gen = async (n: string, prompt: string) => (await new GoogleGenerativeAI(c.GEMINI_API_KEY!).getGenerativeModel({ model: n, generationConfig: { responseMimeType: "application/json", temperature: 0 } }).generateContent(prompt)).response.text();
  return async prompt => withWorkingModel(c.GEMINI_API_KEY!, name, n => gen(n, prompt));
}
