// pokedex dev hub — floating surface switcher. Served by tools/devhub/server.mjs at
// /switcher.js and injected into Vite DEV servers only (devhubSwitcher plugin in
// apps/web/vite.config.ts). Never present in a prod build.
(() => {
  if (window.__pokedexSwitcher) return;
  window.__pokedexSwitcher = true;

  const hub = new URL(document.currentScript?.src ?? 'http://localhost:3999/').origin;

  const css = `
  #pdx-sw-btn{position:fixed;right:max(14px,env(safe-area-inset-right));
    bottom:max(14px,env(safe-area-inset-bottom));width:48px;height:48px;border-radius:50%;
    background:#1e2230;color:#aecbff;border:1px solid #3a4570;font-size:22px;line-height:46px;
    text-align:center;z-index:2147483000;box-shadow:0 4px 14px rgba(0,0,0,.45);cursor:pointer;
    user-select:none;-webkit-tap-highlight-color:transparent}
  #pdx-sw-bg{position:fixed;inset:0;background:rgba(10,12,18,.6);z-index:2147483001}
  #pdx-sw-panel{position:fixed;right:10px;bottom:max(72px,calc(env(safe-area-inset-bottom) + 60px));
    max-height:70vh;overflow:auto;width:min(320px,calc(100vw - 20px));background:#15181f;
    color:#e6e9ef;border:1px solid #2c3245;border-radius:14px;padding:12px;
    z-index:2147483002;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  #pdx-sw-panel h3{margin:2px 4px 10px;font-size:13px;color:#8b93a7;font-weight:600}
  .pdx-sw-card{border:1px solid #2c3245;border-radius:10px;padding:8px 10px;margin-bottom:8px}
  .pdx-sw-card.cur{border-color:#5b79c7}
  .pdx-sw-branch{font-size:11px;color:#8b93a7;font-family:ui-monospace,monospace}
  .pdx-sw-label{font-weight:600;margin:1px 0 6px}
  .pdx-sw-page{display:inline-block;background:#2b3350;color:#aecbff;text-decoration:none;
    padding:6px 11px;border-radius:7px;margin:0 6px 4px 0;font-size:13px}
  .pdx-sw-hub{display:block;text-align:center;color:#8b93a7;font-size:12px;
    text-decoration:none;padding:6px 0 2px}`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement('div');
  btn.id = 'pdx-sw-btn';
  btn.textContent = '◐';
  btn.title = 'dev surfaces';
  document.body.appendChild(btn);

  let open = null;
  const esc = (x) => { const d = document.createElement('i'); d.textContent = String(x ?? ''); return d.innerHTML; };

  const close = () => { open?.bg.remove(); open?.panel.remove(); open = null; };

  btn.addEventListener('click', async () => {
    if (open) return close();
    let surfaces = [];
    try {
      surfaces = (await (await fetch(hub + '/surfaces.json')).json()).surfaces ?? [];
    } catch { /* hub down — show the link anyway */ }
    const host = location.hostname;
    const bg = document.createElement('div');
    bg.id = 'pdx-sw-bg';
    bg.addEventListener('click', close);
    const panel = document.createElement('div');
    panel.id = 'pdx-sw-panel';
    panel.innerHTML =
      '<h3>Dev surfaces</h3>' +
      (surfaces.map((s) => {
        const cur = String(s.port) === location.port;
        return '<div class="pdx-sw-card' + (cur ? ' cur' : '') + '">' +
          '<div class="pdx-sw-branch">' + esc(s.branch) + '</div>' +
          '<div class="pdx-sw-label">' + esc(s.label) + '</div>' +
          (s.pages || []).map((p) =>
            '<a class="pdx-sw-page" href="' +
            (p.url || ('http://' + host + ':' + s.port + (p.path || '/'))) + '">' +
            esc(p.name) + '</a>').join('') +
          '</div>';
      }).join('') || '<div class="pdx-sw-card">No surfaces registered.</div>') +
      '<a class="pdx-sw-hub" href="' + hub + '/">open dev hub ↗</a>';
    document.body.appendChild(bg);
    document.body.appendChild(panel);
    open = { bg, panel };
  });
})();
