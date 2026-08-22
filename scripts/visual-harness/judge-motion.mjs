#!/usr/bin/env node
/**
 * Judge what a recording or a screenshot actually shows.
 *
 * A vision model cannot watch a `.webm`, so a video argument is first turned
 * into a contact sheet — an evenly-spaced grid of frames in time order — which
 * is how motion becomes legible to it. Give it a `.png`/`.jpg` and it judges
 * that image directly.
 *
 * Two modes:
 *
 *   --describe "<question>"   prose answer. For exploring: "what changes?"
 *   --assert   "<claim>"      JSON verdict + exit code. For gating.
 *
 * `--assert` exits 0 on pass, 1 on fail, 2 on unclear, so it composes into a
 * script. Treat a failure as a reason to go and look at the artifact yourself,
 * not as a fact — see `lib/judge.mjs` for why.
 *
 * Examples:
 *
 *   node scripts/visual-harness/judge-motion.mjs .visual-harness/run/open.webm \
 *     --assert "the character starts absent, scales up from nothing, then travels across the screen"
 *
 *   node scripts/visual-harness/judge-motion.mjs .visual-harness/run/chat.png \
 *     --describe "Which direction is the 3D character facing relative to the text input?"
 *
 *   node scripts/visual-harness/judge-motion.mjs before.png after.png \
 *     --assert "the overlay in the second image is more blurred and darker than in the first"
 *
 * Requires ffmpeg for video input (FFMPEG_PATH / FFPROBE_PATH override the
 * defaults) and AI_GATEWAY_API_KEY for the model call.
 */
import { mkdirSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { buildContactSheet } from './lib/contact-sheet.mjs'
import { judge, assertVisual, judgeAvailability, DEFAULT_JUDGE_MODEL } from './lib/judge.mjs'

const VIDEO_EXT = new Set(['.webm', '.mp4', '.mov', '.mkv'])

/**
 * Exit codes.
 *
 * UNAVAILABLE is deliberately distinct from FAIL and from ERROR. A collaborator
 * with no vision model must be able to run the harness, get the artifact, and
 * have a calling script tell the difference between "the change is wrong" and
 * "nobody checked" — collapsing those two is how an unverified change gets
 * recorded as a passing one.
 */
const EXIT = { PASS: 0, FAIL: 1, UNCLEAR: 2, UNAVAILABLE: 3, ERROR: 4 }

/**
 * Set the exit code and let the event loop drain, rather than calling
 * `process.exit()`.
 *
 * `process.exit()` here ABORTS the process on Windows —
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c` —
 * because Node's `fetch` leaves a pooled keep-alive socket open, and tearing
 * the loop down underneath it trips a libuv assertion. The process then dies
 * with 127 instead of the verdict's own code, which silently breaks any script
 * that branches on the exit status. Found by testing the exit code rather than
 * assuming it. Setting `exitCode` lets the socket close on its own and
 * preserves the code.
 */
function finish(code) {
  process.exitCode = code
}

function usage(message) {
  if (message) console.error(`judge-motion: ${message}\n`)
  console.error(
    [
      'Usage:',
      '  node scripts/visual-harness/judge-motion.mjs <file...> --describe "<question>"',
      '  node scripts/visual-harness/judge-motion.mjs <file...> --assert   "<claim>"',
      '',
      'Files may be videos (.webm/.mp4/.mov/.mkv) or images (.png/.jpg/.webp/.gif).',
      'Videos are converted to a contact sheet first.',
      '',
      'Options:',
      '  --frames <n>     frames in the contact sheet (default 9)',
      '  --tile <px>      width of each tile (default 320)',
      '  --context <s>    what the images are, if not self-evident',
      '  --model <id>     gateway model id (default ' + DEFAULT_JUDGE_MODEL + ')',
      '  --out <dir>      where contact sheets are written (default alongside the video)',
      '  --require-judge  treat a missing vision model as an error, not a skip',
      '',
      'Exit codes: 0 pass, 1 fail, 2 unclear, 3 no vision model configured, 4 error.',
      '',
      'The vision model is OPTIONAL. Without AI_GATEWAY_API_KEY this still builds the',
      'contact sheet, tells you where it is, and exits 3 so a caller can tell',
      '"nobody checked" apart from "the change is wrong".',
    ].join('\n'),
  )
  return null
}

/** @returns {null | {files:string[],mode:string,text:string,frames:number,tile:number,context:string,model:string,outDir:string|null}} */
function parseArgs(argv) {
  if (!argv.length) return usage()

  const files = []
  let mode = null
  let text = ''
  let frames = 9
  let tile = 320
  let context = ''
  let model = DEFAULT_JUDGE_MODEL
  let outDir = null
  let requireJudge = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--describe' || a === '--assert') {
      mode = a.slice(2)
      text = argv[++i] ?? ''
    } else if (a === '--frames') frames = Number(argv[++i])
    else if (a === '--tile') tile = Number(argv[++i])
    else if (a === '--context') context = argv[++i] ?? ''
    else if (a === '--model') model = argv[++i] ?? model
    else if (a === '--out') outDir = argv[++i] ?? null
    else if (a === '--require-judge') requireJudge = true
    else if (a === '--help' || a === '-h') return usage()
    else if (a.startsWith('--')) return usage(`unknown option ${a}`)
    else files.push(a)
  }

  if (!files.length) return usage('no input file given')
  if (!mode) return usage('one of --describe or --assert is required')
  if (!text.trim()) return usage(`--${mode} needs a question or claim`)
  if (!Number.isFinite(frames) || frames < 2) return usage('--frames must be a number >= 2')

  return { files, mode, text, frames, tile, context, model, outDir, requireJudge }
}

