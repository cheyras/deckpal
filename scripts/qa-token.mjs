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
 *   3. mints a token with POST /api/tokens ("Analysis eval (QA)");
 *   4. writes QA_MCP_TOKEN=… into `.qa-account`, replacing an older one;
 *   5. proves it: an MCP initialize + tools/list on /mcp with that token.
 * The token is never printed. The eval (scripts/analysis-eval.mjs) reads it from `.qa-account`.
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
  return { raw, email: get('QA_EMAIL'), password: get('QA_PASSWORD'), token: get('QA_MCP_TOKEN') };
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

async function main() {
  const acct = readAccount();
  if (args.has('--check')) {
    if (!acct.token) throw new Error('No QA_MCP_TOKEN in .qa-account yet. Run without --check to mint one.');
    console.log(`QA_MCP_TOKEN works: ${await proveToken(acct.token)} tools on ${BASE}/mcp.`);
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

  // Replace an older line, or append; the file keeps its other lines and its mode.
  const line = `QA_MCP_TOKEN=${minted.secret}`;
  const next = /^QA_MCP_TOKEN=.*$/m.test(acct.raw)
    ? acct.raw.replace(/^QA_MCP_TOKEN=.*$/m, line)
    : `${acct.raw.replace(/\s*$/, '')}\n\n# Personal access token for the analysis eval (scripts/qa-token.mjs). Never print it.\n${line}\n`;
  fs.writeFileSync(FILE, next);

  const tools = await proveToken(minted.secret);
  console.log(`Done: a ${scope} token is in .qa-account as QA_MCP_TOKEN, and it works (${tools} tools on ${BASE}/mcp).`);
  if (acct.token) console.log('The previous QA_MCP_TOKEN was replaced; revoke the old "Analysis eval (QA)" token in the QA account if you like.');
}

main().catch((err) => {
  console.error(`qa-token: ${err.message}`);
  process.exit(1);
});
