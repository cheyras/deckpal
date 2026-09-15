import { Router } from 'express';
import { ApiError, asyncHandler, clampInt, UUID_RE } from '../http.js';
import { currentUserId } from '../identity.js';
import { commitRequestTx } from '../db.js';
import { integer, object } from '../credits/policy.js';
import { privateSession, sessionCall } from '../credits/session.js';
export const selfSharingRouter:Router=Router();
export const adminUsageRouter:Router=Router();
selfSharingRouter.use(privateSession);adminUsageRouter.use(privateSession);
selfSharingRouter.get('/',asyncHandler(async(_req,res)=>{res.json(await sessionCall('SELECT public.decke_sharing_read() AS data'));}));
selfSharingRouter.put('/',asyncHandler(async(req,res)=>{
 const body=object(req.body,['enabled','expectedRevision'],'sharing');
 if(typeof body.enabled!=='boolean')throw new ApiError(400,'invalid_input','enabled must be a boolean');
 const result=await sessionCall('SELECT public.decke_sharing_save($1,$2) AS data',[body.enabled,integer(body.expectedRevision,0,Number.MAX_SAFE_INTEGER,'expectedRevision')]);
 await commitRequestTx(currentUserId(req));res.json(result);
}));
export function usageFilters(query:Record<string,unknown>):Record<string,string|number> {
 const f:Record<string,string|number>={};
 for(const key of ['userId','conversationId','category','status','from','to','buildSha','buildPr','modelId','costSource']){
  const v=query[key];if(v===undefined||v==='')continue;
  if(typeof v!=='string'||v.length>160)throw new ApiError(400,'invalid_input','Invalid usage filter');
  if(key==='costSource'&&!['provider_reported','token_rate_estimate','unknown'].includes(v))throw new ApiError(400,'invalid_input','Invalid cost source');
  if(key==='category'&&!['response','research','planning'].includes(v))throw new ApiError(400,'invalid_input','Invalid category');
  if(key==='status'&&!['started','completed','failed','cancelled','abandoned'].includes(v))throw new ApiError(400,'invalid_input','Invalid status');
  if(key==='conversationId'&&!UUID_RE.test(v))throw new ApiError(400,'invalid_input','Invalid conversation');
  if((key==='from'||key==='to')&&!Number.isFinite(Date.parse(v)))throw new ApiError(400,'invalid_input','Invalid date');
  if(key==='buildPr'){if(!/^[1-9]\d{0,6}$/.test(v))throw new ApiError(400,'invalid_input','Invalid pull request');f[key]=Number(v);}
  else f[key]=v;
 }
 return f;
}
const id=(value:unknown)=>{if(typeof value!=='string'||!UUID_RE.test(value))throw new ApiError(400,'invalid_input','Invalid identifier');return value;};
adminUsageRouter.get('/',asyncHandler(async(req,res)=>{
 res.json(await sessionCall('SELECT public.decke_usage_list($1::jsonb,$2,$3) AS data',[JSON.stringify(usageFilters(req.query)),clampInt(req.query.limit,25,1,100),clampInt(req.query.offset,0,0,1000000)]));
}));
adminUsageRouter.get('/requests/:id',asyncHandler(async(req,res)=>{res.json(await sessionCall('SELECT public.decke_usage_detail($1) AS data',[id(req.params.id)]));}));
adminUsageRouter.get('/conversations/:id',asyncHandler(async(req,res)=>{res.json(await sessionCall('SELECT public.decke_usage_conversation($1,$2,$3) AS data',[id(req.params.id),clampInt(req.query.limit,25,1,100),clampInt(req.query.offset,0,0,1000000)]));}));

adminUsageRouter.get('/observations',asyncHandler(async(req,res)=>{
 const days=Number(req.query.days??30);
 if(![7,30,90].includes(days))throw new ApiError(400,'invalid_input','Choose 7, 30, or 90 days.');
 const sha=req.query.buildSha;
 if(sha!==undefined&&(typeof sha!=='string'||sha.length>64))throw new ApiError(400,'invalid_input','Invalid build.');
 res.json(await sessionCall('SELECT public.decke_usage_observations($1,$2) AS data',[days,sha||null]));
}));
