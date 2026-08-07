// foil/mask-corpus.ts — read the whole mask corpus, report on it, select
// exemplars, and emit the training-tuple manifest a generator lane consumes.
//
// Three jobs, one scan of data/foil-masks:
//
//  1. REPORT      counts by derivation_method, mean rule-agreement, breakdown
//                 by era/set/series, and the queue of `ai` masks awaiting
//                 human review. Feeds GET /foil-lab/masks/corpus and the CLI.
//  2. EXEMPLARS   selectExemplars() — THE sanctioned way to pick masks a
//                 generator (or the codify ritual) may learn from. It applies
//                 the anti-feedback-collapse rule from provenance.ts: only
//                 masks a HUMAN painted are eligible, `ai` is weight 0 and can
//                 never be selected at any corpus size.
//  3. TUPLES      trainingTuples() — (card art, prior mask, human mask, diff,
//                 correction metrics) with every path resolved, so a future
//                 generator lane reads a manifest instead of reverse-
//                 engineering the directory.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AUTHORSHIP_BY_METHOD,
  DERIVATION_METHODS,
  EXEMPLAR_WEIGHT,
  isExemplarEligible,
  maskPathsIn,
  readSidecarFile,
  REVIEW_BY_METHOD,
  type Authorship,
  type DerivationMethod,
  type ExemplarRef,
  type MaskSidecarV3,
  type ReviewStatus,
} from './provenance.js';

export interface CorpusEntry {
  cardId: string;
  variantId: number;
  sidecar: MaskSidecarV3;
  /** Repo-relative paths of everything on disk for this entry. */
  files: {
    mask: string;
    sidecar: string;
    prior: string | null;
    diff: string | null;
    parent: string | null;
    parentDiff: string | null;
  };
}

const REL = (cardId: string, file: string): string => `data/foil-masks/${cardId}/${file}`;

/** setId from a catalog cardId: 'base1-8' → 'base1', 'me04.5-12' → 'me04.5'. */
export function setIdOf(cardId: string): string | null {
  const i = cardId.lastIndexOf('-');
  return i > 0 ? cardId.slice(0, i) : null;
}

/** Scan data/foil-masks and return every mask that has a readable sidecar. */
export async function readCorpus(masksDir: string): Promise<CorpusEntry[]> {
  let dirs: string[] = [];
  try {
    dirs = await readdir(masksDir);
  } catch {
    return [];
  }
  const out: CorpusEntry[] = [];
  for (const cardId of dirs) {
    if (cardId === 'codified') continue; // the codification logs, not masks
    let files: string[];
    try {
      const st = await stat(join(masksDir, cardId));
      if (!st.isDirectory()) continue;
      files = await readdir(join(masksDir, cardId));
    } catch {
      continue;
    }
    for (const f of files) {
      const m = /^(\d{1,10})\.json$/.exec(f);
      if (!m) continue;
      const variantId = m[1]!;
      const sidecar = await readSidecarFile(masksDir, cardId, variantId);
      if (!sidecar) continue;
      const has = (name: string): string | null => (files.includes(name) ? REL(cardId, name) : null);
      out.push({
        cardId,
        variantId: Number(variantId),
        sidecar,
        files: {
          mask: REL(cardId, `${variantId}.png`),
          sidecar: REL(cardId, `${variantId}.json`),
          prior: has(`${variantId}.prior.png`),
          diff: has(`${variantId}.diff.png`),
          parent: has(`${variantId}.parent.png`),
          parentDiff: has(`${variantId}.parent.diff.png`),
        },
      });
    }
  }
  out.sort((a, b) => (a.cardId === b.cardId ? a.variantId - b.variantId : a.cardId < b.cardId ? -1 : 1));
  return out;
}

// ── Exemplar selection (anti-feedback-collapse enforced HERE) ──────────────

export interface ExemplarQuery {
  /** Restrict to one era (the layout family a generator targets). */
  eraId?: string | null;
  /** Restrict to one scope — a window mask must never teach a sheet mask. */
  scope?: string | null;
  /** Cap the number returned (highest weight, then newest). */
  limit?: number;
}

export interface ExemplarSelection {
  chosen: (CorpusEntry & { weight: number })[];
  /** Every mask considered and thrown out, with the reason — auditable. */
  rejected: { cardId: string; variantId: number; method: DerivationMethod; reason: string }[];
}

