import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request,Response,RequestHandler } from 'express';
import type pg from 'pg';
import { getAccessForUser,requestAccessStore,requirePermission,legacyBootstrapInputs,type Access } from '../access.js';
import { commitRequestTx,pool,rlsStore } from '../../db.js';
const access:Access={ready:true,suspended:false,permissions:['admin.access','users.read'],roles:[]};
async function gate(handler:RequestHandler,kind='jwt',id:string|null='u'){
 return new Promise<unknown>(resolve=>{
  const req={user:id?{id}:undefined,authKind:kind} as Request;
  const res={setHeader(){return this;}} as unknown as Response;
  handler(req,res,error=>resolve(error??null));
 });
}
test('private gates require identity, a browser session, readiness and current capability',async()=>{
 const handler=requirePermission('users.read',async()=>access,{admin:true});
 assert.equal(await gate(handler),null);
 assert.equal((await gate(handler,'token') as {status:number}).status,403);
 assert.equal((await gate(handler,'jwt',null) as {status:number}).status,401);
 for(const partial of [{ready:false},{suspended:true},{permissions:['users.read']}]){
  const error=await gate(requirePermission('users.read',async()=>({...access,...partial}),{admin:true})) as {status:number};
  assert.ok([403,503].includes(error.status));
 }
});
test('database failure cannot accidentally authorize a request',async()=>{
 const marker=new Error('database unavailable');
 assert.equal(await gate(requirePermission('users.read',async()=>{throw marker;})),marker);
});
test('legacy credit flag is exactly true and partial Supabase configuration never boots local owner',()=>{
 assert.equal(legacyBootstrapInputs({DECKE_CREDITS_ENABLED:'true'}).creditsEnabled,true);
 for(const value of ['1','TRUE','false','']) assert.equal(legacyBootstrapInputs({DECKE_CREDITS_ENABLED:value}).creditsEnabled,false);
 for(const key of ['SUPABASE_MODE','SUPABASE_URL','SUPABASE_JWT_SECRET']) assert.equal(legacyBootstrapInputs({[key]:'configured'}).cloud,true);
 assert.equal(legacyBootstrapInputs({}).cloud,false);
});
test('request access is coalesced but never cached across requests',async()=>{
 let queries=0;
 const client={query:async()=>{queries++;return{rows:[{access}]};}} as unknown as pg.PoolClient;
 await rlsStore.run(client,()=>requestAccessStore.run(new Map(),async()=>{
  const [a,b]=await Promise.all([getAccessForUser('u'),getAccessForUser('u')]);assert.equal(a,b);assert.equal(queries,1);
 }));
 await rlsStore.run(client,()=>requestAccessStore.run(new Map(),()=>getAccessForUser('u')));
 assert.equal(queries,2);
});
test('explicit commit preserves session claims and uses no second connection',async t=>{
 const claims={sub:'u',role:'authenticated',deckpal_auth_kind:'jwt'};
 const sql:string[]=[];
 const client={
  query:async(text:string)=>{sql.push(text);return{rows:[{claims:JSON.stringify(claims)}]};},
  escapeLiteral:(value:string)=>"'"+value.replaceAll("'","''")+"'",
 } as unknown as pg.PoolClient;
 const original=pool.connect;(pool as {connect:unknown}).connect=()=>{throw new Error('second checkout');};
 t.after(()=>{(pool as {connect:unknown}).connect=original;});
 await rlsStore.run(client,()=>commitRequestTx('u'));
 assert.match(sql[1]!,/COMMIT; BEGIN/);assert.match(sql[1]!,/deckpal_auth_kind/);assert.match(sql[1]!,/SET LOCAL role = 'authenticated'/);
 await assert.rejects(()=>rlsStore.run(client,()=>commitRequestTx('different')),/Cannot change identity/);
});
test('self-host commit retains local claims without assuming Supabase roles',async()=>{
 const sql:string[]=[];
 const client={query:async(text:string)=>{sql.push(text);return{rows:[{claims:'{"sub":"1","role":"local","deckpal_auth_kind":"local"}'}]};},escapeLiteral:(value:string)=>"'"+value+"'"} as unknown as pg.PoolClient;
 await rlsStore.run(client,()=>commitRequestTx('1'));
 assert.match(sql[1]!,/local/);assert.ok(!sql[1]!.includes('SET LOCAL role'));
});
