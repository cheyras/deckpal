import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { defaultUserId, q1, rlsStore, withTx } from '../db.js';
import { ApiError } from '../http.js';

export interface Access {
 ready: boolean; suspended: boolean; permissions: string[];
 roles: { id: string; key: string; name: string }[];
}
export const requestAccessStore=new AsyncLocalStorage<Map<string,Promise<Access>>>();
export type AccessResolver = (userId: string) => Promise<Access>;
let bootstrapState: 'pending' | 'ready' | 'owner-missing' | 'schema-unavailable' = 'pending';
let retryAt = 0;
let initializing: Promise<boolean> | undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ids(value: string | undefined): string[] {
 return [...new Set((value ?? '').split(',').map(x=>x.trim()).filter(x=>UUID.test(x)))];
}
export function adminBootstrapStatus() { return bootstrapState; }
export function legacyBootstrapInputs(env:Record<string,string|undefined>) {
 return {
  cloud:!!(env.SUPABASE_MODE||env.SUPABASE_URL||env.SUPABASE_JWT_SECRET),
  creditsEnabled:env.DECKE_CREDITS_ENABLED==='true',
 };
}

/** This must run before request RLS acquires its one connection. Success alone
 * is cached; changed environment allowlists are never reimported after sentinel. */
export async function ensureAdminBootstrap(): Promise<boolean> {
 if (bootstrapState === 'ready') return true;
 if (rlsStore.getStore()) return false;
 if (initializing) return initializing;
 if (Date.now() < retryAt) return false;
 initializing = (async () => {
  try {
   const {cloud,creditsEnabled}=legacyBootstrapInputs(process.env);
   const configured = process.env.DESIGN_EDITOR_USER_ID?.trim();
   const owner = cloud ? (configured && UUID.test(configured) ? configured : null) : await defaultUserId();
   const decke = ids(process.env.DECKE_ENTITLED_USER_IDS);
   const dedicated = ids(process.env.LABELER_ENTITLED_USER_IDS);
   const result = await withTx(async client => {
    const row = (await client.query<{ready:boolean}>('SELECT public.admin_bootstrap($1,$2::text[],$3::text[]) AS ready',[owner,decke,dedicated.length ? dedicated : decke])).rows[0];
    // Economy enablement is independently initialized once. A missing credit
    // migration must fail this transaction instead of publishing partial setup.
    if (row?.ready) await client.query('SELECT public.credit_policy_initialize($1)', [creditsEnabled]);
    return row?.ready === true;
   });
   bootstrapState = result ? 'ready' : 'owner-missing';
   retryAt = result ? 0 : Date.now()+30_000;
   if (!result) console.warn('[admin] Initialization requires the existing configured owner account.');
   return result;
  } catch (error) {
   bootstrapState='schema-unavailable'; retryAt=Date.now()+30_000;
   console.warn('[admin] Administration unavailable; apply its migrations before enabling this deployment.', (error as {code?:string}).code ?? 'database-error');
   return false;
  } finally { initializing=undefined; }
 })();
 return initializing;
}

export async function getAccessForUser(userId: string): Promise<Access> {
 // Coalesce only inside this request. SQL mutations independently reauthorize
 // after acquiring the governance lock, and no authority outlives a request.
 const cache=requestAccessStore.getStore();
 const existing=cache?.get(userId);
 if(existing) return existing;
 const pending=q1<{access:Access}>('SELECT public.admin_access($1) AS access',[userId]).then(row=>{
  if (!row?.access) throw new ApiError(503,'admin_unavailable','Account authorization is unavailable.');
  return row.access;
 });
 cache?.set(userId,pending);
 return pending;
}
export function hasPermission(access:Access,key:string):boolean {
 return access.ready && !access.suspended && access.permissions.includes(key);
}
export function requirePermission(key:string,resolver:AccessResolver=getAccessForUser, options:{admin?:boolean; hidden?:boolean; session?:boolean}={}):RequestHandler {
 return (req,res,next) => {
  res.setHeader('Cache-Control','no-store');
  if (!req.user?.id) { next(new ApiError(401,'unauthorized','Sign in to continue.')); return; }
  if (options.session!==false && req.authKind==='token') { next(new ApiError(403,'forbidden','Sign in to the web app to use this tool.')); return; }
  resolver(req.user.id).then(access=>{
   if (!access.ready) throw new ApiError(503,'admin_unavailable','Administration is not initialized.');
   if (access.suspended) throw new ApiError(403,'account_suspended','This account is suspended.');
   if (!hasPermission(access,key) || (options.admin && !hasPermission(access,'admin.access'))) {
    throw new ApiError(options.hidden?404:403,options.hidden?'not_found':'forbidden', options.hidden?'Not found':'You do not have permission for this action.');
   }
   next();
  }).catch(next);
 };
}
export function requireAdminPermission(key:string):RequestHandler { return requirePermission(key,getAccessForUser,{admin:true}); }

/** All Express identities, including catalog personalization, pass this before
 * accessing owned data. Missing schema fails closed for authenticated requests. */
export const requireActiveAccount:RequestHandler=(req,_res,next)=>{
 if (!req.user?.id) { next(); return; }
 getAccessForUser(req.user.id).then(access=>{
  if (access.suspended) throw new ApiError(403,'account_suspended','This account is suspended. Contact the app owner.');
  next();
 }).catch(next);
};
export async function appDefaults():Promise<{skin:'premium'|'classic';topbar:'cover'|'flat'}> {
 const row=await q1<{defaults:{skin:'premium'|'classic';topbar:'cover'|'flat'}}>('SELECT public.admin_public_defaults() AS defaults');
 return row?.defaults ?? {skin:'premium',topbar:'cover'};
}

/** Query through the request transaction. Self-host establishes its own local
 * claims inside a transaction, without requiring an auth schema or a UUID. */
export async function adminQuery<T>(operation:string, payload:unknown, userId:string):Promise<T> {
 try {
  return await withTx(async client=>{
   if (!rlsStore.getStore()) await client.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role:'local',deckpal_auth_kind:'local'})]);
   const row=(await client.query<{result:T}>('SELECT public.admin_api($1,$2::jsonb) AS result',[operation,JSON.stringify(payload)])).rows[0];
   return row!.result;
  });
 } catch(error) { throw adminError(error); }
}
export function adminError(error:unknown):unknown {
 const e=error as {code?:string;message?:string};
 if (e.code==='42501') return new ApiError(403,'forbidden',e.message ?? 'Permission denied.');
 if (e.code==='P0002') return new ApiError(404,'not_found',e.message ?? 'Not found.');
 if (e.code==='40001') return new ApiError(409,'conflict',e.message ?? 'This record changed. Refresh and retry.');
 if (e.code==='55000') return new ApiError(409,'protected_state',e.message ?? 'This change is not allowed.');
 if (e.code && ['22023','22P02','22003','23502','23514'].includes(e.code)) return new ApiError(400,'bad_request',e.message ?? 'Invalid input.');
 if (e.code==='23505') return new ApiError(409,'conflict','A record with these values already exists.');
 return error;
}
