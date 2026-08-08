# D2 · feat/board-replay

**Wave 2 — the board component's first life, well before the engine.**
Worktree: `~/pokedex-worktrees/board-replay` (create when A1 merges) · Depends: A1.
**Web dev port: 5181**; api dev port 3711 if branch API routes are needed
(`DECKSCOUT_API_PORT=3711` + `DECKSCOUT_DEV_API_PORT=3711` for the vite proxy).
Spec: §2 (locked UX: one board component, phone-first), §3 Wave 2.

## Mission
The board component: a **pure renderer of game state / event streams** — no game logic inside.
Replay mode ships first, against real logged games. Live-match mode (D1b) later plugs into the
same renderer contract, so the contract this branch defines is the deliverable as much as the UI.

## Scope
- [ ] Renderer contract: event stream in (`battle_events` shape) → board state per turn →
      pixels. Document it (this is what D1b and the sim debug view build on). Component
      placement (apps/web module vs. package) is your call — but zero engine imports.
- [ ] Replay UI: both boards, actives/benches, attached energy, prizes, hand sizes, discard
      knowledge — rendered from events only (what the log knows, the board shows; nothing
      invented). Card faces from the existing image cache.
- [ ] Turn scrubbing (per-turn stepping minimum; per-event nice-to-have).
- [ ] **Phone-first**: one-handed portrait at 390px is the design target; desktop secondary.
- [ ] Entry point: from a battle log's detail (route is fine; app-shell nav integration can
      wait for Chey's call on visibility).
- [ ] Register the surface in the dev hub (port 5181) so Chey can watch replays from his phone
      during review.

## Done gate
Any stored log watchable + scrubbable on a phone at 390px; renderer contract documented;
verified in a real browser both widths (screenshots in the review note).
