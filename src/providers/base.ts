import type {Mandate,ProviderResult,SearchRequest} from "../contracts/search.js";
export type ProviderContext={request:SearchRequest;mandate:Mandate;signal:AbortSignal};
export interface SearchProvider{name:string;enabled():boolean;search(ctx:ProviderContext):Promise<ProviderResult[]>}
export abstract class HttpProvider implements SearchProvider{abstract name:string;abstract enabled():boolean;abstract search(ctx:ProviderContext):Promise<ProviderResult[]>;protected async json(url:string,init:RequestInit,signal:AbortSignal){const r=await fetch(url,{...init,signal});if(!r.ok)throw new Error(`${this.name} HTTP ${r.status}`);return r.json();}}
