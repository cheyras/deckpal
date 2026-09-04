import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { describe, it } from 'node:test';
import {
  EXPORT_FIELD_COUNT,
  MAX_EXPORT_NAME_LENGTH,
  MAX_FRAME_INDEX_DIGITS,
  MAX_ID_DIGITS,
  MAX_IDENTITY_SLUG_LENGTH,
  MAX_SLEEVE_SLUG_LENGTH,
  buildExportName,
  capturedDateToken,
  consentProblem,
  exportNameProblem,
  parseArgs,
  parseExportName,
  slugIdentity,
  slugLabel,
  type ExemplarRow,
  type ExportNameParts,
} from '../export.mjs';

/**
 * The filename convention, on its own, with no network, no database, no sharp.
 *
 * Two halves, and the second is the one that is easy to skip:
 *
 *  1. every name the tool PRODUCES parses back to what built it, because the
 *     name is the only thing a reader has when an image has been copied out of
 *     the folder and away from the manifest;
 *  2. every hostile or malformed input is refused BY THE BUILDER, before it can
 *     become a path. This is the same reasoning as
 *     `packages/storage/src/__tests__/object-path.test.ts`: a filename derived
 *     from free text is a path-injection sink, and the allow-list is only worth
 *     anything if it is asserted rather than assumed.
 */

const REAL_ROW: ExportNameParts = {
  setId: 'sv03.5',
  localId: '102',
  variantId: '4471',
  sleeve: 'Dragon Shield Matte Black',
  pipeline: 'frame',
  framePipelineVersion: 3,
  capturedAt: '2026-09-04T11:02:31.000Z',
  exemplarId: '918273',
};

