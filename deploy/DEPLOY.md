# pokedex — deployment runbook (Phase 7)

The lead executes these steps **by hand**. Nothing here was activated while the artifacts
were prepared: no `/etc/` file was edited, no `pm2 start/save/restart` was run, and nginx
and dnsmasq were not reloaded or restarted. This document is written to be run literally,
in order. Each stage is independent and independently reversible; stop after any stage.

**Golden rule (project CLAUDE.md):** six pm2 services and Gitea depend on this nginx and
this box. Never reload nginx or restart dnsmasq without the user's explicit OK.

Prefix every command with `rtk` per the user's global convention.

---

## What was already done (safe, no shared infra touched)

- Built all backend apps (`@pokedex/db`, `pokedex-api`, `pokedex-images`, `pokedex-sync`)
  and the production frontend. `pokedex-sync` had **no `dist/` before** and now builds
  cleanly; the other three already had `dist/` and were rebuilt to be current.
- Frontend: `apps/web/dist` (644 KB), base `/pokedex/` baked into `index.html`
  (`/pokedex/assets/index-*.js`). JS 116 KB gzip.
- Smoke-tested the two servers on localhost (then stopped them, ports freed):
  `GET /pokedex/api/health` → 200, `/pokedex/api/series` → 200,
  `/pokedex/images/en/base/base1/004/high.webp` → 200 image/webp. The old
  `/api/pokedex/...` path → 404, confirming the previous draft fragment was wrong.

The superseded draft `deploy/nginx/thegrid-pokedex.conf` was **removed** in this commit:
it used the wrong API prefix (`/api/pokedex/`) and proxied `/pokedex/` to :3700 for the
SPA, which the API does not serve. Use the fragments in this directory instead.

---

## Pre-flight (read-only, run anytime)

```bash
rtk pm2 list                                   # confirm the six existing apps are online
rtk ss -tln | grep -E ':3700|:3701' || echo "3700/3701 free"   # must be free
rtk psql -U pokedex -h 127.0.0.1 -d pokedex -c 'select 1'      # DB reachable with .env creds
rtk nginx -t                                   # current config is valid BEFORE we touch it
```

---

## Stage A — pm2 (pokedex-api, pokedex-images, pokedex-sync)

Runs as its **own** app list; it is **not** merged into thegrid-api's ecosystem.

**Apply**
```bash
rtk pm2 start /home/cheyras/pokedex/deploy/ecosystem.pokedex.cjs
rtk pm2 save                                   # persist across reboot (updates the dump)
```

**Verify**
```bash
rtk pm2 list                                   # pokedex-api / -images / -sync all "online"
rtk ss -tln | grep -E ':3700|:3701'            # both now LISTEN on 127.0.0.1
rtk curl -s http://127.0.0.1:3700/pokedex/api/health          # {"status":"ok","db":"up",...}
rtk curl -s http://127.0.0.1:3701/api/pokedex/images/health   # {"status":"ok",...}
rtk pm2 logs pokedex-sync --lines 20 --nostream               # "pokedex-sync up. sync_run rows: N"
# Existing services untouched — connections stay within budget:
rtk psql -U pokedex -h 127.0.0.1 -d pokedex -c \
  "select application_name, count(*) from pg_stat_activity where usename='pokedex' group by 1"
# expect pokedex-api ≤2, pokedex-sync ≤1  (hard cap 3 total)
```

**Rollback**
```bash
rtk pm2 delete pokedex-api pokedex-images pokedex-sync
rtk pm2 save
rtk ss -tln | grep -E ':3700|:3701' || echo "ports freed"
```

---

## Stage B — filesystem permission for nginx static serving (do BEFORE Stage C)

⚠ **This is the non-obvious blocker.** `/home/cheyras` is `700 cheyras:cheyras`, so the
nginx worker (`www-data`) cannot traverse into it — the `/pokedex/` `alias` block would
return **403 Forbidden** for every asset. Everything *below* home is already
world-readable (`apps/web/dist` dirs `775`, files `664`), so the **only** thing missing is
a traverse (`x`) grant on the home directory itself. Grant it scoped to `www-data` (an ACL,
not a `chmod 755` — that would open home traversal to every local user):

**Apply**
```bash
rtk sudo setfacl -m u:www-data:x /home/cheyras
```

**Verify**
```bash
rtk sudo -u www-data test -r /home/cheyras/pokedex/apps/web/dist/index.html \
  && echo "www-data CAN read the SPA" || echo "STILL BLOCKED — do not proceed to Stage C"
```

**Rollback**
```bash
rtk sudo setfacl -x u:www-data /home/cheyras
```

Notes:
- This survives future frontend rebuilds: Vite writes world-readable files, and the home
  dir is not recreated. (If a rebuild ever produces non-world-readable files, re-run
  `chmod -R o+rX /home/cheyras/pokedex/apps/web/dist`.)
- Alternative if ACLs are undesirable: copy the build to a path nginx already reads
  (`rtk sudo rsync -a --delete /home/cheyras/pokedex/apps/web/dist/ /var/www/pokedex/`)
  and change the `alias` in both nginx fragments to `/var/www/pokedex/`. That trades the
  ACL for a copy step on every deploy.

---

## Stage C — nginx location blocks

Do Stage A and Stage B first (the blocks proxy to :3700/:3701 and serve from dist).

