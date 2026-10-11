// THE VIRTUAL PHONE — a video file standing in for the device's camera stream.
//
// The engine never sees "a video frame". It sees a camera STREAM of some size,
// takes that stream's centre square (frame.squareCrop), and works on the square:
// the model input, the refiner's working image, the reticle and the full-res
// capture buffer are all functions of the square and of nothing else
// (frame.ts header, the 2026-09-04 ruling). So the only honest way to point the
// engine at a video is to make the video LOOK LIKE A STREAM first, and then let
// the engine's own crop do the rest.
//
// THE STREAM WE PRETEND TO BE: 960x1280 portrait. That is what the owner's phone
// actually delivers — every scan-telemetry record with a `stream` field says
// `{"width":960,"height":1280}` — from camera.ts's `{ width: { ideal: 1280 },
// height: { ideal: 960 } }` request, rotated to portrait by the OS.
//
// HOW A VIDEO FRAME BECOMES THAT STREAM: the LARGEST CENTRED 3:4 PORTRAIT crop
// of the frame, resized to 960x1280. For a 9:16 short that is the full width
// and a centred band of the height; for a 16:9 landscape clip it is the full
// height and a centred column. Then `squareCrop(960, 1280)` — the engine's own
// function — takes the centre 960x960, which is the only part the engine reads.
//
// WHAT THIS DOES NOT MODEL, stated so nobody mistakes it for a person aiming a
// phone: the virtual phone is BOLTED TO THE CENTRE OF THE VIDEO. A user lines
// the card up with the reticle they can see; this camera points wherever the
// video's author pointed theirs. A card revealed off-centre in the source frame
// is a card the phone was never aimed at.
//
// RESOLUTION, ALSO STATED: most shorts are 608x1080, so the square the engine
// reads is 608 px of real detail upsampled to 960 — less than a phone's sensor
// gives it. The engine path is identical; the pixels behind it are softer.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { squareCrop, type SquareCrop } from '../../../apps/web/src/scan/engine/frame'

/** The device's portrait stream (scan telemetry `stream`, camera.ts:41). */
export const STREAM_W = 960
export const STREAM_H = 1280

export interface PhoneGeometry {
  /** Source video frame, post-rotation (what ffmpeg's filters see). */
  srcW: number
  srcH: number
  /** The 3:4 portrait viewport in SOURCE pixels. */
  viewport: { x: number; y: number; w: number; h: number }
  /** frame.squareCrop of the virtual stream — the engine's own crop. */
  square: SquareCrop
  /** Source pixels per stream pixel (1 / upscale). */
  srcPerStream: number
  /** How many REAL source pixels span the square the engine reads. */
  nativeSquarePx: number
  /** Set when the phone is AIMED (`--aim`): the engine square's SOURCE rect.
   *  The decoder then crops it directly instead of going through the viewport. */
  aim?: { x: number; y: number; side: number }
}

/** Largest centred 3:4 portrait crop, even-sized (yuv420 crops want it). */
export function phoneGeometry(srcW: number, srcH: number): PhoneGeometry {
  const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
  let w: number
  let h: number
  if (srcW / srcH > 3 / 4) {
    h = even(srcH)
    w = even((srcH * 3) / 4)
  } else {
    w = even(srcW)
    h = Math.min(even((srcW * 4) / 3), even(srcH))
  }
  const viewport = { x: even((srcW - w) / 2), y: even((srcH - h) / 2), w, h }
  const square = squareCrop(STREAM_W, STREAM_H)
  const srcPerStream = w / STREAM_W
  return { srcW, srcH, viewport, square, srcPerStream, nativeSquarePx: Math.round(square.size * srcPerStream) }
}

/**
 * THE PHONE, AIMED. `phoneGeometry` bolts the camera to the frame's centre, so
 * a creator who holds every card low in a landscape frame (WuheDPVq_Bo: the
 * card's bottom edge sits ~120 source px BELOW the centre square, in the part of
 * the stream the engine never reads) is replayed as a user who never pointed the
 * phone at the card. This places the engine square at a chosen SOURCE square
 * (x, y, side), clamped inside the frame, as a user aiming at that spot would.
 * It is a fixed aim for the whole video, not a per-card one: nobody re-aims per
 * card, and a per-card aim would be ground truth leaking into the replay.
 *
 * Only the square matters to the engine (frame.ts), so the stream around it is
 * reported, not decoded: `viewport` is the 3:4 portrait the square would sit
 * centred in, which may extend past the frame.
 */
export function aimedGeometry(srcW: number, srcH: number, aim: { x: number; y: number; side: number }): PhoneGeometry {
  const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
  const side = even(Math.min(aim.side, srcW, srcH))
  const x = even(Math.min(Math.max(aim.x, 0), srcW - side))
  const y = even(Math.min(Math.max(aim.y, 0), srcH - side))
  const square = squareCrop(STREAM_W, STREAM_H)
  const srcPerStream = side / square.size
  const viewport = { x: x - square.x * srcPerStream, y: y - square.y * srcPerStream, w: STREAM_W * srcPerStream, h: STREAM_H * srcPerStream }
  return { srcW, srcH, viewport, square, srcPerStream, nativeSquarePx: side, aim: { x, y, side } }
}

