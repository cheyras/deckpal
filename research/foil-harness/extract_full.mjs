/**
 * Cut the narrated clips into labelled frames.
 *
 * One frame per second per segment (capped), cropped to the region the card
 * occupies. The crop is deliberately generous rather than tight: the hand moves,
 * and a crop that clips the card on some frames would put a different amount of
 * background into each measurement, which is exactly the kind of silent bias
 * that makes a separation look real when it is not.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'

const DIR = '/tmp/claude-1000/-home-cheyras/b64a0301-b0e7-4e67-976e-46366638fbd3/scratchpad/foil'
const SRC = '/home/cheyras/iPad'
const CROP = 'scale=1080:-1'
const MAX_PER_SEG = 15

const spec = JSON.parse(readFileSync(`${DIR}/segments.json`, 'utf8'))
mkdirSync(`${DIR}/full`, { recursive: true })

let n = 0
for (const clip of spec.clips) {
  for (const seg of clip.segments) {
    const span = seg.end - seg.start
    const step = Math.max(1, span / MAX_PER_SEG)
    for (let k = 0, t = seg.start; t < seg.end && k < MAX_PER_SEG; k++, t += step) {
      const out = `${DIR}/full/${seg.id}__${String(k).padStart(2, '0')}.png`
      if (existsSync(out)) { n++; continue }
      execFileSync('ffmpeg', [
        '-v', 'error', '-ss', t.toFixed(2), '-i', `${SRC}/${clip.file}`,
        '-frames:v', '1', '-vf', CROP, '-y', out,
      ])
      n++
    }
    process.stdout.write(`${seg.id} `)
  }
}
console.log(`\n${n} frames`)
