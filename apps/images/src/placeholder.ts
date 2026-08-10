/**
 * Cache-miss placeholder — re-exported from `@deckscout/storage` so the self-host
 * service and the cloud image tier serve the SAME ~1 KB card-shaped WebP on a
 * miss. Kept as a module here because every call site in this app imports it from
 * './placeholder.js'.
 */
export { PLACEHOLDER_CONTENT_TYPE, PLACEHOLDER_WEBP } from '@deckscout/storage';
