// Curated surface: only what apps and tests actually import. Migrations are
// deliberately absent — cli.ts imports ./migrate.js directly, and the compiled
// package could not run them anyway (no .sql copy step into dist/).
export { makePool } from './pool.js';
export { loadEnv } from './env.js';
export {
  TOKEN_PREFIX,
  countActiveTokens,
  createToken,
  generateToken,
  grantSchemaReady,
  hashToken,
  listTokens,
  looksLikeApiToken,
  resolveToken,
  revokeToken,
  tokenPrefix,
  touchToken,
} from './tokens.js';
export type { ApiTokenRow, Queryable, ResolvedToken, TokenScope } from './tokens.js';
export {
  OAuthValidationError,
  classifyRedirect,
  connectionName,
  consumeAuthCode,
  createAuthCode,
  getClient,
  registerClient,
  verifyPkceS256,
} from './oauth.js';
export type { RedirectIdentity, RedirectTrust } from './oauth.js';
export {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_DAYS,
  openConnection,
  refreshConnection,
} from './grants.js';
export type { IssuedTokens, RefreshOutcome } from './grants.js';