/**
 * Pick the masks a generator may learn from.
 *
 * THE SAFEGUARD: `EXEMPLAR_WEIGHT[method] > 0` is the only gate that admits a
 * mask, and it is 0 for `ai` (unreviewed machine output) and `layout-flatten`
 * (a rect the machine already knows). So a generator can never train on its own
 * unreviewed output — not by configuration, not by accident, not at n=1000.
 * `ai-corrected` is admitted at 0.6 because a human painted those pixels, but
 * anchored by what the AI proposed; pure human masks outrank it.
 */
export function selectExemplars(corpus: CorpusEntry[], q: ExemplarQuery = {}): ExemplarSelection {
  const chosen: (CorpusEntry & { weight: number })[] = [];
  const rejected: ExemplarSelection['rejected'] = [];
  for (const e of corpus) {
    const method = e.sidecar.derivation_method;
    if (!isExemplarEligible(method)) {
      rejected.push({
        cardId: e.cardId,
        variantId: e.variantId,
        method,
        reason:
          method === 'ai'
            ? 'unreviewed machine output — never an exemplar (anti-feedback-collapse)'
            : 'machine-rasterized geometry — teaches only the rect the generator already has',
      });
      continue;
    }
    if (q.eraId && e.sidecar.prior?.eraId !== q.eraId) {
      rejected.push({ cardId: e.cardId, variantId: e.variantId, method, reason: `era ${String(e.sidecar.prior?.eraId)} != ${q.eraId}` });
      continue;
    }
    if (q.scope && e.sidecar.prior?.scope !== q.scope) {
      rejected.push({ cardId: e.cardId, variantId: e.variantId, method, reason: `scope ${String(e.sidecar.prior?.scope)} != ${q.scope}` });
      continue;
    }
    chosen.push({ ...e, weight: EXEMPLAR_WEIGHT[method] });
  }
  chosen.sort((a, b) => (b.weight - a.weight) || (a.sidecar.savedAt < b.sidecar.savedAt ? 1 : -1));
  return { chosen: q.limit ? chosen.slice(0, q.limit) : chosen, rejected };
}

export function toExemplarRefs(sel: ExemplarSelection): ExemplarRef[] {
  return sel.chosen.map((e) => ({
    cardId: e.cardId,
    variantId: e.variantId,
    savedAt: e.sidecar.savedAt ?? null,
    method: e.sidecar.derivation_method,
    weight: e.weight,
  }));
}

// ── Report ─────────────────────────────────────────────────────────────────

interface Bucket {
  n: number;
  byMethod: Partial<Record<DerivationMethod, number>>;
  meanAgreement: number | null;
}

function bucket(entries: CorpusEntry[]): Bucket {
  const byMethod: Partial<Record<DerivationMethod, number>> = {};
  let sum = 0;
  let count = 0;
  for (const e of entries) {
    const m = e.sidecar.derivation_method;
    byMethod[m] = (byMethod[m] ?? 0) + 1;
    if (typeof e.sidecar.diff?.agreement === 'number') {
      sum += e.sidecar.diff.agreement;
      count++;
    }
  }
  return { n: entries.length, byMethod, meanAgreement: count ? Number((sum / count).toFixed(4)) : null };
}

function groupBy(entries: CorpusEntry[], key: (e: CorpusEntry) => string | null): Record<string, Bucket> {
  const groups = new Map<string, CorpusEntry[]>();
  for (const e of entries) {
    const k = key(e) ?? 'unknown';
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, bucket(v)]));
}

export interface AwaitingReview {
  cardId: string;
  variantId: number;
  savedAt: string;
  generator: { name: string; version: number; runId: string; modelId: string | null } | null;
  confidence: number | null;
  exemplars: number;
  /** Rule-vs-mask agreement, so a reviewer can triage the worst first. */
  agreement: number | null;
  maskUrl: string;
}

