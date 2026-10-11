export * from './types.js';
export type * from './dsl.js';
export { createContext, type DeckInput, type DeckEntry, type GameContext, type Env } from './context.js';
export { Game } from './game.js';
export { playOut } from './play.js';
export { cloneState, newState } from './state.js';
export { legalActions, startGame, submit } from './flow.js';
export { describeAction, describeBoard, describeOptions } from './describe.js';
export { buildDef, isVanilla, normText, parseCost, parseDamage, textKey } from './cards/frame.js';
export { FRAMES, allScripts, scriptById, scriptFor } from './cards/registry.js';
export { RandomPilot, optionCount } from './pilot/random.js';
export type { Pilot } from './pilot/types.js';
export { Rng, deriveSeed } from './rng.js';
export { determinize } from './determinize.js';
export { makePilot, type PilotName, type PilotOptions } from './pilot/index.js';
export { GreedyPilot, type GreedyOptions } from './pilot/greedy.js';
export { SearchPilot, DEFAULT_SEARCH, type SearchOptions } from './pilot/search.js';
export { PolicyPilot, policyChoose, DEFAULT_PROFILE, type PolicyProfile } from './pilot/policy.js';
export { evaluate, DEFAULT_WEIGHTS, type EvalWeights } from './pilot/eval.js';
export {
  defaultPilotFactory, isTimeout, ownTurn, runSimulation, simulate, simulateAsync,
  type FirstTurns, type GameSummary, type KoRecord, type PilotFactory, type Side, type SimulateOptions,
  type Simulation, type SimulationResult,
} from './runner.js';
export {
  UNCREDITED, cardImpact, matchupStats, overallStats, rate, recordOf, wilson,
  type CardImpact, type CardImpactOptions, type ImpactSplit, type LossPatterns, type MatchupStats,
  type OverallStats, type PrizeRow, type Rate, type Record4, type SideSetup,
} from './stats.js';
export {
  CAVEAT, RANDOM_PILOT_WARNING, buildReport, deckCoverage, renderReport,
  type BuildReportInput, type CoverageLine, type DeckCoverage, type SimReport,
} from './report.js';
export {
  MIN_VERDICT_PAIRS, deckChanges, diffOf, gameScore, pairClusters, pairedDiff, pairedOverall, runPaired, simulatePaired,
  simulatePairedAsync, t95,
  type CardChange, type PairedDiff, type PairedOptions, type PairedSimulation, type Verdict,
} from './compare.js';
export {
  PAIRED_METHOD, buildComparison, renderComparison,
  type BuildComparisonInput, type ChangedCardImpact, type ComparisonMatchup, type ComparisonReport,
} from './compareReport.js';
