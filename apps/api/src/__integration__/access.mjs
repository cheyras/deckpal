import assert from 'node:assert/strict';
import {readFileSync,realpathSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const root=process.env.DECKPAL_TEST_ROOT,mode=process.env.DECKPAL_TEST_ADMIN_MODE,phase=process.env.DECKPAL_TEST_BOOTSTRAP;
assert.ok(root&&/^\/tmp\/deckpal-db-[^/]+$/.test(root));assert.equal(realpathSync(root),root);
assert.equal(readFileSync(join(root,'.deckpal-ci-owner'),'utf8'),process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST,join(root,'socket'));assert.equal(process.env.PGPORT,'55432');assert.equal(process.env.PGUSER,'deckpal_ci_fixture');
assert.equal(process.env.PGDATABASE,'deckpal_ci_access_'+mode.replaceAll('-','_')+'_'+phase);
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT),root);assert.equal(existsSync(join(repo,'.env')),false);
assert.equal(process.env.DATABASE_URL,undefined);assert.ok(!Object.keys(process.env).some(k=>/^SUPABASE/.test(k)));
const config={host:join(root,'socket'),port:55432,user:'deckpal_ci_fixture',database:process.env.PGDATABASE,ssl:false};
const db=new pg.Client(config),results={name:'access-'+mode+'-'+phase,status:'running',cases:[]};
const id=n=>mode==='legacy-self-host'?String(n):'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sql=name=>readFileSync(join(repo,'packages/db/src/migrations',name),'utf8');
const denied=async(fn,code='42501')=>assert.rejects(fn,e=>{assert.equal(e.code,code,e.message);return true;});
async function test(name,fn){await fn();results.cases.push({name,status:'passed'});console.log('PASS '+name);}
async function as(user,fn,kind=mode==='cloud'?'jwt':'local'){
 const c=new pg.Client(config);await c.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:mode==='cloud'?'authenticated':'local',deckpal_auth_kind:kind})]);if(mode==='cloud')await c.query('SET LOCAL ROLE authenticated');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
}
const call=(user,op,p={},kind)=>as(user,async c=>(await c.query('SELECT admin_api($1,$2::jsonb) result',[op,JSON.stringify(p)])).rows[0].result,kind);
const features=(user,op,p={})=>as(user,async c=>(await c.query('SELECT feature_api($1,$2::jsonb) result',[op,JSON.stringify(p)])).rows[0].result);
const access=async user=>(await db.query('SELECT admin_access($1) result',[user])).rows[0].result;
let roles, httpApi, httpServer, apiDatabase;
const assign=async(actor,target,key,extra={})=>{const u=(await call(actor,'user',{id:target})).user;return call(actor,'user.role',{id:target,roleId:roles[key].id,expectedRevision:u.revision,expectedRoleRevision:roles[key].revision,reason:'Fixture role change',...extra});};
try{
 await db.connect();
 assert.equal((await db.query('SELECT inet_server_addr() addr')).rows[0].addr,null);
 if(mode==='cloud')await db.query(readFileSync(join(repo,'apps/api/src/__integration__/admin-fixture.sql'),'utf8'));
 else await db.query(`CREATE TABLE app_user(id ${mode==='legacy-self-host'?'bigint':'uuid'} PRIMARY KEY,username text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
 if(mode!=='cloud')for(let n=1;n<=7;n++)await db.query('INSERT INTO app_user(id,username) VALUES($1,$2)',[id(n),'user-'+n]);
 await db.query(`CREATE TABLE api_token(id text,user_id ${mode==='legacy-self-host'?'bigint':'uuid'},revoked_at timestamptz);`);
 if(mode!=='legacy-self-host')for(const name of ['041_decke_credits.sql','043_decke_history.sql',...(mode==='cloud'?['044_decke_history_rls.sql']:[]),'046_decke_turn_finish_reason.sql','053_billing.sql','055_billing_ab.sql','057_billing_one_time.sql','061_billing_ab_dedupe.sql','063_billing_event_processed.sql'])await db.query(sql(name));
 await db.query(sql('064_admin_core.sql'));
 if(mode==='cloud')await db.query(sql('065_admin_security.sql'));
 if(mode!=='legacy-self-host')for(const name of ['066_credit_economy.sql','067_credit_economy_security.sql'])await db.query(sql(name));
 if(phase==='before')await db.query("SELECT admin_bootstrap($1,ARRAY[$2],ARRAY[$3])",[id(1),id(2),id(3)]);
 await test('preflight fails atomically on unmapped custom role and retains original authority',async()=>{
  const original=(await db.query('SELECT count(*)::int n FROM admin_user_role')).rows[0].n;
  await db.query('BEGIN');await db.query("INSERT INTO admin_role(key,name) VALUES('ambiguous','Unmapped custom role')");
  await denied(()=>db.query(sql('068_single_role_tiers.sql')),'55000');await db.query('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM admin_user_role')).rows[0].n,original);
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='admin_account' AND column_name='role_id'")).rows[0].n,0);
 });
 await test('preflight rejects ambiguous multi-role unions without an explicit account mapping',async()=>{
  await db.query('BEGIN');
  await db.query('INSERT INTO admin_account(user_id) VALUES($1) ON CONFLICT DO NOTHING',[id(6)]);
  const custom=(await db.query("INSERT INTO admin_role(key,name) VALUES('mapped_reader','Mapped reader') RETURNING id")).rows[0].id;
  const labeler=(await db.query("SELECT id FROM admin_role WHERE key='legacy_labeler'")).rows[0].id;
  await db.query('INSERT INTO admin_user_role(user_id,role_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING',[id(6),custom,labeler]);
  await db.query("SELECT set_config('deckpal.role_migration_map',$1,true)",[JSON.stringify({roles:{[custom]:10}})]);
  await denied(()=>db.query(sql('068_single_role_tiers.sql')),'55000');await db.query('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='admin_account' AND column_name='role_id'")).rows[0].n,0);
 });
 await test('reviewed role and account mappings work through PostgreSQL startup options across runner transactions',async()=>{
  const custom='68000000-0000-4000-8000-000000000099';
  const mapping={roles:{[custom]:10},users:{[id(6)]:custom}};
  const c=new pg.Client({...config,options:'-c deckpal.role_migration_map='+JSON.stringify(mapping)});await c.connect();
  try{
   await c.query('BEGIN');
   await c.query('INSERT INTO admin_account(user_id) VALUES($1) ON CONFLICT DO NOTHING',[id(6)]);
   await c.query("INSERT INTO admin_role(id,key,name) VALUES($1,'reviewed_custom','Reviewed custom')",[custom]);
   await c.query("INSERT INTO admin_user_role(user_id,role_id) SELECT $1,id FROM admin_role WHERE id=$2 OR key='legacy_labeler' ON CONFLICT DO NOTHING",[id(6),custom]);
   await c.query(sql('068_single_role_tiers.sql'));
   const row=(await c.query('SELECT a.role_id,r.tier FROM admin_account a JOIN admin_role r ON r.id=a.role_id WHERE a.user_id=$1',[id(6)])).rows[0];
   assert.equal(row.role_id,custom);assert.equal(row.tier,10);
  }finally{await c.query('ROLLBACK');await c.end();}
 });
 const existingFunctions=new Set((await db.query("SELECT oid::text FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows.map(x=>x.oid));
 await db.query(sql('068_single_role_tiers.sql'));
 await test('068 creation stage has no writable client authority store',async()=>{
  const tables=['admin_user_role','admin_user_role_archive','admin_role_migration_snapshot'];
  for(const table of tables){const acl=(await db.query("SELECT count(*)::int n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=$1::regclass AND a.grantee=0",[table])).rows[0].n;assert.equal(acl,0);}
  if(mode==='cloud')for(const name of tables)await denied(()=>as(id(1),c=>c.query('SELECT * FROM '+name)));
  for(const f of (await db.query("SELECT oid::text,proname FROM pg_proc WHERE pronamespace='public'::regnamespace")).rows.filter(x=>!existingFunctions.has(x.oid))){
   const publicAcl=(await db.query("SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::oid AND a.grantee=0",[f.oid])).rows[0].n;
   assert.equal(publicAcl,0,'PUBLIC cannot execute '+f.proname);
   if(mode==='cloud')for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') allowed",[role,f.oid])).rows[0].allowed,role==='authenticated'&&f.proname==='admin_api',role+' '+f.proname);
  }

 });
 await db.query(sql('069_feature_lifecycle.sql'));
 if(phase==='after')assert.equal((await db.query("SELECT admin_bootstrap($1,'{}','{}') ready",[id(1)])).rows[0].ready,true);
 await test('trusted bootstrap is idempotent and canonical Owner keeps old actual superadmin summary',async()=>{
  await db.query("SELECT admin_bootstrap($1,'{}','{}')",[id(7)]);
  const a=await access(id(1)),superId=(await db.query("SELECT id FROM admin_role WHERE key='super_admin'")).rows[0].id;
  assert.equal(a.role.key,'owner');assert.equal(a.isOwner,true);assert.equal(a.roles.length,1);assert.equal(a.roles[0].id,superId);assert.equal(a.roles[0].key,'super_admin');
  assert.equal((await access(id(7))).isOwner,false);
  if(mode==='cloud')await denied(()=>as(id(7),c=>c.query("SELECT admin_bootstrap($1,'{}','{}')",[id(7)])));
 });
 await test('every account has exactly one role; legacy Deck-E retired; new signup cannot self-claim',async()=>{
  assert.equal((await db.query('SELECT count(*)::int n FROM admin_account')).rows[0].n,7);
  assert.equal((await access(id(2))).role.key,'user');
  await db.query('INSERT INTO app_user(id,username) VALUES($1,$2)',[id(8),'new-user']);
  assert.equal((await access(id(8))).role.key,'user');assert.equal((await access(id(8))).isOwner,false);
  const snap=(await db.query('SELECT prior_roles FROM admin_role_migration_snapshot WHERE user_id=$1',[id(2)])).rows[0].prior_roles;
  if(phase==='before')assert.ok(snap.some(r=>r.key==='legacy_decke'&&r.permissions.includes('decke.use')));
 });
 roles=Object.fromEntries((await call(id(1),'roles')).roles.map(r=>[r.key,r]));
 for(const [n,key] of [[2,'superuser'],[3,'contributor'],[4,'admin'],[5,'super_admin']])await assign(id(1),id(n),key);
 await test('role assignment matrix checks destination and current elevated target, including suspended Owner',async()=>{
  await assign(id(4),id(6),'superuser');await assign(id(4),id(6),'user');
  for(const n of [1,3,4,5])await denied(()=>assign(id(4),id(n),'user'));
  await denied(()=>assign(id(4),id(6),'admin'));
  await denied(()=>assign(id(5),id(1),'user'));await denied(()=>assign(id(5),id(6),'owner'));
  await db.query('UPDATE admin_account SET suspended=true WHERE user_id=$1',[id(1)]);
  await denied(()=>assign(id(5),id(1),'user'));
  await db.query('UPDATE admin_account SET suspended=false WHERE user_id=$1',[id(1)]);
  await denied(()=>call(id(1),'user.roles',{id:id(6),roleIds:[],expectedRevision:1,reason:'No roles forbidden'}),'22023');
  await denied(()=>call(id(1),'user.roles',{id:id(6),roleIds:[roles.user.id,roles.superuser.id],expectedRevision:1,reason:'Union forbidden'}),'22023');
  await denied(()=>assign(id(1),id(6),'superuser',{expectedRoleRevision:0}),'40001');
  await denied(()=>assign(id(1),id(6),'superuser',{expectedRevision:0}),'40001');
 });
 await test('concurrent revisions accept one assignment and queued actions reauthorize after actor demotion',async()=>{
  const u=(await call(id(1),'user',{id:id(6)})).user;
  const payload={id:id(6),roleId:roles.superuser.id,expectedRevision:u.revision,expectedRoleRevision:roles.superuser.revision,reason:'Concurrent revision check'};
  const mutations=await Promise.allSettled([call(id(4),'user.role',payload),call(id(4),'user.role',payload)]);
  assert.equal(mutations.filter(x=>x.status==='fulfilled').length,1);assert.equal(mutations.find(x=>x.status==='rejected').reason.code,'40001');
  await assign(id(1),id(6),'user');
  const current=(await call(id(1),'user',{id:id(6)})).user;
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(741290064)');
  const pending=call(id(4),'user.role',{...payload,expectedRevision:current.revision}).then(value=>({value}),error=>({error}));
  try{
   let waiting=false;for(let n=0;n<100;n++){
    waiting=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND pid<>pg_backend_pid()) yes")).rows[0].yes;
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(waiting,true,'mutation must actually wait on the governance lock');
   await db.query('UPDATE admin_account SET role_id=$1,revision=revision+1 WHERE user_id=$2',[roles.user.id,id(4)]);await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
  const result=await pending;assert.equal(result.error?.code,'42501','queued actor lost role before lock acquisition');
  assert.equal((await access(id(6))).role.key,'user');await assign(id(1),id(4),'admin');
 });
 await test('last Owner and account mutation constraints apply even through legacy endpoints',async()=>{
  const u=(await call(id(1),'user',{id:id(1)})).user;
  await denied(()=>call(id(1),'user.status',{id:id(1),suspended:true,expectedRevision:u.revision,reason:'Last Owner guard'}),'55000');
  await denied(()=>assign(id(1),id(1),'user'),'55000');
  await denied(()=>call(id(5),'user.revoke-tokens',{id:id(1),reason:'Forbidden target'}));
  const member=(await call(id(4),'user',{id:id(6)})).user;
  await call(id(4),'user.status',{id:id(6),suspended:true,expectedRevision:member.revision,reason:'Account suspension'});
  await call(id(4),'user.status',{id:id(6),suspended:false,expectedRevision:member.revision+1,reason:'Account restoration'});
 });
 await test('builtin editable definitions and custom tiers cannot manufacture governance or Contributor admin access',async()=>{
  assert.equal(roles.contributor.canEdit,true);assert.equal(roles.contributor.canDelete,false);assert.equal(roles.owner.canEdit,false);
  for(const permission of ['admin.access','users.manage','credits.manage','roles.manage','scanner.use','decke.use'])await denied(()=>call(id(1),'role.update',{id:roles.contributor.id,name:'Contributor',description:'Tools only',permissions:[permission],expectedRevision:roles.contributor.revision}));
  await denied(()=>call(id(4),'role.create',{name:'Illegal',description:'No authority',permissions:[],tier:10}));
  await denied(()=>call(id(1),'role.create',{name:'Owner spoof',description:'No reserved tier',permissions:[],tier:60}),'22023');
  const custom=(await call(id(1),'role.create',{name:'Custom tool reviewer',description:'Scoped development',permissions:['devtools.access','design.view'],tier:30})).role;
  assert.equal(custom.canEdit,true);assert.equal(custom.canDelete,true);
  await denied(()=>db.query("INSERT INTO admin_role_permission VALUES($1,'users.manage')",[custom.id]));
  await denied(()=>db.query("UPDATE admin_role SET tier=60 WHERE id=$1",[custom.id]));
  await call(id(1),'role.delete',{id:custom.id,expectedRevision:custom.revision});
  const editable=await call(id(1),'role.update',{id:roles.contributor.id,name:'Contributor',description:'Development tools only',permissions:roles.contributor.permissions,expectedRevision:roles.contributor.revision});
  assert.equal(editable.role.revision,roles.contributor.revision+1);assert.equal(editable.role.canEdit,true);assert.equal(editable.role.canDelete,false);roles.contributor=editable.role;
  for(const op of ['users','roles','settings'])await denied(()=>call(id(3),op));
  const a=await access(id(3));assert.ok(a.permissions.includes('devtools.access'));assert.ok(!a.permissions.some(p=>p.startsWith('credits.')||p.startsWith('users.')||p==='admin.access'));
 });
 await test('malformed raw grants cannot bypass structural role or product lifecycle authority',async()=>{
  await db.query('ALTER TABLE admin_role_permission DISABLE TRIGGER admin_role_permission_ceiling');
  try{
   await db.query("INSERT INTO admin_role_permission VALUES($1,'scanner.use'),($1,'decke.use'),($2,'users.manage'),($2,'admin.access'),($2,'credits.manage'),($2,'roles.manage')",[roles.user.id,roles.contributor.id]);
   const user=await access(id(6)),contributor=await access(id(3));
   assert.equal(user.permissions.includes('scanner.use'),false);assert.equal(user.permissions.includes('decke.use'),false);
   assert.equal(contributor.permissions.some(x=>['users.manage','admin.access','credits.manage','roles.manage'].includes(x)),false);
   await denied(()=>call(id(3),'users'));
  }finally{
   await db.query("DELETE FROM admin_role_permission WHERE (role_id=$1 AND permission_key IN('scanner.use','decke.use')) OR (role_id=$2 AND permission_key IN('users.manage','admin.access','credits.manage','roles.manage'))",[roles.user.id,roles.contributor.id]);
   await db.query('ALTER TABLE admin_role_permission ENABLE TRIGGER admin_role_permission_ceiling');
  }
 });
 await test('every lifecycle × tier × opt-in outcome uses one authoritative resolver',async()=>{
  const people=[[id(6),10],[id(2),20],[id(3),30],[id(4),40],[id(5),50],[id(1),60]];
  for(const key of ['scanner','decke'])for(const state of ['released','beta','experimental','disabled']){
   const f=(await features(id(1),'admin.list')).features.find(x=>x.key===key);
   await features(id(1),'admin.update',{key,lifecycle:state,expectedRevision:f.revision,reason:'Lifecycle matrix'});
   for(const [user,tier] of people)for(const opt of [false,true]){
    await db.query('INSERT INTO app_feature_opt_in(user_id,feature_key,opted_in) VALUES($1,$2,$3) ON CONFLICT(user_id,feature_key) DO UPDATE SET opted_in=EXCLUDED.opted_in',[user,key,opt]);
    const a=await access(user),actual=a.features.find(x=>x.key===key),expected=state==='released'||state==='beta'&&opt||state==='experimental'&&(tier>=50||tier>=20&&opt);
    assert.equal(actual.enabled,expected,`${key} ${state} tier${tier} opt${opt}`);assert.equal(a.permissions.includes(key+'.use'),expected);
   }
  }
 });
 await test('self opt-in covers all experiments, beta User and optimistic changes; PAT and fake authority fail',async()=>{
  for(const key of ['scanner','decke']){
   let f=(await features(id(1),'admin.list')).features.find(x=>x.key===key);await features(id(1),'admin.update',{key,lifecycle:'experimental',expectedRevision:f.revision,reason:'Every experiment'});
   f=(await features(id(2),'self.list')).features.find(x=>x.key===key);await features(id(2),'self.update',{key,optedIn:true,expectedRevision:f.revision});
   await denied(()=>features(id(2),'self.update',{key,optedIn:false,expectedRevision:f.revision}),'40001');
   f=(await features(id(6),'self.list')).features.find(x=>x.key===key);await denied(()=>features(id(6),'self.update',{key,optedIn:true,expectedRevision:f.revision}));
  }
  let f=(await features(id(1),'admin.list')).features.find(x=>x.key==='scanner');await features(id(1),'admin.update',{key:'scanner',lifecycle:'beta',expectedRevision:f.revision,reason:'All users beta'});
  f=(await features(id(6),'self.list')).features.find(x=>x.key==='scanner');await features(id(6),'self.update',{key:'scanner',optedIn:true,expectedRevision:f.revision});
  await denied(()=>as(id(1),c=>c.query("SELECT feature_api('admin.list','{}')"),'token'));
  await denied(()=>features(id(3),'admin.list'));
  if(mode==='cloud')for(const table of ['app_feature','app_feature_opt_in'])await denied(()=>as(id(1),c=>c.query('SELECT * FROM '+table)));
 });
 await test('072 scanner voice is a beta every tier must opt into, Owner included, and mints no permission',async()=>{
  for(let run=0;run<2;run++)await db.query(sql('072_scanner_voice_feature.sql'));
  assert.equal((await db.query("SELECT count(*)::int n FROM app_feature WHERE key='scanner_voice'")).rows[0].n,1);
  for(const [user,tier] of [[id(1),60],[id(5),50],[id(6),10]]){
   const a=await access(user),f=a.features.find(x=>x.key==='scanner_voice');
   assert.deepEqual([f.lifecycle,f.eligible,f.enabled,f.optedIn,f.reason],['beta',true,false,false,'opt_in_required'],'tier'+tier);
   assert.ok(!a.permissions.includes('scanner_voice.use'));
  }
  let f=(await features(id(1),'self.list')).features.find(x=>x.key==='scanner_voice');
  f=(await features(id(1),'self.update',{key:'scanner_voice',optedIn:true,expectedRevision:f.revision})).features.find(x=>x.key==='scanner_voice');
  assert.deepEqual([f.enabled,f.reason],[true,'opted_in']);
  await features(id(1),'self.update',{key:'scanner_voice',optedIn:false,expectedRevision:f.revision});
  assert.equal((await access(id(1))).features.find(x=>x.key==='scanner_voice').enabled,false);
 });
 if(mode!=='legacy-self-host')await test('disabled Deck-E rejects old reserve/start/checkout SQL for Owner too',async()=>{
  await db.query('SELECT credit_policy_initialize(true)');
  await db.query("SELECT credit_apply_delta($1,100,'grant','Lifecycle fixture funding','lifecycle-fixture-funding')",[id(1)]);
  const policy=(await db.query('SELECT credit_policy_read() p')).rows[0].p;
  const spend=(await db.query('SELECT credit_spend_create($1,$2,$3,$4,$5) s',[id(1),'chatTurn',policy.revision,'lifecycle-spend-'+phase,'a'.repeat(64)])).rows[0].s;
  let f=(await features(id(1),'admin.list')).features.find(x=>x.key==='decke');await features(id(1),'admin.update',{key:'decke',lifecycle:'disabled',expectedRevision:f.revision,reason:'Immediate kill switch'});
  await denied(()=>db.query('SELECT credit_spend_create($1,$2,$3,$4,$5)',[id(1),'chatTurn',policy.revision,'disabled-new-'+phase,'b'.repeat(64)]));
  await denied(()=>db.query('SELECT credit_spend_start($1,$2)',[id(1),spend.spendId]));
  await denied(()=>as(id(1),c=>c.query('SELECT credit_order_create($1,$2)',[null,'disabled-checkout'])));
 });
 await test('real feature and singular-role HTTP routes validate bodies, sessions, revisions and committed responses',async()=>{
  const {default:express}=await import('express');const database=await import('../db.ts');apiDatabase=database;
  const {adminRouter}=await import('../routes/admin.ts');const {meFeatureRouter,adminFeatureRouter}=await import('../routes/features.ts');
  const {errorMiddleware}=await import('../http.ts');const {requestAccessStore}=await import('../admin/access.ts');
  const app=express();app.use(express.json());
  app.use(async(req,res,next)=>{
   const user=String(req.headers['x-fixture-user']??id(1)),kind=String(req.headers['x-fixture-kind']??(mode==='cloud'?'jwt':'local'));
   req.user={id:user};req.authKind=kind;
   const c=await database.pool.connect();await c.query('BEGIN');
   await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:mode==='cloud'?'authenticated':'local',deckpal_auth_kind:kind})]);
   if(mode==='cloud')await c.query('SET LOCAL ROLE authenticated');
   let released=false;const cleanup=async()=>{if(released)return;released=true;try{await c.query('ROLLBACK; RESET ROLE');c.release();}catch{c.release(true);}};
   res.once('finish',cleanup);res.once('close',cleanup);database.rlsStore.run(c,()=>requestAccessStore.run(new Map(),next));
  });
  const {deckeHistoryRouter}=await import('../routes/deckeHistory.ts');
  const {selfSharingRouter,adminUsageRouter}=await import('../decke/usageRoutes.ts');
  app.use('/decke',deckeHistoryRouter);app.use('/me/decke-sharing',selfSharingRouter);app.use('/admin/ai-usage',adminUsageRouter);
  app.use('/me/features',meFeatureRouter);app.use('/admin/features',adminFeatureRouter);app.use('/admin',adminRouter);app.use(errorMiddleware);
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  httpServer=server;
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,options={})=>fetch(base+path,{signal:AbortSignal.timeout(10000),...options});
  httpApi=request;
  const patch=(path,body,headers={})=>request(path,{method:'PATCH',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  try{
   const list=await request('/admin/features');assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'no-store');
   const initial=(await list.json()).features.find(x=>x.key==='scanner');
   const saved=await patch('/admin/features/scanner',{lifecycle:'beta',expectedRevision:initial.revision,reason:'HTTP feature lifecycle'});assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');
   assert.equal((await db.query("SELECT lifecycle FROM app_feature WHERE key='scanner'")).rows[0].lifecycle,'beta','successful response follows commit');
   assert.equal((await patch('/admin/features/scanner',{lifecycle:'released',expectedRevision:initial.revision,reason:'Stale lifecycle'})).status,409);
   for(const body of [{optedIn:true,expectedRevision:0},{optedIn:true,expectedRevision:'1'},{optedIn:true,expectedRevision:1,role:'owner'},[]])assert.equal((await patch('/me/features/scanner',body)).status,400);
   assert.equal((await request('/me/features',{headers:{'x-fixture-kind':'token'}})).status,403);
   assert.equal((await request('/admin/features',{headers:{'x-fixture-user':id(3)}})).status,403);
   const pref=(await (await request('/me/features',{headers:{'x-fixture-user':id(6)}})).json()).features.find(x=>x.key==='scanner');
   const opted=await patch('/me/features/scanner',{optedIn:true,expectedRevision:pref.revision},{'x-fixture-user':id(6)});assert.equal(opted.status,200);assert.equal((await opted.json()).features.find(x=>x.key==='scanner').enabled,true);
   const target=(await (await request('/admin/users/'+id(6))).json()).user;
   assert.ok(target.role.id);assert.equal(target.roles.length,1);assert.ok(target.actions.assignableRoleIds.includes(roles.superuser.id));
   const assigned=await request('/admin/users/'+id(6)+'/role',{method:'PUT',headers:{'content-type':'application/json','x-fixture-user':id(4)},body:JSON.stringify({roleId:roles.superuser.id,expectedRevision:target.revision,expectedRoleRevision:roles.superuser.revision,reason:'HTTP single role assignment'})});
   assert.equal(assigned.status,200);assert.equal((await assigned.json()).user.role.key,'superuser');assert.equal((await access(id(6))).role.key,'superuser');
   assert.equal((await request('/admin/users/'+id(6)+'/roles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({roleIds:[],expectedRevision:target.revision+1,reason:'No role forbidden'})})).status,400);
  }finally{/* The same guarded fixture server continues into usage/history HTTP checks. */}
 });
 if(mode!=='legacy-self-host'){
  for(const name of ['070_credit_user_overrides.sql','071_decke_usage.sql'])await db.query(sql(name));
  const {runUsageContracts}=await import('./usage.mjs');
  await runUsageContracts({db,as:(user,fn,options={})=>as(user,fn,options.kind),test,id,mode,api:httpApi,connect:async()=>{const c=new pg.Client(config);await c.connect();return c;}});
 }
 results.status='passed';
}catch(e){results.status='failed';results.error=e.stack;throw e;}finally{if(httpServer)await new Promise(resolve=>httpServer.close(resolve));if(apiDatabase)await apiDatabase.pool.end();await db.end();writeFileSync(process.env.DECKPAL_TEST_RESULT,JSON.stringify(results,null,2)+'\n');}
