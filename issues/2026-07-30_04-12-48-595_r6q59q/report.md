---
id: 2026-07-30_04-12-48-595_r6q59q
status: resolved
resolvedAt: 2026-07-31T21:30:00.000Z
resolution: Mobile header row was hardcoded h-[99px] for 44px content (~27px dead space top+bottom); tightened to 64px across the four synced spots (header, content pt offset, safe-area calc, drawer top) in AppShell.tsx — desktop stays 78px, env(safe-area-inset-top) untouched. Verified on built app at 428+390+1440px.
createdAt: 2026-07-30T04:12:48.595Z
page: /pokedex/lists
viewport: 428x926
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

Make the top bar chrome not quite so tall on mobile. I don’t want it cramped but there’s a lot of extra unused space.
