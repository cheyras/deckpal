// TCGCSV's daily price ARCHIVES — the only way to recover a day the live
// ingest missed.
//
// ── Why this exists ────────────────────────────────────────────────────────
// The scheduled price jobs stopped on 2026-08-08 and nobody noticed for three
// weeks (see DECISIONS.md 2026-08-29). `https://tcgcsv.com/tcgplayer/3/<group>/prices`
// serves TODAY and only today, so at first reading those twenty days looked
// permanently lost: the ownership ledger survived, but there were no prices to
// value it with, and carrying the last known price forward for three weeks
// draws a flat line and calls it market data.
//
// TCGCSV does publish per-day archives, which makes the gap genuinely
// recoverable with REAL prices:
//
//   https://tcgcsv.com/archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z   (~4 MB)
//
// Verified 2026-08-29: the archive holds `<date>/<categoryId>/<groupId>/prices`
// (4,629 entries, 218 of them category 3 = Pokémon), and each of those files is
// byte-identical in shape to what the live endpoint returns — the same
// `{success, errors, results:[{productId, subTypeName, marketPrice, ...}]}`
// envelope. So `writeSetPrices`'s join and metric mapping apply unchanged and
// nothing about the price rule is duplicated here.
//
// ── PPMd, and why we shell out ─────────────────────────────────────────────
// The archives are 7z/PPMd, which no pure-JS unpacker in the ecosystem handles
// reliably. `7z` is preinstalled on GitHub Actions' ubuntu runners (p7zip),
// which is where this command is meant to run, and is one `apt install
// p7zip-full` away on a self-host box. Shelling out therefore costs the repo no
// dependency at all. Its absence is checked UP FRONT and reported by name
// rather than surfacing as a confusing spawn failure 4 MB into a download.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fetchBinary } from './http.js';
import type { TcgcsvPriceEnvelope, TcgcsvPriceRow } from './types.js';

const execFileAsync = promisify(execFile);

/** TCGplayer's category id for Pokémon. The archive holds every category. */
const POKEMON_CATEGORY = 3;

const ARCHIVE_BASE = 'https://tcgcsv.com/archive/tcgplayer';

export function archiveUrl(date: string): string {
  return `${ARCHIVE_BASE}/prices-${date}.ppmd.7z`;
}

/**
 * Locate a 7z binary, or explain what to install.
 *
 * B11's shape: a dependency this feature needs, verified rather than assumed,
 * named exactly when it is missing.
 */
export async function find7z(): Promise<string> {
  for (const bin of ['7z', '7za', '7zr']) {
    try {
      await execFileAsync(bin, ['i']);
      return bin;
    } catch {
      // try the next one
    }
  }
  throw new Error(
    'no 7z binary on PATH (tried 7z, 7za, 7zr). The TCGCSV archives are 7z/PPMd. ' +
      'GitHub Actions ubuntu runners have it preinstalled; on a self-host box: ' +
      'apt-get install -y p7zip-full',
  );
}

export interface ArchiveDay {
  date: string;
  /** groupId -> the price rows for that TCGplayer group on that day. */
  groups: Map<number, TcgcsvPriceRow[]>;
}

/**
 * Download one day's archive and return its Pokémon price rows by group.
 *
 * Returns null when the archive does not exist (404) — TCGCSV has not published
 * every historical day, and a missing day is a fact to report, not a crash.
 *
 * The whole archive is unpacked to a temp directory and deleted before
 * returning; only the ~218 Pokémon entries are read back. Extracting a subset
 * is not worth the flag-quoting risk for 4 MB.
 */
export async function fetchArchiveDay(date: string, sevenZip: string): Promise<ArchiveDay | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad archive date: ${date}`);

  // `fetchBinary`, never a bare `fetch`: TCGCSV answers 401 to a generic or
  // missing User-Agent, and a bare fetch sends exactly that. This was not a
  // theory — the first draft used `fetch` and every archive request came back
  // 401 while the same URL fetched fine from curl. It also carries the 100 ms
  // inter-request floor TCGCSV asks for, which matters more here than anywhere
  // else in this app: a two-year replay is 730 sequential requests.
  const bytes = await fetchBinary(archiveUrl(date));
  if (bytes === null) return null; // TCGCSV has not published this date

  const dir = await mkdtemp(join(tmpdir(), 'deckpal-prices-'));
  try {
    const archivePath = join(dir, 'prices.7z');
    await writeFile(archivePath, bytes);
    // -bso0/-bsp0 silence the banner and the progress meter; -y auto-confirms.
    await execFileAsync(sevenZip, ['x', archivePath, `-o${dir}`, '-y', '-bso0', '-bsp0'], {
      maxBuffer: 64 * 1024 * 1024,
    });

    const groupsDir = join(dir, date, String(POKEMON_CATEGORY));
    let entries: string[];
    try {
      entries = await readdir(groupsDir);
    } catch {
      throw new Error(`archive ${date} has no category ${POKEMON_CATEGORY} directory`);
    }

    const groups = new Map<number, TcgcsvPriceRow[]>();
    for (const entry of entries) {
      const groupId = Number(entry);
      if (!Number.isInteger(groupId)) continue;
      const raw = await readFile(join(groupsDir, entry, 'prices'), 'utf8');
      const env = JSON.parse(raw) as TcgcsvPriceEnvelope;
      if (!env.success) continue;
      groups.set(groupId, env.results);
    }
    return { date, groups };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The timestamp an archived day's observations are filed under.
 *
 * Midnight UTC of the archive's own date. The live path uses TCGCSV's
 * `last-updated.txt` stamp (~20:05 UTC), which is a more precise answer to
 * "when was this published" but is not recoverable for a past archive — and
 * inventing a plausible-looking time would be worse than using the one fact the
 * filename actually carries. `price_observation`'s PK includes `captured_at`,
 * so a backfilled day and a live-ingested day for the same date coexist rather
 * than collide; the charts group by day either way.
 */
export function archiveCapturedAt(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
