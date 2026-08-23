/**
 * Turn a video into one PNG grid of evenly-spaced frames — how a vision model
 * (which cannot watch a .webm) judges motion: entry/exit animation, a
 * character turning to face the camera, a panel sliding in.
 *
 * Uses the system ffmpeg/ffprobe (not a Playwright feature — Playwright only
 * records video, it does not do frame extraction or tiling). Not bundled with
 * this repo; point at the binaries via FFMPEG_PATH / FFPROBE_PATH or the
 * defaults below, which match this machine's WinGet install
 * (CLAUDE.local.md / the task brief).
 */
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const DEFAULT_FFMPEG =
  process.env.FFMPEG_PATH ??
  'C:/Users/cheyr/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe'
const DEFAULT_FFPROBE =
  process.env.FFPROBE_PATH ??
  'C:/Users/cheyr/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffprobe.exe'

async function probeDuration(videoPath, ffprobePath) {
  const { stdout } = await run(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ])
  const seconds = Number(stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned an unusable duration for ${videoPath}: "${stdout.trim()}"`)
  }
  return seconds
}

/**
 * @param {string} videoPath - source .webm/.mp4
 * @param {string} outPath - destination .png for the contact sheet
 * @param {object} [opts]
 * @param {number} [opts.frames=9] - how many evenly-spaced frames to tile
 * @param {number} [opts.tileWidth=320] - width of each frame in the grid, px
 * @param {string} [opts.ffmpegPath]
 * @param {string} [opts.ffprobePath]
 * @returns {Promise<{ path: string, frames: number, columns: number, rows: number, durationSec: number }>}
 */
export async function buildContactSheet(videoPath, outPath, opts = {}) {
  const {
    frames = 9,
    tileWidth = 320,
    ffmpegPath = DEFAULT_FFMPEG,
    ffprobePath = DEFAULT_FFPROBE,
  } = opts
  mkdirSync(dirname(outPath), { recursive: true })

  const durationSec = await probeDuration(videoPath, ffprobePath)
  const columns = Math.ceil(Math.sqrt(frames))
  const rows = Math.ceil(frames / columns)

  // fps = frames-wanted / duration spaces samples evenly across the clip's
  // full length. `select`-by-index would be more exact about the last frame,
  // but a constant-fps sample is the standard technique and is plenty
  // faithful for judging motion — the failure mode (off by one frame at the
  // very end) does not matter for "did the entry animation slide up or fade".
  const fps = frames / durationSec
  const filter = `fps=${fps.toFixed(4)},scale=${tileWidth}:-1,tile=${columns}x${rows}`

  await run(ffmpegPath, ['-y', '-i', videoPath, '-vf', filter, '-frames:v', '1', outPath])

  return { path: outPath, frames, columns, rows, durationSec }
}
