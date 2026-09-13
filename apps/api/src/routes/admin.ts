import { Router } from 'express';
import { adminQuery, requireAdminPermission } from '../admin/access.js';
import { commitRequestTx } from '../db.js';
import { asyncHandler, badRequest, clampInt } from '../http.js';
import { currentUserId } from '../identity.js';

export const adminRouter:Router=Router();
adminRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
function body(value:unknown,allowed:string[]) {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw badRequest('Expected a JSON object.');
 const result=value as Record<string,unknown>;
 const extra=Object.keys(result).filter(k=>!allowed.includes(k));
 if(extra.length) throw badRequest('Unknown fields: '+extra.join(', '));
 return result;
}
function read(path:string,permission:string,op:string) {
 adminRouter.get(path,requireAdminPermission(permission),asyncHandler(async(req,res)=>{
  const payload:Record<string,unknown>={...req.query,...req.params};
  if(op==='users'||op==='audit') {
   payload.limit=clampInt(req.query.limit,50,1,100);
   payload.offset=clampInt(req.query.offset,0,0,1000000);
  }
  res.json(await adminQuery(op,payload,currentUserId(req)));
 }));
}
function write(method:'post'|'patch'|'put'|'delete',path:string,permission:string,op:string,keys:string[]) {
 adminRouter[method](path,requireAdminPermission(permission),asyncHandler(async(req,res)=>{
  const userId=currentUserId(req);
  const result=await adminQuery(op,{...body(req.body??{},keys),...req.params},userId);
  await commitRequestTx(userId);
  res.json(result);
 }));
}
read('/overview','admin.access','overview');
read('/users','users.read','users');
read('/users/:id','users.read','user');
write('put','/users/:id/roles','roles.manage','user.roles',['roleIds','expectedRevision','reason']);
write('patch','/users/:id/status','users.manage','user.status',['suspended','expectedRevision','reason']);
write('post','/users/:id/revoke-tokens','users.manage','user.revoke-tokens',['reason']);
read('/roles','roles.read','roles');
write('post','/roles','roles.manage','role.create',['name','description','permissions']);
write('patch','/roles/:id','roles.manage','role.update',['name','description','permissions','expectedRevision']);
write('delete','/roles/:id','roles.manage','role.delete',['expectedRevision']);
read('/settings','settings.read','settings');
write('put','/settings','settings.write','settings.update',['settings','expectedRevision']);
read('/audit','audit.read','audit');
