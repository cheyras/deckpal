/**
 * A failure message may not misstate its own evidence.
 *
 * ── THE TURN ────────────────────────────────────────────────────────────────
 *
 * `deck_strategy({ deck_id: 'slowking toolbox' })` came back with
 *
 *     More than one deck matches 'slowking toolbox'. Say which by passing its id:
 *       eaae34ba-… — Toolbox Slowking
 *
 * one deck, under a sentence claiming several. `strict` turns ANY inexact hit
 * into `ambiguous` — correctly, because a lone fuzzy match is exactly what
 * would rewrite the wrong deck's guide — but `explainMiss` did not know that
 * and counted the candidates it was handed as "more than one" regardless.
 *
 * This file exists because that is the specific defect `entities.ts` was
 * written to remove. Its own header says the failure message is what teaches
 * the model its next move, and lists three originals that taught it wrong. A
 * message that is confidently wrong about how many things it found belongs on
 * that list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainMiss, type EntityCandidate } from '../entities.js';

const deck = (id: string, label: string): EntityCandidate => ({ id, label });

test('ONE candidate is reported as a near miss, not as a crowd', () => {
  const msg = explainMiss(
    'deck',
    'slowking toolbox',
    { kind: 'ambiguous', candidates: [deck('eaae34ba-9607-49d6-a133-1a06b777d472', 'Toolbox Slowking')] },
    'unused',
  );
  assert.doesNotMatch(msg, /More than one/, 'one candidate is not more than one');
  assert.match(msg, /closest/i);
  assert.match(msg, /Toolbox Slowking/);
  assert.match(msg, /eaae34ba-9607-49d6-a133-1a06b777d472/, 'the id is the whole point of the message');
  assert.match(msg, /call this again with its id/i, 'it has to name the next move');
});

test('TWO candidates still say more than one, and still list ids', () => {
  const msg = explainMiss(
    'deck',
    'slow',
    { kind: 'ambiguous', candidates: [deck('aaa', 'Toolbox Slowking'), deck('bbb', 'All Out (Slowbro)')] },
    'unused',
  );
  assert.match(msg, /More than one deck matches 'slow'/);
  assert.match(msg, /aaa — Toolbox Slowking/);
  assert.match(msg, /bbb — All Out \(Slowbro\)/);
});

test('the message never invents an id, in either shape', () => {
  // Rule 1 of `explainMiss`: every id in this message comes from the caller's
  // own database. 'sv3pt5' was offered as an example once and was called nine
  // times in one turn.
  for (const candidates of [[deck('aaa', 'One')], [deck('aaa', 'One'), deck('bbb', 'Two')]]) {
    const msg = explainMiss('deck', 'x', { kind: 'ambiguous', candidates }, 'unused');
    for (const line of msg.split('\n')) {
      if (!line.startsWith('  ')) {
        assert.doesNotMatch(line, /\b[0-9a-f]{8}-[0-9a-f]{4}/, 'a uuid outside the candidate rows');
        assert.doesNotMatch(line, /\bsv\d/, 'a set-id-shaped example in the prose');
      }
    }
  }
});
