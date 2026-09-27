import { makeDeckPool } from './db.js';
import { indexIdenticalPrints } from './identicalPrintIndex.js';

const pool = makeDeckPool();
try {
  const result = await indexIdenticalPrints(pool);
  console.log(
    `[identical-prints] scanned ${result.scanned}; grouped ${result.grouped}; ` +
      `excluded promo ${result.excludedPromo}; too thin ${result.tooThin}; updated ${result.updated}`,
  );
} finally {
  await pool.end();
}
