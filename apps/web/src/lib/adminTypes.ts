export interface AppDefaults { skin: 'premium' | 'classic'; topbar: 'cover' | 'flat' }
export interface RoleRef { id: string; name: string }
export interface AdminUser {
  id: string; username: string; email: string | null; createdAt: string;
  lastSignInAt: string | null; suspended: boolean; roles: RoleRef[]; revision: number
}
export interface AdminRole extends RoleRef {
  key: string; description: string; permissions: string[]; memberCount: number; protected: boolean; revision: number
}
export interface Permission { key: string; group: string; description: string }
export interface RoleList { roles: AdminRole[]; permissions: Permission[] }
export interface PageResult { total: number; limit: number; offset: number }
export interface AuditEvent { id: string; actorId: string; actorName: string | null; action: string; targetType: string; targetId: string | null; before: unknown; after: unknown; reason: string | null; createdAt: string }
export interface CreditPolicy { enabled: boolean; microUsdPerCredit: number; markupBps: number; estimatedMicroUsd: { chatTurn: number; analysis: number; planDeck: number }; lowBalance: number }
export interface CreditSettings { policy: CreditPolicy; revision: number; updatedAt: string; estimateNotice?: string }
export interface CreditPack { id: string; name: string; credits: number; priceCents: number; currency: 'usd'; active: boolean; revision: number }
export interface CreditEvent { id: string; delta: number; debtDelta?: number; kind: string; reason: string | null; createdAt: string; pricingRevision: number | null }
export interface Wallet { enabled: boolean; balance: number; debt: number; purchaseHold: boolean; lowAt: number; prices: { chatTurn: number; analysis: number; planDeck: number }; packs: CreditPack[]; purchasesEnabled: boolean; purchaseUnavailableReason: string | null }
export interface CreditOrder { id: string; status: string; credits: number; priceCents: number; currency: string }
export interface CreditSummary { days: number; creditsSpent: number; creditsGranted: number; paidOrders: number; grossSalesCents: number; refundedCents: number; pendingOrders: number; heldWallets: number; debtWallets: number; totalDebt: number; estimatedProviderMicroUsd: number; unpricedSpends: number }
export interface AdminCreditOrder { id: string; userId: string; username: string | null; packName: string; credits: number; priceCents: number; currency: string; status: string; refundedCents: number; reversedCredits: number; disputeStatus: string | null; createdAt: string; paidAt: string | null }
