import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SET_IMAGE_FALLBACK_TABLE, setImageFallbackUrl } from '../setImageFallback.js';
import type { SetImageKind } from '../paths.js';

/**
 * The set-image fallback crosswalk — the 43 (setId, kind) pairs the warmer fills
 * when the catalog column is NULL, plus the residue that must stay blank.
 *
 * What would actually break if this drifted:
 *  - an approved pair resolving to the WRONG url (a stale crosswalk) — every
 *    fill fetch hits the wrong file, and the manifest records a provenance lie;
 *  - a residue pair resolving non-null (a "helpful" completion of the table) —
 *    the McDonald's corporate logo or a Trainer Kit generic wordmark gets cached
 *    and served as app chrome, which is the exact exposure the exclusions exist
 *    to prevent;
 *  - a set we already serve from the catalog resolving non-null — the fallback
 *    would race the catalog and re-fetch a file that already exists.
 *
 * Source of truth: inputs/fill-worklist.json (generated 2026-08-29). 43 fill,
 * 47 residue. The two exclusion rulings that must hold: McDonald's LOGOS
 * (trademark, DECISIONS.md 2026-08-10) and the Trainer Kit LOGOS (owner decision
 * 2026-08-29 — one byte-identical wordmark across four EX Trainer Kit sets).
 */

describe('setImageFallbackUrl — the 43 approved pairs resolve to their exact URL', () => {
  it('the table holds exactly the 43 approved pairs (no silent add or drop)', () => {
    assert.equal(SET_IMAGE_FALLBACK_TABLE.length, 43);
  });

  it('every approved pair resolves to its exact approved sourceUrl', () => {
    for (const e of SET_IMAGE_FALLBACK_TABLE) {
      assert.equal(
        setImageFallbackUrl(e.setId, e.kind),
        e.sourceUrl,
        `${e.setId}|${e.kind} must resolve to ${e.sourceUrl}`,
      );
    }
  });

  it('a sampling of exact URLs (not just a table round-trip)', () => {
    const cases: Array<[string, SetImageKind, string]> = [
      ['me02', 'symbol', 'https://images.pokemontcg.io/me2/symbol.png'],
      ['sv08.5', 'symbol', 'https://images.pokemontcg.io/sv8pt5/symbol.png'],
      ['svp', 'symbol', 'https://images.pokemontcg.io/svp/symbol.png'],
      ['mep', 'symbol', 'https://archives.bulbagarden.net/media/upload/0/0c/SetSymbolMEP_Black_Star_Promos.png'],
      ['sv05', 'logo', 'https://images.pokemontcg.io/sv5/logo.png'],
      ['swsh12tg', 'logo', 'https://images.pokemontcg.io/swsh12tg/logo.png'],
      ['mfb', 'logo', 'https://archives.bulbagarden.net/media/upload/1/1d/My_First_Battle_logo.png'],
      ['base1', 'symbol', 'https://images.pokemontcg.io/base1/symbol.png'],
      ['tk-ex-m', 'symbol', 'https://images.pokemontcg.io/tk2b/symbol.png'],
      ['2016xy', 'symbol', 'https://images.pokemontcg.io/mcd16/symbol.png'],
    ];
    for (const [setId, kind, url] of cases) {
      assert.equal(setImageFallbackUrl(setId, kind), url);
    }
  });

  it('the (setId, kind) pairing is exact — a kind not approved for a set is null', () => {
    // me02 has an approved SYMBOL but its logo is served from the catalog, so the
    // fallback must return null for the logo kind, not the symbol's URL.
    assert.equal(setImageFallbackUrl('me02', 'logo'), null);
    // base1 has an approved SYMBOL only.
    assert.equal(setImageFallbackUrl('base1', 'logo'), null);
    // sv05 has an approved LOGO only.
    assert.equal(setImageFallbackUrl('sv05', 'symbol'), null);
    assert.equal(setImageFallbackUrl('mfb', 'symbol'), null);
  });
});

describe('setImageFallbackUrl — the 47 residue pairs resolve to null', () => {
  // Every (setId, kind) the owner ruled must stay blank (fill-worklist.json
  // `residue`). A non-null here means the warmer would fetch and cache an
  // excluded image — the McDonald's corporate logo or a Trainer Kit wordmark.
  const RESIDUE: Array<[string, SetImageKind]> = [
    ['mfb', 'symbol'], ['xya', 'symbol'], ['2024sv', 'symbol'], ['2023sv', 'symbol'],
    ['tk-bw-e', 'symbol'], ['tk-bw-z', 'symbol'], ['exu', 'symbol'], ['ex5.5', 'symbol'],
    ['miscp', 'symbol'], ['mee', 'logo'], ['mep', 'logo'], ['xya', 'logo'],
    ['2016xy', 'logo'], ['2022swsh', 'logo'], ['2021swsh', 'logo'], ['2014xy', 'logo'],
    ['2012bw', 'logo'], ['2024sv', 'logo'], ['2023sv', 'logo'], ['2019sm', 'logo'],
    ['2017sm', 'logo'], ['2018sm', 'logo'], ['2011bw', 'logo'], ['2015xy', 'logo'],
    ['tk-xy-latia', 'logo'], ['tk-sm-l', 'logo'], ['tk-xy-w', 'logo'], ['tk-xy-n', 'logo'],
    ['tk-xy-sy', 'logo'], ['tk-sm-r', 'logo'], ['tk-xy-p', 'logo'], ['tk-hs-g', 'logo'],
    ['tk-hs-r', 'logo'], ['tk-xy-su', 'logo'], ['tk-bw-e', 'logo'], ['tk-ex-latio', 'logo'],
    ['tk-ex-m', 'logo'], ['tk-xy-latio', 'logo'], ['tk-xy-b', 'logo'], ['tk-dp-m', 'logo'],
    ['tk-bw-z', 'logo'], ['tk-ex-p', 'logo'], ['tk-ex-latia', 'logo'], ['exu', 'logo'],
    ['ex5.5', 'logo'], ['tk-dp-l', 'logo'], ['miscp', 'logo'],
  ];

  it('residue has 47 entries (no silent add or drop)', () => {
    assert.equal(RESIDUE.length, 47);
  });

  for (const [setId, kind] of RESIDUE) {
    it(`residue ${setId}|${kind} resolves to null`, () => {
      assert.equal(setImageFallbackUrl(setId, kind), null);
    });
  }

  it('fill and residue are disjoint (no pair is both approved and excluded)', () => {
    const fill = new Set(SET_IMAGE_FALLBACK_TABLE.map((e) => `${e.setId}|${e.kind}`));
    for (const [setId, kind] of RESIDUE) {
      assert.equal(fill.has(`${setId}|${kind}`), false, `${setId}|${kind} is both fill and residue`);
    }
  });
});

