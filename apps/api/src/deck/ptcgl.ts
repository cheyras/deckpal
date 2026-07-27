/**
 * PTCG Live decklist parser + serializer, and a TCGplayer Mass Entry parser.
 * DECK-FORMATS §1. Parse each card line RIGHT-TO-LEFT (§1.2); header counts are
 * ADVISORY (§1.3) — trust only the card lines. String-only; card resolution to
 * the catalogue lives in db.ts (the §1.7 five-step ladder).
 */
import type { ValidationWarning } from './types.js';

/** §1.2: setcode = UPPER {UPPER|DIGIT} optional "-XX(X)" | literal "Energy". */
const SETCODE = /^([A-Z][A-Z0-9]{0,7}(-[A-Z]{2,3})?|Energy)$/;
/** header/trailer shape: "<label> : <digits>" (§1.6 positional, label-agnostic). */
const HEADER = /^(.+?)\s*:\s*(\d+)\s*$/;

export type Section = 'pokemon' | 'trainer' | 'energy';

export interface ParsedLine {
  quantity: number;
  name: string;              // raw name as written (may be non-English)
  setCode: string | null;    // 'SVI', 'CRZ-GG', 'Energy', or null (bare line)
  number: string | null;     // collector number as written
  print: string | null;      // 'PH' or null
  section: Section;          // assigned by header position (a hint; recomputed on resolve)
  raw: string;
}

export interface ParsedDeck {
  lines: ParsedLine[];
  headers: { label: string; count: number; section: Section }[];
  trailerCount: number | null;
  warnings: ValidationWarning[];
}

const TRAILER_LABEL = /total|insgesamt/i;
const SECTION_ORDER: Section[] = ['pokemon', 'trainer', 'energy'];
const LABEL_MAP: Record<string, Section> = {
  // English + the localisations measured in DECK-FORMATS §1.6
  'pokémon': 'pokemon', 'pokemon': 'pokemon',
  'trainer': 'trainer', 'dresseur': 'trainer', 'treinador': 'trainer',
  'energy': 'energy', 'energie': 'energy', 'énergie': 'energy', 'energia': 'energy',
};

function splitLines(text: string): string[] {
  // strip BOM, split on CR?LF (§1.5 case 14)
  return text.replace(/^﻿/, '').split(/\r?\n/);
}

/** Right-to-left card-line parser (§1.2). */
function parseCardLine(line: string, section: Section): ParsedLine {
  const tokens = line.trim().split(/\s+/);
  const quantity = parseInt(tokens[0]!, 10);
  let rest = tokens.slice(1);

  let print: string | null = null;
  if (rest.length > 0 && rest[rest.length - 1] === 'PH') {
    print = 'PH';
    rest = rest.slice(0, -1);
  }

  let setCode: string | null = null;
  let number: string | null = null;
  // need >=3 remaining so bare Trainer lines ("2 Air Balloon") aren't mis-split (§1.2 guard)
  if (rest.length >= 3) {
    const last = rest[rest.length - 1]!;
    const secondLast = rest[rest.length - 2]!;
    if (/^\d+$/.test(last) && SETCODE.test(secondLast)) {
      number = last;
      setCode = secondLast;
      rest = rest.slice(0, -2);
    }
  }

  return { quantity, name: rest.join(' '), setCode, number, print, section, raw: line };
}

/**
 * Parse a PTCGL (or Limitless) decklist. Never throws on a malformed line —
 * unparseable lines become warnings and are skipped (§1.5 case 15).
 */
export function parsePtcgl(text: string): ParsedDeck {
  const lines = splitLines(text);
  const out: ParsedLine[] = [];
  const headers: ParsedDeck['headers'] = [];
  const warnings: ValidationWarning[] = [];
  let trailerCount: number | null = null;
  let currentSection: Section = 'pokemon';
  let headerCount = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;

    // card lines always start with a digit; headers/trailer start with a label word
    if (/^\d/.test(line)) {
      const parsed = parseCardLine(line, currentSection);
      if (Number.isNaN(parsed.quantity) || parsed.name === '') {
        warnings.push({ code: 'UNRESOLVED_CARD', message: `Could not parse line: "${line}"` });
        continue;
      }
      out.push(parsed);
      continue;
    }

    const h = HEADER.exec(line);
    if (h) {
      const label = h[1]!.trim();
      const count = parseInt(h[2]!, 10);
      if (TRAILER_LABEL.test(label)) {
        trailerCount = count;
        continue;
      }
      // section header: assign by label if known, else by position
      const mapped = LABEL_MAP[label.toLowerCase()];
      const section = mapped ?? SECTION_ORDER[Math.min(headerCount, 2)]!;
      currentSection = section;
      headers.push({ label, count, section });
      headerCount++;
      continue;
    }

    // neither digit-led nor header-shaped -> junk (e.g. trailing "Random line") (§1.5 case 15)
    warnings.push({ code: 'UNRESOLVED_CARD', message: `Ignored non-card line: "${line}"` });
  }

  // trailer checksum warning (§1.3): advisory only, never rejects
  if (trailerCount !== null) {
    const sum = out.reduce((n, l) => n + l.quantity, 0);
    if (sum !== trailerCount) {
      warnings.push({
        code: 'TOTAL_MISMATCH',
        message: `Imported file said 'Total Cards: ${trailerCount}' but card lines sum to ${sum}.`,
      });
    }
  }

  return { lines: out, headers, trailerCount, warnings };
}

