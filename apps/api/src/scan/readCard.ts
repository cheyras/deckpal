import { createGateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import type { OcrFields } from './resolve.js';

/**
 * THE VISION-MODEL READ — a capture's printed fields, read on the server by a
 * cloud vision model, for the resolve ladder.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * The printed key (name, number, set size, set code) is what separates one
 * printing from another, and on deckpal.app only the owner's phone ever read
 * it: the device OCR lane is 15.6 MB of WASM, owner-only, and it reads a
 * 480x670 crop's number strip poorly. The owner's 2026-11-25 instruction was
 * that models are better now. Measured on the 261 real cards of the scan
 * benchmark, through the real ladder, with fresh indexes:
 *
 *   | printed fields from    | confident and right | confident and wrong |
 *   |------------------------|---------------------|---------------------|
 *   | device OCR             | 218 (83.5%)         | 0                   |
 *   | Claude Sonnet 5.5 read | 238 (91.2%)         | 1                   |
 *   | Gemini 3.6 Flash read  | 225 (86.2%)         | 4                   |
 *   | Claude Haiku 5.5 read  | 200 (76.6%)         | 13 (before the hold)|
 *
 * The Sonnet row is with `resolveCard`'s `readSource: 'vlm'` hold, which exists
 * because a model reads a damaged strip into a PLAUSIBLE key (`198` for `182`, a
 * set code from memory) where OCR leaves it out. About $0.003 and 1.5-2.5 s a
 * read, in parallel with the image vector, which takes as long.
 *
 * ── THE PROMPT IS THE MEASURED ONE ──────────────────────────────────────────
 *
 * Byte for byte the prompt those numbers were measured with. Changing it, the
 * model, or the decoding settings changes the scanner: re-run the benchmark
 * (`scripts/scan-bench`, `--ocr vlm:`) before shipping any of them.
 */

/** The model, through the Vercel AI Gateway. `SCAN_READ_MODEL=off` disables the read. */
export const DEFAULT_SCAN_READ_MODEL = 'anthropic/claude-sonnet-5.5';
/** The read gives up after this, and the capture resolves on the vector alone. */
export const SCAN_READ_TIMEOUT_MS = 7_000;

export const READ_PROMPT = `This image is a phone photo of ONE trading card, already cropped to the card (it may be rotated, blurry, glared, sleeved, or not a card at all).
Read what is PRINTED on it. Do not guess from memory of other cards; if a field is not legible, use null.
Reply with ONLY a JSON object:
{"isCard": true if this is the FRONT of a Pokemon TCG card, "isCardBack": bool,
 "name": card name exactly as printed (include prefixes like "Team Rocket's", suffixes like "ex", "V", "VMAX"),
 "hp": number|null,
 "number": the collector number as printed bottom-left/right (e.g. "064", "TG12", "SWSH050", "GG44"), "total": the number after the slash (e.g. "103") or null,
 "setCode": the small set abbreviation printed near the number (e.g. "DRI","SVI","PAL") or null,
 "regulationMark": the single letter in a small box near the bottom left, or null,
 "attacks": [attack names], "abilities": [ability names], "illustrator": string|null,
 "rotation": 0|90|180|270 (how many degrees clockwise the card is rotated in the image),
 "legibility": "clear"|"partial"|"poor"}`;

export interface CardRead {
  /** Whether the model saw the front of a Pokémon card. */
  isCard: boolean;
  isCardBack: boolean;
  /** The ladder's input. Absent fields were not legible. */
  fields: OcrFields;
  legibility: 'clear' | 'partial' | 'poor' | null;
}

export function scanReadModel(env: NodeJS.ProcessEnv = process.env): string | null {
  const m = env.SCAN_READ_MODEL?.trim();
  if (m === 'off') return null;
  return m || DEFAULT_SCAN_READ_MODEL;
}

const str = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.toLowerCase() !== 'null' ? t : undefined;
};

/**
 * The model's reply, as the ladder's fields. Tolerates a fenced block and prose
 * around the object; returns null when there is no JSON object to read.
 */
export function parseCardRead(text: string): CardRead | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const isCardBack = j.isCardBack === true;
  const isCard = j.isCard !== false && !isCardBack;
  const fields: OcrFields = {};
  if (isCard) {
    const name = str(j.name);
    const number = str(j.number);
    const total = str(j.total);
    const setCode = str(j.setCode);
    if (name) fields.name = name;
    if (number) fields.number = number;
    if (total) fields.denominator = total;
    if (setCode) fields.setCode = setCode;
    // Rung 9's input, only when neither half of the key was read: the same
    // contract the device OCR keeps (`OcrRead.bodyLines`).
    if (!name && !number) {
      const lines = [j.attacks, j.abilities]
        .flatMap((a) => (Array.isArray(a) ? a : []))
        .map(str)
        .filter((s): s is string => !!s);
      if (lines.length) fields.bodyLines = lines;
    }
  }
  const l = j.legibility;
  return {
    isCard,
    isCardBack,
    fields,
    legibility: l === 'clear' || l === 'partial' || l === 'poor' ? l : null,
  };
}

/** The gateway key the API already uses for Deck-E. */
function gatewayKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.DECKE_VERCEL_AI_GATEWAY_KEY ?? (env.NODE_ENV !== 'production' ? (env.AI_GATEWAY_API_KEY ?? null) : null);
}

export class ReadUnavailable extends Error {}

/**
 * Read one capture. Throws `ReadUnavailable` when this deployment has no model
 * or no gateway key; any other throw is a failed read.
 */
export async function readCard(jpeg: Buffer, mediaType: string, signal?: AbortSignal): Promise<CardRead | null> {
  const model = scanReadModel();
  const key = gatewayKey();
  if (!model || !key) throw new ReadUnavailable('the card read is not enabled on this deployment');
  const gateway = createGateway({ apiKey: key });
  const result = await generateText({
    model: gateway(model),
    // No temperature and no thinking switch: Sonnet 5.5 accepts neither, and
    // with no tools in the call its lowest thinking setting does none.
    maxOutputTokens: 700,
    maxRetries: 0,
    abortSignal: signal ?? AbortSignal.timeout(SCAN_READ_TIMEOUT_MS),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: jpeg, mediaType },
          { type: 'text', text: READ_PROMPT },
        ],
      },
    ],
  });
  return parseCardRead(result.text);
}
