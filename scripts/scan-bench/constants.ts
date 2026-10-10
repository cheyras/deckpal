// Re-exported here so the benchmark reads the SHIPPING constants rather than
// copies: a bench that kept its own CONFIDENT_MAX would keep measuring the old
// gate after the product moved.
//
// `router.ts` imports the database client at module load, so its CONFIDENT_MAX
// is mirrored with a test-free literal and checked against the source text by
// `data.ts`'s `assertMirror` instead of importing the router (and Postgres).
export const CONFIDENT_MAX = 9
