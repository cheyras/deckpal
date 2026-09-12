import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const WEB = path.join(ROOT, 'apps/web')
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 180_000, ...options })
  assert.equal(result.status, 0, command + ' ' + args.join(' ') + '\n' + result.stdout + result.stderr + (result.error ?? ''))
  return result.stdout
}
export function isolatedEnv(extra = {}) {
  // Do not inherit VITE_*, DATABASE_URL, PG*, Supabase or model credentials.
  return Object.fromEntries(Object.entries({
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    SYSTEMROOT: process.env.SYSTEMROOT, CI: '1', NODE_ENV: 'production', ...extra,
  }).filter(([, v]) => v !== undefined))
}
export function refuseEnvFiles() {
  for (const dir of [ROOT, WEB]) {
    for (const name of fs.readdirSync(dir)) {
      assert.ok(!name.startsWith('.env') || name === '.env.example',
        'Browser builds refuse local environment files: ' + path.join(dir, name) + '. Use a clean checkout; no file contents were read.')
    }
  }
}
export function buildWeb(dist, cloud, cloudOrigin = 'https://fixture.supabase.invalid') {
  refuseEnvFiles()
  return run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'),
    'build', '--outDir', dist, '--emptyOutDir'], { cwd: WEB, env: isolatedEnv(cloud ? {
      VITE_SUPABASE_URL: cloudOrigin, VITE_SUPABASE_ANON_KEY: 'synthetic-public-test-key',
    } : { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }) })
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
export async function serve(dist, mount, respondApi, html = 'index.html') {
  const requests = [], unexpected = [], stubbedThirdParty = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push(url.pathname)
    const reject = (why, status = 404) => { unexpected.push(why); res.writeHead(status); res.end(why) }
    if (!['GET', 'HEAD'].includes(req.method)) return reject('Unexpected method ' + req.method, 405)
    if (mount && url.pathname !== mount && !url.pathname.startsWith(mount + '/')) return reject('Outside mount: ' + url.pathname)
    const rel = decodeURIComponent(url.pathname.slice(mount.length))
    const response = respondApi(rel, url)
    if (response || rel.startsWith('/api/')) {
      if (!response) return reject('Unexpected API: ' + rel)
      res.writeHead(response.status ?? 200, { 'Content-Type': response.type ?? 'application/json' })
      res.end(response.raw ?? JSON.stringify(response.body))
      return
    }
    let file = path.resolve(dist, '.' + rel)
    if (!file.startsWith(dist + path.sep)) return reject('Path outside fixture output', 403)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) return reject('Missing asset: ' + rel)
      file = path.join(dist, html)
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { requests, unexpected, stubbedThirdParty, origin: 'http://127.0.0.1:' + server.address().port,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
export async function contextFor(browser, server, width) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 },
    timezoneId: 'America/Denver', locale: 'en-US', serviceWorkers: 'block', reducedMotion: 'reduce' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === server.origin && ['GET', 'HEAD'].includes(route.request().method())) return route.continue()
    // Stripe's installed loader eagerly inserts this script on public pages.
    // Fulfill this one known SDK locally; never permit third-party network.
    if (url.href === 'https://js.stripe.com/dahlia/stripe.js' && route.request().resourceType() === 'script') {
      server.stubbedThirdParty.push(url.href)
      return route.fulfill({ contentType: 'text/javascript', body: 'window.Stripe = function () { return {}; };' })
    }
    server.unexpected.push('Blocked non-fixture request: ' + url.origin + url.pathname)
    return route.abort()
  })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-09-12T18:00:00Z'))
  page.on('pageerror', error => server.unexpected.push('Page error: ' + error.message))
  return { context, page }
}
