/**
 * The two ways a "make me a list" turn went wrong, and the smear that emptied
 * the list even when it went right.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * One transcript, three separate faults, all on the same request:
 *
 *  1. `edit_list({ list_id: 'new', … })` — 'new' is not an id, so it resolved
 *     to nothing and the call failed. The retry sent the NAME of the list it
 *     wanted to create, which is not an id either.
 *  2. Another turn asked for a new list, the name happened to match one that
 *     already existed, and 113 cards were quietly appended to it instead.
 *     Nothing in the approval card said which list was being written to.
 *  3. `add_cards: [{ name: 'Blastoise ex', set_id: 'sv3.5' }]` — the set id the
 *     model wrote is TCGdex's spelling of this catalogue's `sv03.5`, and
 *     `resolve.ts` compared it raw. The list would have been created EMPTY.
 *
 * Everything here is pure or runs against a stubbed `ctx.db`; there is no
 * database and no network. `pnpm --filter @deckpal/agent-tools test:variants`
 * runs it alongside the others.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import type { Ctx } from '../ctx.js';
import { meansCreate, peelRarity } from '../entities.js';

// ── meansCreate: "which list?" answered with a word, not an id ───────────────

test("meansCreate reads the words a model writes for 'a new one'", () => {
  // `list_id: 'new'` is the exact argument from the failing call.
  for (const v of ['new', 'New', 'NEW', 'create', 'Create', 'new list', 'New Deck', 'newdeck']) {
    assert.equal(meansCreate(v), true, `${JSON.stringify(v)} should mean create`);
  }
});

test('meansCreate treats a missing reference as create', () => {
  // Nothing to edit is the ordinary way to say "make one".
  for (const v of [undefined, null, '', '   ', 'none', 42, {}]) {
    assert.equal(meansCreate(v), true, `${JSON.stringify(v)} should mean create`);
  }
});

test('meansCreate does NOT hijack a real reference', () => {
  // The danger of a word list is a real list called one of the words. These
  // must all be treated as references to look up, not as instructions.
  for (const v of [
    'Base Set $100 Completion Buys',
    'a1b2c3d4-0000-0000-0000-000000000000',
    'New Year Pulls', // starts with a sentinel word and is still a name
    'Newton',
    'Creatures of Paldea',
  ]) {
    assert.equal(meansCreate(v), false, `${JSON.stringify(v)} is a reference, not an instruction`);
  }
});

// ── peelRarity: the rarity smeared into the name field ──────────────────────

/**
 * A `Ctx` whose only capability is answering the one question `peelRarity`
 * asks. The rarity vocabulary is read from the catalogue rather than hardcoded,
 * so the stub is the catalogue: these are real values from the live table,
 * including the mixed casing (`Illustration rare`, not `Illustration Rare`)
 * that the peel has to return rather than echo back what the model typed.
 */
const RARITIES = [
  'Common',
  'Uncommon',
  'Rare',
  'Ultra Rare',
  'Holo Rare',
  'Illustration rare',
  'Special illustration rare',
  'Double rare',
  'Shiny rare',
  'Hyper rare',
  'ACE SPEC Rare',
  'One Shiny',
];

let queries = 0;
const ctx = {
  userId: 'test',
  db: {
    query: async <T extends pg.QueryResultRow>(): Promise<{ rows: T[] }> => {
      queries += 1;
      return { rows: RARITIES.map((rarity) => ({ rarity })) as unknown as T[] };
    },
  },
} as unknown as Ctx;

test('peelRarity splits the exact string that returned nothing', async () => {
  // `search_cards({ query: 'Tatsugiri Illustration Rare' })`. The card is real:
  // Tatsugiri | sv06-186 | Illustration rare.
  assert.deepEqual(await peelRarity(ctx, 'Tatsugiri Illustration Rare'), {
    name: 'Tatsugiri',
    rarity: 'Illustration rare',
  });
});

