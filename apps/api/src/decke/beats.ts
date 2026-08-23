/**
 * Narration beats — the words a reader sees WHILE a deep tool is running.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS NOT `narration.ts`
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `narration.ts` is a LEAK FILTER. It removes tool syntax the model emitted as
 * prose. It has no concept of a tool boundary and it never emits a word of its
 * own — it only deletes. That is worth saying plainly because the plan for this
 * work called it "the narration system", and reading it makes the gap obvious:
 * there was no narration system at all.
 *
 * This is the other half. It composes, on the server, the short lines that fill
 * the 210 seconds a deep call can occupy.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERY FUNCTION HERE TAKES A FACT AND RETURNS WORDS ABOUT THAT FACT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * That is the whole design rule, and it is structural rather than a convention
 * someone has to remember. There is no exported function you can call without
 * already holding an observation:
 *
 *   `openingBeat`   needs the name of a deep tool whose `execute` really ran
 *                   AND whose meter charge really succeeded.
 *   `toolBeat`      needs a tool name, and returns `null` unless that name is a
 *                   real entry in the shared registry — so a beat can only ever
 *                   name a tool that exists and really started.
 *   `sourceBeat`    needs a URL the provider really reported as a source, and
 *                   returns `null` if it will not parse.
 *   `heartbeatBeat` needs an elapsed time and a step count measured by the
 *                   caller against its own running invocation.
 *   `proseBeat`     needs text the sub-agent really produced.
 *
 * "Checking your collection…" with no lookup behind it is strictly WORSE than
 * no beat, because it manufactures evidence — the same argument
 * `adapters/aisdk.ts` makes about chips, applied to the words inside one. So
 * nothing here invents an activity, and the unknown cases return `null` rather
 * than something plausible.
 */
import { allTools, type ToolDefinition } from '@deckpal/agent-tools';
import { createNarrationFilter } from './narration.js';

/** One line of progress. `step` is the sub-agent step it was observed in. */
export interface Beat {
  note: string;
  step?: number;
}

/** A beat is a detail row, not a paragraph. Longer than this is noise. */
export const MAX_BEAT_CHARS = 160;

/**
 * What each deep tool is, in one line, for the moment it actually starts.
 *
 * Keyed by the tool's own name rather than composed from its description,
 * because a description is written for a MODEL deciding whether to call
 * something and reads terribly to a person watching it run.
 *
 * A deep tool with no entry here gets SILENCE, not a generic line — and
 * `deep.test.ts` asserts every tool `buildDeepTools` returns has one, so the
 * failure mode is a red test rather than a quiet regression to the 210 seconds
 * this exists to end.
 */
const OPENING: Readonly<Record<string, string>> = {
  plan_deck: 'Working out a deck from what you actually own.',
  analyze_collection: 'Going through your collection properly.',
  research_meta: 'Reading up on what the meta is doing right now.',
  write_strategy_guide: 'Writing a strategy guide for this deck.',
};

/**
 * The beat for a deep tool that has really started.
 *
 * Emitted AFTER the meter charge, never with the `start` chip — a call the cap
 * refuses never runs a model, and "Working out a deck…" in front of a refusal
 * would be the exact fabrication this file exists to prevent.
 */
export function openingBeat(deepToolName: string): Beat | null {
  const note = OPENING[deepToolName];
  return note ? { note, step: 0 } : null;
}

/** Every deep tool name this module can speak for. Exported for its own test. */
export function openingBeatNames(): string[] {
  return Object.keys(OPENING);
}

/** The registry, by name. Built once; `allTools()` reconstructs on every call. */
let byName: Map<string, ToolDefinition> | null = null;
function defs(): Map<string, ToolDefinition> {
  if (!byName) byName = new Map(allTools().map((d) => [d.name, d]));
  return byName;
}

/**
 * The beat for an inner tool the sub-agent really invoked.
 *
 * The words come from the REGISTRY's own `title` and `readOnlyHint`, not from a
 * table in this file. Two reasons, and the second is the important one:
 *
 * 1. A hand-written table drifts. This one cannot — a tool is renamed and the
 *    beat is renamed with it, or the tool ceases to exist and the beat ceases
 *    to exist with it.
 * 2. `null` for an unknown name is the safety property. A beat that named a
 *    tool the registry has never heard of would be a line about work nobody can
 *    show happened.
 *
 * The read/write verb is read off `annotations.readOnlyHint` and NEVER off the
 * verb in the name, for the reason `adapters/aisdk.ts` gives at length:
 * `set_cart` sounds like a write and only composes a URL; `deck_history` sounds
 * like a read and can roll a deck back.
 */
export function toolBeat(toolName: string, step?: number): Beat | null {
  const def = defs().get(toolName);
  if (!def) return null;
  const verb = def.annotations.readOnlyHint ? 'Reading' : 'Writing';
  return beat(`${verb}: ${def.title}`, step);
}

/**
 * The beat for a source the provider really reported.
 *
 * Host only, deliberately. A full URL in a progress row is unreadable at a
 * glance and a source list is a job for the finished answer, which already
 * carries citations — this is "he is off reading pokebeach right now", which is
 * the thing the silence hid.
 */
export function sourceBeat(url: string, step?: number): Beat | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
  return host ? beat(`Read a source: ${host}`, step) : null;
}

/**
 * The beat for "nothing has changed and it is still running".
 *
 * This one is the answer to the 61 pixel-identical seconds. It says only what
 * the server can see from its own side of the call — how long the invocation
 * has been open, and how many steps of it have started — which is exactly the
 * information the reader was missing and none that anybody had to invent.
 */
export function heartbeatBeat(o: { elapsedMs: number; steps: number }): Beat {
  const secs = Math.max(0, Math.round(o.elapsedMs / 1000));
  const steps =
    o.steps > 0 ? `, ${o.steps} step${o.steps === 1 ? '' : 's'} in so far` : ' — no output yet';
  // The one beat that is never null: the caller is holding an open invocation,
  // which is a fact that always has words.
  return { note: `Still going, ${secs}s${steps}.`, step: o.steps };
}

/**
 * The beat that carries the sub-agent's OWN words.
 *
 * ── TWO THINGS THIS MUST NOT BECOME ─────────────────────────────────────────
 *
 * **It is not his voice.** `deep.ts`'s `ANALYST` preamble deliberately gives
 * the sub-agents no personality, because a document written in Deck-E's voice
 * and then discussed by Deck-E is two characters talking over each other in one
 * answer. So this text belongs in the expandable detail row and NEVER in his
 * speech bubble. The client renders every `progress` note there; that is the
 * whole reason the phase carries one field rather than two.
 *
 * **It is not unfiltered.** The leak filter in `narration.ts` runs over the
 * conversational model's text stream in `api/chat.mjs`. A transient data part
 * does not pass through it, so a sub-agent that emits `<express>…</express>`
 * mid-thought would put markup on screen by a route nobody had checked. Running
 * the same tested filter over the snippet closes that, cheaply — one push, one
 * end, no state kept.
 */
export function proseBeat(text: string, step?: number): Beat | null {
  const filter = createNarrationFilter();
  const clean = `${filter.push(text)}${filter.end()}`.replace(/\s+/g, ' ').trim();
  return clean ? beat(clean, step) : null;
}

/** Trim to something a detail row can hold, and drop an empty result. */
function beat(note: string, step?: number): Beat | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  const note2 =
    trimmed.length > MAX_BEAT_CHARS
      ? `${trimmed.slice(0, MAX_BEAT_CHARS - 1).trimEnd()}…`
      : trimmed;
  return step == null ? { note: note2 } : { note: note2, step };
}
