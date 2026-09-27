# Scanner voice invariants

This remains a closed, opt-in beta grammar. Missing a command costs a tap;
executing one against the wrong capture can change the collection.

## Target resolution

1. An accepted command has exactly one capture target, or is a global Undo/Stop.
   An explicit name wins over “that one.” Unknown words refuse the entire command.
2. Structural phrases (filler, verbs, quantity frames, objections) match exact
   normalized **tokens**. They never use phonetic folding, plural stripping or
   token concatenation. “The N” cannot become “then”; “remove N” cannot become
   “removed.” Printing vocabulary alone gets fuzzy grammar matching, bounded
   by structural tokens at both edges and internally. Literal non-holo phrases
   retain their explicit meaning; fuzzy windows cannot swallow an objection.
3. Exact card names reserve their token spans before fuzzy matching. A fuzzy
   window cannot consume a neighbouring exact name. Short names, including N,
   match literally. Otherwise unexplained spans may match longer names by sound
   (“char is hard”), but filler never introduces a fuzzy target. Cosmos is
   matched literally so an absent Cosmog cannot become a Cosmos printing; a
   printing-like word in subject position without a known card or reference is
   refused rather than assigned to the latest capture.
4. Duplicate captures with the same full name mean the most recent capture by
   `capturedAt`, not arrival order. Distinct names sharing an alias or equally
   good sound match are refused with a request for a full name. A name identical
   to a grammar phrase, such as Poké Ball, keeps its printing meaning; use
   “that one” for that capture. Gender signs and other identity-bearing symbols
   remain distinct tokens. Names containing them require an exact match; a
   near-miss symbol never selects another card.
5. The anchor and named captures are snapshotted at the first words, not final
   transcription. A later capture cannot steal a command. A corrected identity
   cannot inherit a command spoken about the previous card.
6. Recognizer alternatives cannot overrule a refusal or unknown target, or
   disagree about which capture a command addresses. A clause break (“and,”
   “then,” or punctuation) cannot pair a named card with a separately referenced
   “that one.” A named Undo is refused because Undo only targets the latest
   action. Conflicting framed quantities refuse the whole utterance, including
   a later count of one.

## Change lifecycle

1. Every accepted action remains pending, applies with an Undo record, is
   deliberately cancelled/superseded, or fails with a persistent warning.
2. Unfinished speech also becomes a persistent warning when recognition ends or
   Verify opens, even if a final command never reached the action queue.
3. A warning belongs to queue state, not the temporary camera caption. Proposal
   refusal, row timeout/discard, unidentified landing, disappearance during a
   hold, Verify settlement, and application failure use the same warning path.
4. Warnings survive timer ticks, Verify, later commands and Undo until the reader
   explicitly acknowledges them. Add stays disabled while any warning remains.
   Applying a later printing does not silently acknowledge an earlier failure;
   Undo could otherwise restore the unresolved default.
5. Pending changes retain capture and card identity. Catalog defaults are not
   manual edits; a deliberate printing/count edit during the hold wins.
6. Leaving Scan settles all pending actions through the same completion path.
   Missing rows fail visibly rather than disappearing from the queue.
7. Accumulated warnings scroll inside a bounded panel; acknowledgement stays
   reachable on a phone even when many captures have failed.
8. The write itself checks warnings before committing. The ordinary Add button
   and the retained “Commit without them” confirmation share that check, and
   returning to Scan invalidates an old unresolved-row confirmation.

`__tests__/grammar.test.ts` enumerates name × command frame × row order and
present/absent targets. `__tests__/actions.test.ts` enumerates queue transitions
and warning persistence. `tests/browser/scannerVoice.mts` runs the shipping hook,
controls and list at desktop and phone widths with fake speech and a fake clock.
The iOS Simulator proves rendering and browser integration; actual speech beside
a running camera still needs a physical iPhone.
