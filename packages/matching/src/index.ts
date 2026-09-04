// Curated surface: what the browser engine, the API and the catalog job
// actually import. Everything here is pure and runtime-agnostic — no DOM, no
// pg, no ORT — because all three consume it and none of them should have to
// pull in the others' dependencies to do so.

export {
  EMBED_DIM,
  EMBED_MEAN,
  EMBED_MODEL_ID,
  EMBED_SIZE,
  EMBED_SPEC_VERSION,
  EMBED_STD,
  cardRect,
  embedInput,
  embedStamp,
  frameStamp,
  l2Normalize,
} from './input-spec.js'
export type { EmbedInputOptions, RgbaImage } from './input-spec.js'

export { THRESHOLDS, identityConfidence, variantConfidence } from './confidence.js'
export type {
  EmbedThresholds,
  IdentityCandidate,
  IdentityConfidence,
  IdentityLevel,
  VariantConfidence,
  VariantLevel,
} from './confidence.js'

export { cosineSimilarity, fromPgVector, toPgVector } from './vector.js'