// ── Serializer (§1.8) ─────────────────────────────────────────────────────────

export interface SerializableLine {
  quantity: number;
  name: string;
  setCode: string | null;   // PTCGL code to emit, uppercased; null -> bare name
  number: string | null;
  print: string | null;     // 'PH'
  section: Section;
}

const SECTION_TITLE: Record<Section, string> = {
  pokemon: 'Pokémon',
  trainer: 'Trainer',
  energy: 'Energy',
};

function serializeLine(l: SerializableLine): string {
  let s = `${l.quantity} ${l.name}`;
  if (l.setCode) {
    const num = (l.number ?? '').replace(/^0+(?=\d)/, ''); // strip leading zeros (§1.8)
    s += ` ${l.setCode.toUpperCase()}`;
    if (num !== '') s += ` ${num}`;
  }
  if (l.print) s += ` ${l.print}`;
  return s;
}

/**
 * Emit a PTCGL-shape decklist (§1.8). Header count = number of DISTINCT ENTRIES
 * (lines) per section, to be byte-compatible with PTCG Live. Preserves input order
 * within each section. `\n` line endings.
 */
export function serializePtcgl(lines: SerializableLine[]): string {
  const blocks: string[] = [];
  for (const section of SECTION_ORDER) {
    const rows = lines.filter((l) => l.section === section);
    if (rows.length === 0) continue;
    const body = rows.map(serializeLine).join('\n');
    blocks.push(`${SECTION_TITLE[section]}: ${rows.length}\n${body}`);
  }
  const total = lines.reduce((n, l) => n + l.quantity, 0);
  blocks.push(`Total Cards: ${total}`);
  return blocks.join('\n\n') + '\n';
}

/** Convenience: turn a ParsedDeck's lines straight back into serializable form. */
export function toSerializable(d: ParsedDeck): SerializableLine[] {
  return d.lines.map((l) => ({
    quantity: l.quantity,
    name: l.name,
    setCode: l.setCode,
    number: l.number,
    print: l.print,
    section: l.section,
  }));
}

// ── TCGplayer Mass Entry (§1.9) — a DIFFERENT format ──────────────────────────

export interface MassEntryLine {
  quantity: number;
  name: string;
  setCode: string | null;   // TCGplayer abbrev, e.g. 'ME05' — a THIRD namespace
  number: string | null;    // optional
  raw: string;
}

/** `massentry_line = count SP name [ SP "[" setcode "]" [ SP number ] ]` (§1.9). */
const MASS_ENTRY = /^(\d+)\s+(.+?)(?:\s+\[([^\]]+)\](?:\s+(\d+))?)?\s*$/;

export function parseMassEntry(text: string): { lines: MassEntryLine[]; warnings: ValidationWarning[] } {
  const lines: MassEntryLine[] = [];
  const warnings: ValidationWarning[] = [];
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line === '') continue;
    const m = MASS_ENTRY.exec(line);
    if (!m) {
      warnings.push({ code: 'UNRESOLVED_CARD', message: `Could not parse Mass Entry line: "${line}"` });
      continue;
    }
    lines.push({
      quantity: parseInt(m[1]!, 10),
      name: m[2]!.trim(),
      setCode: m[3] ?? null,
      number: m[4] ?? null,
      raw: line,
    });
  }
  return { lines, warnings };
}

/**
 * Emit TCGplayer Mass Entry (§1.9) — the "buy the deck" format. Bracketed set
 * abbrev, optional number, flat list, no sections, no trailer. Do NOT share the
 * PTCGL formatter (§1.9).
 */
export function serializeMassEntry(lines: MassEntryLine[]): string {
  return (
    lines
      .map((l) => {
        let s = `${l.quantity} ${l.name}`;
        if (l.setCode) {
          s += ` [${l.setCode}]`;
          if (l.number) s += ` ${l.number}`;
        }
        return s;
      })
      .join('\n') + '\n'
  );
}
