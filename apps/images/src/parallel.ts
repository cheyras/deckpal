/**
 * Bounded parallel map — the one worker-pool loop this app's bulk commands
 * share (warmer, set warmer, warm:gaps, manifest:backfill, storage:backfill).
 * Up to `width` workers pull the next index off a shared cursor, so at most
 * `width` calls to `fn` are outstanding at once and every item runs exactly
 * once. For network work the fetcher gate (≤5 req/s, ≤2 concurrent) is the
 * real limiter; this just keeps its queue fed.
 */
export async function parallelMap<T>(
  items: T[],
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      await fn(items[my]!);
    }
  });
  await Promise.all(workers);
}
