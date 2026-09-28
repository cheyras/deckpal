import type { DeckEntry, PokemonType } from './types.js';

/** A pasted GLC list declares its type only when every resolved Pokémon shares exactly one. */
export function inferGlcType(entries: readonly DeckEntry[]): PokemonType | null {
  const pokemon = entries.filter(({ card }) => card.category === 'Pokemon');
  if (pokemon.length === 0) return null;
  const shared = new Set(pokemon[0]!.card.types);
  for (const { card } of pokemon.slice(1)) {
    for (const type of shared) {
      if (!card.types.includes(type)) shared.delete(type);
    }
  }
  return shared.size === 1 ? [...shared][0]! : null;
}