export interface CorpusReport {
  generatedAt: string;
  total: number;
  byMethod: Record<DerivationMethod, number>;
  byAuthorship: Record<string, number>;
  byReviewStatus: Record<string, number>;
  /** Mean of diff.agreement (rule vs saved mask) across the whole corpus. */
  meanAgreement: number | null;
  byEra: Record<string, Bucket>;
  bySet: Record<string, Bucket>;
  bySeries: Record<string, Bucket>;
  byScope: Record<string, Bucket>;
  /** How many masks a generator is currently allowed to learn from. */
  exemplarsAvailable: { total: number; byEra: Record<string, number>; byScope: Record<string, number> };
  /** `ai` masks no human has touched — the review queue. */
  awaitingReview: AwaitingReview[];
  /** Every human correction of a machine mask — the training signal so far. */
  corrections: {
    n: number;
    meanAgreementVsParent: number | null;
    meanChangedFraction: number | null;
    entries: {
      cardId: string;
      variantId: number;
      savedAt: string;
      parentMethod: DerivationMethod;
      generator: string | null;
      agreement: number;
      changedFraction: number;
      addedPx: number;
      removedPx: number;
    }[];
  };
  /** Sidecar schema versions on disk — proves v2 files still load. */
  bySidecarVersion: Record<string, number>;
}

export function buildReport(corpus: CorpusEntry[]): CorpusReport {
  const byMethod = Object.fromEntries(DERIVATION_METHODS.map((m) => [m, 0])) as Record<DerivationMethod, number>;
  const byAuthorship: Record<string, number> = {};
  const byReviewStatus: Record<string, number> = {};
  const bySidecarVersion: Record<string, number> = {};
  let agSum = 0;
  let agCount = 0;
  const awaitingReview: AwaitingReview[] = [];
  const corrections: CorpusReport['corrections']['entries'] = [];

  for (const e of corpus) {
    const s = e.sidecar;
    byMethod[s.derivation_method]++;
    byAuthorship[AUTHORSHIP_BY_METHOD[s.derivation_method]] =
      (byAuthorship[AUTHORSHIP_BY_METHOD[s.derivation_method]] ?? 0) + 1;
    byReviewStatus[REVIEW_BY_METHOD[s.derivation_method]] =
      (byReviewStatus[REVIEW_BY_METHOD[s.derivation_method]] ?? 0) + 1;
    bySidecarVersion[String(s.version)] = (bySidecarVersion[String(s.version)] ?? 0) + 1;
    if (typeof s.diff?.agreement === 'number') {
      agSum += s.diff.agreement;
      agCount++;
    }
    if (s.derivation_method === 'ai') {
      const g = s.prior?.generator ?? null;
      awaitingReview.push({
        cardId: e.cardId,
        variantId: e.variantId,
        savedAt: s.savedAt,
        generator: g ? { name: g.name, version: g.version, runId: g.runId, modelId: g.modelId } : null,
        confidence: g?.confidence ?? null,
        exemplars: g?.exemplars.length ?? 0,
        agreement: s.diff?.agreement ?? null,
        maskUrl: `/pokedex/api/foil-lab/masks/${e.cardId}/${e.variantId}`,
      });
    }
    if (s.correction) {
      corrections.push({
        cardId: e.cardId,
        variantId: e.variantId,
        savedAt: s.savedAt,
        parentMethod: s.correction.parent.method,
        generator: s.correction.parent.generator
          ? `${s.correction.parent.generator.name}@${s.correction.parent.generator.version}`
          : null,
        agreement: s.correction.agreement,
        changedFraction: s.correction.changedFraction,
        addedPx: s.correction.addedPx,
        removedPx: s.correction.removedPx,
      });
    }
  }
  awaitingReview.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));

  const eligible = selectExemplars(corpus).chosen;
  const countBy = (list: typeof eligible, key: (e: (typeof eligible)[number]) => string): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const e of list) o[key(e)] = (o[key(e)] ?? 0) + 1;
    return o;
  };

  const mean = (nums: number[]): number | null =>
    nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4)) : null;

  return {
    generatedAt: new Date().toISOString(),
    total: corpus.length,
    byMethod,
    byAuthorship,
    byReviewStatus,
    meanAgreement: agCount ? Number((agSum / agCount).toFixed(4)) : null,
    byEra: groupBy(corpus, (e) => e.sidecar.prior?.eraId ?? null),
    bySet: groupBy(corpus, (e) => e.sidecar.card?.setId ?? setIdOf(e.cardId)),
    bySeries: groupBy(corpus, (e) => e.sidecar.card?.seriesSlug ?? null),
    byScope: groupBy(corpus, (e) => e.sidecar.prior?.scope ?? null),
    exemplarsAvailable: {
      total: eligible.length,
      byEra: countBy(eligible, (e) => e.sidecar.prior?.eraId ?? 'unknown'),
      byScope: countBy(eligible, (e) => e.sidecar.prior?.scope ?? 'unknown'),
    },
    awaitingReview,
    corrections: {
      n: corrections.length,
      meanAgreementVsParent: mean(corrections.map((c) => c.agreement)),
      meanChangedFraction: mean(corrections.map((c) => c.changedFraction)),
      entries: corrections.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)),
    },
    bySidecarVersion,
  };
}

