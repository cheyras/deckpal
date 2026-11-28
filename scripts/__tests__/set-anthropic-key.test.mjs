// pnpm ai:set-anthropic-key — logic only. A FAKE key throughout; `vercel` is a
// recording stub, the Anthropic check is a stub, and .env lives in a temp dir.
// Nothing here touches Vercel, Anthropic, or the repo's own .env.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { addArgs, envNames, keyProblem, main, realIo, redact, upsertEnvLine } from '../set-anthropic-key.mjs'

const FAKE = 'sk-ant-api03-FAKEfakeFAKEfakeFAKEfake_0123456789-abcdef'

test('key format', () => {
  assert.equal(keyProblem(FAKE), null)
  assert.match(keyProblem(''), /no key/)
  assert.match(keyProblem('sk-proj-123'), /sk-ant-/)
  assert.match(keyProblem('sk-ant-admin01-aaaaaaaaaaaaaaaaaaaaaaaa'), /Admin/)
  assert.match(keyProblem('sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaa'), /OAuth/)
  assert.match(keyProblem(`${FAKE} `), /whitespace/)
  assert.match(keyProblem('sk-ant-short'), /too short/)
})

test('.env upsert: creates, replaces in place, dedupes, keeps every other line and CRLF', () => {
  assert.deepEqual(upsertEnvLine('', FAKE), { content: `ANTHROPIC_API_KEY=${FAKE}\n`, action: 'created' })
  assert.equal(upsertEnvLine('A=1', FAKE).content, `A=1\nANTHROPIC_API_KEY=${FAKE}\n`)
  const before = 'A=1\nANTHROPIC_API_KEY=old\nB=2\nexport ANTHROPIC_API_KEY=older\nC=3\n'
  const after = upsertEnvLine(before, FAKE)
  assert.equal(after.action, 'updated')
  assert.equal(after.content, `A=1\nANTHROPIC_API_KEY=${FAKE}\nB=2\nC=3\n`)
  assert.equal(upsertEnvLine('X=1\r\nANTHROPIC_API_KEY=old\r\nY=2\r\n', FAKE).content, `X=1\r\nANTHROPIC_API_KEY=${FAKE}\r\nY=2\r\n`)
  // A different variable that merely contains the name is not touched.
  assert.equal(upsertEnvLine('MY_ANTHROPIC_API_KEY=x\n', FAKE).content, `MY_ANTHROPIC_API_KEY=x\nANTHROPIC_API_KEY=${FAKE}\n`)
})

test('vercel arguments never contain the value; Development is not Sensitive', () => {
  assert.deepEqual(addArgs('production', false), ['env', 'add', 'ANTHROPIC_API_KEY', '--environment', 'production', '--sensitive', '--yes'])
  assert.deepEqual(addArgs('preview', true), ['env', 'add', 'ANTHROPIC_API_KEY', '--environment', 'preview', '--sensitive', '--force', '--yes'])
  assert.ok(addArgs('development', false).includes('--no-sensitive'))
  assert.deepEqual([...envNames(' name   value  environments\n ANTHROPIC_API_KEY  Encrypted  Production\n OTHER Encrypted Production\n')].sort(), ['ANTHROPIC_API_KEY', 'OTHER'])
  assert.equal(redact(`oops ${FAKE} leaked`, FAKE), 'oops [redacted] leaked')
})

function harness({ answers = [], listings = {}, whoami = 0, linked = true, ignored = true, check = { ok: true }, addStatus = 0, envContent } = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), 'deckpal-key-'))
  if (linked) { mkdirSync(path.join(repo, '.vercel')); writeFileSync(path.join(repo, '.vercel', 'project.json'), '{}') }
  if (envContent !== undefined) writeFileSync(path.join(repo, '.env'), envContent, { mode: 0o640 })
  const logs = []
  const vercel = []
  const queue = [...answers]
  const io = {
    ...realIo,
    repo,
    readSecret: async () => FAKE,
    ask: async () => queue.shift() ?? '',
    checkWithAnthropic: async (key) => { assert.equal(key, FAKE); return check },
    gitIgnored: () => ignored,
    runVercel: (args, input) => {
      vercel.push({ args, input })
      if (args[0] === 'whoami') return { status: whoami, stdout: 'someone', stderr: '' }
      if (args[1] === 'ls') return { status: 0, stdout: listings[args[3]] ?? ' name value environments\n', stderr: '' }
      return { status: addStatus, stdout: '', stderr: addStatus ? `Error: something about ${input}` : '' }
    },
    log: (line) => logs.push(line),
  }
  return { io, repo, logs, vercel }
}

const noKeyAnywhere = (h) => {
  assert.equal(h.logs.join('\n').includes(FAKE), false, 'the key is never printed')
  for (const call of h.vercel) assert.equal(call.args.join(' ').includes(FAKE), false, 'the key is never an argument')
}

