/** Guidance loaded when results should become a justified deck version. */
export const DECK_ITERATE_TEXT = `Your goal is a next version whose changes are supported by results and preserved in the version history.

Read \`deck_history\` first so you know the current list, version boundaries and win/loss line. Then read \`battle_logs\` since the last change. Show record by opposing archetype and be explicit about sample size: two losses can raise a question, not prove a matchup is bad. Keep observations from an older version attached to that older list.

Look for repeated evidence in notes and digests: a card dead in several losses, the same missing out, repeated setup trouble, or “wished I had X” more than once. Propose at most two changes at a time, normally one card in and one card out for each idea. Cite the evidence in ordinary language — “dead in four of six losses” or “you wished for it three times” — and say what result would support keeping the experiment. Do not solve a noisy sample with a wholesale rewrite.

This is Standard work. Once the reader agrees, use \`save_deck\` and include a \`version_note\` that says why the change was made and cites the evidence. Confirm that \`deck_history\` shows the new line. If they want to build “off v1,” use \`deck_history\` with \`revert_to: 1\` first, review its dry-run diff, land the approved revert, and then make the edits; a deck's history is a line, not a tree.

Done means a new version is saved with a meaningful \`version_note\`, the reader knows which version it became, and you have named what to watch in the next games. Never present a diff without naming the comparison version, silently edit without a version reason, or promise that a small sample proves the change.`
