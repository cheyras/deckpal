import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises';
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
 * 3. Canon pattern defaults — `data/foil-canon/<patternId>.json`. The canon
 *    lab (surface A of the workbench split, /pokedex/foil-lab/canon) locks
 *    down THE canonical look of each holofoil pattern against the video
 *    reference corpus. A canon file is a FULL uniform snapshot; when present
 *    it replaces the recipe's code defaults as the baseline on both surfaces.
 * 4. Per-card overrides — `data/foil-overrides/<cardId>/<variantId>.json`.
 *    The card surface saves a SPARSE uniform diff relative to the canon
 *    baseline (card-to-card differences only; untouched uniforms keep
 *    tracking canon as it evolves).
 * 5. Reference media — GET-only streaming of the committed
 *    `research/foil-video-reference/<pattern>/` mini-clips + keyframes so the
 *    canon lab can play the real tilt clip next to the bare pattern render.
 *    Dev-instance only (env gate) — nothing ships into prod builds.
 * 6. Glyph slot assets (R3-GLYPH) — GET-only serving of Chey's real glyph
 *    artwork from `research/foil-glyphs/<pattern>/` (glyph.svg or
 *    glyph-1.svg…glyph-16.svg; .png accepted too). The index route reports
 *    files + max mtime so the web loader auto-picks-up a freshly dropped or
 *    edited file without a rebuild. See research/foil-glyphs/README.md.
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
const CANON_DIR = join(repoRoot(), 'data', 'foil-canon');
const OVERRIDES_DIR = join(repoRoot(), 'data', 'foil-overrides');
const WINDOWS_DIR = join(repoRoot(), 'data', 'foil-windows');
const REFERENCE_DIR = join(repoRoot(), 'research', 'foil-video-reference');
const GLYPHS_DIR = join(repoRoot(), 'research', 'foil-glyphs');

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
      // Adjusted-window linkage (foil/mask-refine): geometry state the
      // comment describes; full rect lives in context.json.
      line('windowAdjusted'),
      line('windowSavedAt'),
      line('windowAliasOf'),
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

// ── Canon pattern defaults (surface A: the canon lab) ──────────────────────
//
// data/foil-canon/<patternId>.json — a FULL uniform snapshot ("this is what
// the pattern looks like, period"), versionable in-repo. When a canon file
// exists it replaces the recipe's code defaults as the baseline; deleting it
// falls back to code. Pattern re-tunes in patterns.ts (the R0 lane) stay
// meaningful for patterns Chey hasn't locked yet.

const PATTERN_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UNIFORM_KEY_RE = /^u[A-Za-z0-9]{1,31}$/;
const MAX_NOTE = 2_000;

function validPatternId(raw: unknown): string {
  const p = str(raw);
  if (!p || !PATTERN_ID_RE.test(p)) throw badRequest('Invalid patternId.');
  return p;
}