test("peelRarity returns THIS catalogue's spelling, not the model's", async () => {
  // The model typed 'Illustration Rare'; the column says 'Illustration rare'.
  // The rarity filter compares case-insensitively, but the message quotes this
  // string back at the model as the value to send, so it has to be the real one.
  const peel = await peelRarity(ctx, 'Wailord Illustration Rare');
  assert.equal(peel?.rarity, 'Illustration rare');
});

test('peelRarity takes the LONGEST rarity, not the first that fits', async () => {
  // 'Special illustration rare' ends with 'Illustration rare', which ends with
  // 'Rare'. Shortest-match would call this a card named 'Tatsugiri Special'.
  assert.deepEqual(await peelRarity(ctx, 'Tatsugiri Special Illustration Rare'), {
    name: 'Tatsugiri',
    rarity: 'Special illustration rare',
  });
});

test('peelRarity is suffix-only, so `Rare Candy` survives', async () => {
  // A real Trainer card, and the reason prefixes are not peeled: otherwise this
  // reads as a card called 'Candy' of rarity 'Rare'. It is also the regression
  // that would have been invisible — `Rare Candy` returns 23 rows, so this path
  // never runs for it in production and only a test can hold the line.
  assert.equal(await peelRarity(ctx, 'Rare Candy'), null);
});

test('peelRarity needs a word boundary, so `Charizard ex` is left alone', async () => {
  // Without the boundary check, any name ending in the same letters as a rarity
  // would be cut mid-word.
  assert.equal(await peelRarity(ctx, 'Charizard ex'), null);
  assert.equal(await peelRarity(ctx, 'Hyper rare'), null); // whole string, see below
});

test('peelRarity refuses a string that is ENTIRELY a rarity', async () => {
  // There is no name to peel it off. Ungarded, the longest-match loop falls
  // back to the shortest suffix that leaves two characters and reports
  // 'Illustration rare' as a card called 'Illustration' of rarity 'Rare'.
  assert.equal(await peelRarity(ctx, 'Illustration rare'), null);
  assert.equal(await peelRarity(ctx, 'Illustration Rare'), null); // case-insensitively
  assert.equal(await peelRarity(ctx, '  Double rare  '), null); // and trimmed
});

test('peelRarity leaves ordinary card names alone', async () => {
  for (const name of ['Pikachu', 'Blastoise ex', 'Iono', "Professor's Research", 'Tatsugiri']) {
    assert.equal(await peelRarity(ctx, name), null, `${name} has no rarity to peel`);
  }
});

test('peelRarity reads the rarity vocabulary once per Ctx, not once per name', async () => {
  // A batch of add_cards with several bad names lands here once per bad name.
  // Re-reading the whole vocabulary each time is the quiet regression a fix
  // like this smuggles in — the per-item fallback path is already the slow one.
  let reads = 0;
  const fresh = {
    userId: 'test',
    db: {
      query: async <T extends pg.QueryResultRow>(): Promise<{ rows: T[] }> => {
        reads += 1;
        return { rows: RARITIES.map((rarity) => ({ rarity })) as unknown as T[] };
      },
    },
  } as unknown as Ctx;

  for (const n of ['Wailord Illustration Rare', 'Tatsugiri Illustration Rare', 'Pikachu']) {
    await peelRarity(fresh, n);
  }
  assert.equal(reads, 1);

  // And a different Ctx is a different request: it reads for itself, so a set
  // imported between requests is not hidden behind a cache that outlives one.
  const other = { ...fresh } as unknown as Ctx;
  await peelRarity(other, 'Wailord Illustration Rare');
  assert.equal(reads, 2);
});

test('peelRarity on an empty reference asks the database nothing', async () => {
  // It runs on paths that have already come back empty; it should not add a
  // query to a call that never had a name in the first place.
  const before = queries;
  assert.equal(await peelRarity(ctx, ''), null);
  assert.equal(await peelRarity(ctx, '   '), null);
  assert.equal(queries, before);
});
