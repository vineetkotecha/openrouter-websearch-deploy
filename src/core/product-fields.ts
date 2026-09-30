import type {FieldFill} from './fill.js';
// Page evidence only. Multiple conflicting offers/configurations remain missing.
export function productFields(page:string):FieldFill {
 const missing=()=>({value:null,state:'missing' as const});const out:FieldFill={product_price_inr:missing(),ram_gb:missing()};
 const priced=[...page.matchAll(/(?:sale price|selling price|our price|current price|offer price|special price|price)\s*[:|\-]?\s*(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi)].filter(m=>! /(?:original|regular|list|mrp)\s*$/i.test(page.slice(Math.max(0,m.index!-15),m.index)));
 const amounts=[...new Set(priced.map(m=>Number(m[1]!.replace(/,/g,''))).filter(n=>Number.isFinite(n)&&n>0))];
 if(amounts.length===1){const m=priced[0]!;out.product_price_inr={value:amounts[0]!,state:'supported',evidence:m[0],method:'unique_labelled_INR_offer'};}
 const ram=[...page.matchAll(/\b(\d+)\s*GB\s*(?:RAM|DDR[345](?:\s+RAM)?|memory)\b|\b(?:RAM|system memory|memory capacity)\s*[:|\-]?\s*(\d+)\s*GB\b/gi)].filter(m=>! /(?:up to|expandable|maximum|max)\s*$/i.test(page.slice(Math.max(0,m.index!-20),m.index)));
 const values=[...new Set(ram.map(m=>Number(m[1]??m[2])))];if(values.length===1){out.ram_gb={value:values[0]!,state:'supported',evidence:ram[0]![0],method:'unique_explicit_RAM'};}
 return out;
}
