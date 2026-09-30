import type {ProviderResult} from '../contracts/search.js';
// A retrieved model name is a lead, not a verified product or price.
export function namedProductQuery(items:ProviderResult[],original:string):string|undefined {
 const candidates=items.filter(x=>/\b(?:laptop|acer|asus|lenovo|dell|hp|vivobook|ideapad|thinkpad|aspire)\b/i.test(x.title)&&! /\b(?:best|top \d|finder|list of|recommend)\b/i.test(x.title));
 const named=candidates.find(x=>/\b16\s*GB\b/i.test(x.title))??candidates[0];
 if(!named)return undefined;
 const title=named.title.replace(/[\r\n]/g,' ').slice(0,220);
 return `${title} ${original.slice(0,145)} price specifications`.slice(0,400);
}
