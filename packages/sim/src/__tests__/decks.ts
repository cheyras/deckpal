/** The owner's two decks, as of 2026-10-10 (Hide 'n' Sneak v5, Toolbox Slowking v3), built from the frame snapshot. */
import type { DeckInput } from '../context.js';
import { FRAMES } from '../cards/frames.js';

export function fromIds(name: string, list: [string, number][]): DeckInput {
  return {
    name,
    cards: list.map(([id, count]) => {
      const frame = FRAMES[id];
      if (!frame) throw new Error(`no frame for ${id} — run the frames script`);
      return { frame, count };
    }),
  };
}

export const HIDE_N_SNEAK = fromIds("Hide 'n' Sneak", [
  ['me05-034', 3], // Banette
  ['sv06-141', 1], // Bloodmoon Ursaluna ex
  ['me05-039', 4], // Dhelmise
  ['sv08.5-080', 1], // Dudunsparce
  ['sv05-129', 1], // Dudunsparce (reprint)
  ['sv08.5-079', 2], // Dunsparce
  ['sv06.5-038', 1], // Fezandipiti ex
  ['me02.5-076', 1], // Lillie's Clefairy ex
  ['me04-070', 1], // Patrat
  ['me05-005', 2], // Poltchageist
  ['me05-033', 4], // Shuppet
  ['me05-006', 1], // Sinistcha
  ['sv10.5b-079', 1], // Air Balloon
  ['me01-114', 3], // Boss's Orders
  ['sv08.5-101', 2], // Buddy-Buddy Poffin
  ['me02.5-184', 2], // Buddy-Buddy Poffin (reprint)
  ['me05-078', 3], // Gwynn
  ['me01-119', 4], // Lillie's Determination
  ['sv06.5-061', 2], // Night Stretcher
  ['me03-081', 3], // Poké Pad
  ['me04-080', 3], // Prism Tower
  ['sv06-163', 1], // Secret Box
  ['me04-082', 1], // Special Red Card
  ['me01-131', 4], // Ultra Ball
  ['base1-101', 5], // Psychic Energy
  ['me03-088', 4], // Telepathic Psychic Energy
]);

export const TOOLBOX_SLOWKING = fromIds('Toolbox Slowking', [
  ['sv08-100', 1], // Annihilape
  ['sv06.5-038', 1], // Fezandipiti ex
  ['sv06.5-047', 2], // Kyurem
  ['sv08-076', 2], // Latias ex
  ['me02.5-076', 1], // Lillie's Clefairy ex
  ['me01-104', 3], // Mega Kangaskhan ex
  ['me03-062', 1], // Meowth ex
  ['me04-061', 2], // Metagross
  ['sv05-024', 1], // Rabsca
  ['sv08-013', 1], // Rellor
  ['sv07-058', 3], // Slowking
  ['me05-029', 4], // Slowpoke
  ['me02.5-098', 1], // Spectrier
  ['sv10-078', 1], // Zeraora
  ['sv06.5-054', 4], // Academy at Night
  ['sv08.5-104', 3], // Ciphermaniac's Codebreaking
  ['me01-119', 4], // Lillie's Determination
  ['sv06-158', 1], // Lucky Helmet
  ['sv06.5-061', 2], // Night Stretcher
  ['me03-081', 4], // Poké Pad
  ['sv06-163', 1], // Secret Box
  ['me01-130', 1], // Switch
  ['me02.5-213', 4], // Ultra Ball
  ['me02-094', 2], // Wondrous Patch
  ['sv06-166', 3], // Boomerang Energy
  ['base1-101', 3], // Psychic Energy
  ['me03-088', 4], // Telepathic Psychic Energy
]);
