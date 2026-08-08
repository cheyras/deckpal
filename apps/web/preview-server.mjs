// Preview server: serves the built SPA under /deckscout/ and proxies
// /deckscout/api → :3700 and /deckscout/images → :3701, mirroring nginx.
// SPA fallback to /deckscout/index.html for client routes. Dev/screenshot use only.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const PORT = 5199
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon',
}

function proxy(req, res, target) {
  const opts = new URL(target)
  const upstream = { hostname: opts.hostname, port: opts.port, path: req.url, method: req.method, headers: req.headers }
  import('node:http').then(({ request }) => {
    const p = request(upstream, (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    })
    p.on('error', (e) => { res.writeHead(502); res.end('proxy error: ' + e.message) })
    req.pipe(p)
  })
}

createServer(async (req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/deckscout/api')) return proxy(req, res, 'http://127.0.0.1:3700')
  if (url.startsWith('/deckscout/images')) return proxy(req, res, 'http://127.0.0.1:3701')

  let path = url.split('?')[0]
  if (path === '/' || path === '/pokedex' || path === '/deckscout/') path = '/deckscout/index.html'
  path = path.replace(/^\/deckscout/, '')
  let file = join(DIST, path)
  try {
    const s = await stat(file)
    if (s.isDirectory()) throw new Error('dir')
  } catch {
    file = join(DIST, 'index.html') // SPA fallback
  }
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch (e) {
    res.writeHead(404); res.end('not found')
  }
}).listen(PORT, '127.0.0.1', () => console.log(`preview on http://127.0.0.1:${PORT}/deckscout/`))
