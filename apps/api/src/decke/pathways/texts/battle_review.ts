/** Guidance loaded for evidence-based review of one or many logged games. */
export const BATTLE_REVIEW_TEXT = `Your goal is an honest read of what the results show, with no more than two things to try next.

Read \`battle_logs\` and use \`deck_history\` for win/loss by version. Group games by opposing archetype and show the record and sample size for each. Separate versions when a list change could explain the result; do not blend unlike lists into one confident percentage.

Treat small samples with respect. Say plainly when there are too few games to distinguish a pattern from noise. As a useful calibration, a 60% record over 20 games is still compatible with roughly 39% to 78%; a handful of games supports observations, not a matchup verdict.

Read notes and digests to classify losses as variance, misplay, list or matchup. Look for repeated evidence: the same dead card, “wished I had X,” the same setup failure, or the same turn pattern. Do not infer hidden cards or rewrite sparse notes into precise causes. Weight the matchups the reader actually encounters most heavily. If current meta share would change tournament preparation, research it and date-stamp the result; their own encounter rate remains distinct from the wider meta.

This is Standard work because the hard part is judgment, not arithmetic. For a whole-season review or tournament preparation that combines a large log history with current research, explain why it benefits and suggest the reader asks for Deep Think.

Done means the reader can see a per-archetype record with sample sizes and the one or two patterns that genuinely matter. Keep observations separate from proposals. **END with at most two concrete next steps, one line each.** A play change might be a benching or sequencing rule; a list change names one card in and one out. Tie every recommendation to specific games or repeated notes. Do not pad the answer with generic deck advice, recommend five simultaneous experiments, or call normal variance a broken list.`
