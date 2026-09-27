import type pg from 'pg';

// Wait outside pg.Pool.connect(): that pool has a 10-second checkout timeout,
// while a queued photo may hold its advisory lock through slow object storage.
// Passing the slot directly to the next waiter keeps the queue FIFO.
export function createQueueLocker(pool: pg.Pool, concurrency: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function locked<T>(id: number, work: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active++;
    }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [String(id)]);
        const result = await work();
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } finally {
      const next = waiters.shift();
      if (next) next();
      else active--;
    }
  };
}
