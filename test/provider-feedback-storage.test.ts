import {it,expect,vi} from 'vitest';
const db=vi.hoisted(()=>({calls:[] as {sql:string;args:unknown[]}[]}));
vi.mock('pg',()=>({default:{Pool:class{async query(sql:string,args:unknown[]){db.calls.push({sql,args});return{rows:sql.startsWith('SELECT response')?[{feedback:[{provider:'exa'}]},{feedback:null}]:[]}}}}}));
import {PostgresStore} from '../src/storage/postgres.js';
it('reconstructs feedback only from scoped, learn-enabled, unexpired episodes',async()=>{
 const s=new PostgresStore('mock');const out=await s.capabilityObservations('00000000-0000-4000-8000-000000000001');expect(out).toEqual([{provider:'exa'}]);const q=db.calls.at(-1)!;expect(q.args).toEqual(['00000000-0000-4000-8000-000000000001']);expect(q.sql).toContain('tenant_id=$1');expect(q.sql).toContain('expires_at>now()');expect(q.sql).toContain("may_learn");expect(q.sql).toContain('LIMIT 200');
});