describe('buildExportName — the shape of a real name', () => {
  it('produces the documented example', () => {
    assert.equal(
      buildExportName(REAL_ROW),
      'sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273.jpg',
    );
  });

  it('uses the dot sentinels when the printing and the sleeve are unknown', () => {
    assert.equal(
      buildExportName({ ...REAL_ROW, variantId: null, sleeve: null }),
      'sv03.5_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-918273.jpg',
    );
  });

  it('cannot have its null sentinel forged by a sleeve called "none"', () => {
    // The slug alphabet for the sleeve field has no dot, so `sl-none` and
    // `sl.none` are different names and mean different things. If this ever
    // fails, an unsleeved exemplar and a "None" sleeve collapse into one file.
    const named = buildExportName({ ...REAL_ROW, sleeve: 'None' });
    const absent = buildExportName({ ...REAL_ROW, sleeve: null });
    assert.notEqual(named, absent);
    assert.ok(named.includes('_sl-none_'), named);
    assert.ok(absent.includes('_sl.none_'), absent);
    assert.equal(parseExportName(named)?.sleeve, 'none');
    assert.equal(parseExportName(absent)?.sleeve, null);
  });

  it('is a pure function of the row — same row, same name, every time', () => {
    assert.equal(buildExportName(REAL_ROW), buildExportName({ ...REAL_ROW }));
  });

  it('gives every retained frame of one exemplar its own name', () => {
    // `scan_exemplar_frame` is keyed (exemplar_id, frame_index): one capture can
    // retain up to sixteen crops. Keyed on the exemplar alone they would share a
    // name, and since the tool SKIPS a name it already finds, fifteen of them
    // would be silently dropped as "already exported" rather than overwritten.
    const names = new Set([0, 1, 2, 15].map((frameIndex) => buildExportName({ ...REAL_ROW, frameIndex })));
    assert.equal(names.size, 4);
    assert.ok([...names].every((name) => name.includes('_e-918273-')), [...names].join('\n'));
    assert.ok(names.has('sv03.5_102_v-4471_sl-dragon-shield-matte-black_pl-frame_fv-3_d-20260904_e-918273-15.jpg'));
  });

  it('is byte-identical without a frame index — the field is additive', () => {
    // Nothing already in the folder is renamed by the field existing.
    const bare = buildExportName(REAL_ROW);
    assert.equal(buildExportName({ ...REAL_ROW, frameIndex: null }), bare);
    assert.equal(buildExportName({ ...REAL_ROW, frameIndex: undefined }), bare);
    assert.ok(bare.endsWith('_e-918273.jpg'), bare);
    assert.equal(parseExportName(bare)?.frameIndex, null);
    // Frame 0 is a real position and must NOT collapse into the bare form.
    assert.notEqual(buildExportName({ ...REAL_ROW, frameIndex: 0 }), bare);
    assert.equal(parseExportName(buildExportName({ ...REAL_ROW, frameIndex: 0 }))?.frameIndex, 0);
  });

  it('accepts every real set/local id shape this catalog contains', () => {
    // Drawn from the shapes packages/storage/src/__tests__/object-path.test.ts
    // asserts are addressable. A too-strict slug here is an export that
    // silently omits whole sets, which is worse than a loud failure.
    const real: Array<[string, string]> = [
      ['sv03.5', '102'],
      ['base1', '4'],
      ['swsh12.5', 'GG01'],
      ['tk-bw-e', 'TG05'],
      ['P-A', '001'],
      ['me05', '120'],
      ['swsh9tg', 'SV001'],
    ];
    for (const [setId, localId] of real) {
      const name = buildExportName({ ...REAL_ROW, setId, localId });
      const parsed = parseExportName(name);
      assert.ok(parsed, `${setId}-${localId} did not parse back`);
      // Byte-identical, not merely accepted: the slug must be a no-op on a real
      // identifier or the filename stops naming the card it came from.
      assert.equal(parsed.setId, setId);
      assert.equal(parsed.localId, localId);
    }
  });

  it('drops leading zeros so one id has one filename', () => {
    assert.equal(
      buildExportName({ ...REAL_ROW, exemplarId: '000918273' }),
      buildExportName({ ...REAL_ROW, exemplarId: '918273' }),
    );
  });

  it('accepts a Date, an ISO string, or an existing YYYYMMDD token', () => {
    const fromIso = buildExportName(REAL_ROW);
    const fromDate = buildExportName({ ...REAL_ROW, capturedAt: new Date('2026-09-04T11:02:31.000Z') });
    const fromToken = buildExportName({ ...REAL_ROW, capturedAt: '20260904' });
    assert.equal(fromDate, fromIso);
    assert.equal(fromToken, fromIso);
  });

  it('reads the capture date in UTC, not the runner\'s zone', () => {
    // 23:30Z on the 4th is the 5th in Sydney and the 4th in London. The stamp
    // has to be the same file name on every machine that runs the export.
    assert.equal(capturedDateToken('2026-09-04T23:30:00.000Z'), '20260904');
    assert.equal(capturedDateToken('2026-09-05T00:30:00.000Z'), '20260905');
  });
});