describe('setImageFallbackUrl — the excluded classes stay null', () => {
  // The 12 McDonald's Collection LOGOS — excluded on trademark grounds
  // (DECISIONS.md 2026-08-10): the mcd* logo files are the byte-identical
  // corporate Golden Arches, not a set logo.
  const MCDONALDS_LOGO_IDS = [
    '2011bw', '2012bw', '2014xy', '2015xy', '2016xy', '2017sm',
    '2018sm', '2019sm', '2021swsh', '2022swsh', '2023sv', '2024sv',
  ];

  it('every McDonald\u2019s Collection LOGO stays null', () => {
    assert.equal(MCDONALDS_LOGO_IDS.length, 12);
    for (const id of MCDONALDS_LOGO_IDS) {
      assert.equal(setImageFallbackUrl(id, 'logo'), null, `mcd logo ${id} must stay null`);
    }
  });

  it('McDonald\u2019s SYMBOLS are NOT excluded (a genuine printed mark)', () => {
    // Nine of the twelve McDonald's sets have an approved symbol — confirming the
    // logo/symbol asymmetry the ruling relies on.
    const mcdSymbols = ['2011bw', '2012bw', '2014xy', '2015xy', '2016xy', '2017sm', '2018sm', '2019sm', '2022swsh'];
    for (const id of mcdSymbols) {
      assert.ok(setImageFallbackUrl(id, 'symbol'), `mcd symbol ${id} must be filled`);
    }
  });

  // The 20 Trainer Kit LOGOS — excluded by the owner's 2026-08-29 decision: the
  // four EX Trainer Kit sets share one byte-identical generic wordmark that would
  // show the same logo on different sets (reads as a bug).
  const TRAINER_KIT_LOGO_IDS = [
    'tk-xy-latia', 'tk-sm-l', 'tk-xy-w', 'tk-xy-n', 'tk-xy-sy', 'tk-sm-r',
    'tk-xy-p', 'tk-hs-g', 'tk-hs-r', 'tk-xy-su', 'tk-bw-e', 'tk-ex-latio',
    'tk-ex-m', 'tk-xy-latio', 'tk-xy-b', 'tk-dp-m', 'tk-bw-z', 'tk-ex-p',
    'tk-ex-latia', 'tk-dp-l',
  ];

  it('every Trainer Kit LOGO stays null', () => {
    assert.equal(TRAINER_KIT_LOGO_IDS.length, 20);
    for (const id of TRAINER_KIT_LOGO_IDS) {
      assert.equal(setImageFallbackUrl(id, 'logo'), null, `tk logo ${id} must stay null`);
    }
  });
});

describe('setImageFallbackUrl — sets we already serve resolve to null', () => {
  // A set whose (setId, kind) is NOT in the 43-entry table is served from the
  // catalog (or has no source at all). The fallback must not re-route it.
  const SERVED: Array<[string, SetImageKind]> = [
    ['sv01', 'logo'], ['sv01', 'symbol'],
    ['swsh1', 'logo'], ['swsh1', 'symbol'],
    ['sm1', 'logo'], ['sm1', 'symbol'],
    ['xy1', 'logo'], ['xy1', 'symbol'],
  ];
  for (const [setId, kind] of SERVED) {
    it(`served set ${setId}|${kind} resolves to null (catalog wins)`, () => {
      assert.equal(setImageFallbackUrl(setId, kind), null);
    });
  }
});

describe('setImageFallbackUrl — unknown or empty input is safe', () => {
  it('an empty setId returns null', () => {
    assert.equal(setImageFallbackUrl('', 'logo'), null);
    assert.equal(setImageFallbackUrl('', 'symbol'), null);
  });

  it('an unknown setId returns null', () => {
    assert.equal(setImageFallbackUrl('no-such-set', 'logo'), null);
    assert.equal(setImageFallbackUrl('no-such-set', 'symbol'), null);
  });

  it('does not coerce a non-string setId', () => {
    for (const bad of [undefined, null, 42] as unknown[]) {
      assert.equal(setImageFallbackUrl(bad as string, 'logo'), null);
    }
  });
});