**Apply — LAN vhost**
Add one line inside the `server{}` block of `/etc/nginx/sites-available/thegrid`:
```
include /home/cheyras/pokedex/deploy/nginx-thegrid-pokedex.conf;
```
(or paste the file's three blocks directly).

**Apply — public vhost**
Add one line inside the `:443 server{}` block of `/etc/nginx/sites-available/brain-public`,
after its existing `include .../authelia-authrequest.conf;` line:
```
include /home/cheyras/pokedex/deploy/nginx-brain-public-pokedex.conf;
```

**Verify config, THEN reload**
```bash
rtk nginx -t                                   # must say "syntax is ok / test is successful"
rtk sudo systemctl reload nginx               # reload (not restart) — graceful, keeps connections
```

**Verify pokedex + that nothing else regressed**
```bash
# pokedex over LAN (plaintext):
rtk curl -s -H 'Host: thegrid' http://127.0.0.1/pokedex/api/health         # {"status":"ok"...}
rtk curl -sI -H 'Host: thegrid' http://127.0.0.1/pokedex/ | head -1        # 200
rtk curl -s  -H 'Host: thegrid' http://127.0.0.1/pokedex/set/base1 | grep -o '/pokedex/assets/[^"]*' | head -1
#   ^ deep client route must return the SPA shell (index.html referencing /pokedex/assets/…),
#     NOT a 404 — this is the alias+try_files check.
rtk curl -sI -H 'Host: thegrid' http://127.0.0.1/pokedex/assets/ 2>/dev/null # a real asset → 200

# Existing LAN services still serve (spot-check a few):
rtk curl -sI -H 'Host: thegrid' http://127.0.0.1/git/       | head -1
rtk curl -sI -H 'Host: thegrid' http://127.0.0.1/lumina/    | head -1
rtk curl -sI -H 'Host: thegrid' http://127.0.0.1/colorsplash/ | head -1
rtk curl -s  -H 'Host: thegrid' http://127.0.0.1/api/fuel/ -o /dev/null -w '%{http_code}\n'

# Public vhost: pokedex should 302 to the Authelia portal when unauthenticated (gate works):
rtk curl -sI https://cheyrasnet.tplinkdns.com/pokedex/ | grep -iE 'HTTP/|location'
#   expect 302 → /authelia/?rd=…   (same as /git/ and /lumina/)
```
Then load `https://cheyrasnet.tplinkdns.com/pokedex/` in a real browser (log in via
Authelia) and click through series → set → binder → card to confirm the SPA, API, and
images all resolve behind the gate. **UI is not "done" until seen in the browser.**

**Rollback**
```bash
# Remove the include line (or the pasted blocks) from each vhost, then:
rtk nginx -t && rtk sudo systemctl reload nginx
```

---

## Stage D — split-horizon DNS (LAN HTTPS / secure context for the PWA)

Independent of the above; only needed for the PWA/offline requirement on the LAN. Because
it changes DNS for **every** service at that hostname, record current resolution first.

**Record (before)**
```bash
rtk dig +short cheyrasnet.tplinkdns.com @127.0.0.1        # note the current answer (public WAN IP)
rtk cat /etc/resolv.conf                                   # note which resolver LAN clients use
```

**Apply**
```bash
rtk sudo cp /home/cheyras/pokedex/deploy/dnsmasq-pokedex.conf /etc/dnsmasq.d/pokedex.conf
rtk sudo systemctl restart dnsmasq            # dnsmasq has no reload; restart is required
```

**Verify**
```bash
rtk dig +short cheyrasnet.tplinkdns.com @127.0.0.1        # must now be 192.168.68.76
rtk systemctl status dnsmasq --no-pager | head -5          # active (running), no parse errors
# From a LAN client, https://cheyrasnet.tplinkdns.com/pokedex/ should load with a VALID cert
# (Let's Encrypt), i.e. a secure context — check the browser padlock + no cert warning.
# Confirm the other public services still resolve/serve from the LAN too (they now take the
# LAN path and traverse Authelia): open /git/, /lumina/ over that hostname from a LAN client.
```

**Rollback**
```bash
rtk sudo rm /etc/dnsmasq.d/pokedex.conf
rtk sudo systemctl restart dnsmasq
rtk dig +short cheyrasnet.tplinkdns.com @127.0.0.1        # back to the recorded public IP
```

---

## Risks / things to watch (called out honestly)

1. **SPA `alias` + `try_files` (moderate confidence).** The directives are the standard,
   alias-safe subpath form: the fallback `/pokedex/index.html` is an absolute URI, so it
   does an internal redirect that re-enters `location /pokedex/` and resolves via the alias
   — it does *not* hit the historical alias+try_files document-root bug (which only bites
   when the fallback is a relative path). The explicit check is the Stage C
   `/pokedex/set/base1` curl: if that returns the app shell, the pattern is correct on
   this nginx build. If it 404s, switch the fallback to a named location:
   `location @pokedex_spa { rewrite ^ /pokedex/index.html break; root /home/cheyras/pokedex/apps/web/dist; }`
   and `try_files $uri $uri/ @pokedex_spa;` — but the current form is expected to work.
2. **The www-data traverse ACL (Stage B) is a real prerequisite, not optional.** Without
   it the SPA is 403. It was verified that www-data currently *cannot* read the dist.
3. **Authelia turns 401 into a 302 to the portal**, including for `/pokedex/api/*` XHR and
   for static assets once a session expires. This matches every other gated SPA on the box
   and is fine now, but revisit when the service worker / offline layer lands — a redirected
   asset or API fetch can poison a naive SW cache.
4. **Stage D widens LAN reach to all of brain-public** and routes LAN clients through
   Authelia for that hostname. Confirm that is acceptable, or add a deliberate LAN bypass —
   don't let it happen by accident.
5. **Reboot persistence.** `pm2 save` (Stage A) persists the process list only if pm2's
   systemd startup unit is already installed (it is, for the existing services). The nginx
   `include` and the dnsmasq drop-in persist as ordinary config files.
