/**
 * Pure (no DB) regression guard for the vendored data files under ./data.
 *
 * 2026-08: upstream TCGdex re-keyed the four Trainer Gallery sub-sets
 * (swsh9.5tg -> swsh9tg, swsh10.5tg -> swsh10tg, swsh11.5tg -> swsh11tg,
 * swsh12.5tg -> swsh12tg) and the catalog + image tiers were migrated to the
 * new ids, but ptcgl-set-alias.json and banlist-expanded.json still pointed
 * at the retired ids -- so importing a decklist with a Trainer Gallery card
 * silently resolved to the WRONG print via the name-only fallback (no error,
 * no warning). See DECISIONS.md for the incident writeup.
 *
 * This file can't see the live catalog (that only exists in Postgres, via
 * apps/sync), so it can't assert "every set id is known to card_set" the way
 * a DB-backed test could. Instead it pins the four TG aliases to their
 * correct current ids, and sweeps every `set` value in both the alias table
 * and every banlist for a reappearance of any of the four specific retired
 * ids -- so the same rename class is caught by CI, not by a user, even if it
 * resurfaces somewhere other than the four slots fixed here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setAliases, banList, glcRules } from '../data.js';
import type { FormatCode } from '../types.js';

const RETIRED_TG_IDS = ['swsh9.5tg', 'swsh10.5tg', 'swsh11.5tg', 'swsh12.5tg'];
const FORMAT_CODES: FormatCode[] = ['standard', 'expanded', 'glc', 'unlimited'];

test('Trainer Gallery PTCGL aliases point at the current (post-rekey) TCGdex set ids', () => {
  const aliases = setAliases();
  assert.equal(aliases['BRS-TG']?.set, 'swsh9tg');
  assert.equal(aliases['ASR-TG']?.set, 'swsh10tg');
  assert.equal(aliases['LOR-TG']?.set, 'swsh11tg');
  assert.equal(aliases['SIT-TG']?.set, 'swsh12tg');
});

test('no retired Trainer Gallery set id appears anywhere in ptcgl-set-alias.json', () => {
  const aliases = setAliases();
  for (const [code, alias] of Object.entries(aliases)) {
    assert.ok(
      !alias.set || !RETIRED_TG_IDS.includes(alias.set),
      `alias "${code}" still points at retired set id "${alias.set}"`,
    );
  }
});

test('the GLC Classic Collection carve-out is keyed on the set id the alias table resolves to', () => {
  // A carve-out keyed on a set id fails SILENTLY if upstream re-keys the set --
  // the same rename class as the Trainer Gallery incident above, except here the
  // failure mode is a legality false-negative (an illegal deck reported legal).
  // Pin it to the same set id the PTCGL alias table maps CEL-CC to.
  const ccSetId = setAliases()['CEL-CC']?.set;
  assert.equal(ccSetId, 'cel25cc');
  const cc = glcRules().set_carveouts.find((c) => c.set === ccSetId);
  assert.ok(cc, `no GLC set carve-out for the Classic Collection (${ccSetId})`);
  // DECK-FORMATS §2.3.4 item 5, verbatim: "only Reshiram and Zekrom are legal in GLC".
  assert.equal(cc!.mode, 'deny_except');
  assert.deepEqual(cc!.except_names, ['Reshiram', 'Zekrom']);
});

test('no retired Trainer Gallery set id appears in any banlist', () => {
  for (const code of FORMAT_CODES) {
    for (const ban of banList(code).bans) {
      assert.ok(
        !ban.set || !RETIRED_TG_IDS.includes(ban.set),
        `${code} banlist entry "${ban.name}" still points at retired set id "${ban.set}"`,
      );
    }
  }
});
