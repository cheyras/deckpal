import { adminBootstrapStatus, getAccessForUser, hasPermission, type AccessResolver } from '../admin/access.js';
export const DECKE_ENTITLED_VAR='DECKE_ENTITLED_USER_IDS';
export async function isDeckeEntitled(userId:string,resolver:AccessResolver=getAccessForUser):Promise<boolean> {
 return !!userId&&hasPermission(await resolver(userId),'decke.use');
}
export type DeckeEntitlementStatus='database-managed'|'unavailable';
export function deckeEntitlementStatus():DeckeEntitlementStatus {
 return adminBootstrapStatus()==='ready'?'database-managed':'unavailable';
}
export function deckeEntitlementWarning():string|null {
 return adminBootstrapStatus()==='ready'?null:'[deckpal-api] Deck-E permissions are database-managed; administration must initialize before use.';
}
