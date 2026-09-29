import type {SearchRequest} from '../contracts/search.js';
export type AnswerUnit='hotel_property'|'flight_itinerary'|'product'|'local_business'|'person'|'research_source';
export type Strategy={unit:AnswerUnit; dimensions:readonly string[]; terms:readonly string[]; requiresNamedEntity:boolean};
const patterns:{strategy:Strategy;match:RegExp}[]=[
 {strategy:{unit:'hotel_property',dimensions:['property','location','stay_date','filters'],terms:['hotel property','rooms rates reviews'],requiresNamedEntity:true},match:/\b(?:hotels?|stays?|lodg(?:ing|es?)|rooms?)\b/i},
 {strategy:{unit:'flight_itinerary',dimensions:['origin','destination','departure_date','passengers','filters'],terms:['flight itinerary'],requiresNamedEntity:false},match:/\b(?:flights?|airfare|airline tickets?)\b/i},
 {strategy:{unit:'product',dimensions:['item','compatibility','market','price','filters'],terms:['product'],requiresNamedEntity:true},match:/\b(?:laptops?|phones?|shoes?|chargers?|headphones?|earbuds?|jackets?|toys?)\b/i},
 {strategy:{unit:'local_business',dimensions:['service','location','hours','filters'],terms:['local business'],requiresNamedEntity:true},match:/\b(?:pharmac(?:y|ies)|plumbers?|dentists?|restaurants?|cafes?)\b|\b(?:date|romantic)\s+(?:lunch|dinner)\b|\b(?:date|romantic)\s+(?:place|spot|venue)\b[^.?!]{0,75}\b(?:lunch|dinner)\b|\b(?:place|spot|venue)\s+for\s+(?:a\s+)?(?:date|romantic\s+(?:lunch|dinner))\b/i},
 {strategy:{unit:'person',dimensions:['identity','role','organization','time'],terms:['person'],requiresNamedEntity:true},match:/\b(?:who is|founder of|ceo of|biography of)\b/i},
 {strategy:{unit:'research_source',dimensions:['topic','source_type','date','evidence'],terms:['source'],requiresNamedEntity:false},match:/\b(?:research papers?|peer.reviewed|journal articles?|academic studies)\b/i},
];
// Strict recognition is deliberately not forced for vague, multi-unit queries.
export function answerStrategy(r:SearchRequest):Strategy|undefined{
 const matched=patterns.filter(p=>p.match.test(r.query));
 return matched.length===1?matched[0]!.strategy:undefined;
}
