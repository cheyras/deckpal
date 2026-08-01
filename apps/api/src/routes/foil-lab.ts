import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncHandler, badRequest, notFound, str } from '../http.js';

/**
 * foil-lab dev routes — QUARANTINED (foil/main track, roadmap/plans/foil-main.md).
 *
 * Mounted ONLY when POKEDEX_FOIL_LAB=1 (the per-branch api dev instance on port
 * 3712 — see roadmap/ORCHESTRATION.md). Prod imports this module but never
 * mounts it, so nothing foil-specific leaks into deployed behavior at merge
 * time. No DB: both surfaces write developer artefacts into the WORKING TREE
 * of whatever checkout this instance runs from (the foil worktree), where they
 * are committed as reviewable ground truth.
 *
 * 1. Hand-drawn holo masks — `data/foil-masks/<cardId>/<variantId>.png` (+ .json
 *    sidecar, derivation_method "hand"). Alpha channel IS the mask (opaque =
 *    foil). Drawn on the workbench with Apple Pencil; the explicit purpose is a
 *    ground-truth corpus an agent later compares against art scans to learn
 *    real mask rules. Deliberately NOT in the image cache — that path is a
 *    contract for card art only.
 * 2. Workbench comments — `issues/foil/<id>/report.md` + context.json. Mirrors
 *    the in-app bug reporter's shape (routes/bugs.ts) but nested one level
 *    deeper so the fix-issues sweep over issues/<id>/report.md never picks
 *    them up; they're tuning observations for bulk triage, not bugs.
 */
export const foilLabRouter: Router = Router();

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('repo root (pnpm-workspace.yaml) not found from ' + fileURLToPath(import.meta.url));
}
const MASKS_DIR = join(repoRoot(), 'data', 'foil-masks');
const COMMENTS_DIR = join(repoRoot(), 'issues', 'foil');

// Path-traversal guards: card ids are catalog ids (e.g. base1-8, me04.5-12),
// variant ids are integers. Reject anything else outright.
const CARD_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/i;
const VARIANT_ID_RE = /^\d{1,10}$/;
const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_MASK_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 20_000;

function maskPaths(cardId: string, variantId: string): { png: string; json: string } {
  const dir = join(MASKS_DIR, cardId);
  return { png: join(dir, `${variantId}.png`), json: join(dir, `${variantId}.json`) };
}

function validIds(cardId: unknown, variantId: unknown): { cardId: string; variantId: string } {
  const c = str(cardId);
  const v = str(variantId);
  if (!c || !CARD_ID_RE.test(c)) throw badRequest('Invalid cardId.');
  if (!v || !VARIANT_ID_RE.test(v)) throw badRequest('Invalid variantId.');
  return { cardId: c, variantId: v };
}

// ── Masks ──────────────────────────────────────────────────────────────────

foilLabRouter.get(
  '/masks/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const { png } = maskPaths(cardId, variantId);
    let buf: Buffer;
    try {
      buf = await readFile(png);
    } catch {
      throw notFound('No hand mask for this card/variant.');
    }
    res.setHeader('Cache-Control', 'no-store'); // editing surface — never stale
    res.type('png').send(buf);
  }),
);

foilLabRouter.put(
  '/masks/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dataUrl = str(body.png);
    if (!dataUrl) throw badRequest('png (data:image/png;base64 URL) is required.');
    const m = PNG_DATA_URL_RE.exec(dataUrl);
    if (!m) throw badRequest('png must be a data:image/png;base64 URL.');
    const buf = Buffer.from(m[1]!, 'base64');
    if (buf.length === 0) throw badRequest('Empty mask.');
    if (buf.length > MAX_MASK_BYTES) throw badRequest('Mask too large.');
    const width = Number(body.width);
    const height = Number(body.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 4096 || height > 4096)
      throw badRequest('width/height must be sane integers.');

    const { png, json } = maskPaths(cardId, variantId);
    mkdirSync(dirname(png), { recursive: true });
    await writeFile(png, buf);
    const sidecar = {
      cardId,
      variantId: Number(variantId),
      width,
      height,
      channel: 'alpha', // alpha = mask; RGB is display tint only
      derivation_method: 'hand',
      savedAt: new Date().toISOString(),
    };
    await writeFile(json, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
    res.json({ saved: `data/foil-masks/${cardId}/${variantId}.png`, ...sidecar });
  }),
);

foilLabRouter.delete(
  '/masks/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const { png, json } = maskPaths(cardId, variantId);
    let removed = false;
    for (const p of [png, json]) {
      try {
        await unlink(p);
        removed = true;
      } catch {
        /* absent is fine */
      }
    }
    res.json({ removed });
  }),
);

// ── Comments ───────────────────────────────────────────────────────────────

function newId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

foilLabRouter.post(
  '/comments',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = str(body.text)?.trim();
    if (!text) throw badRequest('A comment is required.');
    if (text.length > MAX_TEXT) throw badRequest('Comment too long.');
    const context = (body.context ?? {}) as Record<string, unknown>;

    const id = newId();
    const dir = join(COMMENTS_DIR, id);
    mkdirSync(dir, { recursive: true });

    const line = (k: string): string | null => {
      const v = context[k];
      return v === undefined || v === null || v === '' ? null : `${k}: ${String(v)}`;
    };
    const report = [
      '---',
      `id: ${id}`,
      'status: open',
      'kind: foil-comment',
      `createdAt: ${new Date().toISOString()}`,
      line('cardId'),
      line('variantId'),
      line('variantKind'),
      line('pattern'),
      line('scope'),
      line('era'),
      line('maskSource'),
      line('maskEditActive'),
      line('tiltMode'),
      line('viewport'),
      'context: context.json',
      '---',
      '',
      text,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');

    await writeFile(join(dir, 'report.md'), report, 'utf8');
    // Full machine-readable context (incl. every uniform value) for bulk triage.
    await writeFile(join(dir, 'context.json'), JSON.stringify(context, null, 2) + '\n', 'utf8');
    res.status(201).json({ id, saved: `issues/foil/${id}/` });
  }),
);
