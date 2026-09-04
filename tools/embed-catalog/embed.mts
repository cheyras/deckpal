// tools/embed-catalog — fill `card_embedding` from the cached card art.
//
// Run:
//   node --import tsx tools/embed-catalog/embed.mts --dry-run
//   node --import tsx tools/embed-catalog/embed.mts --local-out .cache/embeddings
//   node --import tsx tools/embed-catalog/embed.mts            # WRITES TO POSTGRES
//
// ── WHAT THIS IS THE SIBLING OF ──────────────────────────────────────────────
//
// `apps/api/src/scan/index.ts` (the dHash indexer) and this job do the same
// thing to the same files and are shaped alike on purpose: resumable by
// default, one pooled connection, batched upserts, gentle enough to run beside
// live traffic (contracts B2 and B8). Where they differ, the difference is
// deliberate and commented.
//
// The big one: this job does NOT compute the vector itself. The tensor is
// produced by `embed_worker.py`, because the parity-tested implementation of
// the input spec lives there and a second one here would defeat the entire
// point of having a spec. See that file's header.
//
// ── THE THREE MODES, AND WHY --local-out EXISTS ──────────────────────────────
//
//   default      embed and UPSERT into card_embedding.
//   --dry-run    do everything except the write, and say what it would have
//                written. Answers "is the model loading, is the art where I
//                think it is, how long will this take" without a schema.
//   --local-out  write vectors to <dir>/<stamp>.jsonl instead of the database.
//                This is what makes the job runnable before migration 048 is
//                applied — which matters because the migration is an operator
//                decision (B9) and this job is the thing that proves the
//                pipeline works before anybody is asked to make it.
//
// ── RESUMABILITY IS BY STAMP, NOT BY CARD ────────────────────────────────────
//
// The default target set is "cards with no vector FOR THIS STAMP", so a model
// change re-embeds everything without `--force` and a re-run after a crash
// embeds only the remainder. Same rule the phash indexer applies to `algo`, and
// the same reason: a stale row must be invisible rather than silently wrong
// (contract B5's corollary).

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makePool } from '../../packages/db/dist/index.js'
import { EMBED_MODEL_ID, embedStamp, toPgVector } from '../../packages/matching/dist/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

// Same default and the same env var as the phash indexer, because it is the
// same cache. A path that differs between the two jobs would mean two indexes
// built from two sets of bytes, which is the sort of thing nobody notices until
// the match rates disagree.
const CACHE_ROOT = process.env.IMAGE_CACHE_ROOT ?? '/home/cheyras/pokedex/cache'
const LANG = 'en'

interface Args {
  quality: 'low' | 'high'
  force: boolean
  limit: number | null
  sets: string[]
  dryRun: boolean
  localOut: string | null
  model: string
  python: string
  batch: number
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    quality: 'low',
    force: false,
    limit: null,
    sets: [],
    dryRun: false,
    localOut: null,
    // Not committed: an ONNX checkpoint is tens of megabytes and the repo does
    // not carry binaries. README.md says how to produce it.
    model: process.env.EMBED_MODEL_PATH ?? join(REPO, '.cache', 'models', `${EMBED_MODEL_ID}.onnx`),
    python: process.env.PYTHON ?? 'python',
    batch: 200,
  }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    const next = (): string => argv[++i] ?? ''
    if (t === '--quality') a.quality = next() === 'high' ? 'high' : 'low'
    else if (t === '--force') a.force = true
    else if (t === '--limit') a.limit = Number(next()) || null
    else if (t === '--dry-run') a.dryRun = true
    else if (t === '--local-out') a.localOut = next()
    else if (t === '--model') a.model = next()
    else if (t === '--python') a.python = next()
    else if (t === '--set') {
      let peek = argv[i + 1]
      while (peek !== undefined && !peek.startsWith('--')) {
        a.sets.push(peek)
        i++
        peek = argv[i + 1]
      }
    }
  }
  return a
}

/**
 * The slice of `pg.Pool` this job uses.
 *
 * Structural rather than imported: `tools/` is not a workspace package, so it
 * has no `@types/pg` of its own, and this script is run with tsx rather than
 * compiled. Naming the two methods it actually calls is also a smaller promise
 * than the whole client, and it is what a future reader has to read.
 */
