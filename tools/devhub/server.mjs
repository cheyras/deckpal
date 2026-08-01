// pokedex dev hub — one LAN URL (http://the.grid:3999) that lists every in-flight
// dev surface (worktree branches, ports, pages) and serves the floating switcher
// script that Vite dev servers inject (see devhubSwitcher in apps/web/vite.config.ts).
//
// LAN-only by construction: ufw admits LAN to all ports; the router forwards only
// 80/443, and nginx has no route here. Zero dependencies; state is a JSON file at
// ~/.pokedex-devhub/surfaces.json (outside the repo so every worktree shares it).
//
// API:
//   GET  /               mobile menu page (bookmark on the phone)
//   GET  /surfaces.json  registry, CORS-open (the switcher fetches this cross-origin)
//   GET  /switcher.js    floating-button script, CORS-open
//   POST /register       upsert {branch, label, port, pages:[{name,path}]} by branch
//   POST /unregister     {branch}
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEVHUB_PORT ?? 3999);
const REG = join(homedir(), '.pokedex-devhub', 'surfaces.json');
const HERE = dirname(fileURLToPath(import.meta.url));

const PROD = {
  branch: 'main (prod)',
  label: 'Pokédex (live)',
  pinned: true,
  pages: [{ name: 'App', url: 'http://the.grid/pokedex/' }],
};

function loadSurfaces() {
  try {
    const list = JSON.parse(readFileSync(REG, 'utf8')).surfaces ?? [];
    return [PROD, ...list.filter((s) => !s.pinned)];
  } catch {
    return [PROD];
  }
}

function saveSurfaces(list) {
  mkdirSync(dirname(REG), { recursive: true });
  writeFileSync(REG, JSON.stringify({ surfaces: list.filter((s) => !s.pinned) }, null, 2) + '\n');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 65536) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const CORS = { 'access-control-allow-origin': '*' };

function menuPage() {
  // Links are built client-side from location.hostname so the.grid and raw-IP both work.
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>pokedex dev hub</title><style>
:root{color-scheme:dark}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#15181f;color:#e6e9ef;
  padding:max(16px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}
h1{font-size:18px;margin:8px 0 16px;display:flex;align-items:center;gap:8px}
.card{background:#1e2230;border:1px solid #2c3245;border-radius:12px;padding:14px 16px;margin-bottom:12px}
.branch{font-size:12px;color:#8b93a7;font-family:ui-monospace,monospace}
.label{font-weight:600;margin:2px 0 8px}
a.page{display:inline-block;background:#2b3350;color:#aecbff;text-decoration:none;
  padding:8px 14px;border-radius:8px;margin:0 8px 6px 0;font-size:14px}
a.page:active{background:#3a4570}
.empty{color:#8b93a7;font-size:14px}
footer{color:#5b6275;font-size:12px;margin-top:20px}
</style></head><body>
<h1>◐ pokedex dev hub</h1>
<div id="list"><p class="empty">Loading…</p></div>
<footer>Surfaces register via POST /register — see roadmap/ORCHESTRATION.md.</footer>
<script>
fetch('/surfaces.json').then(r=>r.json()).then(({surfaces})=>{
  const host=location.hostname;
  document.getElementById('list').innerHTML = surfaces.length ? surfaces.map(s=>
    '<div class="card"><div class="branch">'+esc(s.branch)+'</div>'+
    '<div class="label">'+esc(s.label)+'</div>'+
    (s.pages||[]).map(p=>'<a class="page" href="'+
      (p.url||('http://'+host+':'+s.port+(p.path||'/')))+'">'+esc(p.name)+'</a>').join('')+
    '</div>').join('') : '<p class="empty">No surfaces registered yet.</p>';
});
function esc(x){const d=document.createElement('i');d.textContent=String(x??'');return d.innerHTML}
</script></body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(menuPage());
    }
    if (req.method === 'GET' && url.pathname === '/surfaces.json') {
      res.writeHead(200, { 'content-type': 'application/json', ...CORS, 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ surfaces: loadSurfaces() }));
    }
    if (req.method === 'GET' && url.pathname === '/switcher.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', ...CORS, 'cache-control': 'no-store' });
      return res.end(readFileSync(join(HERE, 'switcher.js')));
    }
    if (req.method === 'POST' && (url.pathname === '/register' || url.pathname === '/unregister')) {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.branch) {
        res.writeHead(400, CORS);
        return res.end('{"error":"branch required"}');
      }
      const rest = loadSurfaces().filter((s) => !s.pinned && s.branch !== body.branch);
      saveSurfaces(url.pathname === '/register' ? [...rest, body] : rest);
      res.writeHead(200, { 'content-type': 'application/json', ...CORS });
      return res.end('{"ok":true}');
    }
    res.writeHead(404, CORS);
    res.end('not found');
  } catch (err) {
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`devhub listening on :${PORT}, registry ${REG}`));
