import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY, METERED_CHARGE_NOTICE, METERED_ESTIMATE_NOTICE, chargeNoticeFor, estimateNoticeFor, isMetered, normalizePolicy, normalizePolicyUpdate, normalizePack, priceFor, pricesFor, operationFor, attemptKey, type MeteredPolicy } from '../policy.js';
import { chatChargeReference, payloadHash } from '../runtime.js';

test('fixed precision usage prices preserve legacy units and round upward once', () => {
  assert.deepEqual(pricesFor(DEFAULT_POLICY), { chatTurn:1, analysis:4, planDeck:75 });
  assert.equal(priceFor(10_000, DEFAULT_POLICY),1);
  assert.equal(priceFor(10_001, DEFAULT_POLICY),2);
  assert.equal(priceFor(0, DEFAULT_POLICY),1);
  assert.equal(priceFor(10_000,{...DEFAULT_POLICY,markupBps:5000}),2);
  assert.equal(priceFor(1_000_000_000,{...DEFAULT_POLICY,microUsdPerCredit:100,markupBps:100000}),110_000_000);
  assert.equal(operationFor('unknown_new_deep_tool'),'planDeck');
  assert.equal(operationFor('web_research'),'analysis');
  assert.equal(operationFor('research_meta'),'analysis');
});
test('economic configuration refuses unknown, unsafe, fractional, and overflowing inputs',()=>{
 for(const [key,value] of [['enabled','true'],['markupBps',NaN],['markupBps',-1],['microUsdPerCredit',0],['lowBalance',1.2],['microUsdPerCredit',Number.MAX_SAFE_INTEGER]] as const) {
  assert.throws(()=>normalizePolicy({...DEFAULT_POLICY,[key]:value}));
 }
 assert.throws(()=>normalizePolicy({...DEFAULT_POLICY,extra:true}));
 assert.throws(()=>normalizePolicy({...DEFAULT_POLICY,estimatedMicroUsd:{...DEFAULT_POLICY.estimatedMicroUsd,extra:1}}));
 assert.throws(()=>normalizePolicy({...DEFAULT_POLICY,microUsdPerCredit:1,markupBps:100000,estimatedMicroUsd:{chatTurn:1_000_000_000,analysis:1,planDeck:1}}));
 assert.deepEqual(normalizePolicy(DEFAULT_POLICY),DEFAULT_POLICY);
});
test('stored policy normalization accepts only the exact legacy or metered shape',()=>{
 const metered:MeteredPolicy={version:2,enabled:true,microUsdPerCredit:10_000,markupBps:250,lowBalance:100,legHoldCredits:25,legHoldMinCredits:3};
 assert.deepEqual(normalizePolicy(metered),metered);
 assert.equal(isMetered(normalizePolicy(metered)),true);
 assert.equal(isMetered(normalizePolicy(DEFAULT_POLICY)),false);
 for(const invalid of [
  {...metered,version:1},
  {...metered,estimatedMicroUsd:DEFAULT_POLICY.estimatedMicroUsd},
  {...metered,extra:true},
  {...metered,legHoldCredits:0},
  {...metered,legHoldCredits:10_001},
  {...metered,legHoldMinCredits:26},
 ]) assert.throws(()=>normalizePolicy(invalid));
 assert.equal(chargeNoticeFor(metered),METERED_CHARGE_NOTICE);
 assert.equal(estimateNoticeFor(metered),METERED_ESTIMATE_NOTICE);
});
test('an admin update may edit fields but cannot switch the stored policy version',()=>{
 const metered:MeteredPolicy={version:2,enabled:true,microUsdPerCredit:10_000,markupBps:0,lowBalance:100,legHoldCredits:25,legHoldMinCredits:3};
 assert.deepEqual(normalizePolicyUpdate({...metered,legHoldCredits:30},metered),{...metered,legHoldCredits:30});
 assert.deepEqual(normalizePolicyUpdate({...DEFAULT_POLICY,lowBalance:50},DEFAULT_POLICY),{...DEFAULT_POLICY,lowBalance:50});
 assert.throws(()=>normalizePolicyUpdate(metered,DEFAULT_POLICY),/version must match/);
 assert.throws(()=>normalizePolicyUpdate(DEFAULT_POLICY,metered),/version must match/);
});
test('pack sale prices are explicit and never automatically marked up',()=>{
 const pack={name:' Small pack ',credits:100,priceCents:250,currency:'usd',active:true};
 assert.deepEqual(normalizePack(pack),{...pack,name:'Small pack'});
 for(const invalid of [{credits:0},{credits:1.5},{priceCents:99},{priceCents:50001},{currency:'eur'},{active:'true'},{amount:100}]) assert.throws(()=>normalizePack({...pack,...invalid}));
 assert.throws(()=>attemptKey('short'));
});
test('chat replay references bind all model-visible request input and each conversation',()=>{
 const messages=[{id:'message_1',role:'user',parts:[{type:'text',text:'hello'}]}];
 const first=chatChargeReference('conversation_1',messages,'/',[]);
 assert.deepEqual(chatChargeReference('conversation_1',messages,'/',[]),first);
 assert.notEqual(chatChargeReference('conversation_1',messages,'/decks',[]).key,first.key);
 assert.notEqual(chatChargeReference('conversation_2',messages,'/',[]).key,first.key);
 assert.notEqual(chatChargeReference('conversation_1',[...messages,{id:'assistant_1',parts:[{type:'tool-result',result:'changed'}]}],'/',[]).key,first.key);
 assert.throws(()=>chatChargeReference(undefined,messages,'/',[]));
 // SEC-04 sends a bounded window, so two new exchanges can carry identical
 // history; the exchange identity keeps them apart and a retry still collides.
 const ex=(exchangeId:string,seq:number)=>chatChargeReference('conversation_1',messages,'/',[],{exchangeId,seq});
 assert.notEqual(ex('11111111-1111-4111-8111-111111111111',3).key,ex('22222222-2222-4222-8222-222222222222',4).key);
 assert.equal(ex('11111111-1111-4111-8111-111111111111',3).key,ex('11111111-1111-4111-8111-111111111111',3).key);
 assert.match(payloadHash({a:1}),/^[a-f0-9]{64}$/);
});
