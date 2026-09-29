---
date: "2026-09-28"
title: "Deck-E asks before saving a chat: per-chat opt-in improvement log"
decided_by: "owner"
areas: ["Deck-E", "privacy", "security", "operations"]
supersedes: []
---
## 2026-09-28 — Deck-E asks before saving a chat: per-chat opt-in improvement log

**Decision:** Deck-E improvement data is opt-in. Deck-E asks naturally and
rarely when a reader is frustrated, says he should work differently, or a chat
clearly failed; the card offers Share this chat, Share all my chats, or No
thanks, and feedback can also share the chat when the reader ticks the option.
The server, not the model prompt, enforces the one-ask-per-conversation limit and
honours the reader's prompt preference. A profile setting, Always share my
Deck-E chats (off by default), shares every new chat from its first recorded
part; an explicit No or Stop sharing on a chat still wins, and turning the setting
off affects future chats only.

Shared copies follow the norms of ChatGPT and Claude (owner decision,
2026-09-29): the protections are consent, access limited to administrators with
the improvement permission and agents an eligible administrator explicitly
grants, 180-day retention, and no account IDs — collection identifiers are
HMAC-derived rather than raw account, conversation or request IDs. Usernames,
display names and emails are removed on a best-effort basis wherever they appear,
including common encodings; deliberately disguised forms are not guaranteed.
Conversation cost is recorded for every chat from usage records, separately and
without chat content.

**Why:** The owner wants DeckPal's team and authorised agents to study real
Deck-E conversations, but agents previously could only read a chat by driving
the owner's browser. A default-on collection was considered and rejected: asking
at the moment a conversation is worth studying gives the reader a real, bounded
choice without making every chat an improvement record. The owner would like
readers to share everything, so the all-chats choice is offered in the ask card
itself, not only in settings (a usage discount for readers who share all chats is
under consideration with metered credits). Adversarial redaction was designed
when collection was going to be opt-out; with explicit opt-in and admin-only
access it is hygiene, not the security boundary, so it is best effort — twelve
review rounds chasing ever more contrived encodings showed the absolute version
never converges.

**Implications:** This supersedes the old opt-in `decke_sharing` store; a later
migration drops that compatibility store. A shared corpus is retained for 180
days, and Stop sharing deletes its saved copy. The corpus includes the complete
redacted diagnostic context available for that conversation, while server-enforced
ask limits mean a decline, grant, or revoke prevents Deck-E from asking again in
that conversation.
