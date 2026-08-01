import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncHandler, badRequest, notFound, str } from '../http.js';
import { decodePng, diffMask, parsePrior, rasterizePriorAlpha, renderPriorPng, type MaskPrior } from '../foil/mask-artifacts.js';

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
 *    sidecar v2 with the starting prior, + <variantId>.prior.png rendered from
 *    the layout rule, + <variantId>.diff.png hand-vs-prior). Alpha channel IS
 *    the mask (opaque = foil). Drawn on the workbench with Apple Pencil; the
 *    explicit purpose is a ground-truth corpus (mask + what the rule got
 *    wrong) that the codify ritual in mask-pipeline SKILL.md turns into
 *    per-era mask rules. Deliberately NOT in the image cache — that path is a
 *    contract for card art only. Masks are artwork-keyed: GETs alias across
 *    variants of the same card (same scan) with matching prior.scope.
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

function maskPaths(cardId: string, variantId: string): { png: string; json: string; prior: string; diff: string } {
  const dir = join(MASKS_DIR, cardId);
  return {
    png: join(dir, `${variantId}.png`),
    json: join(dir, `${variantId}.json`),
    prior: join(dir, `${variantId}.prior.png`),
    diff: join(dir, `${variantId}.diff.png`),
  };
}

interface MaskSidecar {
  version?: number;
  cardId: string;
  variantId: number;
  artworkKey?: string;
  width: number;
  height: number;
  channel: string;
  derivation_method: string;
  savedAt: string;
  prior?: MaskPrior;
  priorPng?: string;
  diffPng?: string;
  diff?: { addedPx: number; removedPx: number; unchangedPx: number; agreement: number };
}

async function readSidecar(cardId: string, variantId: string): Promise<MaskSidecar | null> {
  try {
    return JSON.parse(await readFile(maskPaths(cardId, variantId).json, 'utf8')) as MaskSidecar;
  } catch {
    return null;
  }
}

/**
 * Artwork-keyed alias resolution (Chey, 2026-08-01: the mask "should be the
 * same one for all the ones of this Machamp because they have the same
 * picture"). What the catalog PROVES: all variants of one cardId render the
 * same scan — card imagery is keyed per card (cache path set/localId; the
 * card_variant table has no imagery), so a hand mask drawn on that scan is a
 * property of the ILLUSTRATION-as-scanned, not of the variant. What it does
 * NOT prove: artwork identity across different cardIds (reprints) — no
 * illustration key exists, so cross-card reuse stays per-card (never guess).
 *
 * Resolution for GET (cardId, variantId, scope?): exact file wins; otherwise
 * any sibling variant's mask on the SAME card whose recorded prior.scope
 * matches the requested scope (same artwork + same foil zone class), newest
 * savedAt first. v1 sidecars (no prior) are never aliased — no guessing.
 */
async function resolveMask(
  cardId: string,
  variantId: string,
  scope: string | null,
): Promise<{ variantId: string; sidecar: MaskSidecar | null; aliasOf: string | null } | null> {
  if (existsSync(maskPaths(cardId, variantId).png)) {
    return { variantId, sidecar: await readSidecar(cardId, variantId), aliasOf: null };
  }
  if (!scope) return null;
  let entries: string[];
  try {
    entries = await readdir(join(MASKS_DIR, cardId));
  } catch {
    return null;
  }
  const candidates: { variantId: string; sidecar: MaskSidecar }[] = [];
  for (const f of entries) {
    const m = /^(\d{1,10})\.json$/.exec(f);
    if (!m || m[1] === variantId) continue;
    const sc = await readSidecar(cardId, m[1]!);
    if (sc?.prior?.scope === scope && existsSync(maskPaths(cardId, m[1]!).png)) {
      candidates.push({ variantId: m[1]!, sidecar: sc });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.sidecar.savedAt < b.sidecar.savedAt ? 1 : -1));
  const best = candidates[0]!;
  return { variantId: best.variantId, sidecar: best.sidecar, aliasOf: best.variantId };
}

function maskMetaHeaders(
  res: { setHeader: (k: string, v: string) => void },
  r: { sidecar: MaskSidecar | null; aliasOf: string | null },
): void {
  if (r.sidecar?.savedAt) res.setHeader('X-Foil-Mask-Saved-At', r.sidecar.savedAt);
  if (r.aliasOf) res.setHeader('X-Foil-Mask-Alias-Of', r.aliasOf);
  res.setHeader('X-Foil-Mask-Prior', r.sidecar?.priorPng ? '1' : '0');
  res.setHeader('X-Foil-Mask-Diff', r.sidecar?.diffPng ? '1' : '0');
}

