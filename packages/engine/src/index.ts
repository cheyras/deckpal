/**
 * @pokedex/engine — Pokemon TCG rules engine + baseline bot.
 *
 * Vendored from github.com/keeshii/ryuu-play @ 9cd20b6 (MIT — see LICENSE and
 * README.md). Layout:
 *   ./common — the game core (upstream @ptcg/common): store, effects, prompts,
 *              state, serializer, simulator, card manager, deck analyser.
 *   ./bot    — SimpleBot (upstream @ptcg/simple-bot): greedy tactics + scoring.
 *   ./cards  — upstream @ptcg/sets card implementations, kept as DSL prior art
 *              and test material. NOT the Standard-2026 card pool (that is B3).
 */
export * from './common';
export * from './bot';
