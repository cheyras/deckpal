export interface QueueMeta {
  name: string;
  source: 'camera' | 'upload';
  addedAt: string;
}

export interface QueueStore {
  locked<T>(id: number, work: () => Promise<T>): Promise<T>;
  exists(path: string): Promise<boolean>;
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

export async function repairQueuePhoto(
  id: number,
  jpeg: Buffer,
  requested: Pick<QueueMeta, 'name' | 'source'>,
  store: QueueStore,
  isHeic: (bytes: Buffer) => boolean,
): Promise<{ id: number } & QueueMeta> {
  return store.locked(id, async () => {
    const next = replacementId(id);
    const replacementPath = path(next, 'jpg');
    const replacementExists = await store.exists(replacementPath);
    const original = replacementExists ? null : await store.photo(path(id, 'jpg'));
    if (!replacementExists && (!original || !isHeic(original))) {
      throw new Error(original ? 'repair source is not HEIC' : 'no such queued photo');
    }
    let meta = replacementExists ? await store.meta(path(next, 'json')) : null;
    if (!meta) {
      // A prior request may have written the JPEG and died before its sidecar.
      // The retry must finish that pair before it can acknowledge the repair.
      const old = await store.meta(path(id, 'json'));
      meta = {
        name: requested.name,
        source: old?.source ?? requested.source,
        addedAt: old?.addedAt ?? new Date(id).toISOString(),
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
    // Delete the replacement first. If that fails, the original remains for a
    // retry; if it succeeds, a later repair must still see the original gone.
    for (const photoId of [replacementId(original), original]) {
      for (const ext of ['jpg', 'json'] as const) {
        const objectPath = path(photoId, ext);
        if (await store.remove(objectPath)) removed.push(objectPath.slice('dev-queue/'.length));
      }
    }
    return removed;
  });
}