describe('the round trip', () => {
  const corpus: ExportNameParts[] = [
    REAL_ROW,
    { ...REAL_ROW, variantId: null },
    { ...REAL_ROW, sleeve: null },
    { ...REAL_ROW, variantId: null, sleeve: null },
    { ...REAL_ROW, setId: 'P-A', localId: 'TG05', pipeline: 'frame-crop', framePipelineVersion: 11 },
    { ...REAL_ROW, sleeve: 'Ultra PRO Eclipse — Jet Black (100ct)' },
    { ...REAL_ROW, exemplarId: '9007199254740993' }, // past 2^53: ids stay text
    { ...REAL_ROW, variantId: '9223372036854775807' }, // bigint max
    { ...REAL_ROW, frameIndex: 0 },
    { ...REAL_ROW, frameIndex: 15 },
    { ...REAL_ROW, variantId: null, sleeve: null, frameIndex: 7 },
  ];

  it('parse ∘ build recovers every field (the sleeve as its slug)', () => {
    for (const parts of corpus) {
      const name = buildExportName(parts);
      const parsed = parseExportName(name);
      assert.ok(parsed, `${name} did not parse`);
      assert.equal(parsed.setId, slugIdentity(parts.setId));
      assert.equal(parsed.localId, slugIdentity(parts.localId));
      assert.equal(parsed.variantId, parts.variantId === null ? null : String(parts.variantId));
      assert.equal(parsed.sleeve, parts.sleeve === null ? null : slugLabel(parts.sleeve));
      assert.equal(parsed.pipeline, slugLabel(parts.pipeline, MAX_IDENTITY_SLUG_LENGTH));
      assert.equal(parsed.framePipelineVersion, parts.framePipelineVersion);
      assert.equal(parsed.capturedAt, capturedDateToken(parts.capturedAt));
      assert.equal(parsed.exemplarId, String(parts.exemplarId));
      assert.equal(parsed.frameIndex, parts.frameIndex ?? null);
    }
  });

  it('build ∘ parse is the identity on every name build produced', () => {
    // The property that actually matters operationally: a name read back off
    // the folder rebuilds to itself, so `--manifest-only` cannot rename a file
    // by round-tripping it.
    for (const parts of corpus) {
      const name = buildExportName(parts);
      const parsed = parseExportName(name);
      assert.ok(parsed);
      assert.equal(buildExportName(parsed), name);
    }
  });

  it('both slugs are idempotent — re-slugging changes nothing', () => {
    for (const value of ['Dragon Shield Matte Black', 'sv03.5', 'GG01', 'a  b', '--x--', 'ÜBER Sleeve']) {
      assert.equal(slugLabel(slugLabel(value)), slugLabel(value), value);
      assert.equal(slugIdentity(slugIdentity(value)), slugIdentity(value), value);
    }
  });
});

describe('parseExportName — names it must refuse', () => {
  const rejected: Array<[string, string]> = [
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904.jpg', 'seven fields'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-1_extra.jpg', 'nine fields'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-918273.png', 'wrong extension'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-2026904_e-918273.jpg', 'seven-digit date'],
    ['sv03.5_102_v-abc_sl.none_pl-frame_fv-3_d-20260904_e-918273.jpg', 'non-numeric variant'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-x_d-20260904_e-918273.jpg', 'non-numeric frame version'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-.jpg', 'empty exemplar id'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-918273-.jpg', 'empty frame index'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-918273-1-2.jpg', 'two frame indexes'],
    ['sv03.5_102_v-4471_sl.none_pl-frame_fv-3_d-20260904_e-918273-x.jpg', 'non-numeric frame index'],
    ['sv03.5_102_v-4471_sl.none_pl-FRAME_fv-3_d-20260904_e-918273.jpg', 'uppercase pipeline slug'],
    ['sv03.5_102_v.some_sl.none_pl-frame_fv-3_d-20260904_e-918273.jpg', 'a sentinel that is not the sentinel'],
    ['../../etc/passwd_102_v.none_sl.none_pl-frame_fv-3_d-20260904_e-1.jpg', 'traversal'],
    ['manifest.json', 'not an image name at all'],
    ['', 'empty'],
  ];

  for (const [name, why] of rejected) {
    it(`refuses ${JSON.stringify(name)} (${why})`, () => {
      assert.equal(parseExportName(name), null);
    });
  }

  it('refuses non-strings rather than coercing them', () => {
    for (const value of [null, undefined, 42, {}, ['x']]) {
      assert.notEqual(exportNameProblem(value), null, String(value));
    }
  });
});

