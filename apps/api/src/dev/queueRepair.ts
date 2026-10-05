export interface QueueMeta {
  name: string;
  source: 'camera' | 'upload';
  addedAt: string;
}

/** One object from a listing of the queue prefix, as the object store reported it. */
export interface QueueObject {
  path: string;
  byteSize: number;
  /** The object's etag as listed, when the store reports one. */
  etag?: string | null;
}

export interface QueueStore {
  locked<T>(id: number, work: () => Promise<T>): Promise<T>;
  /** Every object under `dev-queue/`, in one listing: the snapshot the queue listing is built from. */
  list(): Promise<QueueObject[]>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number | null>;
  photo(path: string): Promise<Buffer | null>;
  /**
   * A sidecar's metadata. `listedEtag` is what a listing snapshot reported for
   * this path; a store may answer from a cache only for those exact bytes.
   * Locked callers pass none and get a fresh read.
   */
  meta(path: string, listedEtag?: string | null): Promise<QueueMeta | null>;
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(path: string): Promise<boolean>;
}

const path = (id: number, ext: 'jpg' | 'json') => `dev-queue/${id}.${ext}`;
export const replacementId = (id: number) => id * 1000 + 1;

// Replacement IDs occupy a different numeric range from server clock IDs.
export function originalId(id: number): number {
  return id >= 1_000_000_000_000_000 && id % 1000 === 1 ? Math.floor(id / 1000) : id;
}

export function validQueuePhotoId(id: number): boolean {
  const original = originalId(id);
  return Number.isSafeInteger(id) && original >= 1_000_000_000_000 &&
    Number.isSafeInteger(replacementId(original)) && (id === original || id === replacementId(original));
}

export interface QueuePhoto {
  id: number;
  photoId: number;
  size: number;
  meta: QueueMeta;
}

// The chosen photo's sidecar, else the original's, else a deterministic
// fallback. Metadata never decides whether a photo exists. `listed` carries
// the snapshot's sidecar etags on the lock-free listing path only.
async function familyMeta(original: number, photoId: number, store: QueueStore, listed?: Map<number, string | null>): Promise<QueueMeta> {
  const meta = await store.meta(path(photoId, 'json'), listed?.get(photoId)) ??
    (photoId === original ? null : await store.meta(path(original, 'json'), listed?.get(original)));
  return meta ?? {
    name: `photo-${original}.jpg`,
    source: 'upload',
    addedAt: new Date(original).toISOString(),
  };
}

async function selectedPhoto(id: number, store: QueueStore): Promise<QueuePhoto | null> {
  const original = originalId(id);
  const replacement = replacementId(original);
  const replacementSize = await store.size(path(replacement, 'jpg'));
  const originalSize = replacementSize === null ? await store.size(path(original, 'jpg')) : null;
  const photoId = replacementSize !== null ? replacement : originalSize !== null ? original : null;
  if (photoId === null) return null;
  return { id: original, photoId, size: replacementSize ?? originalSize ?? 0, meta: await familyMeta(original, photoId, store) };
}

/**
 * Sidecar reads one listing keeps in flight. They take no lock and no database
 * connection. Supabase Storage throttles a 16-wide burst (on the PR preview the
 * listing after one drew a 502); at 8, ~1000 never-seen sidecars take ~15 s,
 * and a warm re-list reads only new or rewritten ones (captureQueueStore.ts).
 */
export const LISTING_META_CONCURRENCY = 8;
/** Locked family rechecks one listing keeps in flight, leaving the FIFO room for a thumbnail or a mutation. */
export const LISTING_LOCKED_CONCURRENCY = 2;

const QUEUE_OBJECT_RE = /^dev-queue\/(\d+)\.(jpg|json)$/;

async function eachBounded<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await work(items[cursor++]!);
  }));
}

/**
 * Every queued photo, once per family, chosen from ONE object listing.
 *
 * The listing is the snapshot. A family whose snapshot holds a photo shows it:
 * the replacement if it was listed, else the original, with the size the
 * listing reported. Only its sidecar is read, lock-free and many at a time.
 * A family the snapshot saw only as sidecars is rechecked under its lock,
 * because the listing may have missed a photo that exists (a page that shifted
 * under a concurrent delete, a migration between the two bucket listings).
 *
 * This cannot hide a photo the snapshot saw: nothing below drops a family with
 * a listed photo. It can show one that went away after the snapshot, as any
 * listing can by the time the reader looks; reads take the family lock and
 * resolve the photo that exists now, or 404.
 */