interface QueryablePool {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  end(): Promise<void>
}

interface Target {
  card_id: string
  serie: string
  set: string
  local_id: string
}

/** Local path is a pure function of (serie, set, localId, quality), matching
 *  apps/images/src/layout.ts. Replicated from the phash indexer rather than
 *  imported for the same reason it gives: no cross-app dependency for one
 *  `join`. Read-only. */
function cardPath(t: Target, quality: string): string {
  return join(CACHE_ROOT, 'images', LANG, t.serie, t.set, `${t.local_id}.${quality}.webp`)
}

async function fetchTargets(pool: QueryablePool, args: Args, stamp: string): Promise<Target[]> {
  const params: unknown[] = []
  let sql = `
    SELECT c.id::text AS card_id, ser.tcgdex_id AS serie, cs.tcgdex_id AS set, c.local_id
      FROM card c
      JOIN card_set cs ON cs.id = c.set_id
      JOIN series ser  ON ser.id = cs.series_id`
  const where: string[] = []
  if (!args.force) {
    params.push(args.quality)
    sql += `\n LEFT JOIN card_embedding ce ON ce.card_id = c.id AND ce.quality = $${params.length}`
    params.push(stamp)
    sql += ` AND ce.stamp = $${params.length}`
    where.push('ce.card_id IS NULL')
  }
  if (args.sets.length) {
    params.push(args.sets)
    where.push(`cs.tcgdex_id = ANY($${params.length})`)
  }
  if (where.length) sql += `\n WHERE ${where.join(' AND ')}`
  sql += `\n ORDER BY c.id`
  if (args.limit) sql += `\n LIMIT ${Number(args.limit)}`
  const { rows } = await pool.query<Target>(sql, params)
  return rows
}

/**
 * The Python worker, as a duplex of JSON lines.
 *
 * One long-lived process for the whole run: loading an ONNX session costs more
 * than embedding several hundred images, so per-batch spawning would spend most
 * of the run in startup. The worker announces `{ready, stamp}` before accepting
 * work, and this refuses to proceed if its stamp is not ours — a driver writing
 * rows labelled with a stamp the embedder did not produce is the one failure
 * mode that would not show up until a scan came back wrong.
 */
