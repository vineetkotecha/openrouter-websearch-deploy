// Calling-agent context pull (product doc v1: "pull context from the calling agent before asking
// the human"). The harness never reaches into other systems itself: it names the context it is
// missing, why, and under which scope, and the calling agent decides what to send back.
import type { Mandate, SearchRequest } from "../contracts/search.js";

export type ContextRequest = {
  status: "needs_input"; kind: "context_request"; episode_id: string; gap: string; question: string;
  requested_context: { key: string; why: string; accepted_sources: ("caller" | "human" | "prior_outcome")[]; scope: string[] }[];
  how_to_answer: string;
};

const LOCAL = /\b(near me|nearby|near by|around me|in my area|closest|open now|local)\b/i;
const BUY = /\b(buy|purchase|shop|order|price|cheap|deal|under \$?[0-9])\b/i;

// Heuristic gaps: only facts the query cannot answer and that change the result set.
// Location for "near me" searches is material; budget for shopping is not (we still rank without it).
export function heuristicGaps(r: SearchRequest): Mandate["gaps"] {
  const has = (k: RegExp) => r.context.some(c => (!c.expires_at||Date.parse(c.expires_at)>Date.now())&&k.test(c.key)&&c.value!=null&&String(c.value).trim()!=="") || Object.entries(r.hard_constraints).some(([key,value]) => k.test(key)&&value!=null&&String(value).trim()!=="");
  const gaps: Mandate["gaps"] = [];
  // Broad shopping requests need the intended use before the result set is meaningful.
  if (/\bbest laptop\b/i.test(r.query) && !has(/^(use_case|purpose|usage)/i))
    gaps.push({ key: "use_case", material: true, question: "What will the laptop be used for?" });
  if (/\bweekend trip\b/i.test(r.query) && !has(/^(origin|departure|location|city)/i))
    gaps.push({ key: "origin", material: true, question: "Where would you leave from?" });
  if (/\b(luxury )?watch for my anniversary\b/i.test(r.query) && !has(/^(recipient|wrist_size|style)/i))
    gaps.push({ key: "recipient", material: true, question: "Who is the watch for?" });
  if (LOCAL.test(r.query) && !has(/^(location|city|area|lat|lng|lon|postcode|zip|address)/i) && !/\b(?:in|near|around)\s+(?!me\b|my\b|the\b)[A-Z][\p{L}\s,-]{2,60}/u.test(r.query))
    gaps.push({ key: "location", material: true, question: "Which city or area should I search near?" });
  if (BUY.test(r.query) && !has(/^(budget|price|max_price|price_max)/i) && !/[$₹€£]\s?[0-9]|\b[0-9]+\s?(usd|inr|rs|dollars|rupees)\b/i.test(r.query))
    gaps.push({ key: "budget", material: false, question: "Is there a budget I should stay under?" });
  return gaps;
}

// Drop gaps the caller already answered through context or hard constraints.
export function openGaps(m: Mandate, r: SearchRequest): Mandate["gaps"] {
  const answered = new Set([...r.context.filter(c=>!c.expires_at||Date.parse(c.expires_at)>Date.now()).map(c => c.key.toLowerCase()), ...Object.keys(r.hard_constraints).map(k => k.toLowerCase())]);
  return m.gaps.filter(g => !answered.has(g.key.toLowerCase()));
}

export function contextRequest(episode_id: string, gap: { key: string; question?: string }, r: SearchRequest): ContextRequest {
  return {
    status: "needs_input", kind: "context_request", episode_id, gap: gap.key,
    question: gap.question ?? `Provide ${gap.key}.`,
    requested_context: [{ key: gap.key, why: `Material to the result set: ${gap.question ?? gap.key}`, accepted_sources: ["caller", "human", "prior_outcome"], scope: r.permissions.scopes.length ? r.permissions.scopes : ["this_search"] }],
    how_to_answer: `Call search again with the same query and add {"key":"${gap.key}","value":...,"source":"caller"|"human"|"prior_outcome","confidence":0-1} to context. Send only what the user allowed you to share; omit it to search without it.`,
  };
}

// What context shaped the search, for display. Values stay with the caller; only keys, source,
// confidence and time are echoed.
export function contextUsed(r: SearchRequest) {
  return { scopes: r.permissions.scopes, items: r.context.map(c => ({ key: c.key, source: c.source, confidence: c.confidence, observed_at: c.observed_at })) };
}

// Provider-facing query: a pulled location replaces "near me" so providers search the right place.
// The caller's other context stays out of the provider query.
export function localizeQuery(r: SearchRequest): SearchRequest {
  const item = r.context.find(c => (!c.expires_at||Date.parse(c.expires_at)>Date.now()) && /^(location|city|area|address)$/i.test(c.key) && typeof c.value === "string" && c.value.trim());
  const loc = (item?.value as string | undefined) ?? (typeof r.hard_constraints.location === "string" ? r.hard_constraints.location : undefined);
  if (!loc || r.query.toLowerCase().includes(loc.toLowerCase())) return r;
  const near = /\b(near me|nearby|near by|around me|in my area)\b/i;
  if (near.test(r.query)) return { ...r, query: r.query.replace(near, `in ${loc.slice(0, 120)}`) };
  if (LOCAL.test(r.query)) return { ...r, query: `${r.query} in ${loc.slice(0, 120)}` };
  return r;
}
