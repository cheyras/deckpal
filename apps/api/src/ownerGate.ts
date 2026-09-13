import type { RequestHandler } from 'express';
import { adminBootstrapStatus, getAccessForUser, hasPermission, requirePermission, type AccessResolver } from './admin/access.js';
export const LABELER_ENTITLED_VAR='LABELER_ENTITLED_USER_IDS';
export type OwnerRefusal='forbidden'|'not-found';
export async function isOwner(userId:string|undefined|null,resolver:AccessResolver=getAccessForUser):Promise<boolean> {
 if(!userId) return false;
 const access=await resolver(userId);
 return access.ready&&!access.suspended&&access.roles.some(r=>r.key==='super_admin');
}
export async function isLabelerEntitled(userId:string|undefined|null,resolver:AccessResolver=getAccessForUser):Promise<boolean> {
 return !!userId&&hasPermission(await resolver(userId),'scanner.label');
}
export function ownerGateStatus() {
 if(adminBootstrapStatus()==='ready') return 'configured';
 return process.env.SUPABASE_MODE ? 'unset' : 'self-host';
}
export type LabelerEntitlementStatus='database-managed'|'unavailable';
export function labelerEntitlementStatus():LabelerEntitlementStatus {
 return adminBootstrapStatus()==='ready'?'database-managed':'unavailable';
}
/** Name retained for compatibility; every deployment now checks a session and
 * current capability. Preview authentication is not an authorization bypass. */
export function ownerOnlyInProduction(refusal:OwnerRefusal='forbidden',resolver:AccessResolver=getAccessForUser):RequestHandler {
 return requirePermission('scanner.use',resolver,{hidden:refusal==='not-found'});
}
export function labelerOnlyInProduction(refusal:OwnerRefusal='forbidden',resolver:AccessResolver=getAccessForUser):RequestHandler {
 return requirePermission('scanner.label',resolver,{hidden:refusal==='not-found'});
}
