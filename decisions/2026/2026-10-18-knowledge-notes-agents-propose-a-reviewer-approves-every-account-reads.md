---
date: "2026-10-18"
title: "Knowledge notes: agents propose, a reviewer approves, every account reads"
decided_by: "Chey (via Claude)"
areas: ["agents", "api", "db", "mcp"]
supersedes: []
---
## 2026-10-18 — Knowledge notes: agents propose, a reviewer approves, every account reads
**Decided by:** Chey (via Claude)

**Decision:** DeckPal keeps a shared knowledge base of short, sourced notes about how named cards interact (Phase 6 of the skill-tests plan).

**What a note is.** It has:
- 1–6 card names;
- a statement (10–600 characters);
- an `https` source link;
- the source's own words as a quote.

It is stored in `knowledge_note` (migration 089, which turns row-level security on with no policy, and 090, which adds the policies on cloud).

**How it gets in.**
- Any agent proposes a note with the new `propose_note` tool (`POST /knowledge/notes`). Like the other writes it previews by default (`dry_run`).
- A note is stored only by `knowledge_note_propose()`, never by a table insert. On cloud a client holds the same database role as the API, so a rule only the API enforced could be skipped by calling Supabase directly. The function enforces the limits, drops duplicates and refuses the plainest personal data itself.
- A proposal stays visible only to its proposer until a reviewer approves it.
- Every decision goes through `knowledge_note_review`. Each note is decided once, and every approval or rejection is written to the admin audit log with its reason. A rejection must give one.

**Who reviews.** Anyone with the new `knowledge.review` permission, in a browser session, never with a personal access token.
- It is seeded to the admin tiers (admin, super_admin, owner).
- The ceiling allows giving it to a contributor role (tier 30), never to a user or superuser role. Reviewing checks only for `knowledge.review` (`knowledge_require_reviewer`), not `admin.access`, which a contributor can never hold.

**Automatic checks before a reviewer looks.**
- Refused: email addresses and phone numbers, and an email or a user name and password in the source link (checked as typed and percent-decoded).
- Flagged for the reviewer, worked out from the stored note each time the queue is read (never supplied by the proposer):
  - an @handle;
  - text that reads like instructions to an agent;
  - a source outside the rulings sites reviewers know;
  - a quote that names none of the cards;
  - links inside the text.
- Limits, enforced in the database: 20 proposals an hour, 20 waiting per account, and the same statement about the same cards is not stored twice.

**Where approved notes show.** `get_card` and `rules_lookup` print up to three approved notes under a "Community notes" header. The text is always quoted as third-party data, and the header says the source is the authority. A database without the table shows no notes rather than an error.

**Why:**
- The owner asked for a public knowledge base that agents contribute to, approved by the owner at first, with an admin surface reachable by a reasonable tier.
- Findings that a research turn settles (a Stadium's effect on Tera attackers, an attack window) are lost when the chat ends. Notes keep them, with the source, for the next agent.
- A note is shared with every account, so nothing reaches others unreviewed. The automatic checks only help the reviewer, who is the guard.

**Implications:**
- Notes never outrank DeckPal's rules, the official rulings or card text. The `rules` playbook says the card text and rulings still decide.
- A note is not account data: proposing one writes no mutation-log row and `revert` does not undo it. A reviewer rejects a wrong one instead.
- Twelve write tools now (32 in all). tools/list is at 69,988 of its 70,000 budget: the `save_deck` and `continue_token` descriptions were trimmed to make room, with the same facts.
- The admin review screen is the next PR. Until then a reviewer decides through `POST /admin/knowledge/:id/review`.
- Approved notes about interactions are the candidate source for simulator tests (a later step).
