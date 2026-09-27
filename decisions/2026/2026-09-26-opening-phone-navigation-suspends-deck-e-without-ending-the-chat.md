---
date: "2026-09-26"
title: "Opening phone navigation suspends Deck-E without ending the chat"
decided_by: "Chey (via Codex)"
areas: ["agents","decks","frontend"]
supersedes: []
---
## 2026-09-26 — Opening phone navigation suspends Deck-E without ending the chat

**Decided by:** Chey (via Codex)

**Decision:** Treat the phone navigation drawer as a temporary suspension of Deck-E's panel. Keep the panel inert while the drawer is open, preserve its conversation and unsent draft, and resume the panel when the drawer closes. A presentation's automatic retirement timer pauses during the suspension. Chat focus restoration yields to any modal dialog still open above it.

**Why:** Reusing Deck-E's `travelling` state to minimise the chat also started its presentation retirement timer. After 3.6 seconds, an otherwise idle chat could close and move focus outside the modal navigation drawer.

**Implications:** Opening the menu over chat cannot end the reader's conversation or steal focus after a delay. A delayed browser check waits beyond the retirement deadline, verifies focus remains in the drawer, then checks that the same unsent draft returns when navigation closes.

The drawer also advances focus explicitly through its visible controls on Tab. WebKit's default keyboard setting skips ordinary links and buttons during native Tab navigation, which let focus leave the dialog after its close button. Chromium and WebKit now check forward and backward Tab at phone width.

When the viewport crosses into desktop layout, the phone drawer closes and focus moves to visible sidebar navigation. The hidden drawer can no longer keep intercepting Tab after a resize; Chromium and WebKit check the transition from 390px to 1440px.
