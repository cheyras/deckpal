// foil/mask-artifacts.ts — sidecar-v2 artifact generation for hand masks.
//
// Every hand-mask save records the STARTING PRIOR (what the deterministic
// layout rule produced for this card/variant at save time) and persists it as
// a rendered PNG plus a computed diff (hand vs prior, added/removed regions
// visually distinct). The point (Chey's greenlit vision, 2026-08-01): the
// hand mask alone says "this is right"; the prior + diff say "and THIS is
// what the current rule got wrong" — which is what lets future agent passes
// codify per-era mask rules and measure new rules against the human corpus.
// See .claude/skills/mask-pipeline/SKILL.md ("Sidecar v2" and "Codify").
//
// The prior is rendered HERE, server-side, from the client-reported resolver
// output (rect/radius/invert in UV y-up, exactly what maskForScope returns) —
// never from a client-rendered bitmap, so the artifact can't drift from the
// recorded numbers.

import { decodePng, encodePng, type RgbaImage } from './png.js';

/** What the layout tier resolved to when the hand-edit session was saved. */
export interface MaskPrior {
  /** Where editing started: the layout rule (always, today). */
  source: 'layout';
  eraId: string;
  scope: 'window' | 'sheet' | 'full' | 'none';
  /** maskForScope() output — UV space, y UP, fractions of the card face. */
  rect: [number, number, number, number];
  /** Corner radius, fraction of card width. */
  radius: number;
  invert: boolean;
  /** Mask feather in effect on the workbench (UV of width). */
  feather: number;
  /** Version of apps/web/src/foil/resolver.ts that produced this. */
  resolverVersion: number;
}

export interface DiffStats {
  /** Pixels the human ADDED (foil in hand mask, not in prior). */
  addedPx: number;
  /** Pixels the human REMOVED (foil in prior, erased by hand). */
  removedPx: number;
  /** Foil pixels hand and prior agree on. */
  unchangedPx: number;
  /** Jaccard agreement: unchanged / (unchanged + added + removed). 1 = rule already perfect. */
  agreement: number;
}

// Display tint for rendered masks — matches MaskEditor.tsx TINT (alpha is the
// mask; RGB is only for humans looking at the PNG).
const TINT: [number, number, number] = [255, 45, 100];
// Diff colors: added = green, removed = red, agreed foil = faint white.
const ADDED: [number, number, number] = [64, 220, 120];
const REMOVED: [number, number, number] = [255, 70, 70];

const FOIL_THRESHOLD = 128; // alpha >= 128 counts as foil (strokes are ~binary)

/** Rasterize the layout prior into an alpha coverage field (y-down, w×h). */
export function rasterizePriorAlpha(width: number, height: number, prior: MaskPrior): Uint8Array {
  const [rx, ryUp, rw, rh] = prior.rect;
  // UV y-up rect → pixel-space y-down rect.
  const px = rx * width;
  const py = (1 - ryUp - rh) * height;
  const pw = rw * width;
  const ph = rh * height;
  const rad = Math.min(prior.radius * width, pw / 2, ph / 2);
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const hw = pw / 2;
  const hh = ph / 2;

  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rounded-rect SDF (same shape the shader + MaskEditor use), 1px AA.
      const qx = Math.abs(x + 0.5 - cx) - hw + rad;
      const qy = Math.abs(y + 0.5 - cy) - hh + rad;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inside = Math.min(Math.max(qx, qy), 0);
      const d = outside + inside - rad;
      let cov = Math.min(1, Math.max(0, 0.5 - d)); // d in px; 1px edge
      if (prior.invert) cov = 1 - cov;
      alpha[y * width + x] = Math.round(cov * 255);
    }
  }
  return alpha;
}

/** Render the prior as a viewable PNG (tint RGB, alpha = coverage). */
export function renderPriorPng(width: number, height: number, prior: MaskPrior): Buffer {
  const alpha = rasterizePriorAlpha(width, height, prior);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < alpha.length; i++) {
    const o = i * 4;
    rgba[o] = TINT[0];
    rgba[o + 1] = TINT[1];
    rgba[o + 2] = TINT[2];
    rgba[o + 3] = alpha[i]!;
  }
  return encodePng({ width, height, rgba });
}

/**
 * Diff the hand mask against the prior. Returns a PNG (green = human added,
 * red = human removed, faint white = agreed foil, transparent = agreed empty)
 * plus pixel stats for the codification ritual.
 */
export function diffMask(
  hand: RgbaImage,
  priorAlpha: Uint8Array,
): { png: Buffer; stats: DiffStats } {
  const { width, height, rgba } = hand;
  if (priorAlpha.length !== width * height) throw new Error('prior/hand size mismatch');
  const out = new Uint8Array(width * height * 4);
  let addedPx = 0;
  let removedPx = 0;
  let unchangedPx = 0;
  for (let i = 0; i < priorAlpha.length; i++) {
    const inHand = rgba[i * 4 + 3]! >= FOIL_THRESHOLD;
    const inPrior = priorAlpha[i]! >= FOIL_THRESHOLD;
    const o = i * 4;
    if (inHand && inPrior) {
      unchangedPx++;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = 48;
    } else if (inHand) {
      addedPx++;
      out[o] = ADDED[0]; out[o + 1] = ADDED[1]; out[o + 2] = ADDED[2];
      out[o + 3] = 255;
    } else if (inPrior) {
      removedPx++;
      out[o] = REMOVED[0]; out[o + 1] = REMOVED[1]; out[o + 2] = REMOVED[2];
      out[o + 3] = 255;
    }
  }
  const union = unchangedPx + addedPx + removedPx;
  const stats: DiffStats = {
    addedPx,
    removedPx,
    unchangedPx,
    agreement: union === 0 ? 1 : Number((unchangedPx / union).toFixed(4)),
  };
  return { png: encodePng({ width, height, rgba: out }), stats };
}

/** Parse + sanity-check a client-supplied prior payload. Throws on junk. */
export function parsePrior(raw: unknown): MaskPrior {
  const p = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('prior has non-finite number');
    return n;
  };
  const scope = String(p.scope);
  if (!['window', 'sheet', 'full', 'none'].includes(scope)) throw new Error('prior.scope invalid');
  const rectRaw = p.rect;
  if (!Array.isArray(rectRaw) || rectRaw.length !== 4) throw new Error('prior.rect must be [x,y,w,h]');
  const rect = rectRaw.map(num) as [number, number, number, number];
  for (const v of rect) if (v < -0.5 || v > 1.5) throw new Error('prior.rect out of range');
  const eraId = String(p.eraId ?? '');
  if (!/^[a-z0-9-]{1,32}$/.test(eraId)) throw new Error('prior.eraId invalid');
  return {
    source: 'layout',
    eraId,
    scope: scope as MaskPrior['scope'],
    rect,
    radius: Math.min(Math.max(num(p.radius), 0), 0.5),
    invert: Boolean(p.invert),
    feather: Math.min(Math.max(num(p.feather), 0), 0.25),
    resolverVersion: Math.round(num(p.resolverVersion)),
  };
}

export { decodePng, encodePng };
