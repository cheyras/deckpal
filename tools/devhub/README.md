# dev hub

One LAN URL — **http://the.grid:3999** — listing every in-flight dev surface (worktree
branches → ports → pages) so Chey can hop between them from his phone. A floating ◐ button
(served here as `/switcher.js`, injected into Vite **dev** servers by the `devhubSwitcher`
plugin in `apps/web/vite.config.ts`) opens the same menu on any dev page.

- Runs under pm2 as `deckscout-devhub` (see `ecosystem.config.cjs`). Zero dependencies.
- LAN-only by construction: ufw admits LAN broadly; the router forwards only 80/443 and
  nginx has no route to :3999. Do not add one.
- Registry lives at `~/.deckscout-devhub/surfaces.json` (shared across worktrees, not in git).
- Register / unregister (see `roadmap/ORCHESTRATION.md` for the port table):

```bash
curl -s -X POST http://127.0.0.1:3999/register -H 'content-type: application/json' -d '{
  "branch": "foil/main", "label": "Foil workbench", "port": 5182,
  "pages": [{ "name": "Workbench", "path": "/deckscout/foil-lab" }]
}'
curl -s -X POST http://127.0.0.1:3999/unregister -d '{"branch":"foil/main"}'
```

The live app (`http://the.grid/deckscout/`) is pinned into the menu automatically.