async function startWorker(args: Args, stamp: string) {
  if (!existsSync(args.model)) {
    throw new Error(
      `no model at ${args.model}. Export it first (tools/embed-catalog/README.md), or pass --model / EMBED_MODEL_PATH. ` +
        'This job will not fall back to another checkpoint: a catalogue embedded with the wrong model is worse than an empty one, ' +
        'because it looks finished.',
    )
  }
  const child = spawn(
    args.python,
    [join(HERE, 'embed_worker.py'), '--model', args.model, '--margin', '0'],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  const lines = createInterface({ input: child.stdout })
  const iter = lines[Symbol.asyncIterator]()

  const first = await iter.next()
  if (first.done) throw new Error('embed_worker exited before reporting ready')
  const hello = JSON.parse(first.value as string) as { ready?: boolean; stamp?: string; fatal?: string }
  if (hello.fatal) throw new Error(`embed_worker: ${hello.fatal}`)
  if (!hello.ready) throw new Error(`embed_worker said something unexpected: ${first.value}`)
  if (hello.stamp !== stamp) {
    child.kill()
    throw new Error(
      `stamp mismatch: this job writes '${stamp}', the worker produces '${hello.stamp}'. ` +
        'The TypeScript and Python halves of packages/matching have drifted — run both parity suites.',
    )
  }
  return { child, iter }
}

interface Row {
  cardId: string
  vector: number[]
}

async function flush(
  pool: QueryablePool,
  quality: string,
  stamp: string,
  batch: Row[],
): Promise<void> {
  if (!batch.length) return
  const values: string[] = []
  const params: unknown[] = [quality, stamp]
  for (const r of batch) {
    params.push(r.cardId, toPgVector(r.vector))
    const i = params.length
    values.push(`($${i - 1}::bigint, $1, $2, $${i}::vector)`)
  }
  await pool.query(
    `INSERT INTO card_embedding (card_id, quality, stamp, embedding) VALUES ${values.join(', ')}
       ON CONFLICT (card_id, quality, stamp)
       DO UPDATE SET embedding = EXCLUDED.embedding, computed_at = now()`,
    params,
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const stamp = embedStamp(EMBED_MODEL_ID)
  const pool = makePool(1)
  const t0 = Date.now()
  let out: import('node:fs').WriteStream | null = null
  if (args.localOut) {
    mkdirSync(args.localOut, { recursive: true })
    out = createWriteStream(join(args.localOut, `${stamp.replace(':', '_')}.jsonl`))
  }

  try {
    const targets = await fetchTargets(pool, args, stamp)
    console.log(
      `[embed-catalog] stamp=${stamp} quality=${args.quality} force=${args.force}` +
        (args.sets.length ? ` sets=${args.sets.join(',')}` : '') +
        (args.dryRun ? ' DRY RUN' : '') +
        (args.localOut ? ` local-out=${args.localOut}` : '') +
        `\n[embed-catalog] ${targets.length} card(s) to embed`,
    )
    if (!targets.length) return

    const { child, iter } = await startWorker(args, stamp)
    const byPath = new Map<string, Target>()
    let missing = 0
    for (const t of targets) {
      const p = cardPath(t, args.quality)
      // Same silent skip the phash indexer performs, and the same reason it is
      // COUNTED: 967 catalogue cards have no art at all in any approved source
      // (p2-work/art-sweep/SWEEP.md), so "missing" is an expected number and a
      // run that reports zero of them is the surprising one.
      if (!existsSync(p)) {
        missing++
        continue
      }
      byPath.set(p, t)
    }

    let done = 0
    let embedded = 0
    let failed = 0
    const batch: Row[] = []
    const paths = [...byPath.keys()]

    // Feed the worker without waiting for each answer: it is a pipeline, and
    // blocking per image would idle the ONNX session between reads. The backlog
    // is bounded by the batch size below rather than by the OS pipe buffer.
    const feed = (async () => {
      for (const p of paths) {
        if (!child.stdin.write(`${p}\n`)) {
          await new Promise((r) => child.stdin.once('drain', r))
        }
      }
      child.stdin.end()
    })()

    for await (const line of { [Symbol.asyncIterator]: () => iter }) {
      const rec = JSON.parse(line as string) as { path?: string; vector?: number[]; error?: string }
      done++
      if (rec.error || !rec.path || !rec.vector) {
        failed++
        if (failed <= 5) console.warn(`[embed-catalog] ${rec.path ?? '?'}: ${rec.error ?? 'no vector'}`)
      } else {
        const t = byPath.get(rec.path)
        if (t) {
          embedded++
          if (out) out.write(`${JSON.stringify({ cardId: t.card_id, stamp, vector: rec.vector })}\n`)
          else batch.push({ cardId: t.card_id, vector: rec.vector })
        }
      }
      if (batch.length >= args.batch && !args.dryRun) {
        await flush(pool, args.quality, stamp, batch.splice(0, batch.length))
      }
      if (done % 1000 === 0) {
        const rate = done / ((Date.now() - t0) / 1000)
        console.log(
          `[embed-catalog] ${done}/${paths.length} (${rate.toFixed(1)}/s, embedded=${embedded} failed=${failed})`,
        )
      }
    }
    await feed
    if (!args.dryRun && !args.localOut) await flush(pool, args.quality, stamp, batch)

    const secs = (Date.now() - t0) / 1000
    console.log(
      `[embed-catalog] done in ${secs.toFixed(1)}s: embedded=${embedded} missing-art=${missing} failed=${failed}`,
    )
    if (args.dryRun) {
      console.log('[embed-catalog] DRY RUN — nothing was written.')
    } else if (args.localOut) {
      console.log(`[embed-catalog] wrote vectors to ${args.localOut}; nothing was written to Postgres.`)
    } else {
      const cov = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM card_embedding WHERE stamp = $1 AND quality = $2',
        [stamp, args.quality],
      )
      console.log(`[embed-catalog] coverage: ${cov.rows[0]?.n ?? '?'} card(s) have a '${stamp}' vector`)
    }
  } finally {
    out?.end()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[embed-catalog]', err instanceof Error ? err.message : err)
  process.exit(1)
})