describe('the guard — a name must never be a path', () => {
  /**
   * Everything a `sleeve` column could hold, given it is free text a user
   * typed. None of it may reach the filesystem or a Drive query as anything but
   * an inert token.
   */
  const hostile = [
    '../../etc/passwd',
    '..',
    '.',
    './..',
    'a/b',
    String.raw`a\b`,
    '/absolute',
    'trailing/',
    '%2e%2e',
    'x%00y',
    'sleeve name',
    'sleeve\nname',
    'sleeve\tname',
    "quote'injection",
    'double"quote',
    'null',
    'none',
    'NONE',
    '',
    '   ',
    '----',
    '....',
    '.hidden',
    '-leading-hyphen',
    'Über Sleeve — “fancy” dashes',
    'ドラゴンシールド',
    '‮gnp.exe',
    'a'.repeat(500),
    '<script>alert(1)</script>',
    "'; DROP TABLE scan_exemplar; --",
    '$(rm -rf /)',
    'CON',
    'a_b_c_d_e_f_g',
  ];

  for (const sleeve of hostile) {
    it(`neutralises sleeve ${JSON.stringify(sleeve.slice(0, 40))}`, () => {
      const name = buildExportName({ ...REAL_ROW, sleeve });
      assert.equal(exportNameProblem(name), null, name);
      assert.ok(!name.includes('/'), name);
      assert.ok(!name.includes('\\'), name);
      assert.ok(!name.includes('..'), name);
      assert.ok(!name.includes('\0'), name);
      assert.ok(!name.includes('%'), name);
      assert.ok(!name.includes("'"), name); // the Drive `q =` interpolation
      assert.ok(!/\s/.test(name), name);
      assert.ok(!name.startsWith('.') && !name.startsWith('-'), name);
      // The strongest statement of the property: the name IS its own basename,
      // so joining it to a directory cannot land anywhere else.
      assert.equal(basename(name), name);
      assert.ok(name.length <= MAX_EXPORT_NAME_LENGTH, `${name.length} chars`);
      assert.equal(name.split('_').length, EXPORT_FIELD_COUNT);
      // And it still parses, so a neutralised name is not an unreadable one.
      assert.ok(parseExportName(name));
    });
  }

  it('neutralises a hostile set id and local id too', () => {
    for (const evil of hostile) {
      for (const name of [
        buildExportName({ ...REAL_ROW, setId: evil }),
        buildExportName({ ...REAL_ROW, localId: evil }),
        buildExportName({ ...REAL_ROW, pipeline: evil }),
      ]) {
        assert.equal(exportNameProblem(name), null, name);
        assert.equal(basename(name), name);
        assert.ok(parseExportName(name), name);
      }
    }
  });

  it('the length cap is arithmetically unreachable, not merely usually unmet', () => {
    // Maximal legal input in every field at once. If this ever exceeds the cap,
    // buildExportName would start throwing on a legitimate row.
    const name = buildExportName({
      setId: 'S'.repeat(MAX_IDENTITY_SLUG_LENGTH * 2),
      localId: 'L'.repeat(MAX_IDENTITY_SLUG_LENGTH * 2),
      variantId: '9'.repeat(MAX_ID_DIGITS),
      sleeve: 'z'.repeat(MAX_SLEEVE_SLUG_LENGTH * 2),
      pipeline: 'p'.repeat(MAX_IDENTITY_SLUG_LENGTH * 2),
      framePipelineVersion: Number('9'.repeat(15)),
      capturedAt: '20260904',
      exemplarId: '9'.repeat(MAX_ID_DIGITS),
      frameIndex: '9'.repeat(MAX_FRAME_INDEX_DIGITS),
    });
    assert.ok(name.length <= MAX_EXPORT_NAME_LENGTH, `maximal name is ${name.length} chars`);
    assert.equal(exportNameProblem(name), null);
  });

  it('throws on an id that is not one, rather than emitting an unparseable name', () => {
    for (const bad of ['abc', '-1', '1.5', '', ' 12', '9'.repeat(MAX_ID_DIGITS + 1)]) {
      assert.throws(() => buildExportName({ ...REAL_ROW, exemplarId: bad }), JSON.stringify(bad));
      assert.throws(() => buildExportName({ ...REAL_ROW, variantId: bad }), JSON.stringify(bad));
    }
    for (const bad of ['abc', '-1', '9'.repeat(MAX_FRAME_INDEX_DIGITS + 1)]) {
      assert.throws(() => buildExportName({ ...REAL_ROW, frameIndex: bad }), JSON.stringify(bad));
    }
  });

  it('throws on a capture timestamp that is not one', () => {
    for (const bad of ['', 'yesterday', 'not-a-date', '2026-13-45T00:00:00Z']) {
      assert.throws(() => buildExportName({ ...REAL_ROW, capturedAt: bad }), /not a date/);
    }
  });
});