/** Canonical/crop-space point -> source-video pixel, for reporting only. */
export function cropToSource(g: PhoneGeometry, p: readonly [number, number]): [number, number] {
  return [g.viewport.x + (g.square.x + p[0]) * g.srcPerStream, g.viewport.y + (g.square.y + p[1]) * g.srcPerStream]
}

export function ffmpegPath(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG
  const hint = path.join(os.homedir(), 'deckpal-data', 'cc-videos', 'ffmpeg-path.txt')
  if (fs.existsSync(hint)) {
    const p = fs.readFileSync(hint, 'utf8').trim()
    if (p && fs.existsSync(p)) return p
  }
  return 'ffmpeg'
}

/** Source dimensions after ffmpeg's autorotation, plus duration — parsed from
 *  `ffmpeg -i`, because only ffmpeg's own view of the stream is the one its
 *  crop filter will apply to. */
export async function probeVideo(file: string): Promise<{ width: number; height: number; durationS: number; fps: number }> {
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', () => resolve(err))
  })
  const v = out.match(/Stream #\S+.*Video:.*?\b(\d{2,5})x(\d{2,5})\b/)
  if (!v) throw new Error(`could not read video dimensions from ffmpeg for ${file}`)
  let width = Number(v[1])
  let height = Number(v[2])
  const rot = out.match(/rotation of (-?[\d.]+) degrees/) ?? out.match(/rotate\s*:\s*(-?\d+)/)
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width]
  const d = out.match(/Duration: (\d+):(\d+):([\d.]+)/)
  const durationS = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : NaN
  const f = out.match(/, ([\d.]+) fps/)
  return { width, height, durationS, fps: f ? Number(f[1]) : NaN }
}

export interface StreamFrame {
  /** 0-based detect tick index. */
  index: number
  /** Video time of the frame, ms — the replay's clock (see README "Clock"). */
  tMs: number
  /** The FULL-RES centre square of the virtual stream, RGBA — exactly what
   *  index.ts grabCaptureFrame() blits into the capture buffer. */
  square: { width: number; height: number; data: Uint8ClampedArray }
}

/**
 * Decode at the detect cadence and yield the engine's centre square per tick.
 *
 * ffmpeg's `fps` filter does the sampling: output frame i is the source frame
 * nearest t = start + i / fps, so tick i happens at exactly i / fps of video
 * time. The filter chain is the virtual phone in one line: portrait viewport ->
 * 960x1280 stream -> the engine's own squareCrop of that stream.
 */
export async function* streamSquares(
  file: string,
  g: PhoneGeometry,
  opts: { fps: number; startS?: number; endS?: number },
): AsyncGenerator<StreamFrame> {
  const { viewport: v, square: s } = g
  // Aimed: the square's source rect straight to the square's size — the same
  // lanczos scale factor the viewport route applies, minus the stream around it.
  const vf = (
    g.aim
      ? [`fps=${opts.fps}`, `crop=${g.aim.side}:${g.aim.side}:${g.aim.x}:${g.aim.y}`, `scale=${s.size}:${s.size}:flags=lanczos`, 'format=rgba']
      : [
          `fps=${opts.fps}`,
          `crop=${v.w}:${v.h}:${v.x}:${v.y}`,
          `scale=${STREAM_W}:${STREAM_H}:flags=lanczos`,
          `crop=${s.size}:${s.size}:${s.x}:${s.y}`,
          'format=rgba',
        ]
  ).join(',')
  const args = ['-v', 'error']
  if (opts.startS) args.push('-ss', String(opts.startS))
  args.push('-i', file)
  if (opts.endS) args.push('-t', String(opts.endS - (opts.startS ?? 0)))
  args.push('-an', '-sn', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1')
  const proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? 0)))

  const frameBytes = s.size * s.size * 4
  let cur = Buffer.allocUnsafe(frameBytes)
  let filled = 0
  let index = 0
  const t0 = (opts.startS ?? 0) * 1000
  for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
    let off = 0
    while (off < chunk.length) {
      const n = Math.min(frameBytes - filled, chunk.length - off)
      chunk.copy(cur, filled, off, off + n)
      filled += n
      off += n
      if (filled === frameBytes) {
        yield {
          index,
          tMs: t0 + (index * 1000) / opts.fps,
          square: { width: s.size, height: s.size, data: new Uint8ClampedArray(cur.buffer, cur.byteOffset, frameBytes) },
        }
        index++
        cur = Buffer.allocUnsafe(frameBytes)
        filled = 0
      }
    }
  }
  const code = await exited
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`)
}
