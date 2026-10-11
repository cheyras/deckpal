/**
 * Which tools Deck-E can SEE on a given step.
 *
 * The original implementation hid ten write tools on step zero after a live
 * bisection appeared to show that write tools made the model narrate an
 * `express` command instead of calling it. A follow-up run did not replicate
 * that result in any arm (0/24 on the original trigger), and found a harness
 * bug that made the first measurement unsafe to treat as settled evidence.
 *
 * On 2026-10-10 production supplied the stronger evidence: twice, a reader
 * pasted a PTCG Live battle log and Deck-E never called `add_battle_log`; the
 * write was hidden on its opening decision even though the prompt told it to
 * call the tool immediately. The same narrowing also worked against Anthropic's
 * cache layout. Anthropic caches tools → system → messages and binds replayed
 * thinking to the exact tools array, so changing `activeTools` between steps of
 * one request rewrote the cached prefix on every multi-step turn and could
 * invalidate the thinking being replayed. Writes already wait behind a signed
 * approval card, so visibility on step zero grants no authority to write.
 *
 * Every real tool is therefore visible on every step. The sole remaining
 * mid-turn change is `impossible`: a tool whose meter cap is already spent can
 * disappear because another call cannot succeed. That case is rare by design,
 * and unlike a reader decline it cannot be reversed by another sentence.
 */
import type { ToolSet } from 'ai';

export function focusedTools(
  tools: ToolSet,
  stepNumber: number,
  /** A spent meter cap (or another hard impossibility), never a preference. */
  impossible?: (name: string) => boolean,
): string[] {
  // Kept in the public signature because callers compute focus per SDK step.
  void stepNumber;
  const visible = Object.keys(tools);
  return impossible ? visible.filter((name) => !impossible(name)) : visible;
}
