import { describe, it, expect } from "vitest";
import { gradeDeterministic, gradeWithLlm, splitGroundedAnswer, splitClaims } from "../src/core/faithfulness.js";
import { rank } from "../src/core/rank.js";
import { HeuristicMandateWriter } from "../src/core/mandate.js";
import { SearchRequestSchema } from "../src/contracts/search.js";

const page = "The Aero 14 laptop weighs 1.2 kg and costs $1,299. Battery life is rated at 14 hours in reviews. It has a quiet fan.";
describe("faithfulness grader", () => {
  it("supports claims the page states", () => {
    const f = gradeDeterministic({ title: "Aero 14", snippet: "The Aero 14 laptop weighs 1.2 kg. Battery life is rated at 14 hours." }, page);
    expect(f.state).toBe("supported");
  });
  it("flags numbers the page does not contain", () => {
    const f = gradeDeterministic({ title: "Aero 14", snippet: "The Aero 14 laptop costs $899 with battery life rated at 20 hours." }, page);
    expect(f.state).not.toBe("supported");
    expect(f.claims[0]!.missing_numbers.length).toBeGreaterThan(0);
  });
  it("leaves results without a page unverified", () => {
    expect(gradeDeterministic({ title: "x", snippet: "some claim about laptops here" }, "").state).toBe("unverified");
  });
  it("LLM judge cannot override a number mismatch", async () => {
    const f = await gradeWithLlm({ title: "Aero", snippet: "The Aero 14 laptop costs $899 today in stores." }, page, async () => '{"verdicts":["supported"]}');
    expect(f.state).not.toBe("supported");
  });
  it("splits claims and ignores fragments", () => { expect(splitClaims("Good laptop. Ok. Battery lasts all day long [1].").length).toBe(1); });
});

describe("grounded answers", () => {
  it("splits answers per cited source and keeps them unverified until checked", async () => {
    const items = splitGroundedAnswer("perplexity", "The Aero 14 weighs 1.2 kg [1]. Battery lasts 14 hours [2]. Reviewers like the fan [1].", ["https://a.example/r", "https://b.example/r"]);
    expect(items).toHaveLength(2);
    expect(items[0]!.snippet).toContain("1.2 kg");
    expect(items[0]!.snippet).not.toContain("14 hours");
    const r = SearchRequestSchema.parse({ query: "light laptop", tenant_id: "t" });
    const out = rank(await new HeuristicMandateWriter().write(r), items, 5);
    expect(out.every(x => x.faithfulness.state === "unverified")).toBe(true);
  });
});
