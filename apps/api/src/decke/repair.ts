/**
 * Fixing a tool call the schema rejected, without spending a step on it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE MEASURED FAILURE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * From `api/chat.mjs`'s own record of a real gate run against production:
 *
 *   "`showScreen` failed schema validation FIVE TIMES in one turn, and the
 *    model — told only that something had gone wrong — spent five of its twelve
 *    steps shortening the panel's TITLE while the actual fault, a text block
 *    over the 280-character cap, went untouched in every retry. The reader saw
 *    no panel, no error and no explanation."
 *
 * That was already half-fixed: the validation message is now surfaced to the
 * client instead of the SDK's "An error occurred." But surfacing it did not
 * stop the loop, because the message says WHAT rule broke and not WHERE —
 * "expected string to have <=280 characters" over a schema with several capped
 * strings is a hint, not an address. The model guessed, and guessed wrong five
 * times.
 *
 * A validation failure never reaches `execute`, so the repeat ledger in
 * `repeat.ts` cannot see it either: this is the one thrash class that survives
 * everything else in this pass.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DETERMINISTIC, AND NARROW ON PURPOSE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The SDK's `repairToolCall` hook is usually implemented by asking a model to
 * fix its own arguments. That is not what happens here: another model call costs
 * latency and money on the exact turn that has already wasted both.
 *
 * Instead this repairs ONE class of fault, mechanically — a string longer than
 * its documented maximum — because it is the class that actually occurred, it
 * has exactly one correct fix, and applying it cannot change what the call
 * MEANS. Everything else returns `null`, which leaves the SDK's ordinary error
 * path intact.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * IT IS NOT SILENT, AND THAT IS THE PART THAT MATTERS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `tools.ts` states this project's rule plainly, twice: "a model that is
 * silently corrected learns nothing and repeats the mistake." Truncating a
 * caption behind the model's back would be exactly that.
 *
 * So every repair is recorded and handed to the tool, which reports it in its
 * own result — "the caption was trimmed to 280 characters" — in the same
 * `errors` channel a dropped block already uses. The model is told, in the same
 * turn, precisely which field was too long and what happened to it. That is
 * strictly more information than the failure gave it, and it costs no step.
 */

/** What one repair did, for the tool to report. */
export interface Repair {
  /** Dotted path to the offending field, e.g. `blocks.2.text`. */
  path: string;
  /** How long it was. */
  was: number;
  /** How long it is now. */
  now: number;
}

/**
 * Repairs made this request, keyed by tool call id.
 *
 * Per request, never module state — the same isolation `CallLedger` needs and
 * for the same reason.
 */
export class RepairLog {
  private byCall = new Map<string, Repair[]>();

  note(toolCallId: string, r: Repair): void {
    const list = this.byCall.get(toolCallId) ?? [];
    list.push(r);
    this.byCall.set(toolCallId, list);
  }

  /** What was repaired for this call, as sentences a tool can return. */
  take(toolCallId: string): string[] {
    const list = this.byCall.get(toolCallId);
    if (!list?.length) return [];
    this.byCall.delete(toolCallId);
    return list.map(
      (r) => `${r.path} was ${r.was} characters and the limit is ${r.now}; it was trimmed to fit.`,
    );
  }

  get size(): number {
    return this.byCall.size;
  }
}

/** A JSON Schema, only the parts this file reads. */
interface Schema {
  type?: string | string[];
  maxLength?: number;
  properties?: Record<string, Schema>;
  items?: Schema | Schema[];
  [k: string]: unknown;
}

/**
 * Walk the value against its schema, trimming any string past its `maxLength`.
 *
 * Returns the repaired value and the list of what it changed. Structure is never
 * altered — no key is added, removed or retyped — so a repaired call is the same
 * call with one caption shorter. If nothing was too long, `repairs` is empty and
 * the caller returns `null` rather than pretending to have fixed something.
 */
export function clampStrings(
  value: unknown,
  schema: Schema | undefined,
  path = '',
): { value: unknown; repairs: Repair[] } {
  const repairs: Repair[] = [];

  const walk = (v: unknown, s: Schema | undefined, p: string): unknown => {
    if (!s) return v;

    if (typeof v === 'string' && typeof s.maxLength === 'number' && v.length > s.maxLength) {
      // A HARD CUT, not a clever one. An ellipsis would push it back over the
      // limit by one character, and trimming to a word boundary would make the
      // reported length a lie.
      repairs.push({ path: p || '(root)', was: v.length, now: s.maxLength });
      return v.slice(0, s.maxLength);
    }

    if (Array.isArray(v)) {
      // `items` may be one schema for every element or a tuple of them.
      const itemSchema = (i: number): Schema | undefined =>
        Array.isArray(s.items) ? s.items[i] : (s.items as Schema | undefined);
      return v.map((el, i) => walk(el, itemSchema(i), p ? `${p}.${i}` : String(i)));
    }

    if (v && typeof v === 'object' && s.properties) {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) {
        out[k] = walk(src[k], s.properties[k], p ? `${p}.${k}` : k);
      }
      return out;
    }

    return v;
  };

  return { value: walk(value, schema, path), repairs };
}
