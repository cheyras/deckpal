# issues/

In-app bug reports submitted via the top-nav **Report a bug** button. Each report is a
folder written by `POST /deckscout/api/bugs` (see `apps/api/src/routes/bugs.ts`):

```
issues/<id>/
  report.md        # YAML frontmatter (status, page, viewport, userAgent, screenshot) + the comment
  screenshot.jpg   # what the user was looking at when they hit the button (deleted on resolve)
```

`report.md` frontmatter:

```yaml
---
id: 2026-07-29_14-30-00-123_ab12cd
status: open            # open | resolved
createdAt: 2026-07-29T14:30:00.123Z
page: /deckscout/series/mega-evolution/me05
viewport: 1280x900
userAgent: Mozilla/5.0 …
screenshot: screenshot.jpg
---

<the user's description>
```

**To work through these**, run the project skill **`fix-issues`**: it fixes each open
issue, verifies it thoroughly (including a visual browser check), then deletes the
screenshot and flips `status` to `resolved`. This folder is intentionally version-controlled
so reports live in the codebase.
