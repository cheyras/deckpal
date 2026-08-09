# @deckscout/engine

Pokemon TCG rules engine + baseline bot for the battle-intel track
(`BATTLE-INTEL-SPEC.md` §3, branch lineage B1 → B2 → B3 …).

## Origin & license

Vendored from **[keeshii/ryuu-play](https://github.com/keeshii/ryuu-play)**
@ commit `9cd20b6a3232b77ac114fb45a3979d51a4332850` (release 0.2.x, 2025),
**MIT** — upstream license preserved verbatim in [`LICENSE`](./LICENSE).
The fork-vs-greenfield evaluation and the modern-rules gap list live in
`roadmap/engine-gap-analysis.md` and the 2026-08-01 DECISIONS.md entry.

| Here | Upstream | What |
|---|---|---|
| `src/common` | `packages/common` (`@ptcg/common`) | Game core: store + effect propagation, prompts, state, rules, card manager, deck analyser, serializer, headless `Simulator`, `BotArbiter` |
| `src/bot` | `packages/simple-bot` (`@ptcg/simple-bot`) | `SimpleBot`: greedy tactic list, per-prompt resolvers, weighted state scoring |
| `src/cards` | `packages/sets` (`@ptcg/sets`) | ~250 DP/HGSS/BW-era card implementations. **Prior art for the B3 DSL and test material only** — not the Standard-2026 pool |

Discarded upstream: Angular client (`play`), Cordova shell, lobby/websocket
server (`server` — the only TypeORM/SQLite user; the game core has no
persistence), avatars, scans, docker/fastlane.

Local changes to vendored code (kept deliberately minimal in B1):

- `@ptcg/common` imports rewritten to relative `…/common` paths.
- `src/common/game/replay.ts`: `@progress/pako-esm` → plain `pako`
  (ESM-only dep inside what is now a CommonJS package).
- Upstream's core jasmine specs ported to `node:test` under `test/`
  (upstream's per-card specs were not vendored).

## Module system (read before "fixing" it)

This package is **CommonJS on purpose** (no `"type": "module"`), under the
repo-wide `module: Node16`. Upstream's ~1,000 files use extensionless relative
imports, which are legal in CJS resolution but would all need `.js` suffixes
under ESM. Consumers on ESM can `import` it normally.

`tsconfig.json` relaxes `noUncheckedIndexedAccess` / `noImplicitOverride`
for the vendored code; new files should stay clean against repo strictness.

## Commands

```bash
pnpm --filter @deckscout/engine typecheck
pnpm --filter @deckscout/engine build     # emits dist/ from src/ only
pnpm --filter @deckscout/engine test      # pure: no DB, no network (CI-safe)
```

The test suite includes the B1 smoke test: a full legal game of vanilla basic
Pokemon plays to completion under `SimpleBot` on both sides
(`test/smoke.game.test.ts`).
