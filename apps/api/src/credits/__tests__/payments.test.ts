import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';
import { CREDIT_EVENTS, CREDIT_PURPOSE, checkoutParameters, inspectWebhookSetup, validateCheckout, type FrozenOrder } from '../payments.js';
import { handleCreditWebhook, reconcileCreditSession } from '../webhook.js';
import type { Queryable } from '@deckpal/db';

const order:FrozenOrder={id:'00000000-0000-4000-8000-000000000001',user_id:'user1',credits:100,price_cents:500,currency:'usd',pack_name:'AI credits',
 stripe_customer_id:'cus_one',stripe_session_id:'cs_test_one',stripe_payment_intent_id:null,checkout_url:null,livemode:false,status:'pending',reconciliation_revision:0,created_at:'2026-09-13T12:00:00Z'};
const session={id:'cs_test_one',mode:'payment',payment_status:'paid',status:'complete',metadata:{purpose:CREDIT_PURPOSE,order_id:order.id,user_id:order.user_id},
 client_reference_id:order.id,amount_total:500,currency:'usd',livemode:false,customer:'cus_one',payment_intent:'pi_one'} as unknown as Stripe.Checkout.Session;
function fake(refunded=0,dispute?:{id:string;status:string}) {
 const settlements:unknown[][]=[];
 const charge={id:'ch_one',paid:true,amount:500,amount_refunded:refunded,currency:'usd',livemode:false,customer:'cus_one',payment_intent:'pi_one'};
 const intent={id:'pi_one',status:'succeeded',amount:500,amount_received:500,currency:'usd',livemode:false,customer:'cus_one',metadata:session.metadata,latest_charge:charge};
 const stripe={
  paymentIntents:{retrieve:async()=>intent},
  customers:{retrieve:async()=>({id:'cus_one',livemode:false,metadata:{deckpal_user_id:'user1'}})},
  disputes:{list:async()=>({data:dispute?[dispute]:[],has_more:false})},
  refunds:{list:async()=>({data:refunded?[{payment_intent:'pi_one',amount:refunded,currency:'usd',status:'succeeded'}]:[],has_more:false})},
  checkout:{sessions:{retrieve:async()=>session,list:async()=>({data:[session],has_more:false})}},
 } as unknown as Stripe;
 const db={query:async(sql:string,args:unknown[])=>{
  if(sql.startsWith('SELECT *')) return {rows:[order]};
  settlements.push(args); return {rows:[{added:true}]};
 }} as unknown as Queryable;
 return {stripe,db,settlements,intent,charge};
}
test('checkout ignores browser monetary values and uses frozen card-only terms',()=>{
 const params=checkoutParameters(order,'https://deckpal.example');
 assert.equal(params.mode,'payment');assert.deepEqual(params.payment_method_types,['card']);
 assert.equal(params.line_items?.[0]?.price_data?.unit_amount,500);
 assert.equal(params.payment_intent_data?.metadata?.purpose,CREDIT_PURPOSE);
 assert.equal(params.success_url,`https://deckpal.example/credits?order=${order.id}`);
 assert.deepEqual(validateCheckout(session,order),{customer:'cus_one',intent:'pi_one'});
 for(const patch of [{mode:'subscription'},{payment_status:'unpaid'},{status:'open'},{amount_total:499},{currency:'eur'},{livemode:true},{customer:'cus_other'},{metadata:{purpose:'support'}}]) {
  assert.throws(()=>validateCheckout({...session,...patch} as Stripe.Checkout.Session,order));
 }
});
test('payment setup requires exact app URL, payment mode, enabled endpoint, and every event',async()=>{
 const endpoint={url:'https://deckpal.example/api/stripe/webhook',status:'enabled',livemode:false,enabled_events:[...CREDIT_EVENTS]};
 const stripe={webhookEndpoints:{list:async()=>({data:[endpoint]})}} as unknown as Stripe;
 assert.equal((await inspectWebhookSetup(stripe,'https://deckpal.example',false)).ready,true);
 endpoint.enabled_events.pop();
 assert.equal((await inspectWebhookSetup(stripe,'https://deckpal.example',false)).ready,false);
 endpoint.enabled_events=['*'] as unknown as typeof endpoint.enabled_events;
 assert.equal((await inspectWebhookSetup(stripe,'https://other.example',false)).ready,false);
 assert.equal((await inspectWebhookSetup(stripe,'https://deckpal.example',true)).ready,false);
});
test('SDK signed fixture verification rejects a changed body before reconciliation',()=>{
 const stripe=new Stripe('sk_test_fixture');
 const payload=JSON.stringify({id:'evt_fixture',type:'checkout.session.completed',data:{object:session}});
 const header=stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_fixture'});
 assert.equal(stripe.webhooks.constructEvent(payload,header,'whsec_fixture').id,'evt_fixture');
 assert.throws(()=>stripe.webhooks.constructEvent(payload+' ',header,'whsec_fixture'));
});
test('current paid charge and ownership are required before the atomic grant/reversal statement',async()=>{
 const f=fake(250);
 await reconcileCreditSession(f.stripe,session,f.db);
 assert.equal(f.settlements.length,1);assert.equal(f.settlements[0]![8],250);
 f.intent.amount_received=499;
 await assert.rejects(()=>reconcileCreditSession(f.stripe,session,f.db));
 assert.equal(f.settlements.length,1);
});
test('reversed event arriving before completion settles current refund/dispute state atomically',async()=>{
 const old=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='sk_test_fixture';
 try {
  const f=fake(500,{id:'dp_one',status:'won'});
  const event={id:'evt_refund_first',type:'charge.refunded',livemode:false,data:{object:{payment_intent:'pi_one'}}} as Stripe.Event;
  assert.equal(await handleCreditWebhook(event,f.stripe,f.db),true);
  assert.equal(f.settlements.length,1);assert.equal(f.settlements[0]![8],500);assert.equal(f.settlements[0]![10],'won');
  const stale={...event,type:'charge.dispute.created',data:{object:{payment_intent:'pi_one',status:'needs_response'}}} as Stripe.Event;
  await handleCreditWebhook(stale,f.stripe,f.db);
  assert.equal(f.settlements[1]![10],'won');
 } finally {if(old===undefined) delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=old;}
});
test('unpaid checkout never executes fulfillment and support events remain separate',async()=>{
 const old=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='sk_test_fixture';
 try {
  const f=fake();
  f.stripe.checkout.sessions.retrieve=async()=>({...session,payment_status:'unpaid'}) as never;
  await handleCreditWebhook({type:'checkout.session.completed',livemode:false,data:{object:session}} as Stripe.Event,f.stripe,f.db);
  assert.equal(f.settlements.length,0);
  assert.equal(await handleCreditWebhook({type:'payment_intent.succeeded',livemode:false,data:{object:{}}} as Stripe.Event,f.stripe,f.db),false);
 } finally {if(old===undefined) delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=old;}
});

