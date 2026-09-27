export interface QueueMeta {
  name: string;
  source: 'camera' | 'upload';
  addedAt: string;
}

export interface QueueStore {
  locked<T>(id: number, work: () => Promise<T>): Promise<T>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number | null>;
  photo(path: string): Promise<Buffer | null>;
  meta(path: string): Promise<QueueMeta | null>;
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

async function selectedPhoto(id: number, store: QueueStore): Promise<QueuePhoto | null> {
  const original = originalId(id);
  const replacement = replacementId(original);
  const replacementSize = await store.size(path(replacement, 'jpg'));
  const originalSize = replacementSize === null ? await store.size(path(original, 'jpg')) : null;
  const photoId = replacementSize !== null ? replacement : originalSize !== null ? original : null;
  if (photoId === null) return null;
  const meta = await store.meta(path(photoId, 'json')) ?? await store.meta(path(original, 'json'));
  return {
    id: original,
    photoId,
    size: replacementSize ?? originalSize ?? 0,
    meta: meta ?? {
      name: `photo-${original}.jpg`,
      source: 'upload',
      addedAt: new Date(original).toISOString(),
    },
  };
}

// Object listings are only candidate discovery. Recheck both paths under the
// family's lock so a stale sidecar or a concurrent repair cannot hide a photo.
export async function listQueuePhotos(ids: Iterable<number>, store: QueueStore): Promise<QueuePhoto[]> {
  const families = [...new Set([...ids].filter(validQueuePhotoId).map(originalId))];
  const photos: Array<QueuePhoto | null> = new Array(families.length);
  let cursor = 0;
  // A listing contributes at most two lock requests at once. Another listing,
  // thumbnail, or mutation can enter the shared FIFO before this batch ends.
  await Promise.all(Array.from({ length: Math.min(2, families.length) }, async () => {
    while (cursor < families.length) {
      const index = cursor++;
      photos[index] = await store.locked(families[index]!, () => selectedPhoto(families[index]!, store));
    }
  }));
  return photos.filter((photo): photo is QueuePhoto => photo !== null);
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
