import assert from 'node:assert/strict';
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
const POLICY = { enabled:true,microUsdPerCredit:10000,markupBps:0,estimatedMicroUsd:{chatTurn:143,analysis:35600,planDeck:750000},lowBalance:100 };
export async function runCreditIntegration({db:trusted,as:withIdentity,api,id,config,test}) {
 const context=new AsyncLocalStorage();
 const db={query:(...args)=>(context.getStore() ?? trusted).query(...args)};
 const as=(user,fn,options)=>withIdentity(user,client=>context.run(client,fn),options);
 const query=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const scalar=async(sql,args=[]) => (await query(sql,args)).data;
 const deny=async(fn,code='42501') => assert.rejects(fn,e=>e.code===code);
 await db.query('SELECT public.credit_policy_initialize(true)');
 await db.query('INSERT INTO public.admin_account(user_id) VALUES($1),($2),($3) ON CONFLICT(user_id) DO UPDATE SET suspended=false',[id(5),id(6),id(7)]);
 await db.query("INSERT INTO public.admin_user_role SELECT u,r.id FROM unnest($1::text[]) u CROSS JOIN public.admin_role r WHERE r.key='legacy_decke' ON CONFLICT DO NOTHING",[[id(5),id(6),id(7)]]);
 const policy=await scalar('SELECT public.credit_policy_read() AS data');
 let pack;
 await test('credit policies preserve legacy counts, quote revisions, and reject direct private access',async()=>{
  assert.equal(policy.policy.microUsdPerCredit,10000);
  await db.query("SELECT public.credit_apply_delta($1,200,'grant','Fixture seed','fixture-six')",[id(6)]);
  const before=await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]);
  const saved=await as(id(1),()=>scalar('SELECT public.credit_policy_save($1,$2) AS data',[{...POLICY,markupBps:10000},policy.revision]));
  assert.equal(saved.policy.markupBps,10000);
  assert.deepEqual(await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]),before);
  await deny(()=>as(id(1),()=>db.query('SELECT public.credit_policy_save($1,$2)',[POLICY,policy.revision])),'40001');
  await as(id(1),()=>db.query('SELECT public.credit_policy_save($1,$2)',[POLICY,saved.revision]));
  for(const sql of [
   'SELECT public.credit_policy_read()',
   "SELECT public.credit_apply_delta('"+id(6)+"',1,'grant','attack','attack')",
   "SELECT public.credit_spend_create('"+id(6)+"','chatTurn',1,'attack-key','"+'a'.repeat(64)+"')",
   'SELECT public.credit_policy_initialize(true)',
  ]) await deny(()=>as(id(6),()=>db.query(sql)));
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_policy_admin_read()')));
  await deny(()=>as(id(1),()=>db.query('SELECT public.credit_policy_admin_read()'),{kind:'token'}));
  const publicQuote=await as(id(6),()=>scalar('SELECT public.credit_quote_read() AS data'));
  assert.deepEqual(publicQuote.prices,{chatTurn:1,analysis:4,planDeck:75});
  assert.equal(publicQuote.microUsdPerCredit,undefined);
 });
 await test('credit pack CRUD validates SQL NULLs and optimistic revisions',async()=>{
  pack=await as(id(1),()=>scalar('SELECT public.credit_pack_save(NULL,$1,NULL) AS data',[{name:'Fixture credits',credits:100,priceCents:500,currency:'usd',active:true}]));
  await deny(()=>as(id(1),()=>db.query('SELECT public.credit_pack_save($1,$2,NULL)',[pack.id,{name:'changed',credits:100,priceCents:500,currency:'usd',active:false}])),'40001');
  await deny(()=>as(id(1),()=>db.query('SELECT public.credit_policy_save(NULL,1)')),'22023');
  await deny(()=>as(id(1),()=>db.query('SELECT public.credit_adjust($1,NULL,NULL,NULL)',[id(6)])),'22023');
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_events_read(NULL,NULL,0)')),'22023');
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_order_create($1,NULL)',[pack.id])),'22023');
 });
 await test('direct JWT without trusted server-kind and PAT cannot bind payment identity',async()=>{
  for(const opt of [{direct:true},{kind:'token'}]) {
   await deny(()=>as(id(6),()=>db.query('SELECT public.credit_order_create($1,$2)',[pack.id,'direct-attempt']),opt));
   await deny(()=>as(id(6),()=>db.query('SELECT public.credit_order_prepare($1,$2,false)',[pack.id,'cus_attack']),opt));
   await deny(()=>as(id(6),()=>db.query('SELECT public.credit_order_bind($1,$2,$3)',[pack.id,'cs_test_attack','https://checkout.stripe.com/attack']),opt));
  }
 });
 await test('old quotes are immutable and exact replays cannot start free model work',async()=>{
  const spend=await scalar('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',[id(6),'analysis',policy.revision,'old-quote-request','a'.repeat(64)]);
  assert.equal(spend.spent,4);
  const event=await query("SELECT delta,pricing_snapshot FROM public.decke_credit_event WHERE ref=$1",['spend:'+spend.spendId]);
  assert.equal(event.delta,-4);assert.equal(event.pricing_snapshot.markupBps,0);
  const statement=await as(id(6),()=>scalar('SELECT public.credit_events_read(NULL,25,0) AS data'));
  assert.ok(statement.events.every(e=>e.pricingSnapshot===null));
  await deny(()=>db.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5)',[id(6),'analysis',policy.revision,'old-quote-request','b'.repeat(64)]),'40001');
  assert.equal(await scalar('SELECT public.credit_spend_refund($1,$2) AS data',[id(6),spend.spendId]),true);
  assert.equal(await scalar('SELECT public.credit_spend_refund($1,$2) AS data',[id(6),spend.spendId]),false);
  await deny(()=>db.query('SELECT public.credit_spend_start($1,$2)',[id(6),spend.spendId]),'40001');
  const started=await scalar('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',[id(6),'chatTurn',policy.revision,'started-request','c'.repeat(64)]);
  await db.query('SELECT public.credit_spend_start($1,$2)',[id(6),started.spendId]);
  assert.equal(await scalar('SELECT public.credit_spend_refund($1,$2) AS data',[id(6),started.spendId]),false);
 });
 await test('concurrent last-credit spends permit exactly one atomic ledger entry',async()=>{
  await db.query("SELECT public.credit_apply_delta($1,1,'grant','Fixture race','fixture-race')",[id(7)]);
  const clients=[new pg.Client(config),new pg.Client(config)];
  try {
   await Promise.all(clients.map(c=>c.connect()));
   const outcomes=await Promise.all(clients.map((c,i)=>c.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',[id(7),'chatTurn',policy.revision,'last-credit-'+i,'d'.repeat(64)])));
   assert.equal(outcomes.filter(x=>x.rows[0].data.allowed).length,1);
   assert.equal((await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(7)])).balance,0);
   assert.equal(Number((await query("SELECT count(*) n FROM public.decke_credit_event WHERE user_id=$1 AND kind='spend'",[id(7)])).n),1);
  } finally { await Promise.all(clients.map(c=>c.end())); }
 });
 let order;
 await test('checkout freezes terms and concurrent distinct payment events grant once',async()=>{
  order=await as(id(6),()=>scalar('SELECT public.credit_order_create($1,$2) AS data',[pack.id,'checkout-fixture']));
  await as(id(6),()=>db.query('SELECT public.credit_order_prepare($1,$2,false)',[order.id,'cus_fixture6']));
  await as(id(1),()=>db.query('SELECT public.credit_pack_save($1,$2,$3)',[pack.id,{name:'Retired',credits:9,priceCents:100,currency:'usd',active:false},pack.revision]));
  const retry=await as(id(6),()=>scalar('SELECT public.credit_order_create($1,$2) AS data',[pack.id,'checkout-fixture']));
  assert.equal(retry.credits,100);assert.equal(retry.price_cents,500);
  const args=[order.id,id(6),'cs_test_fixture6','cus_fixture6','pi_fixture6',500,'usd',false,0,null,null,0,0];
  const clients=[new pg.Client(config),new pg.Client(config)];
  try {
   await Promise.all(clients.map(c=>c.connect()));
   const outputs=await Promise.allSettled(clients.map(c=>c.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS added',args)));
   assert.equal(outputs.filter(x=>x.status==='fulfilled' && x.value.rows[0].added).length,1);
   assert.equal(outputs.filter(x=>x.status==='rejected' && x.reason.code==='40001').length,1);
  } finally { await Promise.all(clients.map(c=>c.end())); }
  const events=await query('SELECT count(*) n FROM public.decke_credit_event WHERE ref=$1',['credit-order:'+order.id]);assert.equal(Number(events.n),1);
  await deny(()=>db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[...args.slice(0,5),499,...args.slice(6,12),1]),'22023');
 });
 await test('refunds and lost disputes consume spent credits as debt; repeated events never restore lost credits',async()=>{
  const b=(await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)])).balance;
  await db.query("SELECT public.credit_apply_delta($1,$2,'spend','Fixture spend before dispute','fixture-drain')",[id(6),-b]);
  await db.query('SELECT public.credit_order_reverse($1,0,$2,$3)',['pi_fixture6','dp_fixture6','lost']);
  assert.equal((await query('SELECT debt FROM public.credit_wallet_control WHERE user_id=$1',[id(6)])).debt,100);
  await as(id(1),()=>db.query('SELECT public.credit_adjust($1,100,$2,$3)',[id(6),'Owner settles dispute debt','resolve-debt-six']));
  await as(id(1),()=>db.query('SELECT public.credit_hold_resolve($1,$2)',[id(6),'Closed dispute reviewed and resolved']));
  await db.query('SELECT public.credit_order_reverse($1,0,$2,$3)',['pi_fixture6','dp_fixture6','lost']);
  const result=await as(id(6),()=>scalar('SELECT public.credit_wallet_read(NULL) AS data'));
  assert.deepEqual(result,{balance:0,debt:0,purchaseHold:false});
  await db.query('SELECT public.credit_order_reverse($1,250,NULL,NULL)',['pi_fixture6']);
  assert.equal((await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)])).balance,0);
 });
 await test('ledger and admin-audit failures roll back balance changes',async()=>{
  await db.query("CREATE FUNCTION public.credit_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure' USING ERRCODE='23514'; END $$");
  await db.query('CREATE TRIGGER credit_test_fail BEFORE INSERT ON public.admin_audit FOR EACH ROW EXECUTE FUNCTION public.credit_test_fail()');
  try {
   const before=await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]);
   await deny(()=>as(id(1),()=>db.query('SELECT public.credit_adjust($1,50,$2,$3)',[id(6),'Should roll back with audit','audit-failure'])),'23514');
   assert.deepEqual(await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]),before);
   assert.equal(Number((await query("SELECT count(*) n FROM public.credit_adjustment WHERE attempt_key='audit-failure'")).n),0);
  } finally { await db.query('DROP TRIGGER credit_test_fail ON public.admin_audit');await db.query('DROP FUNCTION public.credit_test_fail()'); }
 });
 await test('fresh suspension and permission revocation deny model starts',async()=>{
  await db.query('UPDATE public.admin_account SET suspended=true WHERE user_id=$1',[id(5)]);
  await deny(()=>db.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5)',[id(5),'chatTurn',policy.revision,'suspended-attempt','e'.repeat(64)]));
  await db.query('UPDATE public.admin_account SET suspended=false WHERE user_id=$1',[id(5)]);
  await db.query('DELETE FROM public.admin_user_role WHERE user_id=$1',[id(5)]);
  await deny(()=>db.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5)',[id(5),'chatTurn',policy.revision,'revoked-attempt','f'.repeat(64)]));
 });
 await test('pending refunds hold credits; failed refunds release hold without another grant',async()=>{
  const p=await as(id(1),()=>scalar('SELECT public.credit_pack_save(NULL,$1,NULL) AS data',[{name:'Refund fixture',credits:50,priceCents:200,currency:'usd',active:true}]));
  const o=await as(id(6),()=>scalar('SELECT public.credit_order_create($1,$2) AS data',[p.id,'pending-refund-fixture']));
  await as(id(6),()=>db.query('SELECT public.credit_order_prepare($1,$2,false)',[o.id,'cus_fixture6']));
  const args=[o.id,id(6),'cs_test_refund','cus_fixture6','pi_refund',200,'usd',false,0,null,null,200,0];
  await db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',args);
  const held=await as(id(6),()=>scalar('SELECT public.credit_wallet_read(NULL) AS data'));
  assert.equal(held.purchaseHold,true);assert.equal(held.balance,50);
  const refused=await scalar('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',[id(6),'chatTurn',policy.revision,'pending-refund-spend','f'.repeat(64)]);
  assert.equal(refused.allowed,false);
  args[11]=0;args[12]=1;
  await db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',args);
  const released=await as(id(6),()=>scalar('SELECT public.credit_wallet_read(NULL) AS data'));
  assert.equal(released.purchaseHold,false);assert.equal(released.balance,50);
  assert.equal(Number((await query('SELECT count(*) n FROM public.decke_credit_event WHERE ref=$1',['credit-order:'+o.id])).n),1);
 });
 await test('a missing ledger event rolls the debit and reservation back together',async()=>{
  await db.query("CREATE FUNCTION public.credit_event_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture ledger failure' USING ERRCODE='23514'; END $$");
  await db.query('CREATE TRIGGER credit_event_test_fail BEFORE INSERT ON public.decke_credit_event FOR EACH ROW EXECUTE FUNCTION public.credit_event_test_fail()');
  try {
   const before=await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]);
   await deny(()=>db.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5)',[id(6),'chatTurn',policy.revision,'ledger-failure-spend','a'.repeat(64)]),'23514');
   assert.deepEqual(await query('SELECT balance FROM public.decke_credit_balance WHERE user_id=$1',[id(6)]),before);
   assert.equal(Number((await query("SELECT count(*) n FROM public.credit_spend WHERE request_key='ledger-failure-spend'")).n),0);
  } finally { await db.query('DROP TRIGGER credit_event_test_fail ON public.decke_credit_event');await db.query('DROP FUNCTION public.credit_event_test_fail()'); }
 });
 await test('credit operations reports enforce permissions and paginate safe summaries',async()=>{
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_admin_summary(30)')));
  const summary=await as(id(1),()=>scalar('SELECT public.credit_admin_summary(30) AS data'));
  assert.equal(summary.days,30);assert.ok(summary.paidOrders>=2);
  const orders=await as(id(1),()=>scalar('SELECT public.credit_admin_orders(NULL,$1,1,0) AS data',[id(6)]));
  assert.equal(orders.orders.length,1);assert.ok(orders.total>=2);
  assert.equal(orders.orders[0].stripe_customer_id,undefined);assert.equal(orders.orders[0].stripe_payment_intent_id,undefined);
 });

 await test('expired unstarted work is recovered once and can never start afterward',async()=>{
  const spend=await scalar('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',[id(6),'chatTurn',policy.revision,'expired-work-fixture','c'.repeat(64)]);
  assert.equal(spend.allowed,true);
  await db.query("UPDATE public.credit_spend SET created_at=now()-interval '6 minutes' WHERE id=$1",[spend.spendId]);
  await deny(()=>db.query('SELECT public.credit_spend_start($1,$2)',[id(6),spend.spendId]),'40001');
  const recovered=await as(id(6),()=>scalar('SELECT public.credit_wallet_read(NULL) AS data'));
  assert.equal(recovered.balance,50);
  await as(id(6),()=>db.query('SELECT public.credit_wallet_read(NULL)'));
  assert.equal(Number((await query('SELECT count(*) n FROM public.decke_credit_event WHERE ref=$1',['spend-refund:'+spend.spendId])).n),1);
  await deny(()=>db.query('SELECT public.credit_spend_start($1,$2)',[id(6),spend.spendId]),'40001');
 });

 await test('checkout throttling counts retries across transactions and denies connector tokens',async()=>{
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_checkout_throttle()'),{kind:'token'}));
  for(let i=0;i<60;i++) await as(id(6),()=>db.query('SELECT public.credit_checkout_throttle()'));
  await deny(()=>as(id(6),()=>db.query('SELECT public.credit_checkout_throttle()')),'54000');
  assert.equal((await query('SELECT attempts FROM public.credit_checkout_rate WHERE user_id=$1',[id(6)])).attempts,60);
 });

 await test('queued financial mutations recheck authority after governance revocation',async()=>{
  const roleResult=await api(id(1),'role.create',{name:'Credit race manager',description:'Disposable race fixture',permissions:['admin.access','credits.read','credits.manage']});
  const roleId=roleResult.role?.id ?? roleResult.id;
  assert.ok(roleId);
  const p=await as(id(1),()=>scalar('SELECT public.credit_pack_save(NULL,$1,NULL) AS data',[{name:'Race pack',credits:10,priceCents:200,currency:'usd',active:false}]));
  const currentPolicy=await scalar('SELECT public.credit_policy_read() AS data');
  const operations=[
   ['SELECT public.credit_policy_save($1,$2)',[POLICY,currentPolicy.revision]],
   ['SELECT public.credit_pack_save($1,$2,$3)',[p.id,{name:'Race exploit',credits:900000,priceCents:100,currency:'usd',active:true},p.revision]],
   ['SELECT public.credit_adjust($1,100,$2,$3)',[id(6),'Should not survive revoked role','revoked-credit-adjust']],
   ['SELECT public.credit_hold_resolve($1,$2)',[id(6),'Should not survive revoked role']],
  ];
  for(const [sql,args] of operations){
   const revision=(await query('SELECT revision FROM public.admin_account WHERE user_id=$1',[id(5)])).revision;
   await api(id(1),'user.roles',{id:id(5),roleIds:[roleId],expectedRevision:revision,reason:'Assign synthetic credit manager'});
   const revokeRevision=(await query('SELECT revision FROM public.admin_account WHERE user_id=$1',[id(5)])).revision;
   const revoker=new pg.Client(config),manager=new pg.Client(config);
   let attempt;
   try {
    await revoker.connect();await manager.connect();
    await revoker.query('BEGIN');await revoker.query('SELECT pg_advisory_xact_lock(741290064)');
    await manager.query('BEGIN');
    await manager.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(5),role:'authenticated',deckpal_auth_kind:'jwt'})]);
    await manager.query('SET LOCAL ROLE authenticated');
    const pid=(await manager.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    let settled=false;
    attempt=manager.query(sql,args).then(()=>({ok:true}),e=>({code:e.code})).finally(()=>{settled=true;});
    let blocked=false;
    for(let i=0;i<100;i++){
     if(settled) break;
     const row=await query("SELECT wait_event FROM pg_stat_activity WHERE pid=$1",[pid]);
     if(row?.wait_event==='advisory'){blocked=true;break;}
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(blocked,true,'financial mutation must wait for governance before reading authority');
    await revoker.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(1),role:'authenticated',deckpal_auth_kind:'jwt'})]);
    await revoker.query('SET LOCAL ROLE authenticated');
    await revoker.query("SELECT public.admin_api('user.roles',$1::jsonb)",[JSON.stringify({id:id(5),roleIds:[],expectedRevision:revokeRevision,reason:'Revoke while financial request is queued'})]);
    await revoker.query('COMMIT');
    assert.deepEqual(await attempt,{code:'42501'});
   }finally{
    await revoker.query('ROLLBACK').catch(()=>{});
    await attempt?.catch(()=>{});
    await manager.query('ROLLBACK').catch(()=>{});
    await Promise.all([revoker.end(),manager.end()]);
   }
  }
  assert.equal((await query('SELECT active FROM public.credit_pack WHERE id=$1',[p.id])).active,false);
  assert.equal(Number((await query("SELECT count(*) n FROM public.credit_adjustment WHERE attempt_key='revoked-credit-adjust'")).n),0);
 });

 await test('stale Stripe reconciliation cannot clear a newer pending-refund hold',async()=>{
  const o=await query("SELECT * FROM public.credit_order WHERE stripe_payment_intent_id='pi_refund'");
  const revision=o.reconciliation_revision;
  const newer=[o.id,o.user_id,o.stripe_session_id,o.stripe_customer_id,o.stripe_payment_intent_id,o.price_cents,o.currency,o.livemode,0,null,null,100,revision];
  await db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',newer);
  const stale=[...newer];stale[11]=0;
  await deny(()=>db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',stale),'40001');
  assert.equal((await query('SELECT pending_refund_cents FROM public.credit_order WHERE id=$1',[o.id])).pending_refund_cents,100);
  stale[12]=revision+1;
  await db.query('SELECT public.credit_order_settle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',stale);
  assert.equal((await query('SELECT pending_refund_cents FROM public.credit_order WHERE id=$1',[o.id])).pending_refund_cents,0);
 });
 await test('hold resolution waits for orders before taking a wallet lock',async()=>{
  const lockedOrder=(await query('SELECT id FROM public.credit_order WHERE user_id=$1 ORDER BY id LIMIT 1',[id(6)])).id;
  const blocker=new pg.Client(config),probe=new pg.Client(config);
  let pending,pid,done=false;
  try{
   await blocker.connect();await probe.connect();
   await blocker.query('BEGIN');await blocker.query('SELECT id FROM public.credit_order WHERE id=$1 FOR UPDATE',[lockedOrder]);
   pending=as(id(1),async()=>{
    pid=await scalar('SELECT pg_backend_pid() AS data');
    await db.query('SELECT public.credit_hold_resolve($1,$2)',[id(6),'Verify consistent financial lock order']);
   }).finally(()=>{done=true;});
   let blocked=false;
   for(let i=0;i<100;i++){
    if(done) break;
    if(pid && (await query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1',[pid]))?.wait_event==='transactionid'){blocked=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(blocked,true,'hold resolution must be waiting on the locked order');
   await probe.query('BEGIN');
   await probe.query('SELECT user_id FROM public.credit_wallet_control WHERE user_id=$1 FOR UPDATE NOWAIT',[id(6)]);
   await probe.query('COMMIT');
   await blocker.query('COMMIT');
   await pending;
  }finally{
   await blocker.query('ROLLBACK').catch(()=>{});await probe.query('ROLLBACK').catch(()=>{});
   await pending?.catch(()=>{});await Promise.all([blocker.end(),probe.end()]);
  }
 });

}
