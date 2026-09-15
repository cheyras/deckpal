import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request,Response,RequestHandler } from 'express';
import { isOwner,isLabelerEntitled,ownerOnlyInProduction,labelerOnlyInProduction } from '../ownerGate.js';
import type { Access } from '../admin/access.js';
const snapshot=(permissions:string[]=[],superAdmin=false):Access=>({ready:true,suspended:false,permissions,isOwner:superAdmin,roles:superAdmin?[{id:'r',key:'super_admin',name:'Owner'}]:[]});
function invoke(handler:RequestHandler,kind='jwt'){return new Promise<unknown>(resolve=>handler({user:{id:'u'},authKind:kind} as Request,{setHeader(){}} as unknown as Response,e=>resolve(e??null)));}
test('Owner authority uses the canonical SQL flag rather than deprecated superadmin aliases',async()=>{
 assert.equal(await isOwner('u',async()=>snapshot([],true)),true);
 assert.equal(await isOwner('u',async()=>snapshot(['admin.access'])),false);
 assert.equal(await isOwner('u',async()=>({...snapshot([],true),isOwner:false})),false);
 assert.equal(await isOwner('u',async()=>({...snapshot([],true),isOwner:undefined})),false);
 assert.equal(await isOwner(undefined,async()=>{throw new Error('must not query');}),false);
});
test('labeler is separately assignable without scanner or owner access',async()=>{
 const resolver=async()=>snapshot(['admin.access','scanner.label']);
 assert.equal(await isLabelerEntitled('u',resolver),true);
 assert.equal(await invoke(labelerOnlyInProduction('forbidden',resolver)),null);
 assert.equal((await invoke(ownerOnlyInProduction('not-found',resolver)) as {status:number}).status,404);
});
test('preview and production obey the same current grants and reject PATs',async t=>{
 const prior=process.env.VERCEL_ENV;t.after(()=>{if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;});
 for(const tier of ['preview','production','development']){
  process.env.VERCEL_ENV=tier;
  assert.equal((await invoke(ownerOnlyInProduction('forbidden',async()=>snapshot())) as {status:number}).status,403);
  assert.equal(await invoke(ownerOnlyInProduction('forbidden',async()=>snapshot(['scanner.use']))),null);
  assert.equal((await invoke(ownerOnlyInProduction('forbidden',async()=>snapshot(['scanner.use'])),'token') as {status:number}).status,403);
 }
});
test('revocation is re-resolved rather than retained in a gate closure',async()=>{
 let allowed=true;const gate=ownerOnlyInProduction('forbidden',async()=>snapshot(allowed?['scanner.use']:[]));
 assert.equal(await invoke(gate),null);allowed=false;assert.equal((await invoke(gate) as {status:number}).status,403);
});
test('suspension denies every private tool even when assigned permissions remain',async()=>{
 const resolver=async()=>({...snapshot(['scanner.use','scanner.label'],true),suspended:true});
 assert.equal(await isOwner('u',resolver),false);assert.equal(await isLabelerEntitled('u',resolver),false);
 assert.equal((await invoke(labelerOnlyInProduction('forbidden',resolver)) as {status:number}).status,403);
});
