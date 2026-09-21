import { z } from "zod";
const Env=z.object({PORT:z.coerce.number().default(8787),LOG_LEVEL:z.string().default("info"),DATABASE_URL:z.string().optional(),DIVAINe_API_KEYS:z.string().default(process.env.NODE_ENV==="production"?"":"dev-key:local"),GEMINI_API_KEY:z.string().optional(),GEMINI_MODEL:z.string().default("gemini-2.5-flash"),SEARCH_TIMEOUT_MS:z.coerce.number().default(8000),SEARCH_FANOUT:z.coerce.number().min(1).max(8).default(3)});
export type Config=z.infer<typeof Env> & {apiKeys:Map<string,string>};
export function loadConfig(env=process.env):Config{const c=Env.parse(env);const apiKeys=new Map(c.DIVAINe_API_KEYS.split(",").map(x=>{const [k,t]=x.split(":");return [k!,t??"local"]}));return {...c,apiKeys};}
