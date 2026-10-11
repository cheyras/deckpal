/**
 * Evolution parents for printings whose catalog frame has `evolvesFrom: null` (a catalog data gap in the 30th Celebration
 * set and its reprints). Without one, nothing can evolve into the card (query.ts mayEvolve names the parent).
 *
 * Each value is the name of the printed "Evolves from" Pokémon. Most are copied from another printing of the same Pokémon
 * in the snapshot; the ones marked "inferred" have no other printing and follow the evolution line (the Pokémon's own
 * line in the games, as printed on the real card).
 *
 * Applied by withEvolvesFrom() wherever a frame enters the engine, next to withPrintedWR() / withCleanText(): the card text key
 * includes the parent, so every entry point must apply the same fill. Fills only a frame that has none (a catalog that does
 * carry it always wins); never mutates its input. src/__tests__/evolves-from.test.ts audits the whole snapshot.
 */
import type { CardFrame } from '../types.js';

export const EVOLVES_FROM: Readonly<Record<string, string>> = {
  '30th-002': 'Exeggcute', // Alolan Exeggutor
  '30th-129': 'Exeggcute', // Alolan Exeggutor
  '30th-007': 'Cherubi', // Cherrim (inferred)
  '30th-008': 'Spewpa', // Vivillon
  '30th-010': 'Vulpix', // Ninetales
  '30th-059': 'Toxel', // Toxtricity
  '30th-060': 'Toxel', // Toxtricity
  '30th-134': 'Toxel', // Toxtricity
  '30th-068': 'Marill', // Azumarill
  '30th-069': 'Eevee', // Espeon (inferred)
  '30th-075': 'Lampent', // Chandelure
  '30th-137': 'Lampent', // Chandelure
  '30th-079': 'Cosmog', // Cosmoem (inferred)
  '30th-080': 'Cosmoem', // Lunala (inferred)
  '30th-105': 'Cosmoem', // Solgaleo (inferred)
  '30th-083': 'Riolu', // Lucario
  '30th-084': 'Palpitoad', // Seismitoad
  '30th-085': 'Rockruff', // Lycanroc
  '30th-138': 'Rockruff', // Lycanroc
  '30th-088': 'Nidoran♀', // Nidorina
  '30th-091': 'Eevee', // Umbreon (inferred)
  '30th-096': 'Zorua', // Zoroark
  '30th-098': 'Deino', // Zweilous
  '30th-099': 'Zweilous', // Hydreigon (inferred)
  '30th-104': 'Ferroseed', // Ferrothorn
  '30th-108': 'Gimmighoul', // Gholdengo
  '30th-142': 'Gimmighoul', // Gholdengo
  '30th-111': 'Jangmo-o', // Hakamo-o (inferred)
  '30th-112': 'Hakamo-o', // Kommo-o (inferred)
  '30th-143': 'Hakamo-o', // Kommo-o (inferred)
  '30th-123': 'Hisuian Zorua', // Hisuian Zoroark (inferred; also a script fix in misc.ts)
  '30th-125': 'Tandemaus', // Maushold
  '30th-146': 'Tandemaus', // Maushold
};

/** The frame with its printed "Evolves from" filled in where the catalog lacks it. */
export function withEvolvesFrom<F extends CardFrame>(f: F): F {
  if (f.evolvesFrom) return f;
  const from = EVOLVES_FROM[f.cardId];
  return from ? { ...f, evolvesFrom: from } : f;
}
