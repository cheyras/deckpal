export interface AppDefaults { skin: 'premium' | 'classic'; topbar: 'cover' | 'flat' }
export interface RoleRef { id: string; name: string; key: string; tier: number }
export interface ActorCapabilities { canEditRoles: boolean; canAssignRoles: boolean; canManageUserOverrides: boolean; canReadSharedConversations: boolean; assignableRoleIds: string[] }
export interface FeatureAccess { key: string; label: string; lifecycle: 'released' | 'beta' | 'experimental' | 'disabled'; revision: number; optedIn: boolean; eligible: boolean; enabled: boolean; reason: string }
export interface UserActions { canAssignRole: boolean; assignableRoleIds: string[]; canChangeStatus: boolean; canRevokeTokens: boolean; denialReasons: Record<string, string> }
export interface AdminUser {
  id: string; username: string; email: string | null; createdAt: string;
  lastSignInAt: string | null; suspended: boolean; role: RoleRef; roles: RoleRef[]; actions: UserActions; revision: number
}
export interface AdminRole extends RoleRef {
  system: boolean; protectedIdentity: boolean; canEdit: boolean; canDelete: boolean; editablePermissions: string[]; key: string; description: string; permissions: string[]; memberCount: number; protected: boolean; revision: number
}
export interface Permission { key: string; group: string; description: string }
export interface RoleList { roles: AdminRole[]; permissions: Permission[]; permissionCeilings: Record<string, string[]> }
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

export interface SharingPreference { enabled: boolean; revision: number; updatedAt: string | null }
export interface AiOverride { userId: string; revision: number; unlimited: boolean; markupBps: number | null; effectiveMarkupBps: number; globalPolicyRevision: number; updatedAt: string | null; canEdit: boolean }
export interface AiCost { source: 'provider_reported' | 'token_rate_estimate' | 'unknown'; usd: string | null; currency: 'USD'; coverage: 'complete' | 'partial' | 'unknown' }
export interface AiUsageRow { id: string; userId: string; conversationId: string | null; exchangeId: string; seq: number | null; category: 'response' | 'research' | 'planning'; status: string; startedAt: string; finishedAt: string | null; buildSha: string | null; buildPr: number | null; pricingRevision: number | null; overrideRevision: number | null; chargeMode: 'paid' | 'unlimited' | 'daily'; chargedCredits: number | null; operationCount: number; cost: AiCost; inputTokens: number | null; outputTokens: number | null }
export interface AiUsageDetail { request: AiUsageRow; operations: { id: string; category: string; toolKey: string | null; modelId: string | null; provider: string | null; status: string; startedAt: string; finishedAt: string | null; tokens: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null }; cost: AiCost }[]; content: { asked: string; answered: string } | null; contentStatus: 'shared' | 'not_shared' | 'revoked' | 'unavailable' }
export interface AiUsagePage { items: AiUsageRow[]; total: number; limit: number; offset: number; aggregate: { knownUsd: string; knownCount: number; unknownCount: number } }

export interface CostObservations { days: number; buildSha: string | null; groups: { operation: 'chatTurn' | 'analysis' | 'planDeck'; category: string; modelIds: string[]; buildSha: string | null; sampleCount: number; completeCount: number; unknownCount: number; meanMicroUsd: number | null; p95MicroUsd: number | null; knownUsd: string }[]; notice: string }