export async function listQueuePhotos(store: QueueStore): Promise<QueuePhoto[]> {
  const sizes = new Map<number, number>(); // physical photo ID → listed bytes
  const sidecarEtags = new Map<number, string | null>(); // physical photo ID → its listed sidecar's etag
  const families = new Set<number>();
  for (const object of await store.list()) {
    const match = QUEUE_OBJECT_RE.exec(object.path);
    if (!match) continue;
    const id = Number(match[1]);
    if (!validQueuePhotoId(id)) continue;
    families.add(originalId(id));
    if (match[2] === 'jpg') sizes.set(id, object.byteSize);
    else sidecarEtags.set(id, object.etag ?? null);
  }
  const listed: number[] = [];
  const sidecarOnly: number[] = [];
  for (const family of families) {
    (sizes.has(replacementId(family)) || sizes.has(family) ? listed : sidecarOnly).push(family);
  }
  const photos = new Map<number, QueuePhoto | null>();
  await Promise.all([
    eachBounded(listed, LISTING_META_CONCURRENCY, async (original) => {
      const replacement = replacementId(original);
      const photoId = sizes.has(replacement) ? replacement : original;
      photos.set(original, { id: original, photoId, size: sizes.get(photoId)!, meta: await familyMeta(original, photoId, store, sidecarEtags) });
    }),
    eachBounded(sidecarOnly, LISTING_LOCKED_CONCURRENCY, async (original) => {
      photos.set(original, await store.locked(original, () => selectedPhoto(original, store)));
    }),
  ]);
  return [...families].map((family) => photos.get(family)).filter((photo): photo is QueuePhoto => !!photo);
}

// Resolve either physical ID to the current family photo while holding the
// same lock as repair/discard. A disappeared photo is a real 404, not stale data.
export async function readQueuePhoto(id: number, store: QueueStore): Promise<{ photo: QueuePhoto; bytes: Buffer } | null> {
  const original = originalId(id);
  return store.locked(original, async () => {
    const photo = await selectedPhoto(original, store);
    if (!photo) return null;
    const bytes = await store.photo(path(photo.photoId, 'jpg'));
    return bytes ? { photo, bytes } : null;
  });
}

// Two devices can POST in the same millisecond. Probe all four family paths
// under the candidate's lock before assigning it, including orphan sidecars.
export async function enqueueQueuePhoto(
  firstId: number,
  jpeg: Buffer,
  requested: Pick<QueueMeta, 'name' | 'source'>,
  store: QueueStore,
): Promise<{ id: number } & QueueMeta> {
  for (let id = firstId; validQueuePhotoId(id); id++) {
    const inserted = await store.locked(id, async () => {
      for (const photoId of [id, replacementId(id)]) {
        for (const ext of ['jpg', 'json'] as const) {
          if (await store.exists(path(photoId, ext))) return null;
        }
      }
      const meta = { ...requested, addedAt: new Date(id).toISOString() };
      await store.put(path(id, 'jpg'), jpeg, 'image/jpeg');
      await store.put(path(id, 'json'), Buffer.from(JSON.stringify(meta, null, 2)), 'application/json');
      return { id, ...meta };
    });
    if (inserted) return inserted;
  }
  throw new Error('queue photo id space exhausted');
}

export async function repairQueuePhoto(
  id: number,
  jpeg: Buffer,
  requested: Pick<QueueMeta, 'name' | 'source'>,
  store: QueueStore,
  isHeic: (bytes: Buffer) => boolean,
): Promise<{ id: number } & QueueMeta> {
  const originalIdValue = originalId(id);
  return store.locked(originalIdValue, async () => {
    const next = replacementId(originalIdValue);
    const replacementPath = path(next, 'jpg');
    const replacementExists = await store.exists(replacementPath);
    const original = replacementExists ? null : await store.photo(path(originalIdValue, 'jpg'));
    if (!replacementExists && (!original || !isHeic(original))) {
      throw new Error(original ? 'repair source is not HEIC' : 'no such queued photo');
    }
    let meta = replacementExists ? await store.meta(path(next, 'json')) : null;
    if (!meta) {
      // A prior request may have written the JPEG and died before its sidecar.
      // The retry must finish that pair before it can acknowledge the repair.
      const old = await store.meta(path(originalIdValue, 'json'));
      meta = {
        name: requested.name,
        source: old?.source ?? requested.source,
        addedAt: old?.addedAt ?? new Date(originalIdValue).toISOString(),
      };
      if (!replacementExists) await store.put(replacementPath, jpeg, 'image/jpeg');
      await store.put(path(next, 'json'), Buffer.from(JSON.stringify(meta, null, 2)), 'application/json');
    }
    return { id: next, ...meta };
  });
}

export async function discardQueuePhoto(id: number, store: QueueStore): Promise<string[]> {
  const original = originalId(id);
  return store.locked(original, async () => {
    const removed: string[] = [];
    // Remove the original first. If a delete stops halfway through, every
    // surviving photo is still discoverable by the family listing.
    for (const photoId of [original, replacementId(original)]) {
      for (const ext of ['jpg', 'json'] as const) {
        const objectPath = path(photoId, ext);
        if (await store.remove(objectPath)) removed.push(objectPath.slice('dev-queue/'.length));
      }
    }
    return removed;
  });
}

export async function cleanupRepairedOriginal(id: number, store: QueueStore): Promise<string[]> {
  const original = originalId(id);
  return store.locked(original, async () => {
    const originalPath = path(original, 'jpg');
    const originalMetaPath = path(original, 'json');
    if (!(await store.exists(originalPath)) && !(await store.exists(originalMetaPath))) return [];
    const replacement = replacementId(original);
    if (!(await store.exists(path(replacement, 'jpg'))) || !(await store.meta(path(replacement, 'json')))) {
      throw new Error('replacement is incomplete');
    }
    const removed: string[] = [];
    for (const ext of ['jpg', 'json'] as const) {
      const objectPath = path(original, ext);
      if (await store.remove(objectPath)) removed.push(objectPath.slice('dev-queue/'.length));
    }
    return removed;
  });
}
