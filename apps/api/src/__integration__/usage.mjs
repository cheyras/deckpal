import assert from 'node:assert/strict';
/** Called only inside the existing runner-owned disposable PostgreSQL fixture. */
export async function runUsageContracts({db,as,test,id,mode,api,connect}) {
 const owner=id(1), member=id(6), outsider=id(7);
 const opts=mode==='cloud'?{}:{kind:'local',role:'none'};
 const call=(actor,sql,args=[])=>as(actor,async c=>(await c.query(sql,args)).rows[0]?.data,opts);
 const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
 // Keep the fixture's other roles untouched; these dedicated identities are fixture-only.
 await db.query("UPDATE public.admin_account SET role_id=(SELECT id FROM public.admin_role WHERE key='user'),suspended=false WHERE user_id=ANY($1::text[])",[[member,outsider]]);
 await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
 const policy=(await db.query('SELECT public.credit_policy_read() data')).rows[0].data;
 const begin=async({user=member,conv=id(810),exchange=id(811),seq=0,key='usage-request-0001',asked='PRIVATE_ASK_SENTINEL'}={})=>{
  const result=await db.query("SELECT public.decke_usage_begin($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'daily',$10) data",
   [user,conv,exchange,seq,key,'a'.repeat(64),'b'.repeat(40),188,policy.revision,asked]);
  return result.rows[0].data.id;
 };
 let shared,privateRequest;
 await test('usage consent default-off and initial request metadata contain no content',async()=>{
  assert.deepEqual(await call(member,'SELECT public.decke_sharing_read() data'),{enabled:false,revision:0,updatedAt:null});
  privateRequest=await begin();
  const detail=await call(owner,'SELECT public.decke_usage_detail($1) data',[privateRequest]);
  assert.equal(detail.content,null);assert.equal(detail.contentStatus,'not_shared');
  assert.equal(JSON.stringify(detail).includes('PRIVATE_ASK_SENTINEL'),false);
 });
 await test('consent starts at exchange first leg and enabling cannot share earlier exchange legs',async()=>{
  const consent=await call(member,'SELECT public.decke_sharing_save(true,0) data');assert.equal(consent.revision,1);
  const later=await begin({key:'usage-request-0002'});
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[later])).content,null);
  shared=await begin({exchange:id(812),seq:1,key:'usage-request-0003'});
  await db.query('SELECT public.decke_usage_content_append($1,$2)',[shared,'PRIVATE_ANSWER_SENTINEL']);
  const detail=await call(owner,'SELECT public.decke_usage_detail($1) data',[shared]);
  assert.deepEqual(detail.content,{asked:'PRIVATE_ASK_SENTINEL',answered:'PRIVATE_ANSWER_SENTINEL'});
  const list=await call(owner,"SELECT public.decke_usage_list('{}',25,0) data");
  assert.equal(JSON.stringify(list).includes('PRIVATE_'),false);
 });
 await test('withdrawal removes admin excerpts and re-enable cannot resurrect them',async()=>{
  await call(member,'SELECT public.decke_sharing_save(false,1) data');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_ai_content WHERE request_id=$1',[shared])).rows[0].n,0);
  await call(member,'SELECT public.decke_sharing_save(true,2) data');
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[shared])).content,null);
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[privateRequest])).content,null);
  await assert.rejects(()=>call(member,'SELECT public.decke_sharing_save(false,1) data'),e=>e.code==='40001');
 });
 await test('usage parent replay, conflicting exchange and foreign conversation cannot forge history',async()=>{
  await assert.rejects(()=>begin(),e=>e.code==='40001');
  await assert.rejects(()=>begin({exchange:id(813),seq:0,key:'usage-request-conflict'}),e=>e.code==='40001');
  await denied(()=>begin({user:outsider,exchange:id(814),key:'usage-request-foreign'}));
 });
 await test('non-admin roles cannot read content or metadata through any usage RPC',async()=>{
  for(const role of ['user','superuser','contributor']) {
   await db.query("UPDATE public.admin_account SET role_id=(SELECT id FROM public.admin_role WHERE key=$2) WHERE user_id=$1",[outsider,role]);
   await denied(()=>call(outsider,"SELECT public.decke_usage_list('{}',25,0) data"));
   await denied(()=>call(outsider,'SELECT public.decke_usage_detail($1) data',[shared]));
   await denied(()=>call(outsider,'SELECT public.decke_usage_conversation($1,25,0) data',[id(810)]));
   await denied(()=>call(outsider,'SELECT public.decke_usage_observations(30,NULL) data'));
  }
 });
 await test('all administrative tiers can read current-consented content',async()=>{
  const fresh=await begin({exchange:id(815),seq:2,key:'usage-request-current'});
  for(const role of ['admin','super_admin']) {
   await db.query("UPDATE public.admin_account SET role_id=(SELECT id FROM public.admin_role WHERE key=$2) WHERE user_id=$1",[outsider,role]);
   assert.equal((await call(outsider,'SELECT public.decke_usage_detail($1) data',[fresh])).contentStatus,'shared');
   await denied(()=>call(outsider,'SELECT public.admin_user_ai_override_update($1,0,true,0,$2) data',[member,'fixture reason']));
  }
 });
 await test('custom role usage and conversation SQL/HTTP require current admin.access through grant and revoke',async()=>{
  const admin=(op,p)=>call(owner,'SELECT public.admin_api($1,$2::jsonb) data',[op,JSON.stringify(p)]);
  let custom=(await admin('role.create',{name:'Usage custom administrator',description:'Permission boundary fixture',tier:40,permissions:[]})).role;
  const fresh=await begin({conv:id(870),exchange:id(871),key:'usage-custom-shared',asked:'CUSTOM_SHARED_SENTINEL'});
  const checks=[
   ["SELECT public.decke_usage_list('{}',25,0) data",[], '/admin/ai-usage'],
   ['SELECT public.decke_usage_detail($1) data',[fresh],'/admin/ai-usage/requests/'+fresh],
   ['SELECT public.decke_usage_conversation($1,25,0) data',[id(870)],'/admin/ai-usage/conversations/'+id(870)],
   ['SELECT public.decke_usage_observations(30,NULL) data',[],'/admin/ai-usage/observations?days=30']
  ];
  const verify=async(actor,allowed)=>{
   const capability=(await db.query('SELECT public.admin_access($1) data',[actor])).rows[0].data.actorCapabilities.canReadSharedConversations;
   assert.equal(capability,allowed);
   for(const [sql,args,path] of checks){
    if(allowed)assert.ok(await call(actor,sql,args));else await denied(()=>call(actor,sql,args));
    const response=await api(path,{headers:{'x-fixture-user':actor}});
    const data=await response.json();assert.equal(response.status,allowed?200:403,path+': '+JSON.stringify(data));
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    if(!allowed)assert.equal(JSON.stringify(data).includes('CUSTOM_SHARED_SENTINEL'),false);
   }
   if(allowed)assert.equal((await call(actor,'SELECT public.decke_usage_detail($1) data',[fresh])).content.asked,'CUSTOM_SHARED_SENTINEL');
  };
  await db.query('UPDATE public.admin_account SET role_id=$2 WHERE user_id=$1',[outsider,custom.id]);
  await verify(outsider,false);
  custom=(await admin('role.update',{id:custom.id,name:custom.name,description:custom.description,permissions:['admin.access'],expectedRevision:custom.revision})).role;
  await verify(outsider,true);
  custom=(await admin('role.update',{id:custom.id,name:custom.name,description:custom.description,permissions:[],expectedRevision:custom.revision})).role;
  await verify(outsider,false);
  const lower=(await admin('role.create',{name:'Usage lower tier',description:'Malformed raw grant fixture',tier:30,permissions:[]})).role;
  await db.query('UPDATE public.admin_account SET role_id=$2 WHERE user_id=$1',[outsider,lower.id]);
  await db.query('ALTER TABLE public.admin_role_permission DISABLE TRIGGER admin_role_permission_ceiling');
  try {
   await db.query("INSERT INTO public.admin_role_permission(role_id,permission_key) VALUES($1,'admin.access')",[lower.id]);
   await verify(outsider,false);
  } finally {
   await db.query('DELETE FROM public.admin_role_permission WHERE role_id=$1',[lower.id]);
   await db.query('ALTER TABLE public.admin_role_permission ENABLE TRIGGER admin_role_permission_ceiling');
  }
  for(const role of ['admin','super_admin']){
   await db.query("UPDATE public.admin_account SET role_id=(SELECT id FROM public.admin_role WHERE key=$2) WHERE user_id=$1",[outsider,role]);
   await verify(outsider,true);
  }
  await verify(owner,true);
  for(const [, ,path] of checks){
   const response=await api(path,{headers:{'x-fixture-user':owner,'x-fixture-kind':'token'}});
   assert.equal(response.status,403);await response.arrayBuffer();
  }
  await admin('role.delete',{id:lower.id,expectedRevision:lower.revision});
  await admin('role.delete',{id:custom.id,expectedRevision:custom.revision});
 });
 await test('Owner override zero/null markup is revisioned and independent of target role',async()=>{
  const initial=await call(owner,'SELECT public.admin_user_ai_override_read($1) data',[member]);
  assert.equal(initial.revision,0);assert.equal(initial.markupBps,null);
  const unlimited=await call(owner,'SELECT public.admin_user_ai_override_update($1,0,true,0,$2) data',[member,'fixture unlimited']);
  assert.equal(unlimited.unlimited,true);assert.equal(unlimited.markupBps,0);assert.equal(unlimited.revision,1);
  await assert.rejects(()=>call(owner,'SELECT public.admin_user_ai_override_update($1,0,false,NULL,$2) data',[member,'stale fixture']),e=>e.code==='40001');
  const effective=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  assert.equal(effective.unlimited,true);assert.equal(effective.policy.markupBps,0);
 });
 await test('unlimited reservation has zero financial movement and frozen override survives revocation',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE user_id::text=$1',[member])).rows[0].n;
  const q=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  const spend=(await db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,1,$3,$4) data",[member,q.revision,'usage-unlimited-spend','c'.repeat(64)])).rows[0].data;
  assert.equal(spend.allowed,true);assert.equal(spend.spent,0);
  await call(owner,'SELECT public.admin_user_ai_override_update($1,1,false,NULL,$2) data',[member,'revoke unlimited']);
  const now=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  assert.equal(now.unlimited,false);assert.equal(now.overrideRevision,2);
  await db.query('SELECT public.credit_spend_start($1,$2)',[member,spend.spendId]);
  await assert.rejects(()=>db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,1,$3,$4)",[member,q.revision,'fresh-stale-unlimited','d'.repeat(64)]),e=>e.code==='40001');
  const child=(await db.query("SELECT public.credit_spend_create_effective($1,'analysis',$2,1,$3,$4) data",[member,q.revision,'usage-unlimited-spend:deep:approved-operation','e'.repeat(64)])).rows[0].data;
  assert.equal(child.allowed,true);assert.equal(child.spent,0);
  await assert.rejects(()=>db.query("SELECT public.credit_spend_create_effective($1,'analysis',$2,1,$3,$4)",[member,q.revision,'made-up-parent:deep:approved-operation','d'.repeat(64)]),e=>e.code==='40001');

  assert.equal((await db.query('SELECT public.credit_spend_refund($1,$2) refunded',[member,spend.spendId])).rows[0].refunded,false);
  const saved=(await db.query('SELECT credits,override_revision,charge_mode FROM public.credit_spend WHERE id=$1',[spend.spendId])).rows[0];
  assert.equal(saved.credits,0);assert.equal(saved.charge_mode,'unlimited');assert.equal(Number(saved.override_revision),1);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE user_id::text=$1',[member])).rows[0].n,before);
  if(mode==='cloud') {
   await denied(()=>call(member,"SELECT public.credit_spend_create_effective($1,'chatTurn',$2,1,$3,$4) data",[member,q.revision,'forged-old-unlimited','d'.repeat(64)]));
   await denied(()=>call(member,'SELECT public.credit_effective_policy($1,$2,1) data',[member,q.revision]));
  }
 });
 await test('unlimited still honors debt/hold and does not manufacture a refund grant',async()=>{
  await call(owner,'SELECT public.admin_user_ai_override_update($1,2,true,NULL,$2) data',[member,'restore fixture unlimited']);
  await db.query('UPDATE public.credit_wallet_control SET debt=1 WHERE user_id=$1',[member]);
  const q=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  const blocked=(await db.query("SELECT public.credit_spend_create_effective($1,'analysis',$2,3,$3,$4) data",[member,q.revision,'usage-held-unlimited','e'.repeat(64)])).rows[0].data;
  assert.equal(blocked.allowed,false);assert.equal(blocked.held,true);
  await db.query('UPDATE public.credit_wallet_control SET debt=0 WHERE user_id=$1',[member]);
  const before=(await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE user_id::text=$1',[member])).rows[0].n;
  const spend=(await db.query("SELECT public.credit_spend_create_effective($1,'analysis',$2,3,$3,$4) data",[member,q.revision,'usage-cancel-unlimited','f'.repeat(64)])).rows[0].data;
  await db.query('SELECT public.credit_spend_refund($1,$2)',[member,spend.spendId]);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_credit_event WHERE user_id::text=$1',[member])).rows[0].n,before);
 });
 await test('observed costs use complete operation samples and preserve unknown totals',async()=>{
  await db.query("INSERT INTO public.decke_ai_operation(id,request_id,category,tool_key,model_id,provider,operation_key,status,cost_usd,cost_source) VALUES($1,$3,'research','research_meta','fixture/model','fixture','research-1','completed',0.00123,'provider_reported'),($2,$3,'research','research_meta','fixture/model','fixture','research-2','failed',NULL,'unknown')",[id(830),id(831),shared]);
  const result=await call(owner,'SELECT public.decke_usage_observations(30,NULL) data');
  assert.equal(result.groups[0].completeCount,1);assert.equal(result.groups[0].unknownCount,1);assert.equal(result.groups[0].meanMicroUsd,1230);
  const detail=await call(owner,'SELECT public.decke_usage_detail($1) data',[shared]);
  assert.equal(detail.request.cost.coverage,'partial');assert.equal(detail.operations[1].cost.usd,null);
 });
 await test('active user can withdraw when Deck-E is disabled, and future provider starts are denied',async()=>{
  const before=await call(member,'SELECT public.decke_sharing_read() data');
  await db.query("UPDATE public.app_feature SET lifecycle='disabled' WHERE key='decke'");
  const stopped=await call(member,'SELECT public.decke_sharing_save(false,$1) data',[before.revision]);
  assert.equal(stopped.enabled,false);
  await denied(()=>begin({exchange:id(848),seq:8,key:'usage-disabled-new'}));
  await denied(()=>db.query("SELECT public.decke_usage_operation_begin($1,$2,'response','chat_turn','fixture/model','fixture','test')",[id(849),shared]));
  await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
 });
 await test('missing correlation remains private, target suspension hides content, and history deletion withdraws it',async()=>{
  const before=await call(member,'SELECT public.decke_sharing_read() data');
  await call(member,'SELECT public.decke_sharing_save(true,$1) data',[before.revision]);
  const missing=await begin({exchange:null,seq:null,key:'usage-missing-correlation'});
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[missing])).content,null);
  const fresh=await begin({conv:id(850),exchange:id(851),seq:0,key:'usage-suspended-content'});
  await db.query('UPDATE public.admin_account SET suspended=true WHERE user_id=$1',[member]);
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[fresh])).content,null);
  await db.query('UPDATE public.admin_account SET suspended=false WHERE user_id=$1',[member]);
  await db.query('DELETE FROM public.decke_conversation WHERE id=$1 AND user_id::text=$2',[id(850),member]);
  assert.equal((await call(owner,'SELECT public.decke_usage_detail($1) data',[fresh])).content,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_ai_request WHERE id=$1',[fresh])).rows[0].n,1);
 });
 await test('cost/model filters are bounded metadata projections and unknown cost never becomes zero',async()=>{
  const result=await call(owner,"SELECT public.decke_usage_list($1::jsonb,1,0) data",[JSON.stringify({modelId:'fixture/model',costSource:'unknown'})]);
  assert.ok(result.total>=1);assert.equal(result.items.length,1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'),false);
  const empty=await call(owner,"SELECT public.decke_usage_list($1::jsonb,25,0) data",[JSON.stringify({modelId:'absent/model'})]);
  assert.equal(empty.total,0);
  const detail=await call(owner,'SELECT public.decke_usage_detail($1) data',[privateRequest]);
  assert.equal(detail.request.cost.usd,null);assert.equal(detail.request.cost.coverage,'unknown');
 });
 await test('fresh paid zero-markup quote is rejected after revocation while reserved terms remain frozen',async()=>{
  const initial=await call(owner,'SELECT public.admin_user_ai_override_read($1) data',[member]);
  const current=(await db.query('SELECT public.credit_policy_read() data')).rows[0].data;
  const paid={...current.policy,enabled:true,markupBps:5000};
  await call(owner,'SELECT public.credit_policy_save($1::jsonb,$2) data',[JSON.stringify(paid),current.revision]);
  const override=await call(owner,'SELECT public.admin_user_ai_override_update($1,$2,false,0,$3) data',[member,initial.revision,'zero markup fixture']);
  const quote=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  await db.query("SELECT public.credit_apply_delta($1,100000,'grant','disposable fixture','usage-paid-fixture',NULL)",[member]);
  const frozen=(await db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,$3,$4,$5) data",[member,quote.revision,override.revision,'usage-paid-frozen','a'.repeat(64)])).rows[0].data;
  await call(owner,'SELECT public.admin_user_ai_override_update($1,$2,false,NULL,$3) data',[member,override.revision,'restore global markup']);
  await assert.rejects(()=>db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,$3,$4,$5)",[member,quote.revision,override.revision,'usage-paid-stale-new','b'.repeat(64)]),e=>e.code==='40001');
  await db.query('SELECT public.credit_spend_start($1,$2)',[member,frozen.spendId]);
  const saved=(await db.query('SELECT pricing_snapshot,credits FROM public.credit_spend WHERE id=$1',[frozen.spendId])).rows[0];
  assert.equal(saved.pricing_snapshot.policy.markupBps,0);
  assert.equal(saved.credits,frozen.spent);
  assert.equal((await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data.policy.markupBps,5000);
 });

 const reserve=async(key)=>{
  const quote=(await db.query('SELECT public.credit_effective_policy($1) data',[member])).rows[0].data;
  const spend=(await db.query("SELECT public.credit_spend_create_effective($1,'chatTurn',$2,$3,$4,$5) data",[member,quote.revision,quote.overrideRevision,key,'e'.repeat(64)])).rows[0].data;
  assert.equal(spend.allowed,true);return {quote,spend};
 };
 const spendState=async spendId=>(await db.query('SELECT provider_started_at,refunded_at,credits FROM public.credit_spend WHERE id=$1',[spendId])).rows[0];
 const waitBlocked=async pid=>{
  for(let n=0;n<200;n++){
   if((await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock') yes",[pid])).rows[0].yes)return;
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail('credit start did not actually wait on the held database lock');
 };
 await test('queued credit start reauthorizes after governance revocation and spend-row payment hold waits',async()=>{
  for(const boundary of ['governance','spend']){
   const {spend}=await reserve('usage-start-wait-'+boundary);
   const c=await connect();
   try{
    const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await db.query('BEGIN');
    if(boundary==='governance')await db.query('SELECT pg_advisory_xact_lock(741290064)');
    else await db.query('SELECT id FROM public.credit_spend WHERE id=$1 FOR UPDATE',[spend.spendId]);
    const pending=c.query('SELECT public.credit_spend_start($1,$2)',[member,spend.spendId]).then(()=>({}),error=>({error}));
    try{
     await waitBlocked(pid);
     if(boundary==='governance')await db.query("UPDATE public.app_feature SET lifecycle='disabled' WHERE key='decke'");
     else await db.query('UPDATE public.credit_wallet_control SET debt=1 WHERE user_id=$1',[member]);
     await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}
    assert.equal((await pending).error?.code,'42501',boundary+' must observe the committed revocation/hold');
    assert.equal((await spendState(spend.spendId)).provider_started_at,null);
    await db.query("UPDATE public.app_feature SET lifecycle='released' WHERE key='decke'");
    await db.query('UPDATE public.credit_wallet_control SET debt=0 WHERE user_id=$1',[member]);
    assert.equal((await db.query('SELECT public.credit_spend_refund($1,$2) ok',[member,spend.spendId])).rows[0].ok,true);
   }finally{await c.end();}
  }
 });
 await test('atomic provider operation failures and pre-invocation cancellation refund while real attempts keep one charge',async()=>{
  const prepare=async(n)=>{
   const key='usage-atomic-start-'+n;const {spend}=await reserve(key);
   const request=await begin({conv:id(880+n),exchange:id(890+n),key});
   return {spend,request,operation:id(900+n)};
  };
  const open=(f,category='response')=>db.query('SELECT public.decke_usage_operation_begin($1,$2,$3,$4,$5,$6,$7,$8)',[f.operation,f.request,category,'chat_turn','fixture/model','fixture','chat_turn',f.spend.spendId]);
  const failed=await prepare(1);
  await assert.rejects(()=>open(failed,'invalid-category'),e=>e.code==='23514');
  assert.equal((await spendState(failed.spend.spendId)).provider_started_at,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_ai_operation WHERE id=$1',[failed.operation])).rows[0].n,0);
  assert.equal((await db.query('SELECT public.credit_spend_refund($1,$2) ok',[member,failed.spend.spendId])).rows[0].ok,true);
  const cancelled=await prepare(2);await open(cancelled);
  assert.ok((await spendState(cancelled.spend.spendId)).provider_started_at);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[cancelled.operation])).rows[0].ok,true);
  assert.equal((await spendState(cancelled.spend.spendId)).provider_started_at,null);
  assert.ok((await spendState(cancelled.spend.spendId)).refunded_at);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[cancelled.operation])).rows[0].ok,false);
  const actual=await prepare(3);await open(actual);
  const start=(await spendState(actual.spend.spendId)).provider_started_at;
  await db.query("UPDATE public.decke_ai_operation SET status='completed',finished_at=now(),cost_usd=0.002,cost_source='provider_reported' WHERE id=$1",[actual.operation]);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[actual.operation])).rows[0].ok,false);
  const retry={...actual,operation:id(904)};await open(retry);
  assert.deepEqual((await spendState(actual.spend.spendId)).provider_started_at,start);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[retry.operation])).rows[0].ok,false);
  assert.equal((await db.query('SELECT public.credit_spend_refund($1,$2) ok',[member,actual.spend.spendId])).rows[0].ok,false);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.decke_credit_event WHERE ref=$1",['spend:'+actual.spend.spendId])).rows[0].n,1);
  const parallel=await prepare(5);await open(parallel);
  const second={...parallel,operation:id(906)};await open(second);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[parallel.operation])).rows[0].ok,false);
  assert.equal((await db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1) ok',[second.operation])).rows[0].ok,true);
  assert.ok((await spendState(parallel.spend.spendId)).refunded_at);
  if(mode==='cloud')await denied(()=>call(member,'SELECT public.decke_usage_operation_cancel_uninvoked($1) data',[actual.operation]));
 });
 await test('financial summary counts mixed historical flat and effective-policy snapshots without hiding unpriced spends',async()=>{
  const before=await call(owner,'SELECT public.credit_admin_summary(30) data');
  const {quote}=await reserve('usage-summary-effective');
  const estimate=Number(quote.policy.estimatedMicroUsd.chatTurn);
  assert.ok(estimate>0);
  await db.query("SELECT public.credit_apply_delta($1,-1,'spend','chatTurn',$2,$3,$4::jsonb)",[member,'usage-summary-historical-flat',quote.revision,JSON.stringify(quote.policy)]);
  await db.query("SELECT public.credit_apply_delta($1,-1,'spend','analysis',$2,$3,$4::jsonb)",[member,'usage-summary-unpriced',quote.revision,JSON.stringify({policy:{}})]);
  const after=await call(owner,'SELECT public.credit_admin_summary(30) data');
  assert.equal(Number(after.estimatedProviderMicroUsd)-Number(before.estimatedProviderMicroUsd),estimate*2);
  assert.equal(Number(after.unpricedSpends)-Number(before.unpricedSpends),1);
 });

 await test('actual history HTTP chain binds owned server usage, remains immutable, and withdraws only shared content',async()=>{
  assert.equal(typeof api,'function','access fixture must supply its real Express HTTP helper');
  const http=async(actor,path,{method='GET',body,status=200}={})=>{
   const response=await api(path,{method,headers:{'x-fixture-user':actor,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const data=await response.json();
   assert.equal(response.status,status,method+' '+path+': '+JSON.stringify(data));
   assert.match(response.headers.get('cache-control')??'',/no-store/);
   return data;
  };
  const sharing=await http(member,'/me/decke-sharing');
  await http(member,'/me/decke-sharing',{method:'PUT',body:{enabled:true,expectedRevision:sharing.revision}});
  const conversation=id(860),exchange=id(861),requestId=await begin({conv:conversation,exchange,seq:0,key:'usage-http-owned-exchange',asked:'SERVER_USER_SENTINEL'});
  await db.query("SELECT public.decke_usage_operation_begin($1,$2,'response','chat_turn','fixture/http-model','fixture','chat_turn')",[id(862),requestId]);
  await db.query("UPDATE public.decke_ai_operation SET status='completed',finished_at=now(),input_tokens=12,output_tokens=6,cost_usd=0.00123,cost_source='provider_reported' WHERE id=$1",[id(862)]);
  await db.query('SELECT public.decke_usage_content_append($1,$2)',[requestId,'SERVER_ANSWER_SENTINEL']);
  await db.query("UPDATE public.decke_ai_request SET status='completed',finished_at=now(),charged_credits=1 WHERE id=$1",[requestId]);
  const client={conversationId:conversation,exchangeId:exchange,seq:0,asked:'Personal client question',answered:'Personal client answer',
   tools:[{name:'plan_deck',phase:'ok',title:'Personal tool',summary:'PRIVATE_TOOL_SUMMARY',args:{secret:'PRIVATE_TOOL_ARGUMENT'}}],
   finishReason:'stop',buildSha:'FORGED_BUILD',buildPr:999999,cost:{usd:'999999',source:'provider_reported'}};
  const created=await http(member,'/decke/history',{method:'POST',body:client});
  assert.equal(created.recorded,true);assert.equal(created.buildSha,'b'.repeat(40));assert.equal(created.buildPr,188);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.decke_turn WHERE conversation_id=$1',[conversation])).rows[0].n,1,'successful HTTP write is committed');
  const duplicate=await http(member,'/decke/history',{method:'POST',body:{...client,asked:'ATTEMPTED_REWRITE',answered:'ATTEMPTED_REWRITE'}});
  assert.equal(duplicate.recorded,false);
  const own=await http(member,'/decke/history/'+conversation);
  assert.equal(own.title,client.asked);assert.equal(own.turns.length,1);
  assert.equal(own.turns[0].asked,client.asked);assert.equal(own.turns[0].answered,client.answered);
  assert.equal(own.turns[0].exchangeId,exchange);assert.equal(own.turns[0].buildSha,'b'.repeat(40));
  assert.equal(own.turns[0].usage.length,1);assert.equal(own.turns[0].usage[0].id,requestId);
  assert.equal(own.turns[0].usage[0].status,'completed');assert.equal(Number(own.turns[0].usage[0].cost.usd),0.00123);
  await http(outsider,'/decke/history/'+conversation,{status:404});
  await http(outsider,'/decke/history',{method:'POST',body:client,status:404});
  await http(member,'/decke/history',{method:'POST',body:{...client,exchangeId:id(863)},status:404});
  await http(member,'/decke/history',{method:'POST',body:{...client,seq:1},status:404});
  const detail=await http(owner,'/admin/ai-usage/requests/'+requestId);
  assert.deepEqual(detail.content,{asked:'SERVER_USER_SENTINEL',answered:'SERVER_ANSWER_SENTINEL'});
  assert.equal(detail.contentStatus,'shared');assert.equal(detail.operations.length,1);
  assert.equal(JSON.stringify(detail).includes('PRIVATE_TOOL_'),false);
  assert.equal(JSON.stringify(detail).includes('FORGED_BUILD'),false);
  const conversationDetail=await http(owner,'/admin/ai-usage/conversations/'+conversation);
  assert.equal(conversationDetail.total,1);assert.equal(conversationDetail.items[0].contentStatus,'shared');
  const list=await http(owner,'/admin/ai-usage?conversationId='+conversation);
  assert.equal(list.total,1);assert.equal(JSON.stringify(list).includes('SENTINEL'),false);
  const preference=await http(member,'/me/decke-sharing');
  const withdrawn=await http(member,'/me/decke-sharing',{method:'PUT',body:{enabled:false,expectedRevision:preference.revision}});
  assert.equal(withdrawn.enabled,false);
  assert.equal((await db.query('SELECT enabled FROM public.decke_sharing WHERE user_id=$1',[member])).rows[0].enabled,false,'successful withdrawal response follows commit');
  const hidden=await http(owner,'/admin/ai-usage/requests/'+requestId);
  assert.equal(hidden.content,null);assert.equal(hidden.contentStatus,'revoked');
  assert.equal(hidden.request.id,requestId);assert.equal(Number(hidden.request.cost.usd),0.00123);
  assert.equal((await http(owner,'/admin/ai-usage/conversations/'+conversation)).items[0].content,null);
  assert.equal((await http(owner,'/admin/ai-usage?conversationId='+conversation)).total,1);
  assert.equal((await http(member,'/decke/history/'+conversation)).turns[0].answered,client.answered);
 });

}
