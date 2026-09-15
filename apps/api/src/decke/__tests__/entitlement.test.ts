import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeckeEntitled } from '../entitlement.js';
import type { Access } from '../../admin/access.js';
const access:Access={ready:true,suspended:false,permissions:['decke.use'],roles:[]};
test('Deck-E uses current database capability, including contributor roles',async()=>{
 assert.equal(await isDeckeEntitled('user',async()=>access),true);
 assert.equal(await isDeckeEntitled('user',async()=>({...access,permissions:['admin.access']})),false);
});
test('unset identity, suspension and uninitialized authorization are denied',async()=>{
 assert.equal(await isDeckeEntitled('',async()=>{throw Error('must not query');}),false);
 assert.equal(await isDeckeEntitled('user',async()=>({...access,suspended:true})),false);
 assert.equal(await isDeckeEntitled('user',async()=>({...access,ready:false})),false);
});
test('permission revocation takes effect for the same old session identity',async()=>{
 let granted=true;const resolve=async()=>({...access,permissions:granted?['decke.use']:[]});
 assert.equal(await isDeckeEntitled('user',resolve),true);granted=false;assert.equal(await isDeckeEntitled('user',resolve),false);
});
test('authorization store errors fail closed before AI work',async()=>{
 await assert.rejects(()=>isDeckeEntitled('user',async()=>{throw Error('unavailable');}),/unavailable/);
});
