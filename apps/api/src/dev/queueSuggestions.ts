/**
 * Labelling SUGGESTIONS for queued photos: an agent's or a script's good-faith
 * guess at how the owner would label each one, so a review is an "agree" or a
 * nudge instead of a label from scratch (owner request, 2026-11-26).
 *
 * ── A SUGGESTION IS NOT A LABEL ────────────────────────────────────────────
 *
 * Labels live in `dev-flags/` and a photo leaves the queue the moment one is
 * saved. A suggestion does neither: it is one map in one object beside the
 * queue (`dev-queue/suggestions.json`), keyed by queue photo id, and nothing
 * here touches the queue or the corpus. The photo stays pending, and stays
 * "not done", until the owner saves a label in the labeler. That label then
 * records that it started from a suggestion (`seededFrom: 'agent'`, and the
 * suggestion's own verdict), so a harvest can tell a confirmed suggestion from
 * a label drawn from scratch.
 *
 * The object name does not match the queue's `<id>.jpg|json` pattern, so the
 * queue listing, repair and discard never see it.
 */
import type { CaptureStore } from '@deckpal/storage';
import { unknownProvenance } from '@deckpal/storage';

export const SUGGESTIONS_PATH = 'dev-queue/suggestions.json';

export const INVALID_REASONS = [
  'no_card',
  'not_a_card',
  'too_blurry',
  'too_far',
  'cut_off',
  'too_dark',
  'glare_washout',
  'too_obscured',
  'too_bent',
  'too_oblique',
  'multiple_no_clear_foreground',
] as const;

export interface QuadSuggestion {
  v: 1;
  id: number;
  /** Who made it, e.g. `agent:claude-sonnet-5.5+lc050`. */
  by: string;
  createdAt: string;
  verdict: 'card' | 'back' | 'reject';
  invalidReason?: (typeof INVALID_REASONS)[number];
  /** The square, in source-photo px (may leave the photo; mirrored). Null = the centre square. */
  crop: { x: number; y: number; size: number } | null;
  /** Fractions of the canonical square, the label's own units. */
  corners?: [[number, number], [number, number], [number, number], [number, number]];
  topLeftIndex?: 0 | 1 | 2 | 3;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One suggestion, checked field by field; null when it is not one. */
export function parseSuggestion(id: string, raw: unknown): QuadSuggestion | null {
  if (!/^\d{13,16}$/.test(id) || raw == null || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.verdict !== 'card' && s.verdict !== 'back' && s.verdict !== 'reject') return null;
  if (s.confidence !== 'high' && s.confidence !== 'medium' && s.confidence !== 'low') return null;
  let crop: QuadSuggestion['crop'] = null;
  if (s.crop != null) {
    const c = s.crop as Record<string, unknown>;
    if (!isNum(c.x) || !isNum(c.y) || !isNum(c.size) || c.size <= 0) return null;
    crop = { x: Math.round(c.x), y: Math.round(c.y), size: Math.round(c.size) };
  }
  const out: QuadSuggestion = {
    v: 1,
    id: Number(id),
    by: typeof s.by === 'string' ? s.by.slice(0, 80) : 'unknown',
    createdAt: typeof s.createdAt === 'string' ? s.createdAt.slice(0, 40) : new Date(0).toISOString(),
    verdict: s.verdict,
    crop,
    confidence: s.confidence,
    ...(typeof s.note === 'string' && s.note ? { note: s.note.slice(0, 200) } : {}),
  };
  if (s.verdict === 'reject') {
    if (!INVALID_REASONS.includes(s.invalidReason as never)) return null;
    out.invalidReason = s.invalidReason as QuadSuggestion['invalidReason'];
    return out;
  }
  const corners = s.corners;
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  if (!corners.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => isNum(v) && v >= -0.5 && v <= 1.5))) return null;
  out.corners = corners.map(([x, y]) => [x, y]) as QuadSuggestion['corners'];
  const tl = s.topLeftIndex ?? 0;
  if (tl !== 0 && tl !== 1 && tl !== 2 && tl !== 3) return null;
  out.topLeftIndex = tl;
  return out;
}

export async function readSuggestions(store: CaptureStore): Promise<Record<string, QuadSuggestion>> {
  const obj = await store.read(SUGGESTIONS_PATH);
  if (!obj) return {};
  try {
    const raw = JSON.parse(obj.bytes.toString('utf8')) as Record<string, unknown>;
    const out: Record<string, QuadSuggestion> = {};
    for (const [id, s] of Object.entries(raw)) {
      const parsed = parseSuggestion(id, s);
      if (parsed) out[id] = parsed;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge `incoming` over what is stored (null deletes an id). Returns the counts. */
export async function writeSuggestions(
  store: CaptureStore,
  incoming: Record<string, unknown>,
): Promise<{ accepted: number; rejected: string[]; removed: number; total: number }> {
  const current = await readSuggestions(store);
  const rejected: string[] = [];
  let accepted = 0;
  let removed = 0;
  for (const [id, raw] of Object.entries(incoming)) {
    if (raw === null) {
      if (delete current[id]) removed++;
      continue;
    }
    const s = parseSuggestion(id, raw);
    if (!s) {
      rejected.push(id);
      continue;
    }
    current[id] = s;
    accepted++;
  }
  await store.put({
    objectPath: SUGGESTIONS_PATH,
    bytes: Buffer.from(JSON.stringify(current)),
    contentType: 'application/json',
    provenance: unknownProvenance('labelling suggestions generated for the owner to review; derived from queued photos'),
    tierProvenanceReason: 'dev-only labelling suggestions beside the labeler queue in the private dev-captures bucket; not labels, not catalog art',
  });
  return { accepted, rejected, removed, total: Object.keys(current).length };
}
