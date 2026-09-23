import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Config } from "../config.js";
import type { LlmJudge } from "./faithfulness.js";

// LLM faithfulness judge. Off unless FAITHFULNESS_JUDGE=gemini and a Gemini key is set;
// the deterministic grader always runs underneath and wins on number mismatches.
export function geminiJudge(c: Config): LlmJudge | undefined {
  if (process.env.FAITHFULNESS_JUDGE !== "gemini" || !c.GEMINI_API_KEY) return undefined;
  const model = new GoogleGenerativeAI(c.GEMINI_API_KEY).getGenerativeModel({ model: c.GEMINI_MODEL, generationConfig: { responseMimeType: "application/json", temperature: 0 } });
  return async prompt => (await model.generateContent(prompt)).response.text();
}
