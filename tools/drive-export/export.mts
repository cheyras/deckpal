import { mkdir, readFile, rename, stat as fsStat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Curated scan exemplars → Google Drive `/deckpal/card_scans`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The card-scanner redesign trains on real photographs of real cards taken by
 * real people through the app's own capture pipeline. Those photographs live in
 * object storage keyed by an opaque id, which is fine for serving and useless
 * for the thing they are collected for: somebody has to be able to LOOK at the
 * training set, sort it, spot the twelve blurry ones, and hand a folder to a
 * training run. So the curated subset is exported to a Drive folder the owner
 * can open.
 *
 * That is the whole product, and everything below follows from two facts about
 * it: the images leave the system, and they were contributed by named users.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CONSENT IS CHECKED TWICE, ON PURPOSE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Crop retention is an OPT-IN tier. `scan_exemplar.crop_retained` says the user
 * asked for it and `crop_consent_at` records when — and only a row with both
 * may leave the system. The filter is in the SQL (`WHERE crop_retained = true
 * AND crop_consent_at IS NOT NULL`) and it is asserted AGAIN in TypeScript, per
 * row, immediately before the bytes are read.
 *
 * The second check is not defensive padding. The SQL is one string in one
 * function that a future `--all`, a debugging edit, a copied-and-trimmed query
 * or an injected `fetchExemplars` seam (which the tests use, and which is by
 * construction not the production query) can each quietly widen. The TypeScript
 * check sits on the ONLY path to `readCrop`, so widening the query does not
 * widen what gets uploaded — it produces a refusal and a count in the summary.
 * An image without recorded consent must be unreachable by construction, not by
 * everybody remembering.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FILENAME CONVENTION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273.jpg
 *   sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918273.jpg
 *   │      │   │      │       │        │    │         └ e-<exemplarId>   (unique)
 *   │      │   │      │       │        │    └ d-<YYYYMMDD>              (capture, UTC)
 *   │      │   │      │       │        └ fv-<frame_pipeline_version>
 *   │      │   │      │       └ pl-<pipeline>
 *   │      │   │      └ sl-<sleeve slug>  |  sl.none
 *   │      │   └ v-<variantId>            |  v.none
 *   │      └ card.local_id
 *   └ card_set.tcgdex_id
 *
 * Eight `_`-separated fields, then `.jpg`. Every property it has is a property
 * somebody needed:
 *
 *   DETERMINISTIC — the name is a pure function of the row, so re-running
 *   produces the same name and the existence check below is meaningful. Nothing
 *   in it comes from the clock, the run, or the order of the rows.
 *
 *   SORTABLE, GROUPED BY CARD — the set id and local id lead, so a plain
 *   alphabetical listing in the Drive UI puts every exemplar of one card
 *   together, then splits them by printing, then by sleeve. That is the order
 *   somebody auditing a training set actually reads in. It is NOT chronological
 *   order; `--since` exists for that, and `captured_at` is in the manifest and
 *   in every file's own metadata. Note that local ids sort lexically, so `102`
 *   precedes `9` within a set — grouping is the property being bought here, not
 *   numeric order, and padding a free-form upstream identifier would cost
 *   fidelity to buy cosmetics.
 *
 *   COLLISION-FREE — `e-<exemplarId>` is the table's primary key and it is
 *   always present, so two names can only collide if two rows share an id.
 *   Everything to its left is context for a human, not identity.
 *
 *   PARSEABLE — `_` is reserved as the field separator and no field may contain
 *   one, so `split('_')` is exact rather than heuristic. `parseExportName` is
 *   the inverse of `buildExportName` on every name `buildExportName` produces;
 *   the round trip is asserted in `__tests__/naming.test.ts`.
 *
 *   PATH-SAFE — every field is passed through an allow-list before it lands in
 *   a name, the same mentality as `packages/storage/src/object-path.ts`: a
 *   leading alphanumeric, then alphanumerics, dots and hyphens. No separator,
 *   no `..`, no `%`, no whitespace, no control character can survive it, so a
 *   name cannot escape its folder in Drive or on disk. `buildExportName` runs
 *   the finished name back through the guard and throws if it ever produced
 *   something the guard rejects — a name that is wrong must not be a file.
 *
 * The two nullable fields carry a sentinel rather than an empty slot. `v.none`
 * and `sl.none` use a dot, and the slug alphabet for those fields excludes
 * dots, so the sentinel cannot be forged by a sleeve that happens to be called
 * "none".
 *
 * The sleeve slug is lossy BY DESIGN: lowercased, de-punctuated, and capped at
 * 40 characters, because it is there so a human can tell two files apart at a
 * glance. The exact label is in the manifest and embedded in the file itself.
 * `parseExportName` therefore returns the slug, not the original label — the
 * exemplar id is the key back to the truth.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERY IMAGE CARRIES ITS OWN PROVENANCE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * An exported file will be copied, renamed, dropped into a training bucket and
 * separated from this manifest, probably within a week. So the provenance rides
 * INSIDE the JPEG, three times over, because three different readers exist:
 *
 *   • XMP — an `x:xmpmeta` packet with a `deckpal:` namespace
 *     (https://deckpal.app/ns/scan/1.0/). The full record, exact, UTF-8, and
 *     machine-readable by anything that speaks XMP.
 *   • EXIF `IFD0.ImageDescription` — one human sentence, so a file browser's
 *     properties pane shows something useful.
 *   • EXIF `Exif.UserComment` (libvips `IFD2`) — the same record as compact
 *     JSON, for a reader that parses EXIF but not XMP.
 *
 * A nullable field is always PRESENT and empty rather than omitted. An empty
 * `deckpal:variantId` means "this exemplar had no chosen printing"; a missing
 * one would mean "something did not write it", and those must not look alike.
 *
 * MEASURED, ON sharp 0.35.3, AND THE REASON THIS DOES NOT USE `withMetadata`:
 *
 *   • `withMetadata({ exif })` MERGES with the input's EXIF. Given a source
 *     JPEG carrying `IFD0.Make` and a GPS IFD — which is exactly what a phone
 *     photograph carries — the output still contained them (exif 280 B in,
 *     264 B out, `Make` intact). `withExif()` replaces the block outright
 *     (144 B out, `Make` gone). These are user photographs going to a shared
 *     folder; the device and the coordinates are not ours to forward.
 *   • `withMetadata({ xmp })` is silently ignored on 0.35.3 — the option is
 *     accepted, the encode succeeds, and `metadata()` on the result reports no
 *     `xmp` at all. `.withXmp(packet)` writes it (295 B back out, under the
 *     `http://ns.adobe.com/xap/1.0/` APP1 header). A metadata write that fails
 *     quietly is the worst of the three outcomes, so this is asserted in
 *     `__tests__/export.test.ts` by reading the encoded bytes back.
 *   • `.autoOrient()` runs BEFORE the strip. Phone photographs lean on EXIF
 *     `Orientation`; discarding it without baking in the rotation would export
 *     a sideways training set.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE MANIFEST IS DERIVED. THE IMAGES ARE THE TRUTH.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `manifest.json` is a convenience index, and `--manifest-only` rebuilds it
 * from scratch without re-uploading a byte: it re-derives every name, asks the
 * destination which of them actually exist, and writes the entries for those.
 * A manifest that disagrees with the folder loses; delete it and re-run.
 *
 * Which is also why no entry carries a content hash. A hash is knowable on the
 * upload path and not on the rebuild path without downloading everything, so a
 * hash field would make the two runs produce different manifests — and a
 * manifest that disagrees with itself is worse than one that says less. Byte
 * size comes from the destination, so both paths report the same number.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CREDENTIALS FAIL LOUD (contract B11)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The service-account key path comes from `DRIVE_EXPORT_CREDENTIALS`. Unset, or
 * pointing at a file that is not there, or pointing at JSON without a private
 * key, all exit non-zero with a message naming the variable and the file. There
 * is NO implicit local fallback: `--local-out <dir>` is the only credential-free
 * path and it must be typed. B11 exists because `/design` shipped gated on a
 * variable nobody set and stayed shut for four days without saying so; a
 * training export that quietly stops growing is the same failure with a longer
 * fuse.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Flags:
 *   --dry-run              do everything except write or upload; print the plan
 *   --local-out <dir>      write encoded images + manifest to <dir> instead of
 *                          Drive (the only sanctioned no-credential path)
 *   --manifest-only        rebuild manifest.json from what the destination
 *                          already holds; uploads nothing
 *   --limit N              cap the rows considered this run
 *   --since <ISO date>     only exemplars captured at or after this instant
 *   --folder <driveFolderId>  override DRIVE_EXPORT_FOLDER_ID
 *
 * Run:
 *   node --import tsx tools/drive-export/export.mts --dry-run --local-out ./out
 */

// ── Configuration (contract B11: every one of these is named in README.md) ────

/** Absolute path to the Google service-account JSON key. Never printed. */
export const CREDENTIALS_ENV = 'DRIVE_EXPORT_CREDENTIALS';

/** The Drive folder id for `/deckpal/card_scans`. Resolved by name if unset. */
export const FOLDER_ENV = 'DRIVE_EXPORT_FOLDER_ID';

/** Bucket holding retained crops. Named here, confirmed by the owner. */
export const CROP_BUCKET_ENV = 'DRIVE_EXPORT_CROP_BUCKET';

/**
 * The path the error message suggests, and the one the repo's `.gitignore`
 * covers. Only a suggestion — the variable is what is read.
 */
export const DEFAULT_CREDENTIALS_PATH = '.drive-export-credentials.json';

/** The folder the owner's ruling names, as a path from the Drive root. */
export const DRIVE_FOLDER_PATH = ['deckpal', 'card_scans'] as const;

/** Custom XMP namespace. Versioned, because the field set will grow. */
export const XMP_NAMESPACE = 'https://deckpal.app/ns/scan/1.0/';
export const XMP_PREFIX = 'deckpal';

/**
 * What an exported image may be used for, embedded in every file. Written out
 * rather than referenced because the file will outlive its folder.
 */
export const USAGE_LICENCE =
  'DeckPal card-scan exemplar. Contributed by a DeckPal user under the opt-in ' +
  'crop-retention tier, with consent recorded in scan_exemplar.crop_consent_at. ' +
  'Internal card-recognition training and evaluation only; not for ' +
  'redistribution. Card artwork remains the property of its rights holders.';

export const MANIFEST_NAME = 'manifest.json';

const LOG = '[drive-export]';

// ── The filename convention ──────────────────────────────────────────────────

export const EXPORT_EXTENSION = '.jpg';
export const FIELD_SEPARATOR = '_';
export const EXPORT_FIELD_COUNT = 8;

/** Long enough to tell two sleeves apart; the exact label is in the metadata. */
export const MAX_SLEEVE_SLUG_LENGTH = 40;

/** Set ids and local ids are short upstream identifiers; this is already slack. */
export const MAX_IDENTITY_SLUG_LENGTH = 32;

/** A `bigint` is at most 19 digits. Anything longer was never an id. */
export const MAX_ID_DIGITS = 20;

/**
 * A frame index is a position in one capture's tilt sequence, bounded by the
 * schema's own `CHECK (frame_index BETWEEN 0 AND 15)`. Three digits is already
 * two more than that constraint allows.
 */
export const MAX_FRAME_INDEX_DIGITS = 3;

/**
 * Not a policy, an ARITHMETIC BOUND: it is the sum of the per-field caps, so
 * `buildExportName` cannot reach it and the guard's length check is genuinely
 * unreachable rather than a lurking failure on a long sleeve name.
 *
 *   setId 32 + localId 32 + ('v-' 2 + 20) + ('sl-' 3 + 40) + ('pl-' 3 + 32)
 *   + ('fv-' 3 + 20) + ('d-' 2 + 8) + ('e-' 2 + 20 + '-' 1 + 3)   = 223
 *   + 7 separators + '.jpg'                                        = 234
 *
 * A realistic name is about 80. `__tests__/naming.test.ts` builds the maximal
 * one and asserts it fits.
 */
export const MAX_EXPORT_NAME_LENGTH = 234;

/**
 * One name field. Identical in spirit to `SEGMENT` in
 * `packages/storage/src/object-path.ts`: a leading alphanumeric, then
 * alphanumerics, dots and hyphens. Deliberately excludes `_`, which is the
 * field separator and the only reason `split` is exact.
 */
const FIELD = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** What a sentinel-bearing field looks like. `.none` cannot be produced by a slug. */
const VARIANT_FIELD = /^v(?:\.none|-(\d+))$/;
const SLEEVE_FIELD = /^sl(?:\.none|-([a-z0-9][a-z0-9-]*))$/;
const PIPELINE_FIELD = /^pl-([a-z0-9][a-z0-9-]*)$/;
const FRAME_FIELD = /^fv-(\d+)$/;
const DATE_FIELD = /^d-(\d{8})$/;

/**
 * `e-<exemplarId>` or `e-<exemplarId>-<frameIndex>`.
 *
 * The frame index is OPTIONAL and additive: a name without one is byte-identical
 * to what this convention produced before the field existed, so nothing already
 * in the folder is renamed by adding it.
 *
 * It exists because one exemplar can retain more than one crop. `scan_exemplar`
 * holds the identification; the retained photographs hang off
 * `scan_exemplar_frame`, keyed `(exemplar_id, frame_index)`, because the tilt
 * sequence is the signal and a frame that loses its position loses most of its
 * value. Keying a filename on the exemplar alone would therefore map up to
 * sixteen distinct images onto one name — and because the tool skips a name it
 * finds, the collision would not overwrite, it would silently export the first
 * frame and drop the other fifteen as "already there". That is the worst
 * available failure: a training set that is quietly missing most of itself.
 */
const EXEMPLAR_FIELD = /^e-(\d+)(?:-(\d+))?$/;

export interface ExportNameParts {
  setId: string;
  localId: string;
  variantId: string | null;
  /** The SLUG, not the original label — see the header. */
  sleeve: string | null;
  pipeline: string;
  framePipelineVersion: number;
  /** A `Date`, an ISO string, or a `YYYYMMDD` token (so parse output re-builds). */
  capturedAt: Date | string;
  exemplarId: string;
  /** Position in the capture's tilt sequence. `null`/absent for a lone crop. */
  frameIndex?: number | string | null;
}

export interface ParsedExportName extends ExportNameParts {
  capturedAt: string; // always YYYYMMDD
  frameIndex: number | null;
}

/**
 * Slug for an identity field (set id, local id). Case is PRESERVED — `GG01` and
 * `TG05` are upstream identifiers and lowercasing them would lose information
 * that the reader is using to find the card. Real ids pass through unchanged;
 * this only bites on input that was never a real id.
 */
export function slugIdentity(value: string): string {
  const cleaned = String(value)
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/\.{2,}/g, '.') // '..' must never survive, in any field
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+/, '')
    .replace(/[.\-]+$/, '')
    .slice(0, MAX_IDENTITY_SLUG_LENGTH)
    .replace(/[.\-]+$/, ''); // the slice can re-expose a trailing separator
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/**
 * Slug for a free-text label (sleeve, pipeline). Lowercased, and the alphabet
 * excludes dots — which is what makes the `.none` sentinel unforgeable.
 */
export function slugLabel(value: string, max = MAX_SLEEVE_SLUG_LENGTH): string {
  const cleaned = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

function digitsOnly(value: string | number | bigint, field: string, maxDigits = MAX_ID_DIGITS): string {
  const text = String(value);
  if (!/^\d+$/.test(text) || text.length > maxDigits) {
    // A non-numeric id is a bug upstream, and a name that cannot be parsed back
    // is worse than a crash: it becomes a file nobody can attribute.
    throw new Error(
      `${LOG} ${field} must be a non-negative integer of at most ${maxDigits} digits, ` +
        `got ${JSON.stringify(text.slice(0, 40))}`,
    );
  }
  // Leading zeros would make two spellings of one id into two filenames.
  return text.replace(/^0+(?=\d)/, '');
}

/** `YYYYMMDD` in UTC. Accepts a Date, an ISO string, or an existing token. */
export function capturedDateToken(value: Date | string): string {
  if (typeof value === 'string' && /^\d{8}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${LOG} captured_at is not a date: ${JSON.stringify(String(value))}`);
  }
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Why this string is not a usable export name, or `null` if it is fine.
 * Returned rather than thrown so a caller can report the reason; the build path
 * throws on it.
 */
export function exportNameProblem(name: unknown): string | null {
  if (typeof name !== 'string') return `expected a string, got ${typeof name}`;
  if (name.length === 0) return 'empty';
  if (name.length > MAX_EXPORT_NAME_LENGTH) {
    return `longer than ${MAX_EXPORT_NAME_LENGTH} characters (${name.length})`;
  }
  // Named individually so a failure says WHICH trap was hit; the FIELD test
  // below would reject every one of them anyway.
  if (name.includes('\0')) return 'contains a NUL byte';
  if (name.includes('/') || name.includes('\\')) return 'contains a path separator';
  if (name.includes('..')) return "contains '..'";
  if (name.includes('%')) return 'contains a percent-escape';
  if (name.startsWith('.')) return 'starts with a dot';
  if (!name.endsWith(EXPORT_EXTENSION)) return `does not end with ${EXPORT_EXTENSION}`;

  const stem = name.slice(0, -EXPORT_EXTENSION.length);
  const fields = stem.split(FIELD_SEPARATOR);
  if (fields.length !== EXPORT_FIELD_COUNT) {
    return `has ${fields.length} fields, expected ${EXPORT_FIELD_COUNT}`;
  }
  for (const field of fields) {
    if (field.length === 0) return 'has an empty field';
    if (!FIELD.test(field)) return `field ${JSON.stringify(field)} is not allow-listed`;
  }
  return null;
}

/**
 * The row → filename direction. Pure. Throws rather than returning a name the
 * guard would reject, because the caller's very next move is to create a file.
 */
export function buildExportName(parts: ExportNameParts): string {
  const fields = [
    slugIdentity(parts.setId),
    slugIdentity(parts.localId),
    parts.variantId === null || parts.variantId === undefined
      ? 'v.none'
      : `v-${digitsOnly(parts.variantId, 'variant_id')}`,
    parts.sleeve === null || parts.sleeve === undefined
      ? 'sl.none'
      : `sl-${slugLabel(parts.sleeve)}`,
    `pl-${slugLabel(parts.pipeline, MAX_IDENTITY_SLUG_LENGTH)}`,
    `fv-${digitsOnly(parts.framePipelineVersion, 'frame_pipeline_version')}`,
    `d-${capturedDateToken(parts.capturedAt)}`,
    parts.frameIndex === null || parts.frameIndex === undefined
      ? `e-${digitsOnly(parts.exemplarId, 'exemplar id')}`
      : `e-${digitsOnly(parts.exemplarId, 'exemplar id')}` +
        `-${digitsOnly(parts.frameIndex, 'frame_index', MAX_FRAME_INDEX_DIGITS)}`,
  ];
  const name = fields.join(FIELD_SEPARATOR) + EXPORT_EXTENSION;
  const problem = exportNameProblem(name);
  if (problem) {
    // Unreachable if the slugs hold. Asserted here so that if a slug is ever
    // loosened, the failure is a crash at the build site rather than a
    // traversal-shaped filename in somebody's Drive.
    throw new Error(`${LOG} built an unusable name (${problem}): ${JSON.stringify(name)}`);
  }
  return name;
}

/** The filename → row direction. `null` when the name was not built by us. */
export function parseExportName(name: string): ParsedExportName | null {
  if (exportNameProblem(name) !== null) return null;
  const fields = name.slice(0, -EXPORT_EXTENSION.length).split(FIELD_SEPARATOR);
  const [setId, localId, variant, sleeve, pipeline, frame, date, exemplar] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const variantMatch = VARIANT_FIELD.exec(variant);
  const sleeveMatch = SLEEVE_FIELD.exec(sleeve);
  const pipelineMatch = PIPELINE_FIELD.exec(pipeline);
  const frameMatch = FRAME_FIELD.exec(frame);
  const dateMatch = DATE_FIELD.exec(date);
  const exemplarMatch = EXEMPLAR_FIELD.exec(exemplar);
  if (!variantMatch || !sleeveMatch || !pipelineMatch || !frameMatch || !dateMatch || !exemplarMatch) {
    return null;
  }

  return {
    setId,
    localId,
    variantId: variantMatch[1] ?? null,
    sleeve: sleeveMatch[1] ?? null,
    pipeline: pipelineMatch[1] as string,
    framePipelineVersion: Number(frameMatch[1]),
    capturedAt: dateMatch[1] as string,
    exemplarId: exemplarMatch[1] as string,
    frameIndex: exemplarMatch[2] === undefined ? null : Number(exemplarMatch[2]),
  };
}

// ── The row, and the consent gate that stands in front of it ─────────────────

/**
 * One curated exemplar, as `fetchExemplars` yields it. Every id is text: these
 * are `bigint` columns and JavaScript numbers stop being exact at 2^53, which
 * is a silent-corruption bug rather than a loud one.
 */
export interface ExemplarRow {
  exemplar_id: string;
  user_id: string;
  card_id: string;
  card_tcgdex_id: string;
  card_name: string;
  local_id: string;
  set_tcgdex_id: string;
  variant_id: string | null;
  sleeve: string | null;
  crop_retained: boolean;
  crop_consent_at: string | Date | null;
  crop_object_key: string | null;
  pipeline: string;
  frame_pipeline_version: number;
  captured_at: string | Date;
  /**
   * Position in the capture's tilt sequence, when the crop came from a table
   * keyed `(exemplar_id, frame_index)` rather than from the exemplar itself.
   * Absent for a one-crop-per-exemplar source; see `EXEMPLAR_FIELD`.
   */
  frame_index?: number | null;
}

/**
 * The SECOND consent check. See the header for why it is not redundant: this
 * one stands on the only path to `readCrop`, so it holds no matter what the
 * query said or who supplied it.
 */
export function consentProblem(row: ExemplarRow): string | null {
  if (row.crop_retained !== true) return 'crop_retained is not true';
  if (row.crop_consent_at === null || row.crop_consent_at === undefined) {
    return 'crop_consent_at is not recorded';
  }
  if (typeof row.crop_object_key !== 'string' || row.crop_object_key.length === 0) {
    return 'crop_object_key is empty';
  }
  return null;
}

// ── Provenance, and the three places it is written ───────────────────────────

export interface Provenance {
  fileName: string;
  cardId: string;
  cardTcgdexId: string;
  cardName: string;
  setId: string;
  localId: string;
  variantId: string | null;
  sleeve: string | null;
  pipeline: string;
  framePipelineVersion: number;
  exemplarId: string;
  frameIndex: number | null;
  capturedAt: string;
  consentAt: string;
  exportedAt: string;
  licence: string;
  namespace: string;
}

function isoOrEmpty(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function buildProvenance(row: ExemplarRow, exportedAt: Date): Provenance {
  const fileName = buildExportName({
    setId: row.set_tcgdex_id,
    localId: row.local_id,
    variantId: row.variant_id,
    sleeve: row.sleeve,
    pipeline: row.pipeline,
    framePipelineVersion: row.frame_pipeline_version,
    capturedAt: row.captured_at,
    exemplarId: row.exemplar_id,
    frameIndex: row.frame_index ?? null,
  });
  return {
    fileName,
    cardId: row.card_id,
    cardTcgdexId: row.card_tcgdex_id,
    cardName: row.card_name,
    setId: row.set_tcgdex_id,
    localId: row.local_id,
    variantId: row.variant_id,
    sleeve: row.sleeve,
    pipeline: row.pipeline,
    framePipelineVersion: row.frame_pipeline_version,
    exemplarId: row.exemplar_id,
    frameIndex: row.frame_index ?? null,
    capturedAt: isoOrEmpty(row.captured_at),
    consentAt: isoOrEmpty(row.crop_consent_at),
    exportedAt: exportedAt.toISOString(),
    licence: USAGE_LICENCE,
    namespace: XMP_NAMESPACE,
  };
}

/**
 * `user_id` is deliberately NOT in the provenance record. It identifies a
 * person, the export leaves the system, and nothing downstream needs it: the
 * exemplar id is the join back to the row that names the contributor, inside
 * the database, behind RLS. Exporting an image is not a reason to export who
 * took it.
 */

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 has no escape for these at all; they can only be dropped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** The ordered field list, shared by all three writers so they cannot drift. */
function provenanceFields(p: Provenance): Array<[string, string]> {
  return [
    ['cardId', p.cardId],
    ['cardTcgdexId', p.cardTcgdexId],
    ['cardName', p.cardName],
    ['setId', p.setId],
    ['localId', p.localId],
    ['variantId', p.variantId ?? ''],
    ['sleeve', p.sleeve ?? ''],
    ['pipeline', p.pipeline],
    ['framePipelineVersion', String(p.framePipelineVersion)],
    ['exemplarId', p.exemplarId],
    ['frameIndex', p.frameIndex === null ? '' : String(p.frameIndex)],
    ['capturedAt', p.capturedAt],
    ['consentAt', p.consentAt],
    ['exportedAt', p.exportedAt],
    ['fileName', p.fileName],
    ['licence', p.licence],
  ];
}

/**
 * A real `x:xmpmeta` packet, attribute form. `end="r"` because it carries no
 * padding and is therefore not editable in place — claiming otherwise would
 * invite a writer to overwrite the following bytes.
 */
export function xmpPacket(p: Provenance): string {
  const attrs = provenanceFields(p)
    .map(([key, value]) => `\n      ${XMP_PREFIX}:${key}="${xmlText(value)}"`)
    .join('');
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="deckpal drive-export">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:${XMP_PREFIX}="${XMP_NAMESPACE}"${attrs}/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end="r"?>`
  );
}

/**
 * EXIF strings are ASCII in practice — libvips writes them as such — so a card
 * name like "Flabébé" has to be folded before it goes in. The exact UTF-8 is in
 * the XMP packet; this is the fallback for a reader that has nothing else.
 */
function asciiFold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** JSON with every non-ASCII code point escaped, for the same reason. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function imageDescription(p: Provenance): string {
  const printing = p.variantId === null ? 'no chosen printing' : `printing ${p.variantId}`;
  const sleeve = p.sleeve === null ? 'no sleeve recorded' : `sleeve: ${p.sleeve}`;
  return asciiFold(
    `DeckPal card scan. ${p.cardName} (${p.setId}-${p.localId}); ${printing}; ${sleeve}; ` +
      `pipeline ${p.pipeline} v${p.framePipelineVersion}; exemplar ${p.exemplarId}` +
      (p.frameIndex === null ? '' : ` frame ${p.frameIndex}`) +
      `; captured ${p.capturedAt}; exported ${p.exportedAt}. ${p.licence}`,
  );
}

export function userComment(p: Provenance): string {
  const record: Record<string, string> = {};
  for (const [key, value] of provenanceFields(p)) record[key] = value;
  record['namespace'] = p.namespace;
  return asciiJson(record);
}

export interface EncodeOptions {
  quality?: number;
}

/**
 * Re-encode one crop as an exported JPEG carrying its own provenance.
 *
 * Re-encoding is not optional even when the source is already a JPEG: it is
 * what bakes in the orientation, drops the contributor's device metadata, and
 * gives libvips a block to attach ours to.
 *
 * `4:4:4` chroma rather than the default `4:2:0`. The matcher keys on set
 * symbols, energy pips and rarity marks — small, saturated, and exactly what
 * chroma subsampling smears. A few percent of file size is cheap against
 * training on artefacts the live camera path will not reproduce.
 */
export async function encodeExportImage(
  source: Buffer,
  provenance: Provenance,
  options: EncodeOptions = {},
): Promise<Buffer> {
  return await sharp(source)
    .autoOrient()
    .jpeg({ quality: options.quality ?? 92, chromaSubsampling: '4:4:4' })
    .withExif({
      IFD0: { ImageDescription: imageDescription(provenance) },
      IFD2: { UserComment: userComment(provenance) },
    })
    .withXmp(xmpPacket(provenance))
    .toBuffer();
}

// ── Destinations ─────────────────────────────────────────────────────────────

export interface RemoteFile {
  bytes: number | null;
}

export interface Destination {
  readonly label: string;
  /** Cheap existence check — this is what makes a re-run a no-op (B8). */
  stat(name: string): Promise<RemoteFile | null>;
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  putText(name: string, text: string, contentType: string): Promise<void>;
}

/**
 * The only sanctioned no-credential path, and it has to be asked for by name.
 * Writes are staged and renamed so a killed run leaves either the old file or
 * the new one, never half of one — the same reasoning as the disk choke point
 * in `apps/images/src/store.ts`.
 */
export function localDestination(dir: string): Destination {
  const root = resolve(dir);
  const safeJoin = (name: string): string => {
    const problem = name === MANIFEST_NAME ? null : exportNameProblem(name);
    if (problem) throw new Error(`${LOG} refusing to write ${JSON.stringify(name)}: ${problem}`);
    // Belt and braces: the guard already forbids separators, so basename() is a
    // no-op on every name we produce. It is here for the name we did not.
    return join(root, basename(name));
  };
  const write = async (name: string, bytes: Buffer): Promise<void> => {
    const target = safeJoin(name);
    const staged = `${target}.tmp-${process.pid}`;
    await mkdir(root, { recursive: true });
    await writeFile(staged, bytes);
    await rename(staged, target);
  };
  return {
    label: `local:${root}`,
    async stat(name) {
      try {
        const s = await fsStat(safeJoin(name));
        return { bytes: s.size };
      } catch {
        return null;
      }
    },
    async put(name, bytes) {
      await write(name, bytes);
    },
    async putText(name, text) {
      await write(name, Buffer.from(text, 'utf8'));
    },
  };
}

/**
 * The slice of the Drive v3 client this tool uses, declared structurally rather
 * than imported as a type.
 *
 * `googleapis` is a dependency of this tool and NOT of the repo — nothing else
 * here needs 200 MB of generated API clients — so a clone that has only run the
 * root `pnpm install` does not have it. Typing against `typeof
 * import('googleapis')` would make `tsc --noEmit` fail on exactly the machines
 * where the Drive path is the part that is not being used: `--local-out`, the
 * tests and `--dry-run` all run without it, and a typecheck that only passes
 * after a heavyweight install is a typecheck people stop running.
 *
 * The cost is that this shape is checked at runtime, not at compile time. It is
 * a stable, long-published corner of the v3 client (`files.list` /
 * `files.create` / `files.update`), and getting it wrong fails loudly on the
 * first call rather than corrupting anything.
 */
interface DriveClientSlice {
  files: {
    list(params: Record<string, unknown>): Promise<{
      data: { files?: Array<{ id?: string | null; size?: string | null }> };
    }>;
    create(params: Record<string, unknown>): Promise<unknown>;
    update(params: Record<string, unknown>): Promise<unknown>;
  };
}

interface GoogleapisSlice {
  google: {
    auth: { GoogleAuth: new (options: { keyFile: string; scopes: string[] }) => unknown };
    drive(options: { version: 'v3'; auth: unknown }): DriveClientSlice;
  };
}

/**
 * Drive. `googleapis` is imported HERE and nowhere above, so `--local-out`, the
 * unit tests and `--dry-run` all run with no network, no credential and no
 * dependency on that package being installed at all.
 */
export async function driveDestination(credentialsPath: string, folderId: string | null): Promise<Destination> {
  let googleapis: GoogleapisSlice;
  try {
    // Assembled at runtime so a missing package is a message rather than an
    // unresolvable static import that breaks every other path in this file.
    const specifier = 'googleapis';
    googleapis = (await import(specifier)) as GoogleapisSlice;
  } catch (err) {
    throw new Error(
      `${LOG} the Drive path needs the 'googleapis' package, which is not installed here.\n` +
        `  Install it in this tool: pnpm --config.verify-deps-before-run=false add googleapis\n` +
        `  (--local-out <dir> needs none of this.)\n` +
        `  Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { google } = googleapis;
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const listIn = async (parent: string, name: string): Promise<{ id: string; size: number | null } | null> => {
    // The name is interpolated into a Drive query string, which is exactly the
    // shape of an injection. What makes it safe is the allow-list: a legal
    // export name contains no quote, no backslash and no separator, so there is
    // nothing to escape. Anything else was rejected before it got here.
    const res = await drive.files.list({
      q: `name = '${name}' and '${parent}' in parents and trashed = false`,
      fields: 'files(id,size)',
      pageSize: 1,
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const file = res.data.files?.[0];
    if (!file?.id) return null;
    return { id: file.id, size: file.size ? Number(file.size) : null };
  };

  let folder = folderId;
  if (!folder) {
    // Resolve `/deckpal/card_scans` by name, and REFUSE to create it. Creating
    // folders in somebody's Drive is an infrastructure mutation (B9); the owner
    // makes the folder and shares it, we find it.
    let parent = 'root';
    for (const segment of DRIVE_FOLDER_PATH) {
      const found = await listIn(parent, segment);
      if (!found) {
        throw new Error(
          `${LOG} cannot find the Drive folder /${DRIVE_FOLDER_PATH.join('/')} ` +
            `(stopped at ${JSON.stringify(segment)}).\n` +
            `  The service account only sees what is SHARED with it. Either share ` +
            `that folder with the account's client_email, or set ${FOLDER_ENV} to ` +
            `the folder id from its URL (…/folders/<id>).\n` +
            `  This tool will not create the folder itself.`,
        );
      }
      parent = found.id;
    }
    folder = parent;
  }
  const parentFolder = folder;

  return {
    label: `drive:${parentFolder}`,
    async stat(name) {
      const found = await listIn(parentFolder, name);
      return found ? { bytes: found.size } : null;
    },
    async put(name, bytes, contentType) {
      await drive.files.create({
        requestBody: { name, parents: [parentFolder] },
        // A Buffer is not a stream, and the Drive client wants one for binary
        // media; `Readable.from` is the adapter, not a copy of the bytes.
        media: { mimeType: contentType, body: Readable.from(bytes) },
        fields: 'id',
        supportsAllDrives: true,
      });
    },
    async putText(name, text, contentType) {
      const existing = await listIn(parentFolder, name);
      if (existing) {
        // The manifest is the one file that is legitimately rewritten. Update
        // it in place so its Drive link survives a rebuild.
        await drive.files.update({
          fileId: existing.id,
          media: { mimeType: contentType, body: text },
          fields: 'id',
          supportsAllDrives: true,
        });
        return;
      }
      await drive.files.create({
        requestBody: { name, parents: [parentFolder] },
        media: { mimeType: contentType, body: text },
        fields: 'id',
        supportsAllDrives: true,
      });
    },
  };
}

