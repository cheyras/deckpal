import assert from 'node:assert/strict';
import { readFileSync,realpathSync,writeFileSync,existsSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../../../..');
const root=process.env.DECKPAL_TEST_ROOT,mode=process.env.DECKPAL_TEST_ADMIN_MODE;
assert.ok(root&&/^\/tmp\/deckpal-db-[^/]+$/.test(root));
assert.equal(realpathSync(root),root);
assert.equal(readFileSync(join(root,'.deckpal-ci-owner'),'utf8'),process.env.DECKPAL_TEST_MARKER);
assert.equal(process.env.PGHOST,join(root,'socket'));
assert.equal(process.env.PGPORT,'55432');
assert.equal(process.env.PGUSER,'deckpal_ci_fixture');
assert.equal(process.env.PGDATABASE,mode==='cloud'?'deckpal_ci_admin_test':mode==='self-host'?'deckpal_ci_selfhost_test':'deckpal_ci_legacy_test');
assert.equal(dirname(process.env.DECKPAL_TEST_RESULT),root);
assert.equal(existsSync(join(repo,'.env')),false);
assert.equal(process.env.DATABASE_URL,undefined);
assert.ok(!Object.keys(process.env).some(k=>/^SUPABASE/.test(k)));
const config={host:join(root,'socket'),port:55432,user:'deckpal_ci_fixture',database:process.env.PGDATABASE,ssl:false,connectionTimeoutMillis:5000};
const db=new pg.Client(config);
const results={name:'admin-'+mode,status:'running',cases:[]};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function test(name,fn){await fn();results.cases.push({name,status:'passed'});console.log('PASS '+name);}
async function creationObjects(){
 return (await db.query(`
  SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'table' END kind,
   c.oid::text oid,c.oid::regclass::text name
  FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','S')
  UNION ALL
  SELECT 'function',p.oid::text,p.oid::regprocedure::text
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 `)).rows;
}
async function assertCreationPrivileges(name,created){
 const expected=name.startsWith('064')?{table:8,sequence:1,function:17}:{table:7,sequence:1,function:10};
 const counts={table:0,sequence:0,function:0};
 for(const object of created) counts[object.kind]++;
 assert.deepEqual(counts,expected,'all objects introduced by the actual migration are checked');
 const webRoles=(await db.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows.map(r=>r.rolname);
 const checkers={table:['has_table_privilege','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'],sequence:['has_sequence_privilege','USAGE,SELECT,UPDATE'],function:['has_function_privilege','EXECUTE']};
 let deniedChecks=0;
 for(const object of created){
  const [checker,privileges]=checkers[object.kind];
  for(const role of webRoles){
   const value=(await db.query('SELECT '+checker+'($1,$2::oid,$3) allowed',[role,object.oid,privileges])).rows[0].allowed;
   assert.equal(value,false,name+' must not leave '+role+' access to '+object.name+' before its security migration');
   deniedChecks++;
  }
  // Also prove PUBLIC itself is closed when no cloud roles exist. Expanding
  // acldefault covers implicit EXECUTE, not merely explicit ACL entries.
  const publicAcl=object.kind==='function'
   ? await db.query("SELECT a.privilege_type FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::oid AND a.grantee=0",[object.oid])
   : await db.query("SELECT a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a WHERE c.oid=$1::oid AND a.grantee=0",[object.oid]);
  assert.equal(publicAcl.rowCount,0,name+' must remove inherited PUBLIC access to '+object.name);
  const owner=(await db.query('SELECT '+checker+'(current_user,$1::oid,$2) allowed',[object.oid,privileges])).rows[0].allowed;
  assert.equal(owner,true,'trusted creator retains operation of '+object.name);
 }
 results.creationStages??=[];
 results.creationStages.push({migration:name,objects:counts,webRoles,deniedChecks,publicAclClosed:true,creatorRetained:true});
}
async function migration(name){
 const creation=name==='064_admin_core.sql'||name==='066_credit_economy.sql';
 const before=creation?new Set((await creationObjects()).map(o=>o.kind+':'+o.oid)):null;
 // Each original migration is its own committed query, like migrateUp's
 // per-file transaction; assertions run before the next numbered file.
 await db.query(readFileSync(join(repo,'packages/db/src/migrations',name),'utf8'));
 if(creation){
  const created=(await creationObjects()).filter(o=>!before.has(o.kind+':'+o.oid));
  await test(name.slice(0,3)+' creation-stage table sequence and function ACLs are closed before later grants',()=>assertCreationPrivileges(name,created));
 }
}
async function as(user,fn,{kind='jwt',role='authenticated',direct=false}={}){
 const c=new pg.Client(config);await c.connect();
 try{
  await c.query('BEGIN');
  const claims=direct?{sub:user,role,session_id:user}:{sub:user,role,deckpal_auth_kind:kind};
  await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
  if(role!=='none') await c.query('SET LOCAL ROLE '+role);
  const value=await fn(c);await c.query('COMMIT');return value;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
}
const api=(user,op,p={},options)=>as(user,async c=>(await c.query('SELECT public.admin_api($1,$2::jsonb) AS result',[op,JSON.stringify(p)])).rows[0].result,options);
const code=(expected)=>e=>{assert.equal(e.code,expected,e.message);return true;};
async function denied(fn,expected='42501'){await assert.rejects(fn,code(expected));}
let superId,readRole,managerRole;
try{
 await db.connect();
 const identity=(await db.query("SELECT current_database() db,current_user role,inet_server_addr() tcp,current_setting('data_directory') data,current_setting('unix_socket_directories') socket,current_setting('listen_addresses') listen,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super")).rows[0];
 assert.equal(identity.db,config.database);assert.equal(identity.role,config.user);assert.equal(identity.super,false);assert.equal(identity.tcp,null);assert.equal(realpathSync(identity.data),join(root,'data'));assert.equal(identity.socket,join(root,'socket'));assert.equal(identity.listen,'');
 if(mode==='legacy-self-host'){
  await db.query("CREATE TABLE app_user(id bigint PRIMARY KEY,username text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO app_user VALUES(1,'local-owner',now()),(2,'local-member',now()); CREATE TABLE api_token(id text,user_id bigint,revoked_at timestamptz);");
  await migration('064_admin_core.sql');
  await test('bigint self-host bootstrap and governance require no auth schema',async()=>{
   assert.equal((await db.query("SELECT admin_bootstrap('1','{}','{}') ready")).rows[0].ready,true);
   const result=await api('1','roles',{}, {kind:'local',role:'none'});
   assert.equal(result.roles.find(r=>r.key==='super_admin').memberCount,1);
   const changed=await api('1','settings.update',{settings:{skin:'classic',topbar:'flat'},expectedRevision:1},{kind:'local',role:'none'});
   assert.equal(changed.settings.skin,'classic');
   await denied(()=>api('2','users',{}, {kind:'local',role:'none'}));
  });
 }else if(mode==='self-host'){
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")).rows[0].n,0);
  await db.query("CREATE TABLE app_user(id uuid PRIMARY KEY,username text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()); INSERT INTO app_user(id,username) SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'user-'||i FROM generate_series(1,7)i;");
  for(const name of ['041_decke_credits.sql','053_billing.sql','055_billing_ab.sql','057_billing_one_time.sql','061_billing_ab_dedupe.sql','063_billing_event_processed.sql','064_admin_core.sql','066_credit_economy.sql']) await migration(name);
  const security=readFileSync(join(repo,'packages/db/src/migrations/067_credit_economy_security.sql'),'utf8');
  if(!security.includes('-- @supabase-only')) await migration('067_credit_economy_security.sql');
  await test('current UUID self-host initialization without cloud roles or auth schema',async()=>{
   await db.query("SELECT admin_bootstrap($1,'{}','{}')",[id(1)]);
   await db.query('SELECT credit_policy_initialize(true)');
   const changed=await api(id(1),'settings.update',{settings:{skin:'classic',topbar:'flat'},expectedRevision:1},{kind:'local',role:'none'});
   assert.equal(changed.settings.topbar,'flat');
  });
  await test('current self-host credit settings wallet and metered spend',async()=>{
   const local={kind:'local',role:'none'};
   const policy=(await as(id(1),c=>c.query('SELECT credit_policy_admin_read() policy'),local)).rows[0].policy;
   assert.equal(policy.policy.enabled,true);
   await as(id(1),c=>c.query('SELECT credit_adjust($1,100,$2,$3)',[id(1),'Self-host initial credits','selfhost-grant-1']),local);
   assert.equal((await as(id(1),c=>c.query('SELECT credit_wallet_read(NULL) wallet'),local)).rows[0].wallet.balance,100);
   const spent=(await db.query('SELECT credit_spend_create($1,$2,$3,$4,$5) spent',[id(1),'chatTurn',policy.revision,'selfhost-chat-request','a'.repeat(64)])).rows[0].spent;
   assert.equal(spent.allowed,true);
   assert.equal((await as(id(1),c=>c.query('SELECT credit_wallet_read(NULL) wallet'),local)).rows[0].wallet.balance,99);
  });
 }else{
  await db.query(readFileSync(join(here,'admin-fixture.sql'),'utf8'));
  await test('disposable cloud fixture includes direct web defaults and inherited PUBLIC execute',async()=>{
   const defaults=(await db.query("SELECT d.defaclobjtype kind,a.grantee,a.privilege_type,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END principal FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace='public'::regnamespace")).rows;
   for(const principal of ['anon','authenticated']){
    for(const [kind,privilege] of [['r','SELECT'],['S','USAGE'],['f','EXECUTE']]){
     assert.ok(defaults.some(d=>d.kind===kind&&d.principal===principal&&d.privilege_type===privilege),'fixture must exercise '+principal+' default '+privilege);
    }
   }
   // Function PUBLIC EXECUTE can be implicit or explicit. The built-in default
   // is verified in metadata without creating or invoking a financial helper.
   assert.ok((await db.query("SELECT EXISTS(SELECT 1 FROM aclexplode(acldefault('f',(SELECT oid FROM pg_roles WHERE rolname=current_user))) a WHERE a.grantee=0 AND privilege_type='EXECUTE') allowed")).rows[0].allowed);
  });
  for(const name of ['026_api_token.sql','027_api_token_rls.sql','031_oauth_client.sql','032_oauth_code.sql','033_oauth_rls.sql','041_decke_credits.sql','042_decke_credits_rls.sql','053_billing.sql','054_billing_rls.sql','055_billing_ab.sql','056_billing_ab_rls.sql','057_billing_one_time.sql','058_billing_ab_amount_cap.sql','059_billing_customer_pin.sql','060_billing_release_customer.sql','061_billing_ab_dedupe.sql','062_billing_ab_event_guard.sql','063_billing_event_processed.sql','064_admin_core.sql','065_admin_security.sql']) await migration(name);
  await test('missing owner is atomic and trusted bootstrap runs exactly once',async()=>{
   assert.equal((await db.query("SELECT admin_bootstrap(NULL,'{}','{}') ready")).rows[0].ready,false);
   assert.equal((await db.query('SELECT count(*)::int n FROM admin_audit')).rows[0].n,0);
   assert.equal((await db.query("SELECT admin_bootstrap($1,ARRAY[$2],ARRAY[$2]) ready",[id(1),id(5)])).rows[0].ready,true);
   await db.query("SELECT admin_bootstrap($1,ARRAY[$2],ARRAY[$2])",[id(2),id(7)]);
   superId=(await db.query("SELECT id FROM admin_role WHERE key='super_admin'")).rows[0].id;
   assert.equal((await db.query("SELECT count(*)::int n FROM admin_user_role WHERE user_id=$1",[id(2)])).rows[0].n,0);
   await denied(()=>as(id(1),c=>c.query("SELECT admin_bootstrap($1,'{}','{}')",[id(1)])));
  });
  await test('anonymous ordinary PAT and forged direct sessions cannot administer',async()=>{
   await denied(()=>api(id(4),'users'));
   await denied(()=>api(id(1),'users',{}, {kind:'token'}));
   await denied(()=>api(id(1),'users',{}, {role:'anon'}));
   await denied(()=>as(id(1),async c=>{await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(1),session_id:id(7)})]);return c.query("SELECT admin_api('users')");}));
   const direct=await api(id(1),'users',{}, {direct:true});assert.equal(direct.total,7);
  });
  await test('governance tables and internal projections are not direct APIs',async()=>{
   for(const table of ['admin_account','admin_user_role','admin_role','admin_role_permission','admin_audit','admin_state']){
    await denied(()=>as(id(1),c=>c.query('SELECT * FROM public.'+table)));
   }
   await denied(()=>as(id(1),c=>c.query('SELECT admin_user_projection($1)',[id(4)])));
   await denied(()=>as(id(1),c=>c.query('SELECT admin_permissions($1)',[id(4)])));
   await denied(()=>as(id(1),c=>c.query('SELECT admin_access($1)',[id(4)])));
  });
  await test('directory is bounded filtered and contains only safe identity fields',async()=>{
   const result=await api(id(1),'users',{search:'user-4',limit:1,offset:0});assert.equal(result.total,1);assert.equal(result.users[0].id,id(4));
   assert.equal(result.users[0].email,'user-4@example.invalid');
   assert.ok(!JSON.stringify(result).includes('secret-hash'));assert.ok(!JSON.stringify(result).includes('must-never-return'));
   const empty=await api(id(1),'users',{offset:99,limit:2});assert.equal(empty.total,7);assert.deepEqual(empty.users,[]);
  });
  await test('custom role CRUD union assignments and stale edit conflicts',async()=>{
   readRole=(await api(id(1),'role.create',{name:'Reader',description:'Directory only',permissions:['admin.access','users.read']})).role;
   managerRole=(await api(id(1),'role.create',{name:'Role manager',description:'Limited delegation',permissions:['admin.access','roles.read','roles.manage']})).role;
   await api(id(1),'user.roles',{id:id(3),roleIds:[managerRole.id],expectedRevision:1,reason:'Assign role manager'});
   await api(id(1),'user.roles',{id:id(4),roleIds:[readRole.id],expectedRevision:1,reason:'Assign read only'});
   assert.equal((await api(id(4),'users')).total,7);
   await denied(()=>api(id(4),'settings'));
   const updated=await api(id(1),'role.update',{id:readRole.id,name:'Reader renamed',description:'Directory only',permissions:['admin.access','users.read'],expectedRevision:1});assert.equal(updated.role.revision,2);
   await denied(()=>api(id(1),'role.update',{id:readRole.id,name:'Stale',description:'',permissions:[],expectedRevision:1}),'40001');
   await denied(()=>api(id(1),'role.delete',{id:readRole.id,expectedRevision:2}),'55000');
  });
  await test('anti escalation immutable superadmin and inherited authority checks',async()=>{
   await denied(()=>api(id(3),'role.create',{name:'Escalated',description:'',permissions:['admin.access','credits.manage']}));
   await denied(()=>api(id(3),'user.roles',{id:id(7),roleIds:[superId],expectedRevision:1,reason:'Try granting admin'}));
   await denied(()=>api(id(3),'user.roles',{id:id(1),roleIds:[],expectedRevision:1,reason:'Try stripping admin'}));
   await denied(()=>api(id(1),'role.update',{id:superId,name:'Changed',description:'',permissions:[],expectedRevision:1}));
   await denied(()=>api(id(1),'user.roles',{id:id(1),roleIds:[],expectedRevision:1,reason:'Cannot lose last admin'}),'55000');
  });
  await test('last active admin is protected under concurrent self demotions',async()=>{
   await api(id(1),'user.roles',{id:id(2),roleIds:[superId],expectedRevision:1,reason:'Add second administrator'});
   const before=(await db.query('SELECT count(*)::int n FROM admin_audit')).rows[0].n;
   const outcomes=await Promise.allSettled([
    api(id(1),'user.roles',{id:id(1),roleIds:[],expectedRevision:1,reason:'Step down first'}),
    api(id(2),'user.roles',{id:id(2),roleIds:[],expectedRevision:2,reason:'Step down second'}),
   ]);
   assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
   assert.equal((await db.query("SELECT count(*)::int n FROM admin_user_role WHERE role_id=$1",[superId])).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int n FROM admin_audit')).rows[0].n,before+1,'failed mutation audit rolls back');
   // Restore the primary synthetic owner as sole admin for remaining checks.
   await db.query("INSERT INTO admin_user_role(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id(1),superId]);
   await db.query("DELETE FROM admin_user_role WHERE user_id=$1 AND role_id=$2",[id(2),superId]);
  });
  await test('orphaned admin membership cannot satisfy the last active admin rule',async()=>{
   await db.query('INSERT INTO admin_account(user_id) VALUES($1)',[id(99)]);
   await db.query('INSERT INTO admin_user_role(user_id,role_id) VALUES($1,$2)',[id(99),superId]);
   const rev=(await db.query('SELECT revision FROM admin_account WHERE user_id=$1',[id(1)])).rows[0].revision;
   await denied(()=>api(id(1),'user.status',{id:id(1),suspended:true,expectedRevision:rev,reason:'Must retain real admin'}),'55000');
   await db.query('DELETE FROM admin_account WHERE user_id=$1',[id(99)]);
  });
  await test('revocation immediately changes old JWT authority and invalidates outstanding OAuth codes',async()=>{
   await db.query("INSERT INTO oauth_client(client_id,client_name,redirect_uris) VALUES('client','Fixture',ARRAY['https://example.invalid/callback'])");
   await db.query("INSERT INTO oauth_code(code,client_id,user_id,redirect_uri,code_challenge,code_challenge_method,expires_at) VALUES('pending','client',$1,'https://example.invalid/callback','challenge','S256',now()+interval '5 minutes')",[id(4)]);
   await db.query("INSERT INTO api_token(user_id,name,token_hash,prefix) VALUES($1,'connector','hash','dsk_fixture')",[id(4)]);
   await api(id(1),'user.revoke-tokens',{id:id(4),reason:'Disconnect all clients'});
   assert.ok((await db.query("SELECT used_at FROM oauth_code WHERE code='pending'")).rows[0].used_at);
   assert.ok((await db.query("SELECT revoked_at FROM api_token WHERE user_id=$1",[id(4)])).rows[0].revoked_at);
   const rev=(await db.query('SELECT revision FROM admin_account WHERE user_id=$1',[id(4)])).rows[0].revision;
   await api(id(1),'user.roles',{id:id(4),roleIds:[],expectedRevision:rev,reason:'Remove directory access'});
   await denied(()=>api(id(4),'users',{}, {direct:true}));
  });
  await test('suspension blocks direct RLS and legacy definer RPCs but trusted reconciliation works',async()=>{
   const rev=(await db.query('SELECT revision FROM admin_account WHERE user_id=$1',[id(4)])).rows[0].revision;
   await api(id(1),'user.status',{id:id(4),suspended:true,expectedRevision:rev,reason:'Suspend synthetic account'});
   const rows=await as(id(4),c=>c.query('SELECT * FROM collection_item'));assert.equal(rows.rowCount,0);
   await denied(()=>as(id(4),c=>c.query('INSERT INTO collection_item(user_id) VALUES($1)',[id(4)])));
   await denied(()=>as(id(4),c=>c.query('SELECT billing_touch_visit()')));
   await db.query('UPDATE billing_account SET visit_count=visit_count+1 WHERE user_id=$1',[id(4)]);
   await api(id(1),'user.status',{id:id(4),suspended:false,expectedRevision:rev+1,reason:'Restore synthetic account'});
   assert.equal((await as(id(4),c=>c.query('SELECT * FROM collection_item'))).rowCount,1);
  });
  await test('hostile temporary shadow relations do not affect privileged reads',async()=>{
   await as(id(1),async c=>{
    await c.query("CREATE TEMP TABLE admin_role(id uuid,key text,name text); CREATE TEMP TABLE admin_account(user_id text,suspended boolean); CREATE TEMP TABLE app_user(id uuid,username text);");
    const result=(await c.query("SELECT public.admin_api('roles') result")).rows[0].result;
    assert.ok(result.roles.some(r=>r.key==='super_admin'));
   });
  });
  await test('defaults updates are validated versioned audited and publicly safe',async()=>{
   const changed=await api(id(1),'settings.update',{settings:{skin:'classic',topbar:'flat'},expectedRevision:1});
   assert.equal(changed.revision,2);
   assert.deepEqual((await as(null,c=>c.query('SELECT admin_public_defaults() defaults'),{role:'anon'})).rows[0].defaults,{skin:'classic',topbar:'flat'});
   await denied(()=>api(id(1),'settings.update',{settings:{skin:'premium',topbar:'cover'},expectedRevision:1}),'40001');
   await denied(()=>api(id(1),'settings.update',{settings:{skin:'classic',topbar:'flat',other:1},expectedRevision:2}),'22023');
   const audit=await api(id(1),'audit',{action:'settings.update',limit:1});assert.equal(audit.total,1);assert.equal(audit.events[0].after.settings.skin,'classic');
  });
  await test('direct token mint and administrator revoke serialize through commit',async()=>{
   let announce,release,rejectReady;
   const ready=new Promise((resolve,reject)=>{announce=resolve;rejectReady=reject;});
   const proceed=new Promise(resolve=>{release=resolve;});
   const mint=as(id(7),async c=>{
    await c.query("INSERT INTO api_token(user_id,name,token_hash,prefix) VALUES($1,'Direct concurrent token','admin-mint-revoke-race','dsk_race')",[id(7)]);
    announce();await proceed;
   });
   mint.catch(rejectReady);
   let revoke;
   try{
    await ready;
    revoke=api(id(1),'user.revoke-tokens',{id:id(7),reason:'Disconnect while manual insert awaits commit'});
    let waiting=false;
    for(let i=0;i<100&&!waiting;i++){
     await db.query('SELECT pg_stat_clear_snapshot()');
     waiting=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory') waiting")).rows[0].waiting;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'revocation waits for the in-flight token INSERT transaction');
   }finally{release();await mint;}
   await revoke;
   const row=(await db.query("SELECT revoked_at FROM api_token WHERE token_hash='admin-mint-revoke-race'")).rows[0];
   assert.ok(row.revoked_at,'revocation sees the row after mint commits');
  });
  await test('direct token insert queued behind suspension rechecks active account after lock',async()=>{
   const rev=(await api(id(1),'user',{id:id(7)})).user.revision;
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(741290064)');
   const mint=as(id(7),c=>c.query("INSERT INTO api_token(user_id,name,token_hash,prefix) VALUES($1,'Queued after suspension','admin-mint-suspend-race','dsk_race')",[id(7)]));
   const result=mint.then(value=>({value}),error=>({error}));
   try{
    let waiting=false;
    for(let i=0;i<100&&!waiting;i++){
     await db.query('SELECT pg_stat_clear_snapshot()');
     waiting=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory') waiting")).rows[0].waiting;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'INSERT reached the governance lock');
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(1),role:'authenticated',deckpal_auth_kind:'jwt'})]);
    await db.query("SELECT admin_api('user.status',$1)",[JSON.stringify({id:id(7),suspended:true,expectedRevision:rev,reason:'Suspend while direct token mint is queued'})]);
    await db.query('COMMIT');
    assert.equal((await result).error?.code,'42501');
    assert.equal((await db.query("SELECT count(*)::int n FROM api_token WHERE token_hash='admin-mint-suspend-race'")).rows[0].n,0);
   }finally{await db.query('ROLLBACK');}
   await api(id(1),'user.status',{id:id(7),suspended:false,expectedRevision:rev+1,reason:'Restore synthetic account after race'});
  });
  await test('real Express admin routes enforce sessions revisions no-store and committed responses',async()=>{
   const {default:express}=await import('express');
   const database=await import('../db.ts');
   const {adminRouter}=await import('../routes/admin.ts');
   const {oauthRouter}=await import('../routes/oauth.ts');
   const {tokensRouter}=await import('../routes/tokens.ts');
   const {requireSession}=await import('../auth.ts');
   const {mountOAuthServer}=await import('../oauthServer.ts');
   const {errorMiddleware}=await import('../http.ts');
   const {requestAccessStore}=await import('../admin/access.ts');
   const {createHash}=await import('node:crypto');
   const app=express();app.use(express.json());
   mountOAuthServer(app);
   app.use(async(req,res,next)=>{
    const user=String(req.headers['x-fixture-user']??id(1));
    const kind=String(req.headers['x-fixture-kind']??'jwt');
    req.user={id:user};req.authKind=kind;
    const c=await database.pool.connect();
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated',deckpal_auth_kind:kind})]);
    await c.query('SET LOCAL ROLE authenticated');
    let released=false;
    const cleanup=async()=>{
     if(released)return;released=true;
     try{await c.query('ROLLBACK; RESET ROLE');c.release();}catch{c.release(true);}
    };
    res.once('finish',cleanup);res.once('close',cleanup);
    database.rlsStore.run(c,()=>requestAccessStore.run(new Map(),next));
   });
   app.use('/admin',adminRouter);app.use('/oauth',oauthRouter);app.use('/tokens',requireSession,tokensRouter);app.use(errorMiddleware);
   const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
   const base='http://127.0.0.1:'+server.address().port;
   const request=(path,options={})=>fetch(base+path,{signal:AbortSignal.timeout(10000),...options});
   try{
    const roles=await request('/admin/roles');assert.equal(roles.status,200);assert.equal(roles.headers.get('cache-control'),'no-store');
    const pat=await request('/admin/users',{headers:{'x-fixture-kind':'token'}});assert.equal(pat.status,403);
    // Exercise the browser's initial query through the actual HTTP parser and SQL.
    for(const filter of ['', '&status=all', '&status=active', '&status=suspended']){
     const users=await request('/admin/users?search=&role=&offset=0&limit=25'+filter);
     assert.equal(users.status,200,'accepted Users status filter '+filter);
     const list=await users.json();
     assert.equal(list.total,filter==='&status=suspended'?0:7);
     assert.equal(list.users.length,list.total);
    }
    for(const invalid of ['', 'unknown']){
     const users=await request('/admin/users?status='+invalid);
     assert.equal(users.status,400,'reject invalid Users status '+JSON.stringify(invalid));
    }
    const update=await request('/admin/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{skin:'premium',topbar:'cover'},expectedRevision:2})});
    assert.equal(update.status,200,await update.text());
    assert.equal((await db.query('SELECT revision FROM admin_app_settings')).rows[0].revision,3,'mutation committed before successful HTTP response');
    const stale=await request('/admin/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({settings:{skin:'classic',topbar:'flat'},expectedRevision:2})});assert.equal(stale.status,409);
    const bad=await request('/admin/roles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Injected',description:'',permissions:[],protected:true})});assert.equal(bad.status,400);
    const manual=await request('/tokens',{method:'POST',headers:{'content-type':'application/json','x-fixture-user':id(7)},body:JSON.stringify({name:'Committed manual token'})});
    assert.equal(manual.status,201);assert.equal(manual.headers.get('cache-control'),'no-store');
    const minted=await manual.json();
    assert.match(minted.secret,/^dsk_/);
    assert.equal((await db.query('SELECT count(*)::int n FROM api_token WHERE id=$1 AND token_hash=$2',[minted.token.id,createHash('sha256').update(minted.secret).digest('hex')])).rows[0].n,1,'manual token is durably visible before HTTP201');
    const tokenPat=await request('/tokens',{method:'POST',headers:{'content-type':'application/json','x-fixture-kind':'token'},body:JSON.stringify({name:'PAT must not mint'})});assert.equal(tokenPat.status,403);
    await db.query(`CREATE FUNCTION public.fixture_token_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN IF NEW.name='Reject at commit' THEN RAISE EXCEPTION 'fixture deferred token commit failure'; END IF; RETURN NEW; END $fn$;
     CREATE CONSTRAINT TRIGGER fixture_token_commit_failure AFTER INSERT ON api_token DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fixture_token_commit_failure();`);
    try{
     const failed=await request('/tokens',{method:'POST',headers:{'content-type':'application/json','x-fixture-user':id(7)},body:JSON.stringify({name:'Reject at commit'})});
     assert.equal(failed.status,500);
     const failure=await failed.json();assert.equal(failure.secret,undefined);assert.equal(failure.token,undefined);
     assert.equal((await db.query("SELECT count(*)::int n FROM api_token WHERE name='Reject at commit'")).rows[0].n,0);
    }finally{await db.query('DROP TRIGGER fixture_token_commit_failure ON api_token; DROP FUNCTION public.fixture_token_commit_failure()');}
    const tokenRev=(await api(id(1),'user',{id:id(7)})).user.revision;
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(741290064)');
    const queuedManual=request('/tokens',{method:'POST',headers:{'content-type':'application/json','x-fixture-user':id(7)},body:JSON.stringify({name:'HTTP mint queued before suspension'})});
    try{
     let waits=false;
     for(let i=0;i<100&&!waits;i++){
      await db.query('SELECT pg_stat_clear_snapshot()');
      waits=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory') waiting")).rows[0].waiting;
      if(!waits)await new Promise(resolve=>setTimeout(resolve,10));
     }
     assert.ok(waits,'real POST /tokens waits on governance');
     await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(1),role:'authenticated',deckpal_auth_kind:'jwt'})]);
     await db.query("SELECT admin_api('user.status',$1)",[JSON.stringify({id:id(7),suspended:true,expectedRevision:tokenRev,reason:'Suspend while HTTP mint is queued'})]);
     await db.query('COMMIT');
     const refused=await queuedManual;assert.equal(refused.status,403);
     assert.equal((await refused.json()).secret,undefined);
    }finally{await db.query('ROLLBACK');}
    await api(id(1),'user.status',{id:id(7),suspended:false,expectedRevision:tokenRev+1,reason:'Restore after HTTP suspension race'});
    const verifier='x'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
    const consent=await request('/oauth/authorize/decision',{method:'POST',headers:{'content-type':'application/json','x-fixture-user':id(4)},body:JSON.stringify({decision:'allow',clientId:'client',redirectUri:'https://example.invalid/callback',responseType:'code',codeChallenge:challenge,codeChallengeMethod:'S256'})});
    assert.equal(consent.status,200);const authCode=new URL((await consent.json()).redirectTo).searchParams.get('code');assert.ok(authCode);
    // Deterministically queue real /token behind the revocation lock.
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(741290064)');
    const exchange=request('/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'authorization_code',code:authCode,client_id:'client',redirect_uri:'https://example.invalid/callback',code_verifier:verifier})});
    let waiting=false;
    for(let n=0;n<100&&!waiting;n++){
     waiting=(await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory') waiting")).rows[0].waiting;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.ok(waiting,'OAuth exchange must really be waiting on governance lock');
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id(1),role:'authenticated',deckpal_auth_kind:'jwt'})]);
    await db.query("SELECT admin_api('user.revoke-tokens',$1)",[JSON.stringify({id:id(4),reason:'Revoke while exchange is queued'})]);
    await db.query('COMMIT');
    const response=await exchange;assert.equal(response.status,400);
    assert.equal((await db.query('SELECT count(*)::int n FROM api_token WHERE user_id=$1 AND revoked_at IS NULL',[id(4)])).rows[0].n,0);
   }finally{await db.query('ROLLBACK');await new Promise(resolve=>server.close(resolve));}
  });
  // The peer-owned economics tests use this SAME runner-owned database and
  // actual migration functions, never a URL supplied by a caller.
  for(const name of ['066_credit_economy.sql','067_credit_economy_security.sql']) await migration(name);
  if(existsSync(join(here,'credits.mjs'))){
   const credits=await import('./credits.mjs');
   if(typeof credits.runCreditIntegration!=='function') throw new Error('credits.mjs must export runCreditIntegration({db,as,api,id,config,test})');
   await credits.runCreditIntegration({db,as,api,id,config,test});
  }else{throw new Error('Credit integration suite is required and has not been authored yet');}
 }
 results.status='passed';
}catch(error){results.status='failed';results.error=error.stack;console.error(error);process.exitCode=1;}
finally{await db.end();writeFileSync(process.env.DECKPAL_TEST_RESULT,JSON.stringify(results,null,2)+'\n');}
