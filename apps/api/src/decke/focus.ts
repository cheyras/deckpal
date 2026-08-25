/**
 * Which tools Deck-E can SEE on a given step.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — MEASURED, NOT SUPPOSED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The conversational model holds 36 tools: 9 cosmetic, 23 data, 4 deep. (It
 * held 34 when the bisection below ran — `journey` and `escort` arrived
 * later; the arm labels keep the counts they were measured at.) The bake-off
 * that measured it 100% clean on every metric gave it about ten.
 *
 * Then a defect appeared on the deployed preview. Asked to add 4000 of a card —
 * a request that should fire an `alert_dizzy` reaction — it emitted this as
 * VISIBLE TEXT and called nothing:
 *
 *     <express><commands><op>state</op><value>alert_dizzy</value></commands></express>
 *
 * A character reading his own stage directions aloud while standing perfectly
 * still. So the tool set was bisected against the live model, 5 trials per arm,
 * on that exact prompt:
 *
 *   34 tools (7 cosmetic + 23 data + 4 deep) ... narrated 5/5, express 0/5
 *   23 tools (write tools removed) ........... narrated 1/5, express 1/5
 *   10 tools (bake-off's set) ................ narrated 3/5, express 1/5
 *
 * Two things fall out, and the second is why this file is not simply a shorter
 * tool list:
 *
 *  - **The 11 write tools are the ones that hurt.** Removing them fixed it.
 *  - **Fewer is not better.** Ten was WORSE than twenty-three. So it is which
 *    tools are present, not how many — and a blunt trim would have cost real
 *    capability for a worse result.
 *
 * The same measurement killed the other hypothesis it was run to test:
 * fabrication was 0/5 at 34 tools and 1/5 at 10. Tool count is not why he
 * invents things. That is recorded in DECISIONS.md rather than acted on.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * AND THE MEASUREMENT DID NOT REPLICATE — READ THIS BEFORE TRUSTING THE NUMBERS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A follow-up run could not reproduce the defect in ANY arm: 0/24 on the
 * primary trigger where the first run saw 5/5. That agent also found a real bug
 * in its own harness — `fullStream`'s `text-delta` carries the increment in
 * `.text`, not `.delta` — and could not rule out that the first harness had an
 * analogous gap.
 *
 * So the numbers above are the honest record of what was observed, and they are
 * NOT settled. This narrowing stays because it costs nothing, removes no
 * capability, and is independently supported by published work on adaptive tool
 * shortlists — not because the bisection is proven. If someone re-measures with
 * a corrected harness and finds no effect, deleting this file is a perfectly
 * good outcome and nothing else has to change.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY `activeTools` AND NOT A SMALLER TOOL SET
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `streamText` takes `activeTools`, and `prepareStep` can recompute it per step.
 * Verified against the pinned `ai@7.0.66` rather than assumed — including the
 * part that matters: with `danger` absent from `activeTools`, a prompt begging
 * the model to call it produced no call, no execution, and the model answering
 * "there's no danger tool". The schema and the executor agree.
 *
 * (That check was not paranoia. vercel/ai#8653 reported `activeTools` filtering
 * the advertised schema while the executor still ran the unfiltered set, which
 * would make it a hint rather than a boundary. It does not reproduce here.)
 *
 * So writes are not REMOVED, they are OUT OF VIEW until he is working on one.
 * He keeps every capability; he simply is not shown eleven ways to mutate a
 * collection while being asked what is in a set.
 */
import type { ToolSet } from 'ai';
import { allTools } from '@deckpal/agent-tools';

/**
 * The one write that belongs in conversation.
 *
 * "Add these cards" is the request this whole feature exists to serve, and the
 * approval flow was built for it. Banishing it to a sub-agent would mean the
 * commonest write is the one that takes ten seconds and a delegated model.
 *
 * Kept on the FIRST step deliberately, so "add one Grass Energy" needs no
 * warm-up turn. The other ten writes are deck and list management — rarer,
 * heavier, and no worse for arriving on step two.
 */
const CONVERSATIONAL_WRITE = 'log_cards';

/**
 * What he can see on the FIRST step of a turn.
 *
 * Everything except the ten heavy writes. In practice that is 26 of 36 — the
 * shape of the arm that measured cleanest, with `log_cards` still in reach.
 */
export function openingTools(tools: ToolSet): string[] {
  const writes = new Set(
    allTools()
      .filter((d) => !d.annotations.readOnlyHint && d.name !== CONVERSATIONAL_WRITE)
      .map((d) => d.name),
  );
  return Object.keys(tools).filter((n) => !writes.has(n));
}

/**
 * What he can see once a turn is under way.
 *
 * EVERYTHING. The narrowing exists to stop eleven write tools crowding the
 * FIRST decision — "what is this person asking for" — and once he has read
 * something and is acting on it, the crowd is no longer the problem and
 * withholding a tool he now needs would be.
 *
 * Concretely: "delete my Mono Fire deck" reads the deck on step one and can
 * delete it on step two. One extra step, and the alternative is a capability
 * that silently does not exist.
 */
export function focusedTools(tools: ToolSet, stepNumber: number): string[] {
  return stepNumber === 0 ? openingTools(tools) : Object.keys(tools);
}