/** Videos become contact sheets; images pass through unchanged. */
async function toImages(paths, { frames, tile, outDir }) {
  const out = []
  for (const path of paths) {
    if (!VIDEO_EXT.has(extname(path).toLowerCase())) {
      out.push(path)
      continue
    }
    const dir = outDir ?? join(path, '..')
    mkdirSync(dir, { recursive: true })
    const sheet = join(dir, `${basename(path, extname(path))}.contact-sheet.png`)
    let built
    try {
      built = await buildContactSheet(path, sheet, { frames, tileWidth: tile })
    } catch (err) {
      // ENOENT here almost always means ffmpeg is not where we looked, which is
      // a setup problem with an obvious fix — say so instead of showing a spawn
      // error from deep inside a promisified execFile.
      const hint = /ENOENT|not recognized|cannot find/i.test(err.message)
        ? '\nffmpeg/ffprobe were not found. Install ffmpeg, or set FFMPEG_PATH and FFPROBE_PATH.'
        : ''
      throw new Error(`could not build a contact sheet from ${path}: ${err.message}${hint}`)
    }
    console.error(
      `[contact sheet] ${built.frames} frames (${built.columns}x${built.rows}) ` +
        `over ${built.durationSec.toFixed(2)}s → ${built.path}`,
    )
    out.push(built.path)
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) return finish(EXIT.ERROR)

  const { files, mode, text, frames, tile, context, model, outDir, requireJudge } = args
  // Build the artifact FIRST, before checking whether a model is reachable.
  // Someone without a key still wants the contact sheet — that is the whole
  // point of degrading rather than refusing.
  const images = await toImages(files, { frames, tile, outDir })
  const fromVideo = files.some((f) => VIDEO_EXT.has(extname(f).toLowerCase()))

  const availability = judgeAvailability()
  if (!availability.available) {
    console.error(availability.reason)
    console.error('\nLook at these yourself:')
    for (const img of images) console.error(`  ${img}`)
    if (requireJudge) {
      console.error('\n--require-judge was set, so this is an error.')
      return finish(EXIT.ERROR)
    }
    return finish(EXIT.UNAVAILABLE)
  }

  if (mode === 'describe') {
    const seq =
      images.length > 1
        ? 'The images are in the order listed. '
        : fromVideo
          ? 'This is a contact sheet: frames in time order, left to right, top to bottom. '
          : ''
    const prompt =
      (context ? `Context: ${context}\n` : '') +
      seq +
      'Describe only what is actually visible.\n\n' +
      text
    const { text: answer, model: used, usd } = await judge({ images, prompt, model })
    process.stdout.write(answer.trim() + '\n')
    console.error(`[judge] model=${used}${usd != null ? ` cost=$${usd.toFixed(4)}` : ''}`)
    return finish(EXIT.PASS)
  }

  const ctx =
    context ||
    (fromVideo
      ? 'A contact sheet of frames from a screen recording, in time order (left to right, top to bottom).'
      : '')
  const result = await assertVisual({ images, claim: text, context: ctx, model })

  console.log(JSON.stringify(result, null, 2))
  console.error(
    `[judge] ${result.verdict.toUpperCase()} model=${result.model}` +
      (result.usd != null ? ` cost=$${result.usd.toFixed(4)}` : ''),
  )
  return finish(
    result.verdict === 'pass' ? EXIT.PASS : result.verdict === 'fail' ? EXIT.FAIL : EXIT.UNCLEAR,
  )
}

try {
  await main()
} catch (err) {
  console.error(`judge-motion: ${err.message}`)
  finish(EXIT.ERROR)
}
