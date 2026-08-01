// foil/backfill.ts — upgrade a v1 hand-mask sidecar to sidecar v2 by
// backfilling the prior + diff artifacts the save flow now produces.
//
// Used once per legacy mask (masks saved before sidecar v2). The prior is the
// DETERMINISTIC layout-rule output for the era/scope the mask was drawn
// against — supplied explicitly on the CLI (never guessed) and cross-checked
// against apps/web/src/foil/era-layouts.json, the same data the workbench
// resolver used. The hand-drawn PNG is never touched; the original sidecar
// fields (savedAt above all) are preserved.
//
//   pnpm --filter pokedex-api exec tsx src/foil/backfill.ts \
//     --card base1-8 --variant 32 --era wotc --scope window \
//     --feather 0.008 --resolver-version 1
//
// No DB, no server: pure file work in the working tree.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, diffMask, rasterizePriorAlpha, renderPriorPng, type MaskPrior } from './mask-artifacts.js';

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('repo root not found');
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
  const cardId = arg('card');
  const variantId = arg('variant');
  const eraId = arg('era');
  const scope = arg('scope') as MaskPrior['scope'] | null;
  const feather = Number(arg('feather') ?? '0.008');
  const resolverVersion = Number(arg('resolver-version') ?? '1');
  if (!cardId || !variantId || !eraId || !scope) {
    console.error('usage: backfill.ts --card <id> --variant <n> --era <eraId> --scope <window|sheet|full|none> [--feather f] [--resolver-version n]');
    process.exit(2);
  }

  const root = repoRoot();
  const dir = join(root, 'data', 'foil-masks', cardId);
  const pngPath = join(dir, `${variantId}.png`);
  const jsonPath = join(dir, `${variantId}.json`);
  const sidecar = JSON.parse(await readFile(jsonPath, 'utf8')) as Record<string, unknown>;
  if (sidecar.version === 2 && !process.argv.includes('--force')) {
    console.error(`${cardId}/${variantId} is already sidecar v2 — nothing to backfill (--force to redo prior/diff).`);
    process.exit(1);
  }

  // Reproduce maskForScope() (apps/web/src/foil/resolver.ts) from the same
  // layout data — rect in UV y-up.
  const layouts = JSON.parse(
    await readFile(join(root, 'apps', 'web', 'src', 'foil', 'era-layouts.json'), 'utf8'),
  ) as {
    cornerRadius: number;
    eras: Record<string, { artWindow: { x: number; y: number; w: number; h: number }; artWindowRadius: number }>;
  };
  const era = layouts.eras[eraId];
  if (!era) throw new Error(`unknown era '${eraId}' in era-layouts.json`);
  const aw = era.artWindow;
  const rectYUp: [number, number, number, number] = [aw.x, 1 - aw.y - aw.h, aw.w, aw.h];
  let rect: [number, number, number, number];
  let radius: number;
  let invert = false;
  switch (scope) {
    case 'window':
      rect = rectYUp; radius = era.artWindowRadius; break;
    case 'sheet':
      rect = rectYUp; radius = era.artWindowRadius; invert = true; break;
    case 'full':
    case 'none':
      rect = [0, 0, 1, 1]; radius = layouts.cornerRadius; break;
    default:
      throw new Error(`bad scope ${String(scope)}`);
  }
  const prior: MaskPrior = { source: 'layout', eraId, scope, rect, radius, invert, feather, resolverVersion };

  const hand = decodePng(await readFile(pngPath));
  const width = Number(sidecar.width);
  const height = Number(sidecar.height);
  if (hand.width !== width || hand.height !== height) throw new Error('sidecar dims do not match PNG');

  const priorAlpha = rasterizePriorAlpha(width, height, prior);
  const priorPng = renderPriorPng(width, height, prior);
  const { png: diffPng, stats } = diffMask(hand, priorAlpha);

  await writeFile(join(dir, `${variantId}.prior.png`), priorPng);
  await writeFile(join(dir, `${variantId}.diff.png`), diffPng);
  const v2 = {
    version: 2,
    ...sidecar, // original fields (incl. savedAt) win over nothing — preserved verbatim
    artworkKey: cardId,
    prior,
    priorPng: `${variantId}.prior.png`,
    diffPng: `${variantId}.diff.png`,
    diff: stats,
  };
  await writeFile(jsonPath, JSON.stringify(v2, null, 2) + '\n', 'utf8');
  console.log(`backfilled ${cardId}/${variantId}:`, JSON.stringify(stats));
}

void main();
