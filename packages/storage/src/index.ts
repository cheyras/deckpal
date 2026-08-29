/**
 * @deckpal/storage — the cached-image asset layer.
 *
 * Two things live here:
 *   1. `paths.ts` — the ONE definition of the path/cache-key algebra, shared by
 *      the self-host disk tier (apps/images re-exports it) and the cloud object
 *      tier, plus the request parser both use to validate an incoming image URL.
 *   2. most of the rest — the cloud object tier: Supabase Storage reads/writes,
 *      the `image_asset` manifest over PostgREST, and `put-asset.ts`, the choke
 *      point that keeps bytes and provenance in step.
 *   3. `avatar-store.ts` — the OTHER kind of byte: user-uploaded profile photos.
 *      Its own bucket, its own choke point, and its own record (the
 *      `user_profile` row, migration 029) because an avatar's source is a person
 *      rather than a URL. Read its header before touching it.
 *
 * Importing this package is side-effect free; credentials are read lazily, so
 * apps/images can depend on it for the path algebra alone.
 *
 * THIS EXPORT LIST IS CURATED, not `export *`: only what consumers actually
 * import, plus documented manual tools (e.g. `listAvatarObjectKeys`,
 * DECISIONS.md 2026-08). Internal plumbing — `uploadObject`, `storageEnv`,
 * the manifest row writers `putStorageAsset` wraps — stays inside the package;
 * add a name here only when something outside gains a real caller.
 */
export {
  LANG,
  QUALITIES,
  SPRITES_SHA,
  cardCacheKey,
  cardRelativePath,
  cardSourceUrl,
  imageSubPathFromUrl,
  parseImagePath,
  setImageCacheKey,
  setImageRelativePath,
  setImageSourceUrl,
  spriteRelativePath,
  spriteSourceUrl,
  type CardRef,
  type ParsedImage,
  type Quality,
  type SetImageKind,
} from './paths.js';
export {
  SET_IMAGE_FALLBACK_TABLE,
  setImageFallbackUrl,
  type SetImageFallbackEntry,
} from './setImageFallback.js';
export { isWebp, sniffContentType } from './sniff.js';
export { PLACEHOLDER_CONTENT_TYPE, PLACEHOLDER_WEBP } from './placeholder.js';
export {
  FAILURE_CACHE_CONTROL,
  IMMUTABLE_CACHE_CONTROL,
  USER_AGENT,
  hasStorageEnv,
} from './config.js';
export {
  headObject,
  listObjectsRecursive,
  moveObject,
  objectExists,
  publicObjectUrl,
} from './object-store.js';
export {
  getManifestRow,
  recordProvenanceIfUnknown,
  upsertImageObjectRow,
  type ImageAssetKind,
} from './manifest.js';
export { fetchSourceBytesWithExtensionFallback } from './fetch-source.js';
export {
  fromUrl,
  putStorageAsset,
  putStorageAssetFromFile,
  putUnmanifestedObject,
  unknownProvenance,
  type Provenance,
} from './put-asset.js';
export {
  ACCEPTED_AVATAR_UPLOAD_TYPES,
  AVATAR_EDGE,
  MAX_AVATAR_UPLOAD_BYTES,
  avatarPublicUrl,
  deleteAvatarObject,
  hasAvatarStorage,
  isAvatarKey,
  listAvatarObjectKeys,
  newAvatarKey,
  putAvatarObject,
  type AvatarRecorder,
  type StoredAvatar,
} from './avatar-store.js';
