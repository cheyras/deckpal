// Tiny batch-insert helper shared by the catalog and dex importers: chunks the
// rows so one statement never exceeds pg's 65535-bind-parameter limit, builds
// the ($1,$2,…) placeholder tuples and splices them in for the caller's
// `__VALUES__` marker.
import type { Queryable } from '@deckpal/db';

export async function batchInsert(
  client: Queryable,
  sql: (rows: number) => string,
  cols: number,
  values: unknown[][],
  chunkRows = 400,
): Promise<void> {
  for (let i = 0; i < values.length; i += chunkRows) {
    const chunk = values.slice(i, i + chunkRows);
    const placeholders = chunk
      .map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`)
      .join(',');
    await client.query(sql(chunk.length).replace('__VALUES__', placeholders), chunk.flat());
  }
}
