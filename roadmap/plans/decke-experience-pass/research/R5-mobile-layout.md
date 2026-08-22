# R5 — Mobile / PWA layout, viewport, safe areas, scroll-locking, chat overlay shell

Repo: `E:/Users/cheyr/deckpal`. All paths below are relative to repo root unless
given absolute. Line numbers are as of the `main` branch, commit `209150f`.

The single most load-bearing file for this whole investigation is
`apps/web/src/character/host/DeckeChat.tsx` (705 lines) — it is the chat
overlay's entire shell (scrim, panel, header, transcript, composer). The
second is `apps/web/src/components/AppShell.tsx` (the app's own chrome) and
the third is `apps/web/src/components/ui/Sheet.tsx` (the *other* overlay
primitive in the app, which already solves several of the problems the
Deck-E overlay has not adopted).

---

## 0. Read of `AGENTS.md` — contracts that govern this work

Full file: `E:\Users\cheyr\deckpal\AGENTS.md` (486 lines). Relevant to a
UI/layout change:

- **Verification standard 1** (`AGENTS.md:354-356`): *"Browser verification
  for UI changes. Open the page at desktop width **and** at 390px viewport.
  Actually look at it — type-checks and tests verify code correctness, not
  feature correctness."* This is the binding verification bar for this task.
  390px is the canonical mobile width the project checks at (matches iPhone
  12/13 mini logical width). There is no iOS-Safari-specific or
  installed-PWA-specific check named anywhere in the file — see §7 below,
  this is a real gap for exactly the defects reported.
- **Verification standard 3**: *"Verify the artifact, not the report... load
  the page — confirm the real thing works."*
- **Verification standard 6 / doc-sync table** (`AGENTS.md:376-417`): any
  non-trivial decision gets a dated `DECISIONS.md` entry; a frontend-stack or
  pattern decision also updates the wiki **Frontend-Research** page. A pure
  CSS/layout bugfix with no architectural decision behind it may not trigger
  this, but if the fix changes an established pattern (e.g., "the phone panel
  is glass with no background" — a documented, deliberate decision in
  `DeckeChat.tsx:28-32`) that reversal **is** a decision and should get a
  `DECISIONS.md` entry.
- **B9 — No unilateral infrastructure mutations**: not applicable to this
  work (no Vercel/Supabase/infra touched).
- **B11 — Runtime configuration must fail loudly**: not applicable (no new
  env var).
- Nothing in `AGENTS.md` names a visual regression tool, a screenshot gate, a
  CI-run browser check, or an iOS Simulator. The verification contract is
  manual, in a real/emulated browser, at two widths. See §7 for exactly what
  exists to help with that and what doesn't.

---

## 1. Defect-by-defect root cause

### Defect 1 — page scrolling "broken" while the overlay is open; only Deck-E and the chat window scroll

This is **by design**, and the design is coherent — but it means the
"content is cut off with no way to scroll to it" complaint (Defect 3) and this
one likely describe the same mechanism from two angles, not two mechanisms.

- `DeckeChat.tsx:273-278`:
  ```
  useEffect(() => {
    if (!open || minimised) return
    decke?.returnHome()
    lockScroll()
    return () => unlockScroll()
  }, [open, minimised, decke])
  ```
  `lockScroll`/`unlockScroll` come from `apps/web/src/components/ui/Sheet.tsx:91-123`
  — a ref-counted body-scroll lock, **shared** between `Sheet` and `DeckeChat`
  (the export comment at `Sheet.tsx:77-90` explicitly documents that sharing
  and warns about lock-order: *"anything computing a delta against a
  previously-recorded scroll offset... must be released BEFORE locking"* —
  which is why `DeckeChat.tsx:275` calls `decke.returnHome()` before
  `lockScroll()`).
  - Mechanism (`Sheet.tsx:91-116`): captures `window.scrollY`, sets
    `body.style.position = 'fixed'`, `top = -scrollY`, `width = '100%'`,
    `overflow = 'hidden'`, `overscrollBehavior = 'none'`. This is the standard
    iOS body-lock technique (`overflow:hidden` alone does not hold on iOS
    Safari — the file's own comment at `Sheet.tsx:70-73` says so). **This part
    is correct and is the right technique for iOS standalone.**
  - The only thing that scrolls while the lock holds is whatever has its own
    `overflow-y: auto` **inside** the fixed/portalled overlay tree — for
    `DeckeChat` that is exactly one element: the transcript,
    `DeckeChat.tsx:471-474`
    (`<div ref={transcriptRef} className="flex flex-1 flex-col overflow-y-auto px-[16px] pb-[12px]">`).
  - "Deck-E himself... scrolling": he is not actually scrolled, he is
    **repositioned by WebGL** on a `position: fixed` full-viewport canvas
    (`DeckeHost.tsx:420-427`, `z-30`), independent of body scroll entirely —
    to the user this can look like "he's the one still moving."
  - **Assessment**: the lock mechanism itself is sound and iOS-appropriate.
    The "broken" feeling is a real UX problem but it is the *composition* of
    Defects 2–4, not a distinct scroll-lock bug: the transcript is the only
    scrollable region, its top is invisible (Defect 2/3), and its bottom is
    cramped against a dead zone (Defect 4) — so the one scrollable area feels
    unreachable at both ends.

### Defect 2 — "Deck-E" title and the close ("X") button render in the iOS status-bar / notch area

Root cause is concrete and located exactly:

- `DeckeChat.tsx:433-460`, the panel `div` (mobile: `'pointer-events-none
  inset-0 motion-safe:animate-[sheet-panel-up_...]'`, i.e. `fixed inset-0` —
  literally touches the top edge of the viewport) contains:
  ```tsx
  <header
    className={[
      'flex shrink-0 items-center justify-between px-[16px] py-[12px]',
      desktop ? 'border-b border-border-default' : '',
    ].join(' ')}
  >
    <span className="text-[15px] font-semibold text-text-primary">Deck-E</span>
    <button ... onClick={onClose} ...><Icon name="close" size={18} /></button>
  </header>
  ```
  **There is no `env(safe-area-inset-top)` anywhere in this header or its
  ancestors.** Compare directly with the app's own chrome, which *does* pad
  for it: `AppShell.tsx:427-434` (`<header className="app-header fixed ...">`
  with `style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft:
  ..., paddingRight: ... }}`) and the mobile nav drawer,
  `AppShell.tsx:359` (`const top = 'calc(64px + env(safe-area-inset-top))'`).
  DeckeChat's header is the **one** fixed-position header-shaped element in
  the codebase without this treatment (`MobileDrawer`, `Header`, `authUi.tsx:73`,
  `Landing.tsx:227` all have it — see the table in §2).
- Why it matters specifically for an **installed PWA**: `index.html:13`
  (`<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`)
  plus `viewport-fit=cover` (`index.html:5`) is what makes iOS draw the
  status bar *transparently over* the web content instead of reserving a
  bar of native chrome above it — that combination is exactly what makes
  `env(safe-area-inset-top)` load-bearing for every fixed-to-top element in
  standalone mode. In ordinary mobile Safari (non-standalone) the same code
  would look fine because Safari's own chrome occupies that space; it is
  specifically the installed/standalone context that exposes this gap,
  which matches the owner's report precisely ("running as an installed
  PWA, no Safari chrome").

### Defect 3 — content cut off at the top, no way to scroll up to it

Two contributing mechanisms, both traceable:

1. **The header eats real pixels without accounting for the inset**, per
   Defect 2 — the visible "Deck-E" title/X sit partly under the notch, so the
   header's *effective* visible height is smaller than its layout height,
   and the transcript below it starts exactly where the layout says it
   should (below `py-[12px]` + line height), not below the safe area. This
   reads as "the first bit of content is behind/under something."
2. **The transcript is forced to the bottom on every relevant update, and
   this can fight a user trying to read the top.** `DeckeChat.tsx:329-333`:
   ```tsx
   useLayoutEffect(() => {
     const el = transcriptRef.current
     if (el) el.scrollTop = el.scrollHeight
     reflow()
   }, [messages, reflow, gutter])
   ```
   This runs on every `messages` array change (new message arriving,
   streaming update, or a tool chip appended) and on every `gutter` change
   (which happens on breakpoint or Deck-E's on-screen size change). A user
   scrolled up reading an earlier `DeckeScreen` panel gets yanked back to
   the bottom on the next token/chip. There is no "user has scrolled away,
   don't auto-scroll" guard — contrast this with the very deliberate,
   documented layout choice at `DeckeChat.tsx:462-469` (bottom-alignment via
   `mt-auto`, not `justify-end`, specifically so `scrollHeight` stays
   reachable) — the mechanics of scrolling to the top are fine, but a
   competing effect keeps re-scrolling to the bottom.
3. The panel is `pointer-events-none` on mobile except for specific opaque
   children (`DeckeChat.tsx:420-432` comment; the transcript div carries
   `pointer-events-auto` per its `<ul className="pointer-events-auto ...">`
   at line 480, but the outer scroll container `div ref={transcriptRef}`
   itself — the actual scrollable box — does **not** have an explicit
   `pointer-events-auto` class; it inherits from `pointer-events-none` on
   the ancestor panel `div` unless a touch lands on the `<ul>` specifically.
   Practically: dragging inside the `padding` band of the scroll container
   (its own `px-[16px] pb-[12px]`, outside the `<ul>`'s box) or in the
   region before any messages exist (the empty-state `<p>` at line 476 *does*
   carry no `pointer-events-auto` of its own, relying on inheritance from a
   `pointer-events-none` ancestor) can silently fail to scroll/drag. This is
   a plausible secondary contributor to "no way to scroll up" on a screen
   with few messages.

### Defect 4 — dark-gray dead band at the bottom; composer sits too close to the edge

- **No `env(safe-area-inset-bottom)` anywhere in `DeckeChat.tsx`.** Grep
  confirms zero occurrences in this file (contrast: `AppShell.tsx:371`,
  `Sheet.tsx:318`, `Sheet.tsx:326`, `authUi.tsx` all use it). The composer
  form is `DeckeChat.tsx:647-652`:
  ```tsx
  <form onSubmit={submit} className={[
    'decke-composer pointer-events-auto flex shrink-0 items-center gap-[8px] py-[10px] pr-[16px]',
    desktop ? 'border-t border-border-default' : '',
  ].join(' ')}>
  ```
  `py-[10px]` is the *only* vertical breathing room below the input — on an
  iPhone with a home indicator (safe-area-inset-bottom ≈ 34px in standalone),
  the 40px-tall pill (`h-[40px]` on both the `<input>` at line 660 and the
  send/stop buttons at lines 686/695) sits roughly 10px above the indicator,
  which reads as "far too close to the bottom edge" exactly as reported.
- **The dead-gray band is explained by the deliberate "phone panel is
  glass" design** (`DeckeChat.tsx:28-32`, restated at 420-432): *"The phone
  panel has no background of its own... painting `surface-primary` over the
  top of that threw the blur away."* So on mobile, the only opaque things in
  the whole overlay are the message bubbles (`decke-bubble`, surface-colored
  pills), the header's text/icon, the approval-gate block
  (`DeckeChat.tsx:595-597`, which **does** have `border-t border-border-default`
  but *no* explicit background either — it will show the blurred/darkened
  page through it too), and the composer `<input>` pill itself (`bg-surface-secondary`,
  rounded-full). **The composer `<form>` element has no background of its
  own.** Below/around the 40px input pill — the `py-[10px]` padding, the
  `pr-[16px]` gutter on the right, and the entire safe-area strip below the
  form that nothing pads for — the user is looking straight through to the
  scrim: `bg-black/45 backdrop-blur-[3px]` (`DeckeChat.tsx:409-418`) over
  whatever the app page looks like underneath. A semi-transparent
  dark/blurred strip with no defined color of its own, sitting directly
  above the home-indicator area, is the "dark-gray dead band" — it is the
  scrim showing through the composer's unstyled hit-region, not a
  distinct rendered element.
- **Viewport units**: the panel itself is sized by `fixed inset-0` (not by
  an explicit `100vh`/`100dvh` literal), which is actually the *more*
  correct technique — `inset: 0` on a fixed element resolves against the
  visual viewport's containing block directly and needs no unit choice.
  So the vertical-sizing half of Defect 4 is not a `vh`-vs-`dvh` bug; it is
  purely the missing safe-area padding + missing background, as above.
- **No `visualViewport`/keyboard-avoidance code exists for this composer at
  all** (confirmed by repo-wide grep — see §5). When the iOS keyboard opens
  over the input, nothing here resizes or repositions the panel to keep the
  composer above the keyboard; contrast `Sheet.tsx:281-283`'s
  `max-h-[92dvh]` cap, which the Sheet.tsx author explicitly designed
  keyboard-shrinkage into (comment: *"dvh (not vh) so a mobile URL bar or an
  open keyboard shrinks it instead of pushing it out of view"*) — even that
  is an indirect, CSS-only mitigation (relies on the browser's own
  `dvh`-recompute-on-keyboard behavior, which is itself inconsistent across
  iOS Safari versions), not an explicit `visualViewport` listener. DeckeChat
  has neither the `dvh` cap nor a JS listener.

### Defect 5 — app's own top chrome should not be blurred; overlay should start below it and be darker/more blurred, on both mobile and desktop

- **This is a documented, deliberate reversal target**, not an accident.
  `DeckeChat.tsx:34-40` states the current intent explicitly:
  ```
  Stacking, against the tokens in `theme.css`:
    scrim   z-15 desktop / z-24 phone — desktop chrome stays sharp above it,
                                        a phone's chrome is part of what recedes
    panel   z-25   below the canvas; opaque card on desktop, glass on a phone
  ```
  and again at `DeckeChat.tsx:402-407`: *"Content sits at 0 and app chrome
  at 20, so this darkens and blurs the page while leaving the header and
  sidebar sharp — which is the desktop behaviour asked for. On mobile the
  chrome is part of what should recede, so the scrim covers everything and
  the panel is full-screen."*
  - **Desktop today**: scrim `z-[15]` (`DeckeChat.tsx:416`) — below
    `--z-chrome: 20` (`theme.css:287`), so `AppShell`'s fixed `<Sidebar>`
    (`AppShell.tsx:271`, `z-(--z-chrome)`) and `<Header>`
    (`AppShell.tsx:428`, `z-(--z-chrome)`) do paint above the scrim and stay
    unblurred. **This half already matches what the owner wants for
    desktop** — the "both mobile and desktop" ask means the mobile half is
    the actual gap.
  - **Mobile today**: scrim `z-[24]` (`DeckeChat.tsx:416`) — **above**
    `--z-chrome: 20`, so it fully covers and blurs `AppShell`'s `<Header>`
    (which is `fixed left-0 right-0 top-0`, so it is directly underneath).
    This is the exact opposite of the desktop behavior and the opposite of
    what's being asked for; it's not a bug relative to the code's own
    stated design, but the design itself is what needs to change.
- **Blur/darken intensity**: current scrim is `bg-black/45 backdrop-blur-[3px]`
  (`DeckeChat.tsx:414`) for **both** breakpoints (the `desktop ? 'z-[15]' :
  'z-[24]'` ternary only changes z-index, not color/blur). For comparison,
  the app's *other* overlay primitive, `Sheet.tsx:264-266`, uses
  `background: var(--color-overlay-scrim-strong)` =
  `rgb(26 23 22 / 0.75)` (**75%** opacity, `theme.css:141`) with **no
  backdrop-blur at all**. So DeckeChat's scrim is already the only
  blurred scrim in the app, but at a lower opacity (45% vs. Sheet's 75%)
  and a light blur (3px). "More blurred and darkened than now" means both
  the alpha and the blur radius need to go up from these two literal
  values — there is no design-token variable currently backing either
  number (both are Tailwind arbitrary values inline in the JSX, not driven
  by `--color-overlay-scrim*`).
- **To make "starts below the app header" real** on mobile, the fix is not
  purely a z-index swap — the panel is `inset-0` (touches the very top of
  the viewport). Making the effect start below the header means either (a)
  giving the scrim a top offset equal to the app header's on-screen height
  (`64px + env(safe-area-inset-top)` on mobile, matching
  `AppShell.tsx:359`'s own literal for the drawer, or the `78px` desktop
  height at `AppShell.tsx:539`), or (b) keeping the scrim full-bleed but
  raising the app header's z-index/repainting it after the scrim in DOM
  order so it stays visually on top and unblurred (this only works for
  *darkening*-via-paint-order, not for the *blur* itself, since
  `backdrop-filter` samples whatever is compositing behind the element
  regardless of DOM order/z-index — the header would need to be excluded
  from the blur's backdrop, which in practice means the blur element must
  not extend under the header at all, i.e. approach (a)).

### Defect 6 — composer should be a rounded card (not a bare pill); conversation should scroll behind it under a fade mask, matching Claude's iOS app

- **Current composer anatomy** — see full breakdown in §4. In short: it is
  a flex `<form>` with **no background/border/shadow of its own**
  (`DeckeChat.tsx:647-652`), containing one `rounded-full` input pill
  (`bg-surface-secondary`, `h-[40px]`, line 654-661) and one `rounded-full`
  circular button (send or stop, `h-[40px] w-[40px]`, lines 681-699). There
  is no outer card, no elevation, no distinct surface — it visually is "a
  pill and a circle floating on the scrim," which is the literal "bare
  pill" the owner named.
- **No fade/mask exists anywhere in this file or in `theme.css`** for the
  transcript-behind-composer effect. The transcript container
  (`DeckeChat.tsx:471-474`) is a plain `overflow-y-auto` div; nothing masks
  its bottom edge. A `mask-image: linear-gradient(...)` (or
  `-webkit-mask-image`, needed for Safari) fading the last ~60-80px of the
  transcript to transparent, positioned so it sits above wherever the new
  composer card's top edge lands, is what Claude's iOS app (and this
  project's own `Sheet` header, incidentally, uses a *border* not a mask —
  no existing app precedent for a scroll mask exists in this codebase; it
  would be new).
- Existing radius tokens to reuse for the "card" (`theme.css:199-204`):
  `--radius-lg: 8px` (Tailwind default), `--radius-xl: 12px`,
  `--radius-2xl: 16px`, `--radius-full: 9999px`. The rest of the app's
  sheet/panel chrome uses `rounded-2xl`/`rounded-[18px]` for cards (e.g.
  `Sheet.tsx:284` `rounded-t-2xl ... nav:rounded-2xl`; DeckeChat's own
  desktop panel is `rounded-[18px]`, `DeckeChat.tsx:441`) — a composer card
  in that same family (`16-18px`) would match existing precedent.

---

## 2. Viewport-unit / safe-area / scroll-lock inventory (table)

| Location | What it does | Correct for iOS standalone? |
|---|---|---|
| `apps/web/index.html:5` | `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` | Yes — `viewport-fit=cover` is required for `env(safe-area-inset-*)` to resolve to non-zero at all. |
| `apps/web/index.html:11-14` | `mobile-web-app-capable`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `apple-mobile-web-app-title` | Correct set for iOS Home-Screen install; `black-translucent` is exactly what makes content draw under the status bar and makes safe-area padding load-bearing everywhere. |
| `apps/web/vite.config.ts:129-145` | `VitePWA({ manifest: { display: 'standalone', background_color: '#1c1917', theme_color: '#1c1917', ... } })` | Standalone display mode confirmed; matches the reported "installed PWA, no Safari chrome" scenario. |
| `apps/web/src/components/AppShell.tsx:428-434` | App header: `fixed ... top-0`, `paddingTop/Left/Right: env(safe-area-inset-*)` | Correct. |
| `apps/web/src/components/AppShell.tsx:359,371` | Mobile drawer: `top = calc(64px + env(safe-area-inset-top))`; drawer `height: calc(100dvh - top)`, `paddingBottom: env(safe-area-inset-bottom)` | Correct, and uses `dvh` appropriately for the height budget. |
| `apps/web/src/components/AppShell.tsx:539` | Injected `<style>`: `.app-content{padding-top:calc(64px + env(safe-area-inset-top))}` (mobile) / `78px` flat (desktop ≥1068) | Correct — desktop has no notch to account for, so the flat value is fine. |
| `apps/web/src/character/host/DeckeChat.tsx:445-460` | Chat overlay's own `<header>` — **no safe-area padding at all** | **Incorrect** — root cause of Defect 2. |
| `apps/web/src/character/host/DeckeChat.tsx:647-652` | Composer `<form>` — **no `env(safe-area-inset-bottom)`** | **Incorrect** — root cause of Defect 4. |
| `apps/web/src/character/host/DeckeChat.tsx:433-443` | Mobile panel: `fixed inset-0` (no explicit vh/dvh unit) | Neutral/correct — `inset:0` on `position:fixed` is unit-agnostic and generally more robust than a `100vh` literal. |
| `apps/web/src/character/host/DeckeChat.tsx:441` | Desktop panel: `h-[min(620px,calc(100vh-140px))]` | Uses **`100vh`**, not `100dvh`. Desktop browsers don't have the mobile toolbar-slide problem, so this is low-risk, but it is inconsistent with the `dvh`-everywhere convention the rest of the app follows (see `Sheet.tsx`, `AppShell.tsx`) and is worth normalizing to `dvh` for consistency/future-proofing (foldables, PWA window resize). |
| `apps/web/src/components/ui/Sheet.tsx:91-116` (`lockScroll`/`unlockScroll`) | Body-lock via `position:fixed` + `top:-scrollY` + `overflow:hidden` + `overscrollBehavior:none`, ref-counted, restores `scrollY` on unlock | Correct iOS-appropriate technique; shared by `DeckeChat.tsx:276-277`. |
| `apps/web/src/components/ui/Sheet.tsx:283` | `max-h-[92dvh] nav:max-h-[min(86dvh,860px)]` | Correct `dvh` usage — explicitly commented as keyboard/toolbar-aware. |
| `apps/web/src/components/ui/Sheet.tsx:318,326` | `paddingBottom: calc(20px + env(safe-area-inset-bottom))` / `calc(14px + ...)` | Correct — this is the pattern `DeckeChat`'s composer is missing. |
| `apps/web/src/theme.css:321-324` | `body { min-height: 100vh; min-height: calc(100dvh + 1px); }` | Deliberate 1px overflow reservation for a documented Safari-26 "Liquid Glass" scroll-runway workaround (see comment `theme.css:305-320`). Correct as designed; unrelated to the Deck-E defects but shows the project already treats `dvh` as the modern baseline with `vh` as a dead fallback. |
| `apps/web/src/character/host/DeckeHost.tsx:415` | Zero-width measurement strut: `h-[100svh]` | Correct, deliberate — `100svh` gives the *stable* (toolbars-shown) viewport height as a JS-readable measurement probe (`ResizeObserver`), see `viewport.ts`. |
| `apps/web/src/character/host/DeckeHost.tsx:424` | Character canvas: `fixed inset-0 ... h-[100lvh] w-full` | Correct, deliberate — `100lvh` (largest viewport height, toolbars hidden) ensures the canvas always covers the screen even when toolbars slide away; combined with the `100svh` probe above to avoid non-uniform stretch (see `viewport.ts:1-84` for the full defect history this fixed). In an **installed PWA with no browser chrome**, `svh`/`lvh`/`dvh` are all equal, so this dual-height machinery is inert-but-harmless there — the real toolbar-slide problem this solves is mobile-Safari-tab-mode specific, not standalone-specific. |
| `apps/web/src/character/decke/viewport.ts` (whole file) | Central singleton: forbids any `character/decke/*` module from reading `window.innerWidth/innerHeight` directly; everything is measured once off the canvas's own client box via `ResizeObserver` | Correct, well-documented architecture; not implicated in any of the 6 reported defects (those are all DOM/CSS in `DeckeChat.tsx`/`AppShell.tsx`, outside this module's ownership). |
| `apps/web/src/routes/auth/authUi.tsx:73` | `paddingTop: calc(40px + env(safe-area-inset-top))` | Correct. |
| `apps/web/src/routes/Landing.tsx:227` | Fixed header: `paddingTop: env(safe-area-inset-top)` | Correct. |
| `apps/web/src/components/DevBackendRibbon.tsx:44` | `pb-[max(0.5rem,env(safe-area-inset-bottom))]` | Correct, and shows the `max()` idiom is already used elsewhere in the codebase — a candidate pattern for the composer fix. |
| `apps/web/src/character/host/DeckeButton.tsx:74` | Floating launcher button: `fixed bottom-[20px] right-[20px]` — **no safe-area-inset-bottom** | Same class of gap as the composer, lower severity (a 56px circular FAB, not a text-entry surface) but worth fixing in the same pass since it's the same component family. |
| `apps/web/src/components/PwaUi.tsx:115,119` | Install/offline/update toasts: `fixed bottom-[16px] ...` — **no safe-area-inset-bottom** | Same class of gap, out of scope for this task's 6 defects but flag-worthy for a future pass. |
| `apps/web/src/components/ui/DeckeBeacon.tsx` / `elementHighlight.ts:93` | Highlight-ring overlay: `position:fixed;inset:0;...z-index:25` | Not implicated; purely a pointer/annotation layer, not a scroll or safe-area concern. |

Grep coverage note: repo-wide search for `100vh`, `dvh`, `svh`, `lvh`,
`safe-area-inset`, `visualViewport`, `overscroll-behavior`, `touch-action`,
`position:\s*fixed`, `body.style.overflow`, and `--z-` under `apps/web/src`
turned up every hit above; no `touch-action` CSS property is used anywhere
in `apps/web/src` (confirmed — zero matches), meaning nothing in the app
explicitly opts elements out of native touch gestures (e.g. `pan-y`) —
worth knowing if a future keyboard/scroll fix reaches for it.

---

## 3. App shell, z-index stack, and where Deck-E portals in

### Root layout

- `apps/web/src/main.tsx` — `RootComponent` renders either
  `<AppShell><Outlet/></AppShell>` (public routes) or
  `<AuthGuard><AppShell><Outlet/></AppShell></AuthGuard>` (authenticated
  routes), and **`<DeckeHost/>` is a sibling of that conditional**, not a
  child of `AppShell` — this is deliberately so the WebGL character/canvas
  survives route-type transitions that would otherwise unmount/remount
  `AppShell` (see the block comment at `DeckeHost.tsx:1-27` for the full
  rationale). Practically: `DeckeChat`'s overlay is **not** a portal into
  `AppShell`'s DOM subtree; it renders at the React tree's top level,
  independent of the app chrome, and reaches the visual top of the stack
  purely through `position: fixed` + z-index, not through DOM nesting under
  the header.
- `apps/web/src/components/AppShell.tsx:506-543` (`AppShell`) — renders
  `<Sidebar>`, `<Header>`, `<MobileDrawer>`, `<main class="app-main">`
  (content), then `<PwaUi/>`. Chromeless paths (`/`, `/auth`, `/design`,
  etc. — see `isChromelessPathname`) bypass all of this and render just
  `{children}`.

### z-index tokens (`apps/web/src/theme.css:280-290`)

```
--z-art: -1;
--z-base: 0;
--z-raised: 5;
--z-sticky: 8;
--z-overlay: 10;
--z-popover: 13;
--z-chrome: 20;
--z-modal: 100;
--z-toast: 9999;
```

Additional **literal**, non-token z-indexes found in the Deck-E stack
(these are Tailwind arbitrary values in JSX, not driven by the token list
above — worth normalizing if this pass touches them):

| Element | z-index | Source |
|---|---|---|
| App content | (default, `z-auto`) | `AppShell.tsx:535-537` |
| `--z-chrome` (Sidebar, Header) | **20** | `AppShell.tsx:271,428` |
| DeckeChat scrim, desktop | **15** | `DeckeChat.tsx:416` |
| DeckeChat scrim, mobile | **24** | `DeckeChat.tsx:416` |
| DeckeChat panel (both) | **25** | `DeckeChat.tsx:439` |
| DeckeChat minimised bar | **25** | `DeckeChat.tsx:386` |
| `DeckeBeacon` ring | **25** | `DeckeHost.tsx:428-430` comment; `elementHighlight.ts:93` also hardcodes `z-index:25` |
| Character canvas (`DeckeHost`) | **30** | `DeckeHost.tsx:424`, explicitly "above app chrome (20) on purpose" |
| `--z-modal` (Sheet) | **100** | `Sheet.tsx:264` |
| `--z-toast` (PwaUi, DevBackendRibbon) | **9999** | `PwaUi.tsx:115,119`; `DevBackendRibbon.tsx:44` |

So the full paint order bottom-to-top today is: app content (0) → DeckeChat
desktop scrim (15) → app chrome (20) → DeckeChat mobile scrim (24) →
DeckeChat panel + beacon ring (25) → character canvas (30) → Sheet modals
(100) → toasts (9999). The mobile-vs-desktop divergence at the
15-vs-24-around-20 boundary **is** Defect 5's entire mechanism: desktop's
scrim (15) sits below chrome (20) so chrome stays sharp; mobile's scrim (24)
sits above chrome (20) so chrome gets covered/blurred. A fix that wants
parity ("both mobile and desktop") most likely means moving the mobile
scrim to also sit below the app header specifically (not below all chrome
generically, since on mobile there's also a hamburger menu drawer at
`--z-overlay: 10` and a backdrop at `--z-sticky: 8` that are unrelated), or
literally offsetting the scrim/panel's top edge by the header's height as
discussed in Defect 5 above.

---

## 4. Composer anatomy (current state, exact markup)

`DeckeChat.tsx:647-700`, reproduced in full for reference:

```tsx
<form
  onSubmit={submit}
  className={[
    'decke-composer pointer-events-auto flex shrink-0 items-center gap-[8px] py-[10px] pr-[16px]',
    desktop ? 'border-t border-border-default' : '',
  ].join(' ')}
>
  <input
    ref={inputRef}
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    placeholder="Say something…"
    aria-label="Message Deck-E"
    className="h-[40px] flex-1 rounded-full bg-surface-secondary px-[14px] text-[14px] text-text-primary outline-none placeholder:text-text-muted"
  />
  {busy ? (
    <button type="button" onClick={onStop} aria-label="Stop"
      className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-text-primary">
      <span className="block h-[12px] w-[12px] rounded-[2px] bg-current" />
    </button>
  ) : (
    <button type="submit" disabled={!draft.trim()} aria-label="Send"
      className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-action-primary text-action-primary-text disabled:opacity-40">
      <Icon name="chevron-right" size={18} />
    </button>
  )}
</form>
```

- `.decke-composer`'s only custom CSS (`theme.css:842-844`) is
  `padding-left: calc(16px + var(--decke-gutter, 0px))` — purely to clear
  Deck-E's own on-screen footprint, unrelated to safe-area or card styling.
- No `background`, `border` (mobile), `border-radius`, `box-shadow`, or
  `padding-bottom` beyond `py-[10px]` on the form itself. Only the
  **children** (`input`, buttons) are individually rounded-full — there is
  no enclosing card.
- Radius/size tokens available for a redesign: `--radius-2xl: 16px`
  (`theme.css:203`) or the literal `18px` DeckeChat's own desktop panel
  already uses (`rounded-[18px]`, line 441) would be consistent choices for
  a new composer card.
- The approval-gate block immediately above the composer
  (`DeckeChat.tsx:595-645`) has `border-t border-border-default` but, like
  the composer, no background — if the composer becomes an opaque card,
  this block's relationship to it (does it join the card, or sit above it
  as its own element?) is a design decision the implementation plan should
  make explicit, since today they're visually two borderless regions
  stacked on transparent glass.

---

## 5. Keyboard-avoidance: what exists, what doesn't

- **Nothing in `DeckeChat.tsx` listens to `window.visualViewport`.**
  Confirmed by grep — the only `visualViewport` reads in the whole `apps/web/src`
  tree are diagnostic/dev-only: `apps/web/src/routes/dev/DeckeDiag.tsx:195`
  (a debug readout panel, not shipped UI logic) and comments in
  `apps/web/src/character/decke/DeckE.ts:711` and
  `apps/web/src/character/decke/viewport.ts:123` (both explaining *why*
  `visualViewport.offsetTop` reads flat during an elastic overscroll bounce
  on Chrome — an unrelated investigation, not a keyboard-avoidance
  mechanism).
- **The only keyboard-adjacent code in the app** is `Sheet.tsx:281-283`'s
  `max-h-[92dvh]` cap plus the auto-zoom-prevention rule in
  `theme.css:326-338` (`font-size: 16px !important` on
  `input/textarea/select` under `max-width: 1068px`, to stop iOS Safari's
  automatic page-zoom on focusing a <16px input — this rule **does** apply
  to DeckeChat's `<input>` too, since it's a plain `<input>` under 1068px,
  and is correctly sized at `text-[14px]` in the JSX but overridden to 16px
  by this global rule; worth being aware of when reasoning about the
  composer's rendered height).
- **`BugReport.tsx`** (`apps/web/src/components/BugReport.tsx:~291`) has a
  comment referencing "the keyboard opens over the textarea" as the reason
  its modal is built a certain way — worth reading directly if the
  implementation plan wants a second precedent for in-app keyboard
  handling, though it is Sheet-based (inherits the `dvh` cap), not a
  bespoke `visualViewport` listener either.
- **Conclusion**: there is no `visualViewport.addEventListener('resize', ...)`
  or `interactive-widget` meta anywhere in this codebase. Any
  keyboard-avoidance for the redesigned composer would be new code, not an
  extension of an existing pattern. The closest existing idiom to extend is
  the `dvh`-cap approach (`Sheet.tsx`), which is CSS-only and doesn't
  require a JS listener, but is also the weaker of the two techniques (relies
  on the browser recomputing `dvh` when the keyboard opens, which has been
  historically inconsistent on iOS Safari across versions — the project's
  own comments elsewhere show detailed awareness of iOS viewport-unit
  flakiness, e.g. `viewport.ts`'s whole rationale, so a robust fix likely
  wants the explicit `visualViewport` listener rather than leaning on `dvh`
  alone).

---

## 6. Breakpoint system — exact values, JS/CSS duplication check

- **The one real breakpoint**: `1068px`. Defined in CSS as
  `--breakpoint-nav: 1068px` (`theme.css:253`, comment: *"UI-SPEC §4.3 — 1068
  is the ONE real one"*) and consumed via Tailwind's `nav:` variant
  throughout the app (e.g. `AppShell.tsx` uses `nav:flex`, `nav:hidden`
  extensively). In JS: `DeckeChat.tsx:91` exports
  `export const NAV_BREAKPOINT = 1068` with a comment explicitly pointing
  back at the CSS token (*"`--breakpoint-nav` in theme.css. Below this the
  panel goes full-screen."*) — **this is the one place breakpoint logic is
  duplicated between CSS and JS, and it is kept in sync by comment/convention
  only, not by a shared source (e.g. reading the CSS custom property at
  runtime)**. If `--breakpoint-nav` in `theme.css:253` is ever changed, this
  hardcoded `1068` in `DeckeChat.tsx:91` will not follow it — a latent drift
  risk, though not implicated in any of the 6 reported defects.
- **`isMobile`/`wide` determination in JS**: `DeckeHost.tsx:122-124`
  (`const [wide, setWide] = useState(() => window.innerWidth >= NAV_BREAKPOINT)`)
  kept live via a `matchMedia` listener at `DeckeHost.tsx:146-151`
  (`window.matchMedia('(min-width: 1068px)')`) — this correctly reuses the
  `NAV_BREAKPOINT` constant, so it does track the CSS breakpoint's *value*,
  just not its *definition* (no CSS custom property read at runtime).
  `desktop`/`wide` is threaded down into `DeckeChat` as a prop
  (`DeckeHost.tsx:456`, `desktop={wide}`) rather than the chat component
  computing its own — single source within the Deck-E feature, which is
  good practice, just anchored to a duplicated literal.
- **Second, secondary breakpoint**: `--breakpoint-gap: 567px` (`theme.css:252`),
  used for grid-gap tuning per `apps/web/src/components/ui.tsx:32-47`'s
  comments — unrelated to mobile/desktop chat behavior, purely a
  content-density breakpoint for card grids. Not implicated in any defect
  here, included for completeness since the task asked for "the breakpoint
  system" broadly.
- No other `isMobile`-style boolean or breakpoint constant exists in
  `apps/web/src` outside these two (`1068`, `567`).

---

## 7. Existing tests / verification harness for mobile layout

- **No Playwright, no `.spec.ts`/`.e2e.*` files, no visual-regression or
  screenshot-diff tooling exists anywhere in this repo.** Confirmed by
  repo-wide search for `playwright`, `*.spec.ts`, `*.e2e.*`, and `tests/`/`e2e/`
  directories under `apps/web` and the root `package.json` — all came back
  empty. There is no `package.json` `devDependency` on `playwright`,
  `@playwright/test`, `puppeteer`, `cypress`, or similar anywhere in the
  monorepo.
- **What test harness does exist** (`apps/web/package.json` scripts):
  ```
  "test:insights": "node --import tsx --test src/lib/__tests__/*.test.ts"
  "test:decke":     "node --import tsx --test src/character/decke/__tests__/*.test.ts src/character/host/__tests__/*.test.ts"
  ```
  Run with: `pnpm --filter deckpal-web test:decke` (or `test:insights`).
  These are **pure Node `node:test` unit tests** (no DOM, no browser, no
  jsdom) — e.g. `apps/web/src/character/host/__tests__/bubble.test.ts`,
  `approval.test.ts`, `rip.test.ts`, `ripPresence.test.ts`,
  `sourceSync.test.ts`, `uiTools.test.ts`. `sourceSync.test.ts` is the one
  explicitly named in `DeckeScreen.tsx`'s own header comment
  (`DeckeScreen.tsx:23-25`) as the guard that keeps the block-kind switch in
  sync with the server's schema — **none of these exercise CSS, layout,
  viewport units, safe-area insets, or scroll behavior.** They are
  logic/data-shape tests, not layout tests.
- **The project-wide `pnpm --filter @deckpal/db build && pnpm -r
  --workspace-concurrency=1 exec tsc --noEmit`** typecheck pipeline (per
  `AGENTS.md:59-71` / root `CLAUDE.md`) would catch a TypeScript error in a
  layout change but nothing about how it renders.
- **`.claude/skills/`** — none of the listed project skills
  (`add-tcg`, `add-image-slot`, `fill-missing-assets`, `design-requests`)
  cover mobile-layout verification.
- **A `.claude/commands/setup-clone.md`** exists for environment setup
  verification but is unrelated to UI/browser checks.
- **`/dev/decke`** (`apps/web/src/routes/dev/Decke.tsx`) and
  `apps/web/src/routes/dev/DeckeDiag.tsx` are **manual, owner-run diagnostic
  pages** — `DeckeDiag.tsx` in particular has a live on-screen readout of
  `visualViewport`, scroll drift, elastic-overscroll bounce, and frame
  timing (see the excerpt at `DeckeDiag.tsx:170-220`), clearly built for
  exactly this class of iOS-viewport debugging, but it's a page a human
  opens and reads, not an automated gate, and it is gated behind
  `DESIGN_EDITOR_USER_ID`-style owner-only access (same family as
  `/design`, per `AGENTS.md` B11's own case study about this route).
  `apps/web/src/character/decke/README.md:148-151` documents the
  recipe for photographing the character for verification (stop the render
  loop, step it by hand) — relevant if any implementation work needs a
  static screenshot of the 3D character, irrelevant to the DOM/CSS defects
  in this report.

### What would need to be added to verify these 6 fixes properly

Given the above, "how to verify mobile changes on this repo" today is
**entirely manual**, per `AGENTS.md`'s own verification standard 1: open
`pnpm dev`'s served page in a real browser (or devtools device emulation)
at desktop width and at **390px width**, and *actually look*. For the
specific iOS-standalone-PWA defects reported here, devtools emulation is
insufficient for at least Defects 2/3/5 (safe-area-inset and
backdrop-filter-over-fixed-chrome behavior render differently — often not
at all — in Chrome DevTools' iPhone emulation, which does not simulate
`env(safe-area-inset-*)` non-zero values or `black-translucent` status-bar
compositing by default). A faithful verification needs one of:

1. **A real iPhone**, installed as a Home Screen PWA (matching the owner's
   original repro exactly) — the only fully faithful check, and the one
   `AGENTS.md`'s verification standard implicitly assumes is available to a
   human reviewer even though the standard's own text only names "390px
   viewport" generically.
2. **Safari's Responsive Design Mode / iOS Simulator** (macOS-only,
   presumably unavailable on this Windows machine per the environment
   block) — simulates `env(safe-area-inset-*)` correctly for a chosen
   device, and is the closest thing to (1) that doesn't need physical
   hardware.
3. At minimum, **Chrome DevTools device emulation at 390×844 (iPhone 12/13
   mini logical size) with "Show safe area" / notch overlay enabled**, plus
   manually forcing non-zero safe-area-inset values via devtools (Chrome
   supports emulating these under some flags) — a degraded but partial
   check; it would catch gross layout breaks (composer overlap, scroll
   containers) but not the exact pixel relationship to a real status
   bar/home-indicator.
4. **No automated regression gate exists or is proposed by any repo
   convention** — if this pass wants one, it would be new infrastructure
   (Playwright + device viewport presets + `env(safe-area-inset-*)`
   emulation), which is a meaningfully larger scope decision than the six
   layout defects themselves and should probably be flagged as an explicit
   open question for the implementation plan rather than assumed.

Given `AGENTS.md`'s own standard only asks for "390px viewport, actually
look at it," the pragmatic bar for this task is (3) at minimum, with (1) or
(2) as the real confirmation before calling any of the 6 defects fixed —
because several of them (safe-area padding, backdrop-filter-over-fixed-chrome)
are specifically things devtools emulation is known to under-represent.