// ── Credentials (B11) ────────────────────────────────────────────────────────

export interface ServiceAccountSummary {
  path: string;
  clientEmail: string;
}

/**
 * Resolve and validate the service-account key. Loud on every failure, and the
 * message always names the variable and the file so the reader knows which of
 * the two to fix. The key material itself is never returned, logged or echoed —
 * only the path and the `client_email`, which is what the owner needs to share
 * the Drive folder with.
 */
export async function requireCredentials(): Promise<ServiceAccountSummary> {
  const configured = process.env[CREDENTIALS_ENV];
  if (!configured || configured.trim().length === 0) {
    throw new Error(
      `${LOG} no Google Drive credential: ${CREDENTIALS_ENV} is unset.\n` +
        `  Set it to the path of the service-account JSON key, for example\n` +
        `      export ${CREDENTIALS_ENV}="$PWD/${DEFAULT_CREDENTIALS_PATH}"\n` +
        `  That file is a live private key. Keep it at a gitignored path — the\n` +
        `  repo ignores ${DEFAULT_CREDENTIALS_PATH} at the root — and never print it.\n` +
        `  To run with no credential at all, pass --local-out <dir> explicitly.\n` +
        `  There is no implicit local fallback: an export that silently stops\n` +
        `  uploading is an outage nobody is looking for.`,
    );
  }
  const path = resolve(configured.trim());
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
    throw new Error(
      `${LOG} ${CREDENTIALS_ENV} points at ${path}, which cannot be read (${code}).\n` +
        `  Fix the path or place the service-account JSON key there.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${LOG} ${path} is not valid JSON. A Google service-account key is a JSON\n` +
        `  object with "type": "service_account". Its contents are not printed here.`,
    );
  }
  const key = parsed as Record<string, unknown>;
  const missing = (['client_email', 'private_key'] as const).filter(
    (field) => typeof key[field] !== 'string' || (key[field] as string).length === 0,
  );
  if (missing.length > 0) {
    throw new Error(
      `${LOG} ${path} is missing ${missing.join(' and ')}.\n` +
        `  That is a JSON file but not a service-account key. Download a fresh key\n` +
        `  from the Google Cloud console (IAM → Service Accounts → Keys).`,
    );
  }
  return { path, clientEmail: key['client_email'] as string };
}

