// Calling-agent context pull (product doc v1: "pull context from the calling agent before asking
// the human"). The harness never reaches into other systems itself: it names the context it is
// missing, why, and under which scope, and the calling agent decides what to send back.
import { hotelPropertySearch } from "./intent-formation.js";
import type { Mandate, SearchRequest } from "../contracts/search.js";

export type ContextRequest = {
  status: "needs_input"; kind: "context_request" | "user_question"; episode_id: string; gap: string; question: string;
  requested_context: { key: string; why: string; accepted_sources: ("caller" | "human" | "prior_outcome")[]; scope: string[] }[];
  how_to_answer: string; curation_id?: string; remaining_user_question?: string;
};

const LOCAL = /\b(near me|nearby|near by|around me|in my area|closest|open now|local)\b/i;
// Canonical parameter names shared by the model, heuristic gap checks and calling agent.
const aliases:Record<string,string[]>={location:['location','user_location','user_current_location','current_location','city','area'],use_case:['use_case','intended_use_case','primary_use_case','laptop_use_case','purpose','usage'],origin:['origin','origin_location','location_of_origin','starting_location','departure_location','departure_city'],budget:['budget','price','max_price','price_max']};
export const canonicalContextKey=(key:string)=>Object.entries(aliases).find(([,keys])=>keys.includes(key.toLowerCase()))?.[0]??key.toLowerCase();
export function canonicalGaps(gaps:Mandate['gaps']):Mandate['gaps']{const byKey=new Map<string,Mandate['gaps'][number]>();for(const gap of gaps){const key=canonicalContextKey(gap.key);const old=byKey.get(key);if(!old)byKey.set(key,{...gap,key});else if(!old.question&&gap.question)byKey.set(key,{...old,question:gap.question});}return [...byKey.values()]}
const BUY = /\b(buy|purchase|shop|order|price|cheap|deal|under \$?[0-9])\b/i;

// Heuristic gaps: only facts the query cannot answer and that change the result set.
// Location for "near me" searches is material; budget for shopping is not (we still rank without it).
export function heuristicGaps(r: SearchRequest): Mandate["gaps"] {
  const has = (k: RegExp) => r.context.some(c => (!c.expires_at||Date.parse(c.expires_at)>Date.now())&&(!c.allowed_uses||c.allowed_uses.includes("search"))&&c.class!=="psychological"&&(k.test(c.key)||k.test(canonicalContextKey(c.key)))&&c.value!=null&&String(c.value).trim()!=="") || Object.entries(r.hard_constraints).some(([key,value]) => k.test(key)&&value!=null&&String(value).trim()!=="");
  const gaps: Mandate["gaps"] = [];
  // Only a broad choice with no stated use needs this fill. A specified
  // office/gaming/coding use case is already an answer, not another question.
  if (/\bbest laptop\b/i.test(r.query) && !/\b(?:for|to)\s+(?:[\w-]+\s+){0,2}(?:gaming|coding|office|work|study|travel|school|editing|photography)\b/i.test(r.query) && !has(/^(use_case|purpose|usage)/i))
    gaps.push({ key: "use_case", material: true, question: "What will the laptop be used for?" });
  if (/\bweekend trip\b/i.test(r.query) && !has(/^(origin|departure|location|city)/i))
    gaps.push({ key: "origin", material: true, question: "Where would you leave from?" });
  if (/\b(luxury )?watch for my anniversary\b/i.test(r.query) && !has(/^(recipient|wrist_size|style)/i))
    gaps.push({ key: "recipient", material: true, question: "Who is the watch for?" });
  if (/(?:\b(?:date|romantic)\s+(?:lunch|dinner)\b|\b(?:date|romantic)\s+(?:place|spot|venue)\b[^.?!]{0,75}\b(?:lunch|dinner)\b)/i.test(r.query) && !has(/^(location|city|area|lat|lng|lon|postcode|zip|address)/i) && !/\b(?:in|near|around)\s+(?!me\b|my\b|the\b)[A-Z][\p{L}\s,-]{2,60}/u.test(r.query))
    gaps.push({ key: "location", material: true, question: "Which city or area should I look in for the date lunch?" });
  if (LOCAL.test(r.query) && !has(/^(location|city|area|lat|lng|lon|postcode|zip|address)/i) && !/\b(?:in|near|around)\s+(?!me\b|my\b|the\b)[A-Z][\p{L}\s,-]{2,60}/u.test(r.query))
    gaps.push({ key: "location", material: true, question: "Which city or area should I search near?" });
  if (BUY.test(r.query) && !has(/^(budget|price|max_price|price_max)/i) && !/[$₹€£]\s?[0-9]|\b[0-9]+\s?(usd|inr|rs|dollars|rupees)\b/i.test(r.query))
    gaps.push({ key: "budget", material: false, question: "Is there a budget I should stay under?" });
  return gaps;
}

