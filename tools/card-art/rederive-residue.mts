/**
 * rederive-residue.mts — re-derive `research/card-art-residue.json`'s
 * "504 cards with no approved source" against the crosswalk that now exists.
 *
 * UNTRACKED (Holo 2c PREP). Pure: reads two JSON files, hits no network, no
 * database, no bucket.
 *
 *     npx tsx tools/card-art/rederive-residue.mts
 *
 * The 2026-08-26 residue was measured BEFORE the per-set id + numbering
 * crosswalk existed — `CARD-ART-SOURCES.md` §2.2 could only spot-check three
 * numbering cases by hand, and §3's 88-vs-504 split follows from that partial
 * view. This re-runs the same question over every one of the 592 cards with the
 * real crosswalk in hand, so the published no-art list is a measurement rather
 * than a carried-forward figure.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = resolve(HERE, '..', '..');

interface ResidueCard {
  cardId: string;
  setId: string;
  missingQualities: string[];
  status: string;
}
interface CardLink {
  id: string;
  number: string;
  name: string;
  low: string | null;
  high: string | null;
  via: string;
}
interface Crosswalk {
  generated: string;
  counts: Record<string, number>;
  sets: Record<
    string,
    {
      ptcgioSetId: string | null;
      match: string;
      review: boolean;
      numbering: {
        map: Record<string, CardLink>;
        unmatched: Array<{ localId: string; reason: string }>;
      } | null;
    }
  >;
}

const residue = JSON.parse(
  await readFile(join(REPO, 'research', 'card-art-residue.json'), 'utf8'),
) as { missingCards: number; withoutApprovedSource: number; cards: ResidueCard[] };
const crosswalk = JSON.parse(await readFile(join(HERE, 'crosswalk.json'), 'utf8')) as Crosswalk;

let covered = 0;
const uncoveredByReason: Record<string, number> = {};
const coveredBySet: Record<string, number> = {};
const uncoveredBySet: Record<string, number> = {};

for (const card of residue.cards) {
  // `cardId` is `{setId}-{localId}` and both halves may contain hyphens, so the
  // set id is stripped by PREFIX, never by splitting on '-'.
  const localId = card.cardId.startsWith(`${card.setId}-`)
    ? card.cardId.slice(card.setId.length + 1)
    : null;
  const set = crosswalk.sets[card.setId];

  let reason: string | null = null;
  if (!localId) reason = 'unparseable-card-id';
  else if (!set) reason = 'set-not-in-crosswalk';
  else if (!set.ptcgioSetId || !set.numbering) {
    reason = set.match === 'known-absent' ? 'set-not-carried' : 'set-unmapped';
  } else if (!set.numbering.map[localId]) {
    reason =
      set.numbering.unmatched.find((u) => u.localId === localId)?.reason ?? 'no-such-number';
  }

  if (reason === null) {
    covered++;
    coveredBySet[card.setId] = (coveredBySet[card.setId] ?? 0) + 1;
  } else {
    uncoveredByReason[reason] = (uncoveredByReason[reason] ?? 0) + 1;
    uncoveredBySet[card.setId] = (uncoveredBySet[card.setId] ?? 0) + 1;
  }
}

const uncovered = residue.cards.length - covered;
console.log(
  JSON.stringify(
    {
      residueGenerated: '2026-08-26',
      crosswalkGenerated: crosswalk.generated,
      cardsInResidue: residue.cards.length,
      recordedWithoutApprovedSource: residue.withoutApprovedSource,
      rederived: { coveredByCrosswalk: covered, stillNoApprovedSource: uncovered },
      delta: residue.withoutApprovedSource - uncovered,
      uncoveredByReason,
      coveredBySet,
      uncoveredBySet,
    },
    null,
    2,
  ),
);