test('happy path: .env created 0600, production added via stdin, redeploy instructions printed', async () => {
  const h = harness({ answers: ['y', 'n', 'n'] })
  assert.equal(await main([], h.io), 0)
  assert.equal(readFileSync(path.join(h.repo, '.env'), 'utf8'), `ANTHROPIC_API_KEY=${FAKE}\n`)
  if (process.platform !== 'win32') assert.equal(statSync(path.join(h.repo, '.env')).mode & 0o777, 0o600)
  const adds = h.vercel.filter((c) => c.args[1] === 'add')
  assert.equal(adds.length, 1)
  assert.deepEqual(adds[0].args, addArgs('production', false))
  assert.equal(adds[0].input, FAKE, 'the value goes on stdin')
  const out = h.logs.join('\n')
  assert.match(out, /\.env — ANTHROPIC_API_KEY line created/)
  assert.match(out, /Vercel production — ANTHROPIC_API_KEY added/)
  assert.match(out, /vercel redeploy/)
  assert.match(out, /aiRoute/)
  noKeyAnywhere(h)
})

test('existing value: asks before replacing, uses --force, keeps other .env lines and mode', async () => {
  const h = harness({
    answers: ['n', 'y', 'n', 'y', 'y'], // no check; preview yes; dev no; replace prod yes; replace preview yes
    listings: { production: ' ANTHROPIC_API_KEY Encrypted Production\n', preview: ' ANTHROPIC_API_KEY Encrypted Preview\n' },
    envContent: 'DATABASE_URL=postgres://x\nANTHROPIC_API_KEY=old\n',
  })
  assert.equal(await main([], h.io), 0)
  assert.equal(readFileSync(path.join(h.repo, '.env'), 'utf8'), `DATABASE_URL=postgres://x\nANTHROPIC_API_KEY=${FAKE}\n`)
  if (process.platform !== 'win32') assert.equal(statSync(path.join(h.repo, '.env')).mode & 0o777, 0o640)
  const adds = h.vercel.filter((c) => c.args[1] === 'add').map((c) => c.args)
  assert.deepEqual(adds, [addArgs('production', true), addArgs('preview', true)])
  assert.match(h.logs.join('\n'), /Vercel production — ANTHROPIC_API_KEY replaced/)
  noKeyAnywhere(h)
})

test('declining a replace keeps the Vercel value; .env is still written', async () => {
  const h = harness({ answers: ['n', 'n', 'n', 'n'], listings: { production: ' ANTHROPIC_API_KEY Encrypted Production\n' } })
  assert.equal(await main([], h.io), 0)
  assert.equal(h.vercel.filter((c) => c.args[1] === 'add').length, 0)
  assert.match(h.logs.join('\n'), /kept the existing value/)
  assert.doesNotMatch(h.logs.join('\n'), /redeploy/)
})

test('dry run writes nothing and runs no vercel write', async () => {
  const h = harness({ answers: ['y', 'y', 'y'] })
  assert.equal(await main(['--dry-run'], h.io), 0)
  assert.throws(() => readFileSync(path.join(h.repo, '.env')))
  assert.equal(h.vercel.some((c) => c.args[1] === 'add' || c.args[1] === 'rm' || c.args[1] === 'remove'), false)
  assert.equal(h.vercel.filter((c) => c.args[1] === 'ls').length, 3)
  assert.match(h.logs.join('\n'), /Would run: vercel env add ANTHROPIC_API_KEY --environment production --sensitive --yes/)
  noKeyAnywhere(h)
})

test('a bad key, a failed check, an un-ignored .env, no login and no link all stop safely', async () => {
  const bad = harness()
  bad.io.readSecret = async () => 'sk-proj-nope'
  assert.equal(await main([], bad.io), 1)
  assert.equal(bad.vercel.length, 0)

  const failed = harness({ answers: ['y', 'n'], check: { ok: false, why: 'HTTP 401' } })
  assert.equal(await main([], failed.io), 1)
  assert.match(failed.logs.join('\n'), /FAILED \(HTTP 401\)/)
  assert.throws(() => readFileSync(path.join(failed.repo, '.env')))

  const tracked = harness({ answers: ['n'], ignored: false })
  assert.equal(await main([], tracked.io), 1)
  assert.throws(() => readFileSync(path.join(tracked.repo, '.env')))

  const loggedOut = harness({ answers: ['n'], whoami: 1 })
  assert.equal(await main([], loggedOut.io), 0)
  assert.match(loggedOut.logs.join('\n'), /vercel login/)
  assert.equal(loggedOut.vercel.filter((c) => c.args[1] === 'add').length, 0)

  const unlinked = harness({ answers: ['n'], linked: false })
  assert.equal(await main([], unlinked.io), 0)
  assert.match(unlinked.logs.join('\n'), /vercel link --yes --scope deck-pal/)
})

test('a failing vercel add is reported with the key redacted from its output', async () => {
  const h = harness({ answers: ['n', 'n', 'n'], addStatus: 1 })
  assert.equal(await main([], h.io), 0)
  assert.match(h.logs.join('\n'), /Vercel production: FAILED — Error: something about \[redacted\]/)
  noKeyAnywhere(h)
})