// Drop gaps the caller already answered through context or hard constraints.
export function openGaps(m: Mandate, r: SearchRequest): Mandate["gaps"] {
  const answered = new Set([...r.context.filter(c=>(!c.expires_at||Date.parse(c.expires_at)>Date.now())&&c.value!=null&&String(c.value).trim()!==""&&(!c.allowed_uses||c.allowed_uses.includes("search"))&&c.class!=="psychological").map(c => canonicalContextKey(c.key)), ...Object.keys(r.hard_constraints).map(canonicalContextKey)]);
  return canonicalGaps(m.gaps).filter(g => !answered.has(g.key));
}

export function contextRequest(episode_id: string, gap: { key: string; question?: string }, r: SearchRequest): ContextRequest {
  return {
    status: "needs_input", kind: "context_request", episode_id, gap: gap.key,
    question: gap.question ?? `Provide ${gap.key}.`,
    requested_context: [{ key: gap.key, why: `Material to the result set: ${gap.question ?? gap.key}`, accepted_sources: ["caller", "prior_outcome"], scope: r.permissions.scopes.length ? r.permissions.scopes : ["this_search"] }],
    how_to_answer: `Check permitted caller context only. Do not ask the user at this stage. Call search again with the same query, curation_revision_of, caller_fill_complete:true and evidenced caller answers; the harness will grade remaining gaps.`,
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
  const item = r.context.find(c => (!c.expires_at||Date.parse(c.expires_at)>Date.now()) && (!c.allowed_uses||c.allowed_uses.includes("search")) && c.confidence>=.7 && /^(location|city|area|address)$/i.test(canonicalContextKey(c.key)) && typeof c.value === "string" && c.value.trim());
  const loc = (item?.value as string | undefined) ?? (typeof r.hard_constraints.location === "string" ? r.hard_constraints.location : undefined);
  if (!loc || r.query.toLowerCase().includes(loc.toLowerCase())) return r;
  const near = /\b(near me|nearby|near by|around me|in my area)\b/i;
  if (near.test(r.query)) return { ...r, query: r.query.replace(near, `in ${loc.slice(0, 120)}`) };
  if (LOCAL.test(r.query)) return { ...r, query: `${r.query} in ${loc.slice(0, 120)}` };
  return r;
}


// Query formation keeps private context out of the provider string unless a scoped fact
// changes retrieval. It does not infer a current location or a departure city.
export function formProviderQuery(r: SearchRequest, phase: "pre_fill" | "post_fill") {
  const localized=localizeQuery(r);
  let query=localized.query;
  const used:string[]=[];
  if(query!==r.query)used.push("location");
  if(phase==="post_fill") {
    const values=new Map<string,string>();
    for(const c of r.context) {
      if(c.expires_at&&Date.parse(c.expires_at)<=Date.now())continue;
      if(c.allowed_uses&&!c.allowed_uses.includes("search"))continue;
      if(c.class==="psychological"||typeof c.value!=="string"||!c.value.trim())continue;
      const key=canonicalContextKey(c.key);
      if(!["origin","use_case"].includes(key)||c.confidence<.7)continue;
      values.set(key,c.value.trim().slice(0,120));
    }
    if(values.has("origin")&&/\bweekend trip\b/i.test(query)&&!query.toLowerCase().includes(values.get("origin")!.toLowerCase())) {query+=` from ${values.get("origin")}`;used.push("origin")}
    if(values.has("use_case")&&/\bbest laptop\b/i.test(query)&&!query.toLowerCase().includes(values.get("use_case")!.toLowerCase())) {query+=` for ${values.get("use_case")}`;used.push("use_case")}
  }
  if(hotelPropertySearch(r)) {
    // The answer is a hotel, not a collection of hotels. Keep constraints as
    // terms rather than sending a conversational instruction to the index.
    const place=r.query.match(/\b(?:in|around|near)\s+([\p{L}\s]+?)(?=\s+(?:for|on|under|below|with|one|this|tonight|tomorrow|\d)|[,.;]|$)/iu)?.[1]?.trim()??r.query.match(/^([\p{L}\s]+?)\s+(?:hotel|stay|lodging|rooms?)\b/iu)?.[1]?.trim();
    const cap=r.query.match(/(?:under|below|within|up to|maximum|max)\s*(?:[₹$€£]|rs\.?\s*)?\s*([\d,]+(?:\s*[-–]\s*[\d,]+)?)/i)?.[1];
    const date=r.query.match(/\b(?:on|for|night of|one night)\s+(?:the\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?)(?:\s+\d{4})?)/i)?.[1];
    query=["hotel property",place,cap?`under ₹${cap.replace(/\s/g,"")}`:undefined,date, /\b3\s*star\b/i.test(r.query)?"3 star":undefined,"rooms rates reviews"].filter(Boolean).join(" ");
    used.push("answer_unit:hotel_property");
  }
  return {phase,original_query:r.query,provider_query:query,context_keys:used,changed:query!==r.query};
}
