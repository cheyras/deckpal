/**
 * Put a DeckPal personal access token for the QA account into `.qa-account`, as QA_MCP_TOKEN.
 *
 * Run it yourself (it signs in to the live backend with the QA password; an agent must not):
 *
 *   node scripts/qa-token.mjs            # mint a full (read + write) token and store it
 *   node scripts/qa-token.mjs --read     # a read-only token instead
 *   node scripts/qa-token.mjs --check    # only check the stored token still works
 *
 * What it does, all against https://deckpal.app (DECKPAL_BASE overrides):
 *   1. reads QA_EMAIL / QA_PASSWORD from `.qa-account` (gitignored);
 *   2. asks /api/public-config for the Supabase URL and public anon key, and signs in as QA;
 *   3. reads /api/me with that sign-in and REFUSES to go on unless the account is explicitly
 *      not the owner; its username is the identity the eval pins;
 *   4. mints a token with POST /api/tokens ("Analysis eval (QA)");
 *   5. writes QA_MCP_TOKEN=… and QA_USERNAME=… into `.qa-account`, replacing older lines;
 *   6. proves it: /api/me with the token names the same user, and MCP initialize + tools/list work.
 * The token is never printed. The eval (scripts/analysis-eval.mjs) reads both lines and refuses
 * any token whose /api/me does not name QA_USERNAME as a non-owner.
 * Revoke it any time from the QA account's Profile → Agent access ("Analysis eval (QA)").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, '.qa-account');
const BASE = (process.env.DECKPAL_BASE ?? 'https://deckpal.app').replace(/\/$/, '');
const args = new Set(process.argv.slice(2));

function readAccount() {
  if (!fs.existsSync(FILE)) throw new Error('.qa-account is missing (it is gitignored; get it from the maintainer).');
  const raw = fs.readFileSync(FILE, 'utf8');
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() || '';
  return { raw, email: get('QA_EMAIL'), password: get('QA_PASSWORD'), token: get('QA_MCP_TOKEN'), username: get('QA_USERNAME') };
}

async function json(res, what) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.error_description ?? body?.msg ?? `HTTP ${res.status}`;
    throw new Error(`${what} failed: ${msg}`);
  }
  return body;
}

/** /api/me for a bearer (a sign-in JWT or a token); refuses anything not provably a non-owner. */
async function nonOwner(bearer, what) {
  const me = await json(await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${bearer}` } }), `${what} /api/me`);
  if (me.isOwner !== false || me.owner !== false) throw new Error(`${what}: this account is not provably a non-owner account. Stopping; nothing was written.`);
  if (typeof me.username !== 'string' || !me.username) throw new Error(`${what}: /api/me returned no username. Stopping; nothing was written.`);
  return me.username;
}

/** MCP over streamable HTTP: initialize, then tools/list. Returns the tool count. */
async function proveToken(token) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const rpc = async (body, session) => {
    const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP ${body.method} failed: HTTP ${res.status}`);
    const data = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5);
    return { reply: JSON.parse(data), session: res.headers.get('mcp-session-id') ?? session };
  };
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa-token', version: '1' } } });
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, init.session);
  return list.reply.result?.tools?.length ?? 0;
}

/** Replace a KEY=… line, or append it under a comment; the file keeps its other lines. */
function setLine(raw, key, value, comment) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(raw) ? raw.replace(re, line) : `${raw.replace(/\s*$/, '')}\n\n# ${comment}\n${line}\n`;
}

async function main() {
  const acct = readAccount();
  if (args.has('--check')) {
    if (!acct.token) throw new Error('No QA_MCP_TOKEN in .qa-account yet. Run without --check to mint one.');
    if (!acct.username) throw new Error('No QA_USERNAME in .qa-account. Run without --check to mint a token; it records the username.');
    const who = await nonOwner(acct.token, 'The stored token');
    if (who !== acct.username) throw new Error('The stored token does not belong to QA_USERNAME.');
    console.log(`QA_MCP_TOKEN works for ${who} (not the owner): ${await proveToken(acct.token)} tools on ${BASE}/mcp.`);
    return;
  }
  if (!acct.email || !acct.password) throw new Error('.qa-account has no QA_EMAIL / QA_PASSWORD.');

  const cfg = await json(await fetch(`${BASE}/api/public-config`), 'public-config');
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error(`${BASE} is not a cloud deployment (no Supabase in public-config).`);
  const session = await json(
    await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: acct.email, password: acct.password }),
    }),
    'QA sign-in',
  );
  if (!session.access_token) throw new Error('QA sign-in returned no session.');
  // Before minting anything: the signed-in account must be explicitly not the owner.
  const username = await nonOwner(session.access_token, 'The QA sign-in');

  const scope = args.has('--read') ? 'read' : 'full';
  const minted = await json(
    await fetch(`${BASE}/api/tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Analysis eval (QA)', scope }),
    }),
    'minting the token',
  );
  if (!minted.secret) throw new Error('The token API returned no secret.');

  let next = setLine(acct.raw, 'QA_MCP_TOKEN', minted.secret, 'Personal access token for the analysis eval (scripts/qa-token.mjs). Never print it.');
  next = setLine(next, 'QA_USERNAME', username, 'The QA account the eval pins its token to (scripts/qa-token.mjs).');
  fs.writeFileSync(FILE, next);

  if ((await nonOwner(minted.secret, 'The new token')) !== username) throw new Error('The new token names a different account than the QA sign-in.');
  const tools = await proveToken(minted.secret);
  console.log(`Done: a ${scope} token for ${username} (not the owner) is in .qa-account as QA_MCP_TOKEN, with QA_USERNAME, and it works (${tools} tools on ${BASE}/mcp).`);
  if (acct.token) console.log('The previous QA_MCP_TOKEN was replaced; revoke the old "Analysis eval (QA)" token in the QA account if you like.');
}

main().catch((err) => {
  console.error(`qa-token: ${err.message}`);
  process.exit(1);
});
