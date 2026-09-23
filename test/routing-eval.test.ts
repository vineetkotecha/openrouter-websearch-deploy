import { it, expect } from "vitest";
import { runRoutingEval } from "../src/eval/routing.js";
it("routing eval clears the baseline gate", async () => {
  const r = await runRoutingEval();
  if (r.failures.length) console.log(JSON.stringify(r.failures, null, 1));
  expect(r.cases).toBeGreaterThanOrEqual(28);
  expect(r.class_accuracy).toBeGreaterThanOrEqual(.9);
  expect(r.primary_accuracy).toBeGreaterThanOrEqual(.9);
});