// ── The database read: the ONE place this tool touches Postgres ──────────────

/**
 * NOT EXERCISED BY ANY TEST IN THIS DIRECTORY, and deliberately so: at the time
 * of writing, `scan_exemplar` does not exist — its migration is being written
 * alongside this tool and has not been applied anywhere. Everything above and
 * below is driven through the `fetchExemplars` seam so the rest of the tool is
 * provable without a database. This function is the part that is not, and it
 * says so rather than pretending.
 *
 * Shape, as migration 049 ships it:
 *   scan_exemplar(id bigint, user_id uuid, card_id bigint, variant_id bigint null,
 *                 sleeve text null, crop_retained boolean,
 *                 crop_consent_at timestamptz null, pipeline text,
 *                 frame_pipeline_version smallint, captured_at timestamptz)
 *   scan_exemplar_frame(exemplar_id bigint, frame_index smallint,
 *                       crop_object_key text null, …)
 *   card(id, tcgdex_id, name, local_id, set_id)
 *   card_set(id, tcgdex_id)
 *
 * ONE ROW PER RETAINED FRAME, NOT PER EXEMPLAR — which is why this joins the
 * child table. 049 stores 2-3 tilts per verified scan (the sleeve-invariance
 * addendum's day-one commitment), each with its own crop, so an exemplar-keyed
 * query would map up to sixteen images onto one filename and this tool, which
 * SKIPS names it already finds, would silently drop fifteen of them as "already
 * exported". `frame_index` is therefore in the projection and flows into
 * `buildExportName`.
 *
 * The WHERE clause is the FIRST of the two consent checks. See `consentProblem`
 * for the second and the header for why one is not enough. It is also belt to
 * 049's braces: a frame carrying a crop_object_key without consent on its
 * parent cannot be inserted at all (the `scan_exemplar_frame_consent` trigger),
 * so this filter should never remove a row — and it is written anyway, because
 * a tool that distributes photographs should not depend on a trigger it does
 * not own for the property it must not get wrong.
 *
 * One pooled connection, worker role, per contract B2.
 */
