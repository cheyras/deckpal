/**
 * Content-type sniffing from magic bytes — shared by both image tiers.
 *
 * Lifted out of `apps/images/src/store.ts` (which re-exports it) so the disk tier
 * and the object tier record the same truth. The cache is named `.webp`
 * throughout, but a writer without validation can (and did) land PNG/JPEG bytes
 * under that name; recording `image/webp` for them would be a lie the manifest
 * then spreads. Returns `application/octet-stream` for anything unrecognised.
 */
export function sniffContentType(buf: Uint8Array): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '<?xml') return 'image/svg+xml';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === '<svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

/** Is this actually a WebP? Cheap guard for writers that require WebP. */
export function isWebp(buf: Uint8Array): boolean {
  return sniffContentType(buf) === 'image/webp';
}

/** Raster image types we are willing to cache. SVG is deliberately excluded. */
const CACHEABLE = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif']);

export function isCacheableImage(contentType: string): boolean {
  return CACHEABLE.has(contentType);
}
