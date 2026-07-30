/**
 * Typed loaders for the vendored JSON under ./data. Loaded via fs at module init
 * (a handful of small files) to sidestep ESM JSON import-attribute friction under
 * Node16 module resolution + tsx. See data/_provenance.json for sourcing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FormatCode, PokemonType } from './types.js';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
}

export interface FormatConfig {
  name: string;
  short_name: string;
  deck_size: number;
  max_copies_per_name: number;
  basic_energy_exempt: boolean;
  max_ace_spec: number | null;
  max_radiant: number | null;
  max_prism_star_per_name: number | null;
  require_basic_pokemon: boolean;
  require_single_type: boolean;
  forbid_rule_box: boolean;
  prize_count: number;
  pool_strategy: 'regulation_mark' | 'set_allowance' | 'all';
  legal_marks: string[];
  pool_from_series_prefixes?: string[];
  types?: string[];
  source_url: string;
}

interface FormatsFile {
  as_of: string;
  formats: Record<FormatCode, FormatConfig>;
}

export interface BanEntry {
  scope: 'print' | 'name';
  name: string;
  set?: string;
  local_ids?: string[];
  banned_from?: string;
  source_text: string;
}
interface BanFile {
  as_of: string;
  source_url: string;
  bans: BanEntry[];
}

interface AceSpecFile {
  as_of: string;
  sv_era_derived_from_db: string[];
  bw_xy_era_vendored_uncertain: string[];
}

export interface ExclusiveGroup {
  label: string;
  max_total: number;
  members: string[];
}
export interface SetCarveout {
  set: string;
  mode: string;
  except_names: string[];
  note: string;
}
interface GlcRulesFile {
  as_of: string;
  source_url: string;
  rule_box_suffixes: string[];
  rule_box_name_suffixes: string[];
  exclusive_groups: ExclusiveGroup[];
  not_tournament_legal: string[];
  set_carveouts: SetCarveout[];
}

export interface SetAlias {
  set: string | null;
  kind: 'main' | 'subset' | 'promo' | 'energy' | 'alt' | 'unmapped';
  number_offset?: number;
  /** false = code exists in decklist vocabulary (Limitless/PTCGO) but the set is NOT in PTCG Live's card pool (pool floor: Sun & Moon series). Absent = true. */
  live?: boolean;
  note?: string;
}
interface SetAliasFile {
  as_of: string;
  aliases: Record<string, SetAlias>;
}

const FORMATS = load<FormatsFile>('formats.json');
const ACE = load<AceSpecFile>('ace-spec.json');
const GLC = load<GlcRulesFile>('glc-rules.json');
const ALIAS = load<SetAliasFile>('ptcgl-set-alias.json');
const BANS: Record<FormatCode, BanFile> = {
  standard: load<BanFile>('banlist-standard.json'),
  expanded: load<BanFile>('banlist-expanded.json'),
  glc: load<BanFile>('banlist-glc.json'),
  unlimited: { as_of: FORMATS.as_of, source_url: '', bans: [] },
};

export function formatConfig(code: FormatCode): FormatConfig {
  return FORMATS.formats[code];
}
export function formatsCheckedAt(): string {
  return FORMATS.as_of;
}
export function banList(code: FormatCode): BanFile {
  return BANS[code];
}
export function glcRules(): GlcRulesFile {
  return GLC;
}
export function setAliases(): Record<string, SetAlias> {
  return ALIAS.aliases;
}
export function resolveSetAlias(ptcglCode: string): SetAlias | undefined {
  return ALIAS.aliases[ptcglCode];
}
export function glcTypes(): PokemonType[] {
  return (FORMATS.formats.glc.types ?? []) as PokemonType[];
}

/** Normalized ACE SPEC name set (both eras). Case-insensitive; apostrophe-folded. */
export const ACE_SPEC_NAMES: ReadonlySet<string> = new Set(
  [...ACE.sv_era_derived_from_db, ...ACE.bw_xy_era_vendored_uncertain].map((n) =>
    n.normalize('NFC').replace(/’/g, "'").toLowerCase().trim(),
  ),
);