export async function fetchExemplarsFromDb(args: Args): Promise<ExemplarRow[]> {
  const { makePool } = await import('@deckpal/db');
  const pool = makePool(1);
  try {
    const params: unknown[] = [];
    let sql = `
      SELECT se.id::text                  AS exemplar_id,
             se.user_id::text             AS user_id,
             se.card_id::text             AS card_id,
             c.tcgdex_id                  AS card_tcgdex_id,
             c.name                       AS card_name,
             c.local_id                   AS local_id,
             cs.tcgdex_id                 AS set_tcgdex_id,
             se.variant_id::text          AS variant_id,
             se.sleeve                    AS sleeve,
             se.crop_retained             AS crop_retained,
             se.crop_consent_at           AS crop_consent_at,
             f.crop_object_key            AS crop_object_key,
             f.frame_index                AS frame_index,
             se.pipeline                  AS pipeline,
             se.frame_pipeline_version    AS frame_pipeline_version,
             se.captured_at               AS captured_at
        FROM scan_exemplar se
        JOIN scan_exemplar_frame f ON f.exemplar_id = se.id
        JOIN card c      ON c.id  = se.card_id
        JOIN card_set cs ON cs.id = c.set_id
       WHERE se.crop_retained = true
         AND se.crop_consent_at IS NOT NULL
         AND f.crop_object_key IS NOT NULL`;
    if (args.since) {
      params.push(args.since);
      sql += `\n         AND se.captured_at >= $${params.length}::timestamptz`;
    }
    // Ordered the way the filenames sort, so a run's log reads in the same order
    // as the folder it produces.
    sql += `\n       ORDER BY cs.tcgdex_id, c.local_id, se.id, f.frame_index`;
    if (args.limit !== null) {
      params.push(args.limit);
      sql += `\n       LIMIT $${params.length}`;
    }
    const { rows } = await pool.query<ExemplarRow>(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
}

/**
 * Read one retained crop out of object storage.
 *
 * UNVERIFIED. The bucket this reads from does not exist yet, so this path has
 * never run; it is written against the Storage REST API the rest of the cloud
 * tier uses, and the owner has to confirm the bucket name before it is trusted.
 * `--local-out` and the tests inject their own reader and never reach it.
 *
 * It does not import `@deckpal/storage` because that package's key guard and
 * origin guard are not on its curated export list, and widening that list is
 * that package's call, not this tool's. The guard below is therefore a local
 * copy of the same allow-list mentality rather than a second, looser rule.
 */
export async function readCropFromObjectStore(objectKey: string): Promise<Buffer> {
  const supabaseUrl = (process.env['SUPABASE_URL'] ?? '').replace(/\/+$/, '');
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      `${LOG} SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read retained crops.\n` +
        `  Load them with: set -a && . ./.env && set +a\n` +
        `  Or pass --local-out <dir> with an injected reader if you only want the encode path.`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(objectKey) || objectKey.includes('..')) {
    throw new Error(`${LOG} refusing an unsafe crop object key: ${JSON.stringify(objectKey.slice(0, 80))}`);
  }
  const origin = new URL(supabaseUrl);
  if (origin.protocol !== 'https:') {
    // The service-role key rides on this request.
    throw new Error(`${LOG} SUPABASE_URL must be https, got ${origin.protocol}`);
  }
  const bucket = process.env[CROP_BUCKET_ENV] ?? 'card-scans';
  const url = new URL(`/storage/v1/object/${bucket}/${objectKey}`, origin.origin);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${serviceKey}` } });
  if (!res.ok) {
    throw new Error(`${LOG} crop ${objectKey} came back ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── Arguments ────────────────────────────────────────────────────────────────

export interface Args {
  dryRun: boolean;
  localOut: string | null;
  manifestOnly: boolean;
  limit: number | null;
  since: string | null;
  folderId: string | null;
}

/**
 * Unknown flags are a hard error, unlike `apps/api/src/scan/index.ts` which
 * ignores them. The difference is what a typo costs: there, an ignored token
 * means a slower re-index; here `--dry-ru` means a real upload to a shared
 * folder that the operator believed was a rehearsal.
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    localOut: null,
    manifestOnly: false,
    limit: null,
    since: null,
    folderId: process.env[FOLDER_ENV] ?? null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${LOG} ${token} needs a value`);
      }
      return value;
    };
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--manifest-only') args.manifestOnly = true;
    else if (token === '--local-out') args.localOut = next();
    else if (token === '--folder') args.folderId = next();
    else if (token === '--limit') {
      const value = Number(next());
      if (!Number.isInteger(value) || value <= 0) throw new Error(`${LOG} --limit needs a positive integer`);
      args.limit = value;
    } else if (token === '--since') {
      const raw = next();
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`${LOG} --since needs an ISO date, got ${JSON.stringify(raw)}`);
      }
      args.since = date.toISOString();
    } else {
      throw new Error(`${LOG} unknown argument ${JSON.stringify(token ?? '')}`);
    }
  }
  return args;
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface ManifestEntry extends Provenance {
  bytes: number | null;
}

export interface ExportReport {
  destination: string;
  considered: number;
  uploaded: number;
  skipped: number;
  refused: number;
  failed: number;
  entries: ManifestEntry[];
  manifestWritten: boolean;
}

export interface ExportDeps {
  fetchExemplars: (args: Args) => Promise<ExemplarRow[]>;
  readCrop: (objectKey: string) => Promise<Buffer>;
  destination?: Destination;
  now?: () => Date;
}

export function buildManifest(entries: ManifestEntry[], generatedAt: Date): string {
  // Sorted by name so two runs over the same folder produce byte-identical
  // manifests regardless of row order. A diff of this file should show what
  // changed in the folder, not what order the database felt like today.
  const images = [...entries].sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return `${JSON.stringify(
    {
      generatedAt: generatedAt.toISOString(),
      generator: 'tools/drive-export/export.mts',
      namespace: XMP_NAMESPACE,
      licence: USAGE_LICENCE,
      filenameConvention:
        '<setId>_<localId>_v-<variantId>|v.none_sl-<sleeveSlug>|sl.none_pl-<pipeline>_fv-<n>_d-<YYYYMMDD>_e-<exemplarId>.jpg',
      note: 'Derived index. The images are the source of truth; rebuild with --manifest-only.',
      count: images.length,
      images,
    },
    null,
    2,
  )}\n`;
}

export async function runExport(args: Args, deps: ExportDeps): Promise<ExportReport> {
  const now = deps.now ?? (() => new Date());
  const exportedAt = now();

  let destination = deps.destination ?? null;
  if (!destination) {
    if (args.localOut) {
      destination = localDestination(args.localOut);
    } else {
      // Fail on the credential BEFORE touching the database, so a
      // misconfigured run costs nothing and says why immediately.
      const credentials = await requireCredentials();
      console.log(`${LOG} service account ${credentials.clientEmail} (key at ${credentials.path})`);
      destination = await driveDestination(credentials.path, args.folderId);
    }
  }

  const rows = await deps.fetchExemplars(args);
  const report: ExportReport = {
    destination: destination.label,
    considered: rows.length,
    uploaded: 0,
    skipped: 0,
    refused: 0,
    failed: 0,
    entries: [],
    manifestWritten: false,
  };

  console.log(
    `${LOG} ${destination.label} · ${rows.length} exemplar(s) considered` +
      (args.dryRun ? ' · DRY RUN, nothing will be written' : '') +
      (args.manifestOnly ? ' · manifest only, nothing will be uploaded' : '') +
      (args.since ? ` · since ${args.since}` : '') +
      (args.limit ? ` · limit ${args.limit}` : ''),
  );

  for (const row of rows) {
    // THE SECOND CONSENT CHECK. Everything below this line reads bytes.
    const refusal = consentProblem(row);
    if (refusal) {
      report.refused++;
      console.warn(`${LOG} refusing exemplar ${row.exemplar_id}: ${refusal}`);
      continue;
    }

    let provenance: Provenance;
    try {
      provenance = buildProvenance(row, exportedAt);
    } catch (err) {
      report.failed++;
      console.warn(`${LOG} exemplar ${row.exemplar_id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    try {
      const existing = await destination.stat(provenance.fileName);
      if (existing) {
        // B8: a re-run is a no-op. The entry is still recorded, because the
        // manifest describes the FOLDER, not this run.
        report.skipped++;
        report.entries.push({ ...provenance, bytes: existing.bytes });
        continue;
      }
      if (args.manifestOnly) {
        // The rebuild only indexes what is actually there. A name we would
        // have uploaded but did not is not an image, and listing it would make
        // the manifest a wish list.
        continue;
      }
      if (args.dryRun) {
        report.uploaded++;
        report.entries.push({ ...provenance, bytes: null });
        console.log(`${LOG} would upload ${provenance.fileName}`);
        continue;
      }
      const source = await deps.readCrop(row.crop_object_key as string);
      const encoded = await encodeExportImage(source, provenance);
      await destination.put(provenance.fileName, encoded, 'image/jpeg');
      report.uploaded++;
      report.entries.push({ ...provenance, bytes: encoded.byteLength });
    } catch (err) {
      report.failed++;
      console.warn(
        `${LOG} exemplar ${row.exemplar_id} (${provenance.fileName}) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!args.dryRun) {
    await destination.putText(MANIFEST_NAME, buildManifest(report.entries, exportedAt), 'application/json');
    report.manifestWritten = true;
  }

  console.log(
    `${LOG} done: uploaded=${report.uploaded} skipped=${report.skipped} ` +
      `refused=${report.refused} failed=${report.failed} manifest=${report.entries.length} entries` +
      (report.manifestWritten ? '' : ' (not written — dry run)'),
  );
  return report;
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runExport(args, {
    fetchExemplars: fetchExemplarsFromDb,
    readCrop: readCropFromObjectStore,
  });
  if (report.failed > 0) {
    // A partial export is not a success. Idempotency (B8) means the fix is to
    // re-run once the cause is dealt with, and the already-uploaded images are
    // skipped rather than re-sent.
    throw new Error(`${report.failed} exemplar(s) failed; re-run after fixing the cause`);
  }
}

/**
 * Only run when this file IS the process entry point. Compared with the
 * extension stripped and case-folded because tsx resolves `.mjs` specifiers to
 * the `.mts` source, and Windows hands back drive letters in either case.
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalise = (p: string): string =>
    resolve(p).replace(/\\/g, '/').replace(/\.m?[jt]s$/, '').toLowerCase();
  return normalise(entry) === normalise(fileURLToPath(import.meta.url));
}

if (isEntrypoint()) {
  main().catch((err) => {
    // The multi-line credential messages already carry the prefix; adding a
    // second one turns an actionable message into a stuttering one.
    const message = err instanceof Error ? err.message : String(err);
    console.error(message.startsWith(LOG) ? message : `${LOG} ${message}`);
    process.exit(1);
  });
}
