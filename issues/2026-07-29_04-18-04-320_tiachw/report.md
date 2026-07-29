---
id: 2026-07-29_04-18-04-320_tiachw
status: resolved
resolvedAt: 2026-07-29T07:14:34.274Z
resolution: Root-caused the iOS focus-zoom: form controls now render at 16px on mobile (theme.css @media ≤1068px) so Safari never auto-zooms; added overflow-x/overscroll guards + viewport-fit=cover for a native feel. Verified mobile input font-size = 16px, no horizontal drift.
createdAt: 2026-07-29T04:18:04.321Z
page: /pokedex/scan
viewport: 401x451
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: (none)
---

I keep getting this behavior throughout the site where when I like focus on a text box or something and there’s maybe some other triggers for it as well but it’ll slightly zoom in on the page which then kind of throws everything off and makes it so that I can like scroll to the side and things and it just sucks. We need to have this be feeling a bit more like a native Mobile sort of experience.