/** Uniform maps come from sliders — finite numbers keyed like uniforms, or 400. */
function parseUniforms(raw: unknown, { allowEmpty }: { allowEmpty: boolean }): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badRequest('uniforms must be an object.');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 64) throw badRequest('Too many uniforms.');
  if (!allowEmpty && entries.length === 0) throw badRequest('uniforms is empty.');
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!UNIFORM_KEY_RE.test(k)) throw badRequest(`Bad uniform key: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`Uniform ${k} must be a finite number.`);
    out[k] = v;
  }
  return out;
}

interface CanonEntry {
  version: 1;
  patternId: string;
  savedAt: string;
  uniforms: Record<string, number>;
  note?: string;
}

foilLabRouter.get(
  '/canon',
  asyncHandler(async (_req, res) => {
    const patterns: Record<string, CanonEntry> = {};
    let files: string[] = [];
    try {
      files = await readdir(CANON_DIR);
    } catch {
      /* no canon saved yet */
    }
    for (const f of files) {
      const m = /^([a-z0-9][a-z0-9-]{0,63})\.json$/.exec(f);
      if (!m) continue;
      try {
        const entry = JSON.parse(await readFile(join(CANON_DIR, f), 'utf8')) as CanonEntry;
        patterns[m[1]!] = entry;
      } catch {
        /* unreadable file — skip rather than 500 the whole index */
      }
    }
    res.setHeader('Cache-Control', 'no-store'); // editing surface — never stale
    res.json({ patterns });
  }),
);

foilLabRouter.put(
  '/canon/:patternId',
  asyncHandler(async (req, res) => {
    const patternId = validPatternId(req.params.patternId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const uniforms = parseUniforms(body.uniforms, { allowEmpty: false });
    const note = str(body.note)?.trim();
    if (note && note.length > MAX_NOTE) throw badRequest('note too long.');
    const entry: CanonEntry = {
      version: 1,
      patternId,
      savedAt: new Date().toISOString(),
      uniforms,
      ...(note ? { note } : {}),
    };
    mkdirSync(CANON_DIR, { recursive: true });
    await writeFile(join(CANON_DIR, `${patternId}.json`), JSON.stringify(entry, null, 2) + '\n', 'utf8');
    res.json({ saved: `data/foil-canon/${patternId}.json`, ...entry });
  }),
);

foilLabRouter.delete(
  '/canon/:patternId',
  asyncHandler(async (req, res) => {
    const patternId = validPatternId(req.params.patternId);
    let removed = false;
    try {
      await unlink(join(CANON_DIR, `${patternId}.json`));
      removed = true;
    } catch {
      /* absent is fine */
    }
    res.json({ removed });
  }),
);

// ── Per-card overrides (surface B: the card adjustment surface) ────────────
//
// data/foil-overrides/<cardId>/<variantId>.json — SPARSE uniform values that
// differ from the canon baseline for this card/variant, plus which pattern
// they tune. Untouched uniforms keep tracking canon as it evolves.

interface OverrideEntry {
  version: 1;
  cardId: string;
  variantId: number;
  /** The effective pattern these overrides tune (canonical id). */
  patternId: string;
  /** Explicit dropdown override at save time, or null when Auto resolved it. */
  patternOverride: string | null;
  savedAt: string;
  uniforms: Record<string, number>;
  /** Provenance: which canon save (if any) the sparse diff was taken against. */
  baseline: { canonSavedAt: string | null };
}

function overridePath(cardId: string, variantId: string): string {
  return join(OVERRIDES_DIR, cardId, `${variantId}.json`);
}

foilLabRouter.get(
  '/overrides/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    let entry: OverrideEntry;
    try {
      entry = JSON.parse(await readFile(overridePath(cardId, variantId), 'utf8')) as OverrideEntry;
    } catch {
      throw notFound('No card overrides for this card/variant.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(entry);
  }),
);

foilLabRouter.put(
  '/overrides/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patternId = validPatternId(body.patternId);
    // Sparse map — empty means "no differences": that's a DELETE, not a save.
    const uniforms = parseUniforms(body.uniforms, { allowEmpty: false });
    const rawPo = str(body.patternOverride);
    const patternOverride = rawPo && rawPo !== 'auto' ? validPatternId(rawPo) : null;
    const baselineRaw = (body.baseline ?? {}) as Record<string, unknown>;
    const canonSavedAt = str(baselineRaw.canonSavedAt) ?? null;
    const entry: OverrideEntry = {
      version: 1,
      cardId,
      variantId: Number(variantId),
      patternId,
      patternOverride,
      savedAt: new Date().toISOString(),
      uniforms,
      baseline: { canonSavedAt },
    };
    mkdirSync(join(OVERRIDES_DIR, cardId), { recursive: true });
    await writeFile(overridePath(cardId, variantId), JSON.stringify(entry, null, 2) + '\n', 'utf8');
    res.json({ saved: `data/foil-overrides/${cardId}/${variantId}.json`, ...entry });
  }),
);

foilLabRouter.delete(
  '/overrides/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    let removed = false;
    try {
      await unlink(overridePath(cardId, variantId));
      removed = true;
    } catch {
      /* absent is fine */
    }
    res.json({ removed });
  }),
);

// ── Adjusted window geometry (foil/mask-refine — pre-flatten state) ────────
//
// data/foil-windows/<cardId>/<variantId>.json — the hand-adjusted layout
// window rect for a card (UV y-up, maskForScope's space) + corner radius.
// This is the PRE-FLATTEN state of Chey's "handles → flatten → refine"
// workflow: while no hand mask exists the layout tier renders this rect
// instead of the era rect; Flatten bakes it into a normal hand mask (the
// mask save records it as prior.window provenance). Artwork-keyed like
// masks — the window box is a property of the SCAN (all variants share it;
// scope only decides inversion at render time), so GETs alias to any
// sibling variant's geometry, newest savedAt first, unconditionally.

interface WindowEntry {
  version: 1;
  cardId: string;
  variantId: number;
  artworkKey: string;
  savedAt: string;
  /** Scope active when adjusted (provenance only — applies to window AND sheet). */
  scope: string;
  eraId: string;
  rect: [number, number, number, number];
  radius: number;
  invert: boolean;
  /** The era-layout rule this geometry adjusted, at save time. */
  base: { rect: [number, number, number, number]; radius: number; resolverVersion: number };
}

function windowPath(cardId: string, variantId: string): string {
  return join(WINDOWS_DIR, cardId, `${variantId}.json`);
}

async function readWindowEntry(cardId: string, variantId: string): Promise<WindowEntry | null> {
  try {
    return JSON.parse(await readFile(windowPath(cardId, variantId), 'utf8')) as WindowEntry;
  } catch {
    return null;
  }
}

/** Exact file wins; otherwise newest sibling variant's geometry (same scan). */
async function resolveWindow(
  cardId: string,
  variantId: string,
): Promise<{ entry: WindowEntry; aliasOf: string | null } | null> {
  const exact = await readWindowEntry(cardId, variantId);
  if (exact) return { entry: exact, aliasOf: null };
  let files: string[];
  try {
    files = await readdir(join(WINDOWS_DIR, cardId));
  } catch {
    return null;
  }
  const candidates: WindowEntry[] = [];
  for (const f of files) {
    const m = /^(\d{1,10})\.json$/.exec(f);
    if (!m || m[1] === variantId) continue;
    const e = await readWindowEntry(cardId, m[1]!);
    if (e) candidates.push(e);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  const best = candidates[0]!;
  return { entry: best, aliasOf: String(best.variantId) };
}

function parseWindowRect(raw: unknown, what: string): [number, number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 4) throw badRequest(`${what} must be [x,y,w,h].`);
  const rect = raw.map((v) => Number(v)) as [number, number, number, number];
  for (const v of rect) {
    if (!Number.isFinite(v) || v < -0.5 || v > 1.5) throw badRequest(`${what} out of range.`);
  }
  return rect;
}

foilLabRouter.get(
  '/windows/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const r = await resolveWindow(cardId, variantId);
    if (!r) throw notFound('No adjusted window for this card/variant.');
    res.setHeader('Cache-Control', 'no-store'); // editing surface — never stale
    res.json({ aliasOf: r.aliasOf ? Number(r.aliasOf) : null, entry: r.entry });
  }),
);

foilLabRouter.put(
  '/windows/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scope = str(body.scope);
    if (!scope || !SCOPES.has(scope)) throw badRequest('Invalid scope.');
    const eraId = str(body.eraId);
    if (!eraId || !/^[a-z0-9-]{1,32}$/.test(eraId)) throw badRequest('Invalid eraId.');
    const rect = parseWindowRect(body.rect, 'rect');
    const radius = Number(body.radius);
    if (!Number.isFinite(radius) || radius < 0 || radius > 0.5) throw badRequest('radius out of range.');
    const baseRaw = (body.base ?? {}) as Record<string, unknown>;
    const baseRect = parseWindowRect(baseRaw.rect, 'base.rect');
    const baseRadius = Number(baseRaw.radius);
    if (!Number.isFinite(baseRadius) || baseRadius < 0 || baseRadius > 0.5) throw badRequest('base.radius out of range.');
    const resolverVersion = Number(baseRaw.resolverVersion);
    if (!Number.isInteger(resolverVersion)) throw badRequest('base.resolverVersion must be an integer.');
    const entry: WindowEntry = {
      version: 1,
      cardId,
      variantId: Number(variantId),
      // Same identity rule as masks: the geometry belongs to the card's SCAN.
      artworkKey: cardId,
      savedAt: new Date().toISOString(),
      scope,
      eraId,
      rect,
      radius,
      invert: Boolean(body.invert),
      base: { rect: baseRect, radius: baseRadius, resolverVersion },
    };
    mkdirSync(join(WINDOWS_DIR, cardId), { recursive: true });
    await writeFile(windowPath(cardId, variantId), JSON.stringify(entry, null, 2) + '\n', 'utf8');
    res.json({ saved: `data/foil-windows/${cardId}/${variantId}.json`, ...entry });
  }),
);

foilLabRouter.delete(
  '/windows/:cardId/:variantId',
  asyncHandler(async (req, res) => {
    const { cardId, variantId } = validIds(req.params.cardId, req.params.variantId);
    let removed = false;
    try {
      await unlink(windowPath(cardId, variantId));
      removed = true;
    } catch {
      /* absent is fine */
    }
    res.json({ removed });
  }),
);

// ── Pattern → assigned cards (canon lab: the card preview) ─────────────────
//
// GET /pattern-cards/:patternId?sample=N — random catalog cards the v5
// resolver actually assigns the pattern to, from the BAKED inversion file
// data/foil-pattern-cards.json (tools/foil/build-pattern-cards.mts — the
// resolver is client code and this router is deliberately DB-free, so the
// inversion is baked, not queried). Sampling happens HERE so the client
// never downloads the whole pool; the client enriches each hit via the
// normal /cards/:cardId detail route. Empty pool = the pattern has no
// catalog cards (canon lab shows "no catalog cards" and disables the
// re-randomize button). The file is gitignored (catalog derivative) — a 404
// tells the operator the regen command.

const PATTERN_CARDS_FILE = join(repoRoot(), 'data', 'foil-pattern-cards.json');

interface PatternCardsFile {
  version: number;
  generatedAt: string;
  resolverVersion: number;
  patterns: Record<string, [string, number, string, string][]>;
}

let patternCardsCache: { mtimeMs: number; data: PatternCardsFile } | null = null;

async function loadPatternCards(): Promise<PatternCardsFile | null> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(PATTERN_CARDS_FILE)).mtimeMs;
  } catch {
    return null;
  }
  if (!patternCardsCache || patternCardsCache.mtimeMs !== mtimeMs) {
    patternCardsCache = { mtimeMs, data: JSON.parse(await readFile(PATTERN_CARDS_FILE, 'utf8')) as PatternCardsFile };
  }
  return patternCardsCache.data;
}

foilLabRouter.get(
  '/pattern-cards/:patternId',
  asyncHandler(async (req, res) => {
    const patternId = validPatternId(req.params.patternId);
    const rawSample = Number(str(req.query.sample) ?? '12');
    const sampleN = Number.isInteger(rawSample) && rawSample >= 1 && rawSample <= 50 ? rawSample : 12;
    const file = await loadPatternCards();
    if (!file) {
      throw notFound(
        'data/foil-pattern-cards.json missing — regenerate: pnpm --filter pokedex-api exec tsx ../../tools/foil/build-pattern-cards.mts',
      );
    }
    const pool = file.patterns[patternId] ?? [];
    // Partial Fisher–Yates over an index array: sample without replacement.
    const idx = pool.map((_, i) => i);
    const n = Math.min(sampleN, idx.length);
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (idx.length - i));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    const sample = idx.slice(0, n).map((i) => {
      const [cardId, variantId, kind, scope] = pool[i]!;
      return { cardId, variantId, kind, scope };
    });
    res.setHeader('Cache-Control', 'no-store'); // every GET is a fresh shuffle
    res.json({
      patternId,
      total: pool.length,
      sample,
      generatedAt: file.generatedAt,
      resolverVersion: file.resolverVersion,
    });
  }),
);

// ── Reference media (canon lab: the real tilt clip beside the render) ──────
//
// Streams committed research/foil-video-reference/<pattern>/ assets. GET-only,
// whitelisted filenames, res.sendFile (Range support — iOS Safari refuses
// <video> sources served without byte ranges). Never copies media anywhere.

const REFERENCE_FILE_RE = /^(clip\.webm|frame-0[1-8]\.jpg)$/;

foilLabRouter.get(
  '/reference',
  asyncHandler(async (_req, res) => {
    const patterns: Record<string, { clip: boolean; frames: number }> = {};
    let dirs: string[] = [];
    try {
      dirs = await readdir(REFERENCE_DIR);
    } catch {
      /* corpus missing in this checkout */
    }
    for (const d of dirs) {
      if (!PATTERN_ID_RE.test(d)) continue; // skips pipeline/, _interlude…, README.md
      let files: string[];
      try {
        files = await readdir(join(REFERENCE_DIR, d));
      } catch {
        continue;
      }
      patterns[d] = {
        clip: files.includes('clip.webm'),
        frames: files.filter((f) => /^frame-0[1-8]\.jpg$/.test(f)).length,
      };
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({ patterns });
  }),
);

// ── Glyph slot assets (R3-GLYPH: Chey's real glyph artwork) ────────────────
//
// research/foil-glyphs/<pattern>/glyph.svg (single) or glyph-1.svg… (atlas
// set). GET-only; the web loader (apps/web/src/foil/glyphs.ts) polls the index
// and re-rasterizes when mtime changes — dropping a file IS the deploy.

const GLYPH_FILE_RE = /^glyph(-\d{1,2})?\.(svg|png)$/;

/** glyph.svg first, then glyph-1..glyph-16 in numeric order. */
function glyphOrder(f: string): number {
  const m = /^glyph-(\d{1,2})\./.exec(f);
  return m ? Number(m[1]) : 0;
}

foilLabRouter.get(
  '/glyphs',
  asyncHandler(async (_req, res) => {
    const patterns: Record<string, { files: string[]; mtime: number }> = {};
    let dirs: string[] = [];
    try {
      dirs = await readdir(GLYPHS_DIR);
    } catch {
      /* no glyph assets dropped yet */
    }
    for (const d of dirs) {
      if (!PATTERN_ID_RE.test(d)) continue; // skips README.md etc.
      let files: string[];
      try {
        files = await readdir(join(GLYPHS_DIR, d));
      } catch {
        continue;
      }
      const glyphs = files.filter((f) => GLYPH_FILE_RE.test(f)).sort((a, b) => glyphOrder(a) - glyphOrder(b));
      if (glyphs.length === 0) continue;
      let mtime = 0;
      for (const f of glyphs) {
        try {
          const st = await stat(join(GLYPHS_DIR, d, f));
          mtime = Math.max(mtime, Math.round(st.mtimeMs));
        } catch {
          /* raced a delete — the next poll sees the truth */
        }
      }
      patterns[d] = { files: glyphs, mtime };
    }
    res.setHeader('Cache-Control', 'no-store'); // auto-pickup poll — never stale
    res.json({ patterns });
  }),
);

foilLabRouter.get(
  '/glyphs/:pattern/:file',
  asyncHandler(async (req, res) => {
    const pattern = validPatternId(req.params.pattern);
    const file = str(req.params.file);
    if (!file || !GLYPH_FILE_RE.test(file)) throw badRequest('Invalid glyph file.');
    const abs = join(GLYPHS_DIR, pattern, file);
    if (!existsSync(abs)) throw notFound('No such glyph asset.');
    res.setHeader('Cache-Control', 'no-store'); // editable asset — never stale
    await new Promise<void>((resolve, reject) => {
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) reject(err);
        else resolve();
      });
    });
  }),
);

foilLabRouter.get(
  '/reference/:pattern/:file',
  asyncHandler(async (req, res) => {
    const pattern = validPatternId(req.params.pattern);
    const file = str(req.params.file);
    if (!file || !REFERENCE_FILE_RE.test(file)) throw badRequest('Invalid reference file.');
    const abs = join(REFERENCE_DIR, pattern, file);
    if (!existsSync(abs)) throw notFound('No such reference asset.');
    res.setHeader('Cache-Control', 'private, max-age=3600'); // committed media — stable
    await new Promise<void>((resolve, reject) => {
      res.sendFile(abs, (err) => {
        // A client abort mid-stream (video scrubbing) surfaces here after
        // headers are gone — swallow it; only pre-send failures are real.
        if (err && !res.headersSent) reject(err);
        else resolve();
      });
    });
  }),
);
