import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import {
  MANIFEST_NAME,
  USAGE_LICENCE,
  XMP_NAMESPACE,
  buildExportName,
  parseArgs,
  runExport,
  type ExemplarRow,
  type ExportReport,
} from '../export.mjs';

/**
 * The whole tool, end to end, against a real filesystem — with the database and
 * the object store replaced by injected seams.
 *
 * `scan_exemplar` does not exist yet (its migration is being written alongside
 * this tool and has not been applied anywhere), so the SQL is the one part of
 * this file that cannot be exercised. Everything downstream of it can, and the
 * claim this file is here to substantiate is the one that is easiest to believe
 * and hardest to check: that the exported JPEGs really do carry their own
 * provenance, and really do NOT carry the contributor's.
 *
 * The metadata assertions read the encoded bytes back through sharp rather than
 * trusting the encode call to have done what it was asked. That is not
 * pedantry: `withMetadata({ xmp })` accepts the option, encodes successfully,
 * and writes nothing at all on sharp 0.35.3 — a silent no-op that a test
 * asserting on the call would have passed.
 */

const FIXED_NOW = new Date('2026-09-04T12:00:00.000Z');

/** A phone photograph: EXIF the contributor never meant to publish. */
const CONTRIBUTOR_MAKE = 'SECRET-CONTRIBUTOR-PHONE';

