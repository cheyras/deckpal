# Deck-E parity harness

Measures the three.js port against Blender renders of the same character in the
same pose, through the same camera. It exists because this project's own log
records **five separate measurement instruments that gave confident wrong
answers**, one of which was reading two screenshots by eye and getting the sign
of `bend` backwards. Every number in `src/character/decke/PARITY.md` comes from
here.

## Running it

```bash
# 1. references — INSIDE Blender, with DeckPal_character_rig_v1.blend open.
#    Writes ref/ and seq/ (about 15 MB, gitignored — the .blend is the authority
#    and this script is the artefact, so the PNGs are disposable).
blender -b "$BLEND" -P render-refs.py

# 2. the dev server
pnpm --filter web dev

# 3. the sweeps, from THIS directory
node sweepref.mjs      # 8 states, stills
node sweepref2.mjs     # 6 more states, stills
node seqcmp.mjs        # 3 clips, 6 frames each — catches TIMING, which stills cannot
node browcmp.mjs       # brow mesh position in lid space, all 27 states
node perf.mjs          # frame budget, desktop and throttled mobile
node devpage.mjs       # drives every control on /dev/decke, incl. the JSON console
```

**Playwright is required and is deliberately not a repo dependency** — it is a
few hundred MB of browsers that nothing else here needs. Install it where you
run the harness (`npm i -D playwright && npx playwright install chrome`), or run
the scripts with a global copy. `sharp` *is* a repo dependency and needs nothing.

## What each script measures

| Script | Reports |
|---|---|
| `compare.mjs` | the instrument the others call: silhouette IoU, area ratio, centroid/bbox delta in px, and a per-channel colour transfer ratio over the pixels both images agree are the subject. Also writes an amplified diff image, because vision models reason far better about a diff than about two frames. |
| `sweepref.mjs` / `sweepref2.mjs` | 14 states as stills |
| `seqcmp.mjs` | 3 clips frame-by-frame. A pose error shows up in a still; a **timing** error does not. This is how `travel_far`'s 2x-speed bake was caught. |
| `browcmp.mjs` | brow mesh position expressed in the lid's own frame, so the lid's transform cancels and only the brow chain is under test |
| `perf.mjs` | frame times under CPU throttling, plus draw calls / triangles / programs |
| `devpage.mjs` | every button, facing, talk-over-emote, `flyTo`, and the LLM JSON console including a rejection case |

## Two things to know before trusting a number

**The sweeps pin the procedural clocks.** The blink schedule's cursor is
monotonic and the idle float's clock is integrated, so both survive the page
warm-up and made otherwise identical runs differ by **up to 0.045 IoU** — enough
to make a real regression invisible or invent one. `sweepref*.mjs` resets
`proc.blink.cursor` and sets `proc.float.tau` from the seeked time. Runs are now
bit-identical. This does **not** make the port match Blender's baked float;
nothing can, and it should not — he has to idle indefinitely.

**Colour ratios are transfer functions, not brightnesses.** A ratio of 1.04 means
the port is 4% brighter over the shared silhouette. Diagnose a lighting residual
by **surface normal**, not by pixel: a per-pixel read had the environment error
in this project mis-filed as "missing shadows" for weeks, when bucketing by
normal showed the up-facing lid top at +44% against the front face's +5% — a
shape no occlusion term can produce.