test('pending and failed refund snapshots control only the hold until money is refunded',async()=>{
 const f=fake();
 f.stripe.refunds.list=(async()=>({data:[{payment_intent:'pi_one',amount:500,currency:'usd',status:'pending'}],has_more:false})) as unknown as Stripe['refunds']['list'];
 await reconcileCreditSession(f.stripe,session,f.db);
 assert.equal(f.settlements[0]![8],0);assert.equal(f.settlements[0]![11],500);
 f.stripe.refunds.list=(async()=>({data:[{payment_intent:'pi_one',amount:500,currency:'usd',status:'failed'}],has_more:false})) as unknown as Stripe['refunds']['list'];
 await reconcileCreditSession(f.stripe,session,f.db);
 assert.equal(f.settlements[1]![8],0);assert.equal(f.settlements[1]![11],0);
});
test('forged customer ownership and inconsistent charge amounts cannot settle',async()=>{
 const f=fake();
 f.stripe.customers.retrieve=async()=>({id:'cus_one',livemode:false,metadata:{deckpal_user_id:'someone_else'}}) as never;
 await assert.rejects(()=>reconcileCreditSession(f.stripe,session,f.db),/ownership/);
 assert.equal(f.settlements.length,0);
 const g=fake();g.charge.currency='eur';
 await assert.rejects(()=>reconcileCreditSession(g.stripe,session,g.db),/mismatch/);
 assert.equal(g.settlements.length,0);
});
