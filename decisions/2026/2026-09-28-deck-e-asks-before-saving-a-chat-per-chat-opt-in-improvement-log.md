---
date: "2026-09-28"
title: "Deck-E asks before saving a chat: per-chat opt-in improvement log"
decided_by: "owner"
areas: ["Deck-E", "privacy", "security", "operations"]
supersedes: []
---
## 2026-09-28 — Deck-E asks before saving a chat: per-chat opt-in improvement log

**Decision:** Deck-E improvement data is opt-in for one conversation at a time.
Deck-E asks naturally and rarely when a reader is frustrated, says he should work
differently, or a chat clearly failed; feedback can also share the chat when the
reader ticks the option. The server, not the model prompt, enforces the
one-ask-per-conversation limit and honours the reader's prompt preference.

Shared copies are pseudonymised: names, username and email are redacted, and
stable collection identifiers are HMAC-derived rather than raw account,
conversation or request IDs. Administrators with the improvement permission can
read them, as can an agent only after an eligible administrator explicitly grants
that token capability. Conversation cost is recorded for every chat from usage
records, separately and without chat content.

**Why:** The owner wants DeckPal's team and authorised agents to study real
Deck-E conversations, but agents previously could only read a chat by driving
the owner's browser. A default-on collection was considered and rejected: asking
at the moment a conversation is worth studying gives the reader a real, bounded
choice without making every chat an improvement record.

**Implications:** This supersedes the old opt-in `decke_sharing` store; a later
migration drops that compatibility store. A shared corpus is retained for 180
days, and Stop sharing deletes its saved copy. The corpus includes the complete
redacted diagnostic context available for that conversation, while server-enforced
ask limits mean a decline, grant, or revoke prevents Deck-E from asking again in
that conversation.
