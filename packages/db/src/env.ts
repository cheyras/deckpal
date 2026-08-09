import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal .env loader — no dependency, no override of already-set process.env.
 * The repo .env lives at the workspace root (three levels up from this file:
 * packages/db/src -> packages/db -> packages -> <root>). Kept dependency-free
 * on purpose: the migration runner must have the smallest possible footprint on
 * this memory-constrained box.
 */
export function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const path = join(root, '.env');
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return; // .env is optional; env vars may be supplied by the process manager or shell.
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
