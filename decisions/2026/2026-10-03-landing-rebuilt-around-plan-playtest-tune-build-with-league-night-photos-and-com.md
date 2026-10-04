---
date: "2026-10-03"
title: "Landing rebuilt around plan, playtest, tune, build with league-night photos and composited card art"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["web", "marketing", "seo", "images"]
supersedes: ["2026-09-29-landing-page-rewrite-real-card-art-one-shared-3d-scene-prerendered-copy"]
---
## 2026-10-03 — Landing rebuilt around plan, playtest, tune, build with league-night photos and composited card art
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The logged-out landing (`/`) is rebuilt from the owner's page map and copy. It replaces the unshipped 2026-09-29 version, which the owner did not like.

- **Story and order.** The sections are: hero, works with, the loop (plan, playtest, tune, build), one section per stage, ask it anything, give it a job, what else (a bento), built by a player (open source), connect (steps plus a compatibility table), FAQ and closing. DeckPal is presented as the companion to the visitor's own AI, never as an AI itself.
- **Photography instead of a 3D scene.** The three.js foil-card scene, the Foilkit shader copy and the six showcases are deleted, and the landing loads no three.js (vite.config's chunking is back to three inside `Decke-runtime`).
  - Eight league-night photographs carry the page. They are generated scenes (Gemini 3 Pro Image via the AI Gateway, `scripts/gen-landing-photos.mjs`) whose readable cards were generated blank. Real card art from DeckPal's image store is then composited onto those faces by `tools/landing-photos/composite.py`, which uses each blank face as its light map, so no card text on the page is model-generated.
  - Frozen specs make each final reproducible.
  - Provenance is in `public/marketing/landing/CREDITS.md`, and the footer says the photos are generated scenes with real card images added.
- **Working product pieces, labelled.**
  - The hero phone plays one scripted exchange.
  - The loop marker runs once and is the page's one signature motion.
  - Plan has three tabs over the binder photo, with ownership markers placed on the real cards in it.
  - Playtest deals a real opening hand from the sample deck, and calls a hand with no Basic Pokémon a mulligan.
  - Tune parses an abridged PTCG Live log in the real log format, or turns a message into an entry.
  - Build prices the missing cards live and has a printing slider for Mega Chandelure ex.
  - Ask it anything autoplays example exchanges, with a pause control and chips.
  - Give it a job previews a write and applies it on Approve. This mirrors `log_cards`' dry-run default.
  - Every illustrative number sits inside a panel tagged "Example", and the playground says "Example answers, not a live AI".
- **One real deck everywhere.** The photos, the hand toy and the Build demo share one deck: Mega Chandelure ex / Dusknoir, 60 cards. It was checked Standard-legal with `check_deck` on 2026-10-03 and lives in `landing/data.ts`. The three Pitch Black printings of Mega Chandelure ex (038, 099, 115) were confirmed to have identical rules text before the slider offers them as interchangeable.
- **Live numbers through `lib/api`.** The hero trust line totals the catalog from `api.series()`, and Build reads prices with `api.card()`. Both are anonymous, publicly cached reads with baked fallbacks, and both go through `lib/api`, as `check-api-base` requires.
- **Compatibility claims.**
  - The connect table is in the owner's order: Claude, ChatGPT, Gemini, Grok, Perplexity, Mistral. It says when it was last checked (October 2, 2026).
  - Only Claude is marked "Tested with DeckPal". Every other row says it comes from that app's docs and is not yet tested.
  - The Claude button opens `claude.ai/customize/connectors`. The ChatGPT button opens its settings, which is where the old connectors URL now lands. Both were checked 2026-10-03.
- **Kept from 2026-09-29:**
  - Copy is one module (`landing/copy.ts`), read by the page, the prerender, `llms.txt`, `llms-full.txt` and the JSON-LD (WebApplication plus FAQPage).
  - `robots.txt` and `sitemap.xml` stay. `robots.txt` is now one group, because named-bot groups had silently lifted its disallows for those bots.
  - The prerender plugin now resolves an absolute `outDir` and throws instead of silently writing nothing.
  - `index.html` has no global canonical.
- **Copy guards changed.** The landing now uses "coach" and "matchup" in the owner's copy, so `landingCopy.test.ts` no longer bans them.
  - It still bans the scanner, Deck-E and DeckPal credits. "Trade Credits" (PTCG Live) and "credit card" are allowed.
  - It now also pins the compatibility claims: the order, only Claude tested, the dated badge and the fine print agreeing.

- **Round two (2026-10-04), from the owner's narrated walkthrough.**
  - **AI logos.** Each AI app now shows its real logo, the company's own file copied byte for byte into `public/brand/ai/`. Provenance and each company's rules are in `public/brand/README.md`.
    - The owner chose this knowing that Anthropic, Google and Perplexity ask for permission first and OpenAI's terms are unclear ("If they tell me to take them down I will").
    - Gemini's mark is the icon `gemini.google.com` serves, because Google's brand kit sits behind a partner login. ChatGPT shows OpenAI's Blossom beside its name, because no ChatGPT mark exists.
    - A no-affiliation line sits under the logo strip, on the connect chart and in the footer, which now names the companies.
  - **The hero phone** sits beside the copy, bigger, and breaks out only slightly. It plays one continuous conversation that runs the whole loop, from a first draft to a TCGplayer cart, with each task carried to its end. It no longer pauses on hover; the pause button stays.
  - **Ask it anything** examples run to the end of a task over several turns, instead of stopping at the first reply.
  - **The loop diagram** is tighter, with "Repeat until it wins" inside the loop. Each stage has one icon (lists, cards, sliders, cart), and the same icon appears in the diagram, the stage bar, the phone list and each stage section's eyebrow.
  - **Stage photos are backdrops** framing the product panel, instead of plates with a panel hanging off them. Five new scenes vary the contexts and angles: a top-down binder at home, a desk at night, a deck laid out for tuning, a mailer of singles, and a hand of cards on a couch. The paper score sheet is gone ("no one logs games on paper"). Of the eight round-one photos only the hero and closing bands remain; the other six are deleted.
  - **"What else"** is a carousel of cards with drawn illustrations, not a bento of app-like mocks. It advances on its own, with a pause button, and stays put under reduced motion.
  - **Open source** shows the repository itself: a screenshot of github.com/cheyras/deckpal, cropped to the name, tabs, the 869-commit bar and two folders. The crop leaves out commit messages that name unreleased features, and leaves out the star count.
  - **Connect** is short: three steps, the two app buttons, an at-a-glance chart (free plan, can make changes), and "Learn more about connecting".
  - **New `/connect` page.** The landing's old Connect detail moved here: the URL, per-app steps, Claude Code, Read only versus read and change, the 25 tools, the full compatibility table with notes, and troubleshooting. It is public and chrome-free like `/privacy`, cloud-only, and in the sitemap.

**Why:** The owner said they weren't loving the 2026-09-29 page and supplied a full page map and copy. Their brief asked for real photographs with real card art. For now those are generated, with the cards composited properly. That photographic approach replaces an abstract 3D field.

**Implications:**
- The founder photo is gone; the open-source section shows the repository instead. The first-person founder note ships empty (`COPY.founder.note` is `[]` and nothing renders) because the draft was written for the owner, not by them. Add the owner's own words there when they have them.
- The ChatGPT and Grok rows rest on provider docs that contradict each other. Test them, or soften the cells, before relying on them.
- **Unverified: crawlers may never get `dist/landing.html`.** vercel.json's `/` rewrite runs after Vercel's filesystem check, and `index.html` exists, so `/` likely still serves the plain shell. The 09-29 version never shipped, so this was never seen on a deploy. Check a preview with `curl -s <preview>/ | grep -c seo-landing`. If it prints 0, emit the landing as `index.html` and the shell as `app.html`, point the catch-all rewrite at `/app.html`, and move `sw.ts`'s shell fallback with it. That is a vercel.json change, so it needs the maintainer's yes (B9).
- The privacy browser suite loads `/` and fails on any request it doesn't expect. Its fixture now answers the landing's catalog reads and card-art paths. A new landing request needs a matching line there.
- Repeating the photos costs Gateway money. The specs freeze every quad, so recompositing does not; only a new scene needs generation.
