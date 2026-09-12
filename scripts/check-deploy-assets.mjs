/**
 * Git's scratch ignore matcher checks the gitignore-compatible rules in both
 * files. This exercises upload selection, not the Vercel CLI or remote deploy.
 * Missing-exception and missing-built-asset controls mutate only owned scratch.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { UPCOMING_SETS } from '../apps/api/src/upcomingSets.ts'
import { ROOT, WEB, run, buildWeb, isolatedEnv } from '../tests/browser/support.mjs'

export function checkDeployAssets(dist) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-assets-'))
  const logos = [...new Set(UPCOMING_SETS.map(entry => entry.logoAssetPath)
    .filter(p => p && !p.startsWith('//') && !/^[a-z][a-z\d+.-]*:/i.test(p)))]
  const results = []
  try {
    const matcher = path.join(scratch, 'matcher')
    fs.mkdirSync(matcher)
    run('git', ['init', '-q', matcher])
    const ignored = file => {
      const result = spawnSync('git', ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '-q', file],
        { cwd: matcher, encoding: 'utf8' })
      assert.ok([0, 1].includes(result.status), result.stderr)
      return result.status === 0
    }
    const marketing = run('git', ['ls-files', 'apps/web/public/marketing/*.webp']).trim().split('\n').filter(Boolean)
    const character = run('git', ['ls-files', 'apps/web/public/models/decke/*.webp']).trim().split('\n').filter(Boolean)
    assert.ok(marketing.length && character.length, 'Existing marketing and character controls must be tracked')
    for (const ignoreFile of ['.gitignore', '.vercelignore']) {
      const source = fs.readFileSync(path.join(ROOT, ignoreFile), 'utf8')
      fs.writeFileSync(path.join(matcher, '.gitignore'), source)
      for (const logo of logos) {
        const rel = 'apps/web/public/' + logo.replace(/^\/+/, '')
        assert.ok(!rel.includes('..'), 'Unsafe local announcement asset path: ' + logo)
        run('git', ['ls-files', '--error-unmatch', rel])
        assert.ok(fs.statSync(path.join(ROOT, rel)).size > 0, 'Empty source asset: ' + rel)
        assert.equal(ignored(rel), false, ignoreFile + ' excludes ' + rel)
        // The exception must be precise, leaving unrelated brand/cache images out.
        const exception = '!' + rel
        assert.ok(source.split(/\r?\n/).includes(exception), ignoreFile + ' needs exact exception ' + exception)
        fs.writeFileSync(path.join(matcher, '.gitignore'), source.split(/\r?\n/).filter(line => line !== exception).join('\n'))
        assert.equal(ignored(rel), true, 'Negative control failed: removing ' + exception + ' from ' + ignoreFile + ' must exclude it')
        fs.writeFileSync(path.join(matcher, '.gitignore'), source)
        results.push({ case: 'upload-exception', ignoreFile, asset: rel, removedExceptionRejected: true })
      }
      for (const rel of [...marketing, ...character]) assert.equal(ignored(rel), false, ignoreFile + ' excludes shipped control ' + rel)
      for (const rel of ['apps/web/public/brand/unrelated-cache.webp', 'cache/probe.webp', 'assets/probe.webp'])
        assert.equal(ignored(rel), true, ignoreFile + ' unexpectedly includes cache ' + rel)
    }
    run(process.execPath, [path.join(WEB, 'scripts/check-precache.mjs'), dist], { env: isolatedEnv() })
    // Copy the real output, then omit each real announcement logo independently.
    const copied = path.join(scratch, 'dist')
    fs.cpSync(dist, copied, { recursive: true })
    for (const logo of logos) {
      const rel = logo.replace(/^\/+/, '')
      assert.deepEqual(fs.readFileSync(path.join(dist, rel)), fs.readFileSync(path.join(WEB, 'public', rel)),
        'Build changed announcement bytes: ' + logo)
      fs.rmSync(path.join(copied, rel))
      const result = spawnSync(process.execPath, [path.join(WEB, 'scripts/check-precache.mjs'), copied],
        { cwd: ROOT, env: isolatedEnv(), encoding: 'utf8' })
      assert.notEqual(result.status, 0, 'Missing built logo must fail the actual build gate')
      assert.ok((result.stdout + result.stderr).includes(logo), 'Gate must identify missing logo')
      assert.match(result.stderr, /\.vercelignore/, 'Gate must diagnose deployment filtering')
      fs.copyFileSync(path.join(dist, rel), path.join(copied, rel))
      results.push({ case: 'missing-built-asset', asset: logo, omittedAssetRejected: true })
    }
    return { logos, results, matcher: 'Git scratch gitignore semantics; Vercel CLI not invoked' }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-asset-build-'))
  try {
    const dist = path.join(scratch, 'dist')
    console.log(buildWeb(dist, false))
    const results = checkDeployAssets(dist)
    const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests'))
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'deploy-assets-results.json'), JSON.stringify(results, null, 2) + '\n')
    console.log('PASS deployment assets: ' + results.results.length + ' controls')
  } finally { fs.rmSync(scratch, { recursive: true, force: true }) }
}
