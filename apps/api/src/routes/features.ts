import { Router } from 'express';
import { adminError } from '../admin/access.js';
import { commitRequestTx, rlsStore, withTx } from '../db.js';
import { asyncHandler, badRequest } from '../http.js';
import { currentUserId } from '../identity.js';

/** SQL rechecks a real current session and role under the governance lock.
 * Lifecycle configuration deliberately cannot be granted by editable permissions. */
async function featureQuery(operation:string,payload:unknown,userId:string) {
 try {
  return await withTx(async client=>{
   if(!rlsStore.getStore()) await client.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:userId,role:'local',deckpal_auth_kind:'local'})]);
   return (await client.query('SELECT public.feature_api($1,$2::jsonb) result',[operation,JSON.stringify(payload)])).rows[0].result;
  });
 } catch(error) { throw adminError(error); }
}
function createFeatureRouter(admin:boolean):Router {
 const router=Router();
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/',asyncHandler(async(req,res)=>{
  res.json(await featureQuery(admin?'admin.list':'self.list',{},currentUserId(req)));
 }));
 router.patch('/:key',asyncHandler(async(req,res)=>{
  const value=req.body as Record<string,unknown>;
  const keys=admin?['lifecycle','expectedRevision','reason']:['optedIn','expectedRevision'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))) throw badRequest('Invalid feature fields.');
  if(!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<1) throw badRequest('A current feature revision is required.');
  const userId=currentUserId(req);
  const result=await featureQuery(admin?'admin.update':'self.update',{...value,key:req.params.key},userId);
  await commitRequestTx(userId);
  res.json(result);
 }));
 return router;
}
export const meFeatureRouter=createFeatureRouter(false);
export const adminFeatureRouter=createFeatureRouter(true);