// ── Training tuples (the generator lane's input contract) ──────────────────

export interface TrainingTuple {
  cardId: string;
  variantId: number;
  eraId: string | null;
  scope: string | null;
  setId: string | null;
  seriesSlug: string | null;
  /** The scan the mask was drawn on. null on masks saved before v3. */
  artworkUrl: string | null;
  width: number;
  height: number;
  method: DerivationMethod;
  authorship: Authorship;
  reviewStatus: ReviewStatus;
  /** Exemplar weight — 0 means "do not learn from this" (see EXEMPLAR_WEIGHT). */
  exemplarWeight: number;
  /** The deterministic era rect this mask was scored against. */
  ruleRect: [number, number, number, number] | null;
  files: CorpusEntry['files'];
  /** Rule-vs-mask (how wrong the layout rule was). */
  ruleDiff: MaskSidecarV3['diff'] | null;
  /** Machine identity, when this mask descends from a generator run. */
  generator: MaskSidecarV3['prior']['generator'] | null;
  /**
   * THE CORRECTION TUPLE: present iff a human edited a prior mask. Gives the
   * pre-correction pixels (`files.parent`), the change map (`files.parentDiff`)
   * and the metrics — a supervised (input, target) pair with no inference.
   */
  correction: MaskSidecarV3['correction'] | null;
  lineage: MaskSidecarV3['lineage'];
}

export interface TrainingManifest {
  version: 1;
  generatedAt: string;
  /** Repo-relative root every `files.*` path is resolved against. */
  root: string;
  /** How to read a tuple — spelled out so no lane has to reverse-engineer it. */
  contract: string[];
  counts: { total: number; exemplars: number; corrections: number; unreviewedAi: number };
  tuples: TrainingTuple[];
}

const CONTRACT_NOTES = [
  'files.* are repo-relative paths. Alpha channel of a mask PNG IS the mask (>=128 = foil); RGB is display tint only.',
  'artworkUrl is the card scan the human saw, served by the image service (add your host: http://127.0.0.1:3701<url> or via the api origin).',
  'ruleRect is UV y-up [x,y,w,h] of the deterministic era rect — the geometry prior a generator starts from.',
  'exemplarWeight > 0 means a generator MAY learn from this mask. 0 means it MUST NOT (unreviewed `ai`, or machine-rasterized geometry).',
  'correction != null is a supervised pair: files.parent = the mask BEFORE the human, files.mask = AFTER, files.parentDiff = the change map (green added / red removed), correction.grid = where the changes concentrate.',
  'Never treat a tuple with method "ai" as ground truth — it is a proposal awaiting review.',
];

export function trainingTuples(corpus: CorpusEntry[]): TrainingManifest {
  const tuples: TrainingTuple[] = corpus.map((e) => {
    const s = e.sidecar;
    return {
      cardId: e.cardId,
      variantId: e.variantId,
      eraId: s.prior?.eraId ?? null,
      scope: s.prior?.scope ?? null,
      setId: s.card?.setId ?? setIdOf(e.cardId),
      seriesSlug: s.card?.seriesSlug ?? null,
      artworkUrl: s.artworkUrl ?? null,
      width: s.width,
      height: s.height,
      method: s.derivation_method,
      authorship: AUTHORSHIP_BY_METHOD[s.derivation_method],
      reviewStatus: REVIEW_BY_METHOD[s.derivation_method],
      exemplarWeight: EXEMPLAR_WEIGHT[s.derivation_method],
      ruleRect: s.prior?.rect ?? null,
      files: e.files,
      ruleDiff: s.diff ?? null,
      generator: s.prior?.generator ?? null,
      correction: s.correction ?? null,
      lineage: s.lineage ?? [],
    };
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: '.',
    contract: CONTRACT_NOTES,
    counts: {
      total: tuples.length,
      exemplars: tuples.filter((t) => t.exemplarWeight > 0).length,
      corrections: tuples.filter((t) => t.correction).length,
      unreviewedAi: tuples.filter((t) => t.method === 'ai').length,
    },
    tuples,
  };
}

export { maskPathsIn };