function validIds(cardId: unknown, variantId: unknown): { cardId: string; variantId: string } {
  const c = str(cardId);
  const v = str(variantId);
  if (!c || !CARD_ID_RE.test(c)) throw badRequest('Invalid cardId.');
  if (!v || !VARIANT_ID_RE.test(v)) throw badRequest('Invalid variantId.');
  return { cardId: c, variantId: v };
}

// ── Masks ──────────────────────────────────────────────────────────────────

const SCOPES = new Set(['window', 'sheet', 'full', 'none']);

function scopeParam(req: { query: Record<string, unknown> }): string | null {
  const s = str(req.query.scope);
  if (!s) return null;
  if (!SCOPES.has(s)) throw badRequest('Invalid scope.');
  return s;
}

foilLabRouter.get(
  '/masks/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const r = await resolveMask(cardId, variantId, scopeParam(req as { query: Record<string, unknown> }));
    if (!r) throw notFound('No hand mask for this card/variant.');
    const buf = await readFile(maskPaths(cardId, r.variantId).png);
    res.setHeader('Cache-Control', 'no-store'); // editing surface — never stale
    maskMetaHeaders(res, r);
    res.type('png').send(buf);
  }),
);

// Sidecar + artifact availability, resolved through the same artwork aliasing.
foilLabRouter.get(
  '/masks/:cardId/:variantId/meta',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const r = await resolveMask(cardId, variantId, scopeParam(req as { query: Record<string, unknown> }));
    if (!r || !r.sidecar) throw notFound('No hand mask for this card/variant.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ aliasOf: r.aliasOf ? Number(r.aliasOf) : null, sidecar: r.sidecar });
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

    // Sidecar v2: the save must record the starting prior (the deterministic
    // layout-rule output for this card/variant) and persist it as a rendered
    // PNG + a hand-vs-prior diff — the corpus carries the rule's error, not
    // just the human's answer. A save without a parsable prior is a 400: a
    // corpus entry that can't be diffed teaches nothing.
    let prior: MaskPrior;
    try {
      prior = parsePrior(body.prior);
    } catch (e) {
      throw badRequest(`prior invalid: ${(e as Error).message}`);
    }
    let hand;
    try {
      hand = decodePng(buf);
    } catch (e) {
      throw badRequest(`png undecodable: ${(e as Error).message}`);
    }
    if (hand.width !== width || hand.height !== height) throw badRequest('png dimensions do not match width/height.');

    const priorAlpha = rasterizePriorAlpha(width, height, prior);
    const priorPng = renderPriorPng(width, height, prior);
    const { png: diffPng, stats } = diffMask(hand, priorAlpha);

    const paths = maskPaths(cardId, variantId);
    mkdirSync(dirname(paths.png), { recursive: true });
    await writeFile(paths.png, buf);
    await writeFile(paths.prior, priorPng);
    await writeFile(paths.diff, diffPng);
    const sidecar: MaskSidecar = {
      version: 2,
      cardId,
      variantId: Number(variantId),
      // Identity rule: the mask belongs to the card's SCAN (all variants of a
      // cardId share one scan; see resolveMask). Cross-card artwork identity
      // is unprovable from the catalog, so the key stays the cardId.
      artworkKey: cardId,
      width,
      height,
      channel: 'alpha', // alpha = mask; RGB is display tint only
      derivation_method: 'hand',
      savedAt: new Date().toISOString(),
      prior,
      priorPng: `${variantId}.prior.png`,
      diffPng: `${variantId}.diff.png`,
      diff: stats,
    };
    await writeFile(paths.json, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
    res.json({ saved: `data/foil-masks/${cardId}/${variantId}.png`, ...sidecar });
  }),
);

foilLabRouter.delete(
  '/masks/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const { png, json, prior, diff } = maskPaths(cardId, variantId);
    let removed = false;
    for (const p of [png, json, prior, diff]) {
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
      // Comment↔mask linkage: which hand-mask file (and which save of it) the
      // comment is talking about — captured by the client automatically so
      // "here's why I changed this" is mechanically joined to the mask state.
      line('maskFile'),
      line('maskSavedAt'),
      line('maskAliasOf'),
      line('maskHasPriorDiff'),
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
