# D1b · feat/board-live

**Wave 4 — the table Chey plays on.**
Worktree: `~/pokedex-worktrees/board-live` (create when D1 + D2 have merged) · Depends: D1, D2.
**Web dev port: 5183**; api dev port 3712 if needed (`POKEDEX_API_PORT` + `POKEDEX_DEV_API_PORT`).
Spec: §2 (locked UX: tap-to-act v1, phone-first, direct manipulation later), §3 Wave 4.

## Mission
Live-match mode on the D2 board component: Chey plays Claude on his phone, on a rendered board.

## Scope
- [ ] Live data source into the D2 renderer contract (poll or SSE from the match server — pick
      and document; phone-friendly either way).
- [ ] **Tap-to-act input, v1**: the engine's legal-action list drives every choice. Tap your
      Active → attack options; tap a hand card → its legal targets; end-turn/retreat/concede
      reachable one-handed. The action list is the source of truth — the UI never invents a
      move, so it can never desync.
- [ ] Turn flow UX: whose turn, what the agent did while you looked away (event ticker from
      the stream), prize/KO moments legible at a glance.
- [ ] Phone-first at 390px portrait, one-handed. Desktop works, secondary.
- [ ] Register in the dev hub (port 5183). **Full direct manipulation (drag from hand, drag
      energy) is explicitly out of scope** — later enhancement on this same component, listed
      in spec "Later".

## Done gate
The spec's D gate: a full engine-mediated match against Claude, played on the phone on the
board, tap-to-act only; browser-verified at 390px + desktop with screenshots.
