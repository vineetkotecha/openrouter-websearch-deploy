// Structured fill (playbook: "Structured fill - schema path first"). Given the caller's requested
// fields and an extracted page, fill each field only from text that is literally on the page.
// Nothing is invented: a field with no evidence stays null and is labelled "missing".
export type FilledField = { value: string | number | null; state: "supported" | "missing"; evidence?: string; method?: string };
export type FieldFill = Record<string, FilledField>;

const norm = (s: string) => s.toLowerCase().replace(/[_\-]+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const around = (text: string, i: number, len: number) => text.slice(Math.max(0, i - 40), Math.min(text.length, i + len + 40)).replace(/\s+/g, " ").trim();

const TYPED: { test: RegExp; re: RegExp; parse: (m: RegExpMatchArray) => string | number }[] = [
  { test: /^(price|cost|mrp|amount|fee)s?$/, re: /(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i, parse: m => (m[0] ?? "").replace(/\s+/g, " ").trim() },
  { test: /^(rating|stars|score)$/, re: /\b([0-5](?:\.[0-9])?)\s?(?:\/\s?5|out of 5|stars?)\b/i, parse: m => Number(m[1] ?? "") },
  { test: /^(reviews?|review count|ratings count)$/, re: /\b([0-9][0-9,]*)\s+(?:reviews|ratings)\b/i, parse: m => Number((m[1] ?? "").replace(/,/g, "")) },
  { test: /^(date|published|release date|updated)$/, re: /\b(20[0-9]{2}-[01][0-9]-[0-3][0-9]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? [0-3]?[0-9],? 20[0-9]{2})\b/i, parse: m => m[1] ?? "" },
  { test: /^(weight|mass)$/, re: /weigh[a-z]*[^0-9\n]{0,30}([0-9]+(?:\.[0-9]+)?\s?(?:g|grams|kg|oz|ounces|lbs?)\b)/i, parse: m => (m[1] ?? "").trim() },
  { test: /^(drop|heel drop|offset|heel to toe drop)$/, re: /(?:drop|offset)[^0-9\n]{0,30}([0-9]+(?:\.[0-9]+)?\s?mm\b)/i, parse: m => (m[1] ?? "").trim() },
  { test: /^(stack|stack height)$/, re: /stack[^0-9\n]{0,30}([0-9]+(?:\.[0-9]+)?\s?mm\b)/i, parse: m => (m[1] ?? "").trim() },
  { test: /^(email|contact email)$/, re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, parse: m => m[0] ?? "" },
  { test: /^(phone|telephone|contact number)$/, re: /(?:\+?[0-9][0-9 ()-]{8,}[0-9])/, parse: m => (m[0] ?? "").trim() },
];

export function fillOne(field: string, page: string): FilledField {
  const f = norm(field);
  // 1. Labelled value on the page: "Weight: 250 g", "Weight | 250 g", "**Weight** 250 g".
  const label = new RegExp(`(?:^|\\n|\\|)\\s*\\**${esc(f).replace(/ /g, "[ _-]?")}\\**\\s*(?::|\\||-|–)\\s*([^\\n|]{1,120})`, "i");
  const lm = page.match(label);
  if (lm && lm[1]?.trim()) return { value: (lm[1] ?? "").trim().replace(/\*+/g, ""), state: "supported", evidence: around(page, lm.index ?? 0, (lm[0] ?? "").length), method: "label" };
  // 2. Typed pattern for common fields, taken from the first occurrence on the page.
  const t = TYPED.find(x => x.test.test(f));
  if (t) { const m = page.match(t.re); if (m) return { value: t.parse(m), state: "supported", evidence: around(page, m.index ?? 0, (m[0] ?? "").length), method: "pattern" }; }
  return { value: null, state: "missing" };
}

export function fillFields(fields: string[], page: string): FieldFill {
  const out: FieldFill = {};
  for (const f of fields.slice(0, 25)) {
    const x = fillOne(f, page);
    // Faithfulness guard: evidence must be a literal span of the page.
    if (x.state === "supported" && x.evidence && !page.replace(/\s+/g, " ").includes(x.evidence)) out[f] = { value: null, state: "missing" };
    else out[f] = x;
  }
  return out;
}

export function fillSummary(fields: string[], fills: (FieldFill | undefined)[]) {
  const got = fills.filter(Boolean) as FieldFill[];
  return { fields, pages: got.length, coverage: Object.fromEntries(fields.map(f => [f, got.filter(g => g[f]?.state === "supported").length])) };
}
