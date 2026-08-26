/**
 * Deck-format validation engine + PTCG Live interchange.
 *
 * Wired into the app at `routes/decks.ts` (deck builder — persistence,
 * validation, interchange, test hands) and `export/router.ts` (PDF export's
 * legality verdicts), both of which import from this barrel. `versions.ts` and
 * `battlelog.ts` are deliberately NOT re-exported here: they are Deck
 * Intelligence bookkeeping and log parsing rather than the engine proper, and
 * their consumers deep-import them.
 *
 * This barrel is the module's declared public API surface — a re-export with no
 * external consumer yet is intended surface, not evidence of dead code.
 *
 * See research/DECK-FORMATS.md for the spec and data/_provenance.json for what is
 * vendored vs derived.
 */
export * from './types.js';
export {
  parsePtcgl, serializePtcgl, toSerializable,
  parseMassEntry, serializeMassEntry,
  type ParsedDeck, type ParsedLine, type SerializableLine, type MassEntryLine, type Section,
} from './ptcgl.js';
export { playableFingerprint, hasFullGameplayData, type FingerprintInput } from './fingerprint.js';
export { indexFingerprints, collisionReport, type IndexResult } from './fingerprintIndex.js';
export { validateDeck, type ValidateContext } from './formats.js';
export {
  ruleBoxKind, cardIsAceSpec, cardIsRadiant, cardIsPrismStar, cardIsBasicEnergy,
} from './rules.js';
export {
  mulberry32, expandLibrary, drawOpeningHand,
  simulateMulliganRate, hypergeometricMulligan,
  type Rng, type HandCard, type MulliganStats, type DrawResult,
} from './testhand.js';
export { normalizeName, isBasicEnergy, BRACE_TO_TYPE } from './names.js';
export {
  formatConfig, formatsCheckedAt, banList, glcRules, glcTypes,
  resolveSetAlias, setAliases, ACE_SPEC_NAMES,
} from './data.js';
// DB adapter (read-only) is exported separately so the pure engine has no pg dep at import.
export {
  makeDeckPool, resolveDeck, resolveLine, loadBySetNumber, loadByName,
  computeFingerprints, fingerprintInputs, buildReprintOracle,
} from './db.js';
export {
  buildPtcglExport, findLiveReprint, ptcglCodeForSet, ptcglName, basicEnergyBrace,
  type ExportRow, type ExportWarning, type PtcglExportResult, type LiveReprint,
} from './export.js';
