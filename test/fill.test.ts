import { describe, it, expect } from "vitest";
import { fillFields, fillSummary } from "../src/core/fill.js";
const page = `Title: Asics Gel-Kayano 31\n\n**Price:** ₹14,999\nWeight | 305 g\nRated 4.6 out of 5 from 2,184 reviews\nReleased Mar 12, 2025\nSupport - stability, for flat feet`;
describe("structured fill", () => {
  it("fills labelled and typed fields with literal evidence", () => {
    const f = fillFields(["price", "weight", "rating", "reviews", "date", "support"], page);
    expect(f.price.state).toBe("supported"); expect(String(f.price.value)).toContain("14,999");
    expect(f.weight.value).toBe("305 g"); expect(f.rating.value).toBe(4.6); expect(f.reviews.value).toBe(2184);
    expect(f.date.value).toBe("Mar 12, 2025"); expect(f.support.value).toMatch(/stability/);
    for (const x of Object.values(f)) expect(page.replace(/\s+/g, " ")).toContain(x.evidence!);
  });
  it("never invents a value that is not on the page", () => {
    const f = fillFields(["drop", "warranty", "price"], "A plain page with no data on it.");
    expect(f.drop).toEqual({ value: null, state: "missing" }); expect(f.warranty.state).toBe("missing"); expect(f.price.state).toBe("missing");
  });
  it("summarises coverage per field", () => {
    const s = fillSummary(["price", "drop"], [fillFields(["price", "drop"], page), undefined, fillFields(["price", "drop"], "Price: $120")]);
    expect(s).toEqual({ fields: ["price", "drop"], pages: 2, coverage: { price: 2, drop: 0 } });
  });
});