describe('consentProblem — the second gate', () => {
  const consented: ExemplarRow = {
    exemplar_id: '918273',
    user_id: '00000000-0000-0000-0000-000000000001',
    card_id: '551',
    card_tcgdex_id: 'sv03.5-102',
    card_name: 'Charizard ex',
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

  it('passes a row that carries both halves of the opt-in', () => {
    assert.equal(consentProblem(consented), null);
  });

  /**
   * Each of these is a row the SQL should never have returned. The point of
   * asserting them is that this check is what holds when the SQL is wrong — a
   * widened query, a `fetchExemplars` seam, a copied-and-trimmed WHERE clause.
   */
  const refused: Array<[string, Partial<ExemplarRow>]> = [
    ['retention off', { crop_retained: false }],
    ['consent never recorded', { crop_consent_at: null }],
    ['no stored crop', { crop_object_key: null }],
    ['empty crop key', { crop_object_key: '' }],
    ['retention off AND consent recorded', { crop_retained: false }],
  ];

  for (const [why, patch] of refused) {
    it(`refuses: ${why}`, () => {
      assert.notEqual(consentProblem({ ...consented, ...patch }), null);
    });
  }

  it('refuses a truthy-but-not-true crop_retained', () => {
    // `=== true`, not truthiness: a driver that hands back 't' or 1 for a
    // boolean must not read as consent.
    for (const value of ['t', 1, 'true', {}] as unknown[]) {
      assert.notEqual(
        consentProblem({ ...consented, crop_retained: value as boolean }),
        null,
        JSON.stringify(value),
      );
    }
  });
});

describe('parseArgs — a typo must not become an upload', () => {
  it('defaults to the Drive path with nothing skipped', () => {
    const args = parseArgs([]);
    assert.equal(args.dryRun, false);
    assert.equal(args.localOut, null);
    assert.equal(args.manifestOnly, false);
    assert.equal(args.limit, null);
    assert.equal(args.since, null);
  });

  it('reads the flags the owner asked for', () => {
    const args = parseArgs(['--dry-run', '--local-out', 'out', '--limit', '25', '--since', '2026-09-01']);
    assert.equal(args.dryRun, true);
    assert.equal(args.localOut, 'out');
    assert.equal(args.limit, 25);
    assert.equal(args.since, '2026-09-01T00:00:00.000Z');
  });

  it('rejects an unknown flag instead of ignoring it', () => {
    // `apps/api/src/scan/index.ts` ignores unknown tokens, and there that costs
    // a slower re-index. Here `--dry-ru` would cost a real upload to a shared
    // folder the operator believed was a rehearsal.
    assert.throws(() => parseArgs(['--dry-ru']), /unknown argument/);
    assert.throws(() => parseArgs(['--dryrun']), /unknown argument/);
    assert.throws(() => parseArgs(['out']), /unknown argument/);
  });

  it('rejects a flag whose value is missing or is the next flag', () => {
    assert.throws(() => parseArgs(['--local-out']), /needs a value/);
    assert.throws(() => parseArgs(['--local-out', '--dry-run']), /needs a value/);
    assert.throws(() => parseArgs(['--since']), /needs a value/);
  });

  it('rejects a --limit that is not a positive integer, and a --since that is not a date', () => {
    for (const bad of ['0', '-5', '1.5', 'all']) {
      assert.throws(() => parseArgs(['--limit', bad]), /positive integer/, bad);
    }
    assert.throws(() => parseArgs(['--since', 'last tuesday']), /ISO date/);
  });
});
