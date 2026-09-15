import { Router } from 'express';
import { ApiError, asyncHandler } from '../http.js';
import { commitRequestTx } from '../db.js';
import { currentUserId } from '../identity.js';
import { integer, object, reasonText } from './policy.js';
import { privateSession, sessionCall } from './session.js';
export interface UserAiOverride {
  userId:string;revision:number;unlimited:boolean;markupBps:number|null;effectiveMarkupBps:number;
  globalPolicyRevision:number;updatedAt:string|null;canEdit:boolean;
}
export function normalizeUserOverride(value:unknown) {
  const p=object(value,['expectedRevision','unlimited','markupBps','reason'],'AI override');
  if(typeof p.unlimited!=='boolean') throw new ApiError(400,'invalid_input','unlimited must be a boolean');
  return {expectedRevision:integer(p.expectedRevision,0,Number.MAX_SAFE_INTEGER,'expectedRevision'),
    unlimited:p.unlimited,markupBps:p.markupBps===null?null:integer(p.markupBps,0,100000,'markupBps'),reason:reasonText(p.reason)};
}
export const userAiOverrideRouter:Router=Router({mergeParams:true});
userAiOverrideRouter.use(privateSession);
userAiOverrideRouter.get('/',asyncHandler(async(req,res)=>{
  res.json(await sessionCall<UserAiOverride>('SELECT public.admin_user_ai_override_read($1) AS data',[String(req.params.id)]));
}));
userAiOverrideRouter.put('/',asyncHandler(async(req,res)=>{
  const p=normalizeUserOverride(req.body);
  const data=await sessionCall<UserAiOverride>('SELECT public.admin_user_ai_override_update($1,$2,$3,$4,$5) AS data',
    [String(req.params.id),p.expectedRevision,p.unlimited,p.markupBps,p.reason]);
  await commitRequestTx(currentUserId(req));res.json(data);
}));
