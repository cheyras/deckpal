---
date: "2026-10-14"
title: "Paging the same way in every tool, ignored arguments reported, ids labelled for tools"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-10-14 — Paging the same way in every tool, ignored arguments reported, ids labelled for tools
**Decided by:** Chey (via Claude)

**Decision:** Phase 4 of the plan approved on 2026-10-13, second PR. It makes three changes.

**1. Paging is the same in every paged tool: `page` + `page_size`.**
- **Tools converted:**
  - `collection_log` was `limit` alone, and could not reach past the newest 200;
  - `mutation_history` was `limit`;
  - `decks` was `page` alone;
  - `card_price_history` was an `offset` cursor with `next_offset`.
- **Footer:** it names the call: "showing 1–50 of 312 — call again with page 2 for more".
- **Price-history pages:** as many complete records as fit 5,500 characters, up to `page_size` (default 200). They are packed from the first record with room reserved for the longest header and footer, so page N is always the same records. A record too large for any page is a page of its own that is an error, and packing goes on after it (Astra, #346).
- **Shared arguments:** `pageArg` and `pageSizeArg` in `shared.ts`.
- **Exception:** the gated `decke_improvement_*` tools keep their cursor over an append-only feed.

**2. An argument a tool does not take is reported, not swallowed (MCP).**
- **How:** calls are validated against a loose copy of the schema, while the advertised JSON Schema stays exactly the original. The handler runs on the declared arguments only.
- **The note:** the result's first line names what was ignored, e.g. "Ignored `offset`: search_cards has no such argument. It pages with `page` (and `page_size`)." The paging hint appears only for a paging word on a paged tool.
- **Strict schemas:** a strict schema such as `revert` still refuses unknown arguments outright.

**3. Ids are for the next tool call, and say so.**
- **The format:** undo hints and creation lines now end with "(for the tool, never the reply: revert batch_id "…")", via `forTools` and `undoHint` in `format.ts`. Before, they handed the id over inside the sentence ("undo with revert(batch_id: …)", "Created deck 'X' — id …").
- **Covered:** `edit_list`, `delete_list`, `save_deck`, `delete_deck`, `log_cards`, `mutation_history`, `revert`, and the web approval card's "already landed" message to the model.

**Playbooks:**
- **Index:** a paging rule that also explains the "Ignored" line. The index was trimmed elsewhere to stay inside its 3,600-character cap.
- **Arguments:** the `collection_log` and `card_price_history` rows, and the price-history instructions, now name `page`.

**Why:** In the owner's Haiku test (2026-10-13), the model paged `search_cards` with `offset`, which it had learned from `card_price_history`. zod dropped it silently, page 1 came back again, and the model took that for the whole result: one of the reasons it reported "7 left" with 19 missing. Five paging styles taught that an argument from one tool works in another. A silent strip gave no chance to notice.

Separately, Haiku showed batch ids to the player. A result that hands an id over as the way to undo reads as something to pass on.

**Implications:**
- **Interface change:** callers that sent `limit` to `collection_log` or `mutation_history`, or `offset` to `card_price_history`, now get the "Ignored" note and the default page. Deck-E and the MCP response-audit probes were updated.
- **Deck-E:** gets the paging and the id wording, but not the ignored-argument note. Its AI SDK validates through zod internals that cannot be proxied the same way, and the failure was observed over MCP.
- **Tests:**
  - the price-history pagination tests were rewritten for pages: complete records, no duplicates, empty variants reachable, earlier pages readable past an oversized record, and the same page whichever is asked first;
  - Deck-E's chat-adapter walk and the real-Postgres routes suite now follow pages;
  - a new MCP wire test covers the ignored-argument note.
