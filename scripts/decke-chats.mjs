#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASE = 'https://deckpal.app/api';
const COMMANDS = new Set(['list', 'read', 'search', 'dump']);
const VALUE_FLAGS = new Set(['from', 'to', 'vote', 'build-pr', 'limit', 'format', 'out', 'since']);

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) throw new Error('Usage: decke-chats.mjs list|read <id>|search <query>|dump --since 7d [options]');
  const options = { format: 'markdown' };
  const positional = [];
  for (let index = 0; index < rest.length; index++) {
    const part = rest[index];
    if (!part.startsWith('--')) {
      positional.push(part);
      continue;
    }
    const key = part.slice(2);
    if (key === 'has-error') {
      const next = rest[index + 1];
      if (next === 'true' || next === 'false') {
        options.hasError = next === 'true';
        index++;
      } else {
        options.hasError = true;
      }
      continue;
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`Unknown option --${key}`);
    const next = rest[++index];
    if (!next || next.startsWith('--')) throw new Error(`--${key} needs a value`);
    const camel = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[camel] = next;
  }
  if (options.format !== 'markdown' && options.format !== 'jsonl') throw new Error('--format must be markdown or jsonl');
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new Error('--limit must be an integer from 1 to 100');
  if (limit !== undefined) options.limit = limit;
  if (command === 'read' && positional.length !== 1) throw new Error('read needs one conversation id');
  if (command === 'search' && positional.length < 1) throw new Error('search needs a query');
  if ((command === 'list' || command === 'dump') && positional.length > 0) throw new Error(`${command} takes no positional arguments`);
  return { command, id: command === 'read' ? positional[0] : undefined, query: command === 'search' ? positional.join(' ') : undefined, options };
}

function sinceDate(value, now = Date.now()) {
  const match = /^(\d+)([dhw])$/.exec(value ?? '7d');
  if (!match) throw new Error('--since must look like 12h, 7d, or 2w');
  const amount = Number(match[1]);
  const unit = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]];
  return new Date(now - amount * unit).toISOString();
}

function endpoint(base, path, params = {}) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const url = new URL(path.replace(/^\//, ''), root);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

async function request(fetchImpl, base, token, path, params = {}, accept = 'application/json') {
  const response = await fetchImpl(endpoint(base, path, params), {
    headers: { authorization: `Bearer ${token}`, accept },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json())?.error?.message ?? message; } catch { /* keep status */ }
    throw new Error(message);
  }
  return accept === 'text/markdown' ? response.text() : response.json();
}

function listParams(options, cursor) {
  return {
    from: options.from,
    to: options.to,
    vote: options.vote,
    has_error: options.hasError,
    build_pr: options.buildPr,
    limit: options.limit ?? 50,
    cursor,
  };
}

function markdownList(items, heading = 'Deck-E shared conversations') {
  const lines = [`# ${heading}`, ''];
  for (const item of items) {
    const id = item.id ?? item.conversationId;
    const snippet = item.askedSnippet || item.answeredSnippet ? ` — ${[item.askedSnippet, item.answeredSnippet].filter(Boolean).join(' … ')}` : '';
    lines.push(`- **${id}** — ${item.date ?? 'unknown date'} UTC; ${item.turnCount ?? '?'} turns; ${item.costUsd ?? '—'} USD bucket${item.hasError ? '; error recorded' : ''}${snippet}`);
  }
  if (items.length === 0) lines.push('_No matches._');
  return `${lines.join('\n')}\n`;
}

function jsonl(items) {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
}

async function output(text, options, filename, io) {
  if (!options.out) {
    io.stdout.write(text);
    return;
  }
  await io.mkdir(options.out, { recursive: true });
  await io.writeFile(join(options.out, filename), text, 'utf8');
}

export async function runCli(parsed, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const io = {
    stdout: deps.stdout ?? process.stdout,
    mkdir: deps.mkdir ?? mkdir,
    writeFile: deps.writeFile ?? writeFile,
  };
  const env = deps.env ?? process.env;
  const token = env.DECKPAL_TOKEN;
  if (!token) throw new Error('DECKPAL_TOKEN is required');
  const base = env.DECKPAL_API_BASE ?? DEFAULT_BASE;
  const { command, options } = parsed;

  if (command === 'read') {
    if (options.format === 'markdown') {
      const text = await request(fetchImpl, base, token, `/admin/decke-improvement/${encodeURIComponent(parsed.id)}`, { format: 'markdown' }, 'text/markdown');
      await output(text, options, `${parsed.id}.md`, io);
    } else {
      const detail = await request(fetchImpl, base, token, `/admin/decke-improvement/${encodeURIComponent(parsed.id)}`);
      await output(`${JSON.stringify(detail)}\n`, options, `${parsed.id}.jsonl`, io);
    }
    return;
  }

  if (command === 'search') {
    const result = await request(fetchImpl, base, token, '/admin/decke-improvement/search', { q: parsed.query, limit: options.limit ?? 25 });
    const items = Array.isArray(result.items) ? result.items : [];
    const text = options.format === 'jsonl' ? jsonl(items) : markdownList(items, `Deck-E search: ${parsed.query}`);
    await output(text, options, `search.${options.format === 'jsonl' ? 'jsonl' : 'md'}`, io);
    return;
  }

  if (command === 'list') {
    const result = await request(fetchImpl, base, token, '/admin/decke-improvement', listParams(options));
    const items = Array.isArray(result.items) ? result.items : [];
    const text = options.format === 'jsonl' ? jsonl(items) : markdownList(items);
    await output(text, options, `list.${options.format === 'jsonl' ? 'jsonl' : 'md'}`, io);
    return;
  }

  if (!options.out) throw new Error('dump requires --out dir');
  await io.mkdir(options.out, { recursive: true });
  const from = sinceDate(options.since, deps.now?.() ?? Date.now());
  const index = [];
  let cursor;
  do {
    const page = await request(fetchImpl, base, token, '/admin/decke-improvement', listParams({ ...options, from, limit: options.limit ?? 100 }, cursor));
    const items = Array.isArray(page.items) ? page.items : [];
    for (const item of items) {
      const id = String(item.id);
      const text = await request(fetchImpl, base, token, `/admin/decke-improvement/${encodeURIComponent(id)}`, { format: 'markdown' }, 'text/markdown');
      const file = `${id}.md`;
      await io.writeFile(join(options.out, file), text, 'utf8');
      index.push({ ...item, file });
    }
    cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
  } while (cursor);
  await io.writeFile(join(options.out, 'index.jsonl'), jsonl(index), 'utf8');
}

export async function main(argv = process.argv.slice(2), deps) {
  await runCli(parseArgs(argv), deps);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`decke-chats: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