async function contributorPhoto(): Promise<Buffer> {
  return await sharp({
    create: { width: 120, height: 168, channels: 3, background: { r: 200, g: 40, b: 60 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: CONTRIBUTOR_MAKE, Model: 'SECRET-MODEL', ImageDescription: 'SECRET-ORIGINAL' },
      IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
    })
    .toBuffer();
}

const CONSENTED: ExemplarRow = {
  exemplar_id: '918273',
  user_id: '00000000-0000-0000-0000-0000000000aa',
  card_id: '551',
  card_tcgdex_id: 'sv03.5-102',
  card_name: 'Flabébé',
  local_id: '102',
  set_tcgdex_id: 'sv03.5',
  variant_id: '4471',
  sleeve: 'Dragon Shield Matte Black',
  crop_retained: true,
  crop_consent_at: '2026-09-01T09:00:00.000Z',
  crop_object_key: 'scans/2026/09/918273.jpg',
  pipeline: 'frame',
  frame_pipeline_version: 3,
  captured_at: '2026-09-04T11:02:31.000Z',
};

/** Same user, no chosen printing and no sleeve: both sentinels get exercised. */
const CONSENTED_SPARSE: ExemplarRow = {
  ...CONSENTED,
  exemplar_id: '918274',
  variant_id: null,
  sleeve: null,
  crop_object_key: 'scans/2026/09/918274.jpg',
};

/**
 * A row the SQL is supposed to have excluded. It is injected anyway, because
 * the point of the in-TypeScript consent check is that it holds when the query
 * is wrong — and this seam IS a wrong query, by construction.
 */
const NOT_CONSENTED: ExemplarRow = {
  ...CONSENTED,
  exemplar_id: '918275',
  crop_retained: true,
  crop_consent_at: null,
  crop_object_key: 'scans/2026/09/918275.jpg',
};

describe('runExport — a real local export', () => {
  let dir = '';
  let photo: Buffer;
  let cropReads: string[] = [];
  let report: ExportReport;

  const deps = () => ({
    fetchExemplars: async () => [CONSENTED, CONSENTED_SPARSE, NOT_CONSENTED],
    readCrop: async (key: string) => {
      cropReads.push(key);
      return photo;
    },
    now: () => FIXED_NOW,
  });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'deckpal-drive-export-'));
    photo = await contributorPhoto();
    cropReads = [];
    report = await runExport(parseArgs(['--local-out', dir]), deps());
  });

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('exports the consented rows and refuses the rest', () => {
    assert.equal(report.considered, 3);
    assert.equal(report.uploaded, 2);
    assert.equal(report.refused, 1);
    assert.equal(report.failed, 0);
  });

  it('never even READS the crop of a row without recorded consent', () => {
    // The strongest form of the guarantee: not "we did not upload it" but "we
    // did not open it". If this fails, an unconsented image was in memory.
    assert.deepEqual(cropReads.sort(), [
      'scans/2026/09/918273.jpg',
      'scans/2026/09/918274.jpg',
    ]);
    assert.ok(!cropReads.includes('scans/2026/09/918275.jpg'));
  });

  it('writes exactly the named files and the manifest, nothing else', async () => {
    const entries = (await readdir(dir)).sort();
    assert.deepEqual(entries, [
      MANIFEST_NAME,
      'sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273.jpg',
      'sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918274.jpg',
    ].sort());
    // No staging files survived a successful run.
    assert.ok(!entries.some((name) => name.includes('.tmp-')), entries.join(', '));
  });

  it('embeds the provenance as XMP, in the deckpal namespace', async () => {
    const name = buildExportName({
      setId: 'sv03.5',
      localId: '102',
      variantId: '4471',
      sleeve: 'Dragon Shield Matte Black',
      pipeline: 'frame',
      framePipelineVersion: 3,
      capturedAt: '2026-09-04T11:02:31.000Z',
      exemplarId: '918273',
    });
    const metadata = await sharp(await readFile(join(dir, name))).metadata();
    assert.ok(metadata.xmp, 'no XMP packet was written at all');
    const xmp = metadata.xmp.toString('utf8');

    assert.ok(xmp.startsWith('<?xpacket'), 'not a wrapped XMP packet');
    assert.ok(xmp.includes('x:xmpmeta'), 'not an x:xmpmeta packet');
    assert.ok(xmp.includes(`xmlns:deckpal="${XMP_NAMESPACE}"`), 'namespace missing');
    for (const [field, value] of [
      ['cardId', '551'],
      ['cardTcgdexId', 'sv03.5-102'],
      ['setId', 'sv03.5'],
      ['localId', '102'],
      ['variantId', '4471'],
      ['pipeline', 'frame'],
      ['framePipelineVersion', '3'],
      ['exemplarId', '918273'],
      ['capturedAt', '2026-09-04T11:02:31.000Z'],
      ['consentAt', '2026-09-01T09:00:00.000Z'],
      ['exportedAt', FIXED_NOW.toISOString()],
      ['fileName', name],
    ] as const) {
      assert.ok(xmp.includes(`deckpal:${field}="${value}"`), `deckpal:${field} missing or wrong`);
    }
    // UTF-8 survives here even though it cannot in EXIF — that is the whole
    // reason both are written.
    assert.ok(xmp.includes('deckpal:cardName="Flabébé"'), 'accented card name was mangled in XMP');
    assert.ok(xmp.includes(USAGE_LICENCE.slice(0, 60)), 'licence missing');
  });

  it('keeps an absent printing and an absent sleeve PRESENT and empty', async () => {
    // Empty means "no value recorded"; a missing attribute would mean "nothing
    // wrote it", and an image separated from the manifest cannot tell those
    // apart unless the field is always there.
    const name = 'sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918274.jpg';
    const metadata = await sharp(await readFile(join(dir, name))).metadata();
    const xmp = metadata.xmp?.toString('utf8') ?? '';
    assert.ok(xmp.includes('deckpal:variantId=""'), 'variantId attribute is absent, not empty');
    assert.ok(xmp.includes('deckpal:sleeve=""'), 'sleeve attribute is absent, not empty');
  });

  it('embeds the provenance as EXIF ImageDescription and UserComment', async () => {
    const name = 'sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918274.jpg';
    const metadata = await sharp(await readFile(join(dir, name))).metadata();
    assert.ok(metadata.exif, 'no EXIF block was written');
    // Asserted against the raw EXIF bytes rather than a parsed tree: EXIF
    // strings are stored as ASCII in the TIFF structure, so a substring search
    // is exact, and it avoids taking a dependency on an EXIF parser just to
    // check that a write happened.
    const exif = metadata.exif.toString('latin1');
    assert.ok(exif.includes('DeckPal card scan.'), 'ImageDescription missing');
    assert.ok(exif.includes('exemplar 918274'), 'ImageDescription lost the exemplar id');
    assert.ok(exif.includes('no chosen printing'), 'a null printing must say so in words');
    assert.ok(exif.includes('"exemplarId":"918274"'), 'UserComment JSON missing');
    assert.ok(exif.includes('"consentAt":"2026-09-01T09:00:00.000Z"'), 'UserComment lost the consent stamp');
    // Non-ASCII is escaped rather than emitted raw, because EXIF is ASCII.
    assert.ok(exif.includes('Flab\\u00e9b\\u00e9'), 'non-ASCII card name was not escaped for EXIF');
  });

  it("strips the contributor's camera EXIF instead of forwarding it", async () => {
    // The measured reason this uses `withExif` and not `withMetadata({ exif })`.
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.jpg')) continue;
      const bytes = await readFile(join(dir, name));
      assert.ok(!bytes.includes(Buffer.from(CONTRIBUTOR_MAKE, 'latin1')), `${name} leaked the device make`);
      assert.ok(!bytes.includes(Buffer.from('SECRET-MODEL', 'latin1')), `${name} leaked the device model`);
      assert.ok(!bytes.includes(Buffer.from('SECRET-ORIGINAL', 'latin1')), `${name} leaked the original description`);
    }
  });

  it('never writes the contributor identity into an exported file', async () => {
    // `user_id` is deliberately not in the provenance record. The export leaves
    // the system; who took the photograph does not need to.
    for (const name of await readdir(dir)) {
      const bytes = await readFile(join(dir, name));
      assert.ok(!bytes.includes(Buffer.from(CONSENTED.user_id, 'latin1')), `${name} leaked user_id`);
    }
  });

  it('writes a manifest that indexes what is actually in the folder', async () => {
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_NAME), 'utf8')) as {
      count: number;
      generatedAt: string;
      namespace: string;
      images: Array<{ fileName: string; bytes: number; exemplarId: string; sleeve: string | null }>;
    };
    assert.equal(manifest.count, 2);
    assert.equal(manifest.generatedAt, FIXED_NOW.toISOString());
    assert.equal(manifest.namespace, XMP_NAMESPACE);
    assert.deepEqual(
      manifest.images.map((image) => image.exemplarId),
      ['918273', '918274'],
    );
    // Sorted by name, so a diff of this file shows folder changes rather than
    // row order.
    assert.deepEqual(
      manifest.images.map((image) => image.fileName),
      [...manifest.images.map((image) => image.fileName)].sort(),
    );
    for (const image of manifest.images) {
      const onDisk = await readFile(join(dir, image.fileName));
      assert.equal(image.bytes, onDisk.byteLength, `${image.fileName} byte size disagrees with the file`);
    }
    // The refused exemplar appears nowhere.
    assert.ok(!JSON.stringify(manifest).includes('918275'));
  });
});

