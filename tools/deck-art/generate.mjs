#!/usr/bin/env node
/**
 * Generate the deck-box art library (library.mjs) with the Codex CLI's image
 * generation tool, one Codex session per family, a few sessions at a time.
 *
 *   node tools/deck-art/generate.mjs [--only <id-prefix>] [--out <dir>] [--jobs 4]
 *
 * Raw PNGs land in <out>/<id>.png (default `.deck-art-raw/`, gitignored), with
 * <out>/generation.json recording, for each id: the prompt, the Codex model,
 * the image tool Codex reported, the session's own file path and the time.
 * process.mjs reads that file to write the shipped MANIFEST.json.
 *
 * Needs a logged-in Codex CLI (`codex login`) with image generation enabled.
 * The user config is skipped (--ignore-user-config) so a stale default model
 * or an unrelated MCP server cannot break a run; auth still comes from
 * CODEX_HOME. Codex saves generated images under
 * ~/.codex/generated_images/<session>/; it cannot write into this repo from
 * its sandbox on Windows, so this script copies the files it reports.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIBRARY } from './library.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const OUT = path.resolve(arg('--out', path.join(REPO, '.deck-art-raw')))
const ONLY = arg('--only', '')
const JOBS = Number(arg('--jobs', '4'))
const MODEL = process.env.CODEX_MODEL || 'gpt-6-astra'
fs.mkdirSync(OUT, { recursive: true })

const RECORD = path.join(OUT, 'generation.json')
const record = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : {}
const save = () => fs.writeFileSync(RECORD, JSON.stringify(record, null, 2))

const todo = LIBRARY.filter((a) => a.id.startsWith(ONLY) && !fs.existsSync(path.join(OUT, `${a.id}.png`)))
const groups = new Map()
for (const a of todo) {
  const k = `${a.layer}-${a.family}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(a)
}

function sessionPrompt(items) {
  const shape = items[0].layer === 'box' ? 'a SQUARE image' : 'a LANDSCAPE 3:2 image'
  return [
    'You are producing images for a design library. Use your image generation tool once per item below,',
    `in order, each time creating ${shape} from that item's PROMPT exactly as written.`,
    'Do not run shell commands and do not try to copy, move or edit any files.',
    'When every image has been generated, reply with exactly one line per item, in the form',
    '`ID=<id> PATH=<absolute path of the saved image file>`, and nothing else.',
    '',
    ...items.map((a) => `ITEM ${a.id}\nPROMPT: ${a.prompt}\n`),
  ].join('\n')
}

function runCodex(prompt, logFile) {
  return new Promise((resolve) => {
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-m', MODEL,
      '-c', 'model_reasoning_effort="low"', '-s', 'read-only', '-C', OUT, '-']
    const child = spawn('codex', args, { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => {
      fs.writeFileSync(logFile, out)
      resolve({ code, out })
    })
    child.stdin.end(prompt)
  })
}

async function runGroup(key, items) {
  const started = new Date().toISOString()
  const { code, out } = await runCodex(sessionPrompt(items), path.join(OUT, `${key}.log`))
  const tool = /image_gen[\w-]*/.exec(out)?.[0] ?? 'codex image_generation'
  let got = 0
  for (const a of items) {
    const m = [...out.matchAll(new RegExp(`ID=${a.id}\\s+PATH=([^\\r\\n]+)`, 'g'))].pop()
    const src = m?.[1]?.trim().replace(/^`|`$/g, '')
    if (!src || !fs.existsSync(src)) continue
    const dest = path.join(OUT, `${a.id}.png`)
    fs.copyFileSync(src, dest)
    record[a.id] = {
      prompt: a.prompt,
      tool: `Codex CLI (codex exec) ${process.env.CODEX_VERSION ?? ''}`.trim(),
      model: MODEL,
      imageTool: tool,
      generatedAt: started,
      codexFile: src,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'),
    }
    got++
  }
  save()
  console.log(`${key}: ${got}/${items.length} (exit ${code})`)
}

const queue = [...groups.entries()]
await Promise.all(
  Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) {
      const [k, items] = queue.shift()
      await runGroup(k, items)
    }
  }),
)
const missing = LIBRARY.filter((a) => a.id.startsWith(ONLY) && !fs.existsSync(path.join(OUT, `${a.id}.png`)))
console.log(missing.length ? `missing: ${missing.map((a) => a.id).join(', ')}` : 'all generated')
