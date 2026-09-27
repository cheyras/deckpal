/**
 * Supabase's new API keys are opaque strings, not JWTs. Legacy service-role
 * keys remain JWTs during migration and still need the Bearer header.
 * This file is plain JS so the pre-install model fetch can use the same rule.
 * @param {string} key
 * @returns {Record<string, string>}
 */
export function supabaseKeyHeaders(key) {
  return key.startsWith('sb_')
    ? { apikey: key }
    : { apikey: key, authorization: `Bearer ${key}` }
}
