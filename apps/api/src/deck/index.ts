/**
 * Deck-format validation engine + PTCG Live interchange. Phase 5 backend, part 1.
 * Self-contained module; a later task wires it into a route + UI.
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
