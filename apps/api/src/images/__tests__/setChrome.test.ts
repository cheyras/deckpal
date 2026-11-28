import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SET_IMAGE_FALLBACK_TABLE } from '@deckpal/storage';
import { setChromeUrl } from '../setChrome.js';

/**
 * What the API reports as a set's `logoUrl` / `symbolUrl`. The SPA asks for a
 * set's logo only when `logoUrl` is non-null, so a crosswalk logo reported as
 * null is a logo the image tier serves and nobody ever sees — which is what 15
 * sets were until 2026-11-27.
 */
describe('setChromeUrl — the catalog column, else the approved crosswalk', () => {
  it('a crosswalk logo whose catalog column is NULL is reported (the 2026-11-27 bug)', () => {
    assert.equal(setChromeUrl('sv05', 'logo', null), 'https://images.pokemontcg.io/sv5/logo.png');
    assert.equal(setChromeUrl('swsh12tg', 'logo', null), 'https://images.pokemontcg.io/swsh12tg/logo.png');
    assert.equal(setChromeUrl('swsh12.5gg', 'logo', null), 'https://images.pokemontcg.io/swsh12pt5gg/logo.png');
    assert.equal(setChromeUrl('swsh11tg', 'logo', null), 'https://images.pokemontcg.io/swsh11tg/logo.png');
    assert.equal(setChromeUrl('mfb', 'logo', null), 'https://archives.bulbagarden.net/media/upload/1/1d/My_First_Battle_logo.png');
  });

  it('every crosswalk pair is reported when the catalog has nothing', () => {
    for (const e of SET_IMAGE_FALLBACK_TABLE) {
      assert.equal(setChromeUrl(e.setId, e.kind, null), e.sourceUrl, `${e.setId}|${e.kind}`);
    }
  });

  it('a catalog column always wins, as it does in the image tier', () => {
    const catalog = 'https://assets.tcgdex.net/en/sv/sv05/logo';
    assert.equal(setChromeUrl('sv05', 'logo', catalog), catalog);
    assert.equal(setChromeUrl('me05', 'logo', 'https://assets.tcgdex.net/en/me/me05/logo'),
      'https://assets.tcgdex.net/en/me/me05/logo');
  });

  it('a set with no logo anywhere stays null, so the SPA shows its name without asking', () => {
    for (const id of ['mep', 'mee', 'miscp', 'tk-xy-p', '2024sv', 'no-such-set']) {
      assert.equal(setChromeUrl(id, 'logo', null), null, id);
    }
  });

  it('the kind is respected — a set with only an approved symbol reports no logo', () => {
    assert.equal(setChromeUrl('mep', 'logo', null), null);
    assert.ok(setChromeUrl('mep', 'symbol', null));
    assert.equal(setChromeUrl('sv05', 'symbol', null), null);
  });
});
