// foil/template-raster.ts — serve the vector template as a mask raster, on demand.
//
// The renderer takes a mask PNG. The committed artifact is now analytic geometry. This is
// the seam: rasterise the template on first request and cache the bytes on disk.
//
// THE CACHE IS TWO FILES, NOT 3,454.
//
// A template's rasterisation depends only on (eraId, scope, hasOptionalElement, width,
// height) — NOT on which card is being drawn. Every Basic reverse in Scarlet & Violet gets
// byte-identical pixels; so does every evolving one. That is the whole point of Chey's
// "all of these share the same 2 layouts really": the per-card artifact was always
// redundant. modern-sv/sheet at 490x674 is exactly 2 PNGs, ~17 KB each.
//
// Cache location mirrors the image-cache contract (`apps/images/src/layout.ts`): under
// IMAGE_CACHE_ROOT, disk-only, gitignored, safe to delete — it rebuilds in milliseconds.
// Nothing here is committed, and a miss is never a placeholder, it is a fresh rasterise.
//
// Constraints this file respects, both load-bearing:
//   - the foil-lab routes have NO DB (see routes/foil-lab.ts), so whether a card carries
//     the optional element is an INPUT, supplied by the caller that already knows;
//   - the server NEVER shells out (ImageMagick is CLI-only, used by the offline
//     generator), so nothing here decodes card art.

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.js';
import { rasterizeTemplate, type VectorTemplate } from './vector-template.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const TEMPLATE_FILE = join(ROOT, 'apps/web/src/foil/vector-templates.json');
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache';

/** The mask tint the editor and the shader expect; only alpha is load-bearing. */
const TINT: [number, number, number] = [255, 45, 100];

let templatesCache: VectorTemplate[] | null = null;
let templatesMtime = 0;

/** Templates are a committed artifact a human may hand-correct — reload when the file moves. */
export function loadTemplates(): VectorTemplate[] {
  if (!existsSync(TEMPLATE_FILE)) return [];
  try {
    const { mtimeMs } = statSync(TEMPLATE_FILE);
    if (templatesCache && mtimeMs === templatesMtime) return templatesCache;
    const parsed = JSON.parse(readFileSync(TEMPLATE_FILE, 'utf8')) as { templates?: VectorTemplate[] };
    templatesCache = parsed.templates ?? [];
    templatesMtime = mtimeMs;
    return templatesCache;
  } catch {
    return [];
  }
}

export function findTemplate(eraId: string, scope: string): VectorTemplate | null {
  return loadTemplates().find((t) => t.eraId === eraId && t.scope === scope) ?? null;
}

export interface TemplateRasterKey {
  eraId: string;
  scope: string;
  /** Does this card carry the layout's optional element (the evolution medallion)? */
  evolves: boolean;
  width: number;
  height: number;
}

export function templateCachePath(k: TemplateRasterKey): string {
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(
    CACHE_ROOT, 'foil-templates', safe(k.eraId), safe(k.scope),
    `${k.evolves ? 'evolves' : 'basic'}.${k.width}x${k.height}.png`,
  );
}

/**
 * The template's mask PNG for this layout class, from disk or freshly rasterised.
 *
 * Returns null when no template covers (eraId, scope) — the caller should then behave
 * exactly as it did before templates existed (404), never invent a mask.
 */
export async function templateMaskPng(k: TemplateRasterKey): Promise<Buffer | null> {
  const tpl = findTemplate(k.eraId, k.scope);
  if (!tpl) return null;

  const path = templateCachePath(k);
  if (existsSync(path)) {
    try { return await readFile(path); } catch { /* fall through and rebuild */ }
  }

  const alpha = rasterizeTemplate(tpl, k.width, k.height, { evolves: k.evolves });
  const rgba = new Uint8Array(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = TINT[0]; rgba[i * 4 + 1] = TINT[1]; rgba[i * 4 + 2] = TINT[2]; rgba[i * 4 + 3] = alpha[i]!;
  }
  const buf = encodePng({ width: k.width, height: k.height, rgba });

  // Write through a temp name: two concurrent requests for a cold key must never let a
  // reader see a half-written PNG.
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, path);
  } catch { /* a cache we cannot write is still a mask we can serve */ }
  return buf;
}

/** What a caller should say about a template-derived mask: machine-made, unreviewed. */
export function templateProvenanceHeaders(tpl: VectorTemplate, evolves: boolean): Record<string, string> {
  return {
    'X-Foil-Mask-Source': 'vector-template',
    'X-Foil-Mask-Generator': `${tpl.provenance.generator.name}@${tpl.provenance.generator.version}`,
    'X-Foil-Mask-Run-Id': tpl.provenance.generator.runId,
    'X-Foil-Mask-Review-Status': 'unreviewed',
    'X-Foil-Mask-Exemplars': String(tpl.provenance.exemplars.length),
    'X-Foil-Mask-Optional-Element': evolves ? 'present' : 'absent',
  };
}