describe('runExport — re-running is a no-op (contract B8)', () => {
  let dir = '';
  let photo: Buffer;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'deckpal-drive-export-'));
    photo = await contributorPhoto();
  });
  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const deps = (reads: string[]) => ({
    fetchExemplars: async () => [CONSENTED, CONSENTED_SPARSE],
    readCrop: async (key: string) => {
      reads.push(key);
      return photo;
    },
    now: () => FIXED_NOW,
  });

  it('uploads on the first run and skips everything on the second', async () => {
    const first: string[] = [];
    const a = await runExport(parseArgs(['--local-out', dir]), deps(first));
    assert.equal(a.uploaded, 2);
    assert.equal(first.length, 2);

    const manifestAfterFirst = await readFile(join(dir, MANIFEST_NAME), 'utf8');

    const second: string[] = [];
    const b = await runExport(parseArgs(['--local-out', dir]), deps(second));
    assert.equal(b.uploaded, 0);
    assert.equal(b.skipped, 2);
    assert.equal(b.failed, 0);
    // Nothing was even fetched from the object store the second time: the
    // existence check is what makes a re-run cheap, not just harmless.
    assert.deepEqual(second, []);

    // And the manifest is byte-identical, which is what lets it be checked into
    // a review or diffed between runs.
    assert.equal(await readFile(join(dir, MANIFEST_NAME), 'utf8'), manifestAfterFirst);
  });

  it('--manifest-only rebuilds the index from the images, uploading nothing', async () => {
    const expected = await readFile(join(dir, MANIFEST_NAME), 'utf8');
    await unlink(join(dir, MANIFEST_NAME));

    const reads: string[] = [];
    const report = await runExport(parseArgs(['--local-out', dir, '--manifest-only']), deps(reads));
    assert.equal(report.uploaded, 0);
    assert.equal(report.skipped, 2);
    assert.deepEqual(reads, []);
    assert.equal(await readFile(join(dir, MANIFEST_NAME), 'utf8'), expected);
  });

  it('--manifest-only lists only images that exist, not ones it would have made', async () => {
    const orphan = 'sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918274.jpg';
    await unlink(join(dir, orphan));

    const report = await runExport(parseArgs(['--local-out', dir, '--manifest-only']), deps([]));
    const manifest = JSON.parse(await readFile(join(dir, MANIFEST_NAME), 'utf8')) as { count: number };
    assert.equal(report.skipped, 1);
    assert.equal(manifest.count, 1, 'the rebuild listed an image that is not there');
  });
});

describe('runExport — --dry-run writes nothing', () => {
  it('reports the plan and leaves the directory empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckpal-drive-export-'));
    try {
      const reads: string[] = [];
      const report = await runExport(parseArgs(['--local-out', dir, '--dry-run']), {
        fetchExemplars: async () => [CONSENTED, CONSENTED_SPARSE, NOT_CONSENTED],
        readCrop: async (key: string) => {
          reads.push(key);
          return Buffer.alloc(0);
        },
        now: () => FIXED_NOW,
      });
      assert.equal(report.uploaded, 2, 'a dry run still reports what it would do');
      assert.equal(report.refused, 1);
      assert.equal(report.manifestWritten, false);
      assert.deepEqual(reads, [], 'a dry run must not read the crops either');
      assert.deepEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
