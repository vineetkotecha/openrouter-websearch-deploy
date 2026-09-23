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
import { extractSurvivors } from "../src/core/verify.js";
describe("extraction survives a failing judge", () => {
  it("falls back to deterministic grading and still fills fields", async () => {
    const fetcher: any = async () => ({ ok: true, text: async () => "Price: $120\nsome page text about shoes" });
    const judge = async () => { throw new Error("403 project denied"); };
    const { results, report } = await extractSurvivors([{ provider: "exa", url: "https://a.example.com/x", title: "shoe", snippet: "" }], undefined, { fetcher, judge, fields: ["price"] });
    expect(report.extracted).toBe(1); const r: any = results[0];
    expect(r.raw.verified_content).toBe(true); expect(r.fields.price.value).toBe("$120");
  });
});
describe("review-page phrasing", () => {
  it("reads unlabelled weight and drop near their keyword", () => {
    const f = fillFields(["weight", "drop", "stack height"], "The Kayano 31 weighs in at 10.8 oz for a men's 9. It has a heel-to-toe drop of 10 mm and a stack of 40 mm at the heel.");
    expect(f.weight.value).toBe("10.8 oz"); expect(f.drop.value).toBe("10 mm"); expect(f["stack height"].value).toBe("40 mm");
  });
});
