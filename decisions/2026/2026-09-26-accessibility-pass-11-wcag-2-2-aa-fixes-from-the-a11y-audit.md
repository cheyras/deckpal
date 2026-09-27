---
date: "2026-09-26"
title: "Accessibility pass: 11 WCAG 2.2 AA fixes from the a11y audit"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Accessibility pass: 11 WCAG 2.2 AA fixes from the a11y audit

**Decided by:** Chey (via Claude)

**Decision:** Implemented A11Y-01 through A11Y-11 from the a11y audit
(scratchpad audits/a11y.md), on branch fix/accessibility-pass. In order: the
Card Detail copy-link button now actually copies the canonical card URL and is
named; a skip link now renders app-wide (was landing-page-only); inactive
nav-rail icons and FilterControls' sort-chip chevrons moved off tokens that
measured 2.15:1 and 1.26:1 against their real backgrounds; Set Detail's title
is wrapped in a real h1 regardless of whether a set has a logo image; the
mobile nav drawer gained aria-modal, a Tab trap, and initial/return focus;
Deck-E's chat panel gained aria-expanded on its launcher (see below for what
was deliberately left alone); the disabled binder-view select became plain
text; the danger-button fill and text-muted tokens were retuned for contrast;
the New List/New Deck forms keep Submit enabled and explain an empty-name
refusal instead of silently disabling it; Auth's sign-in/sign-up tablist
gained arrow-key navigation and aria-controls/role=tabpanel wiring; and SPA
route changes are now announced to screen readers via a visually-hidden live
region.

**Why:** Each is argued in the audit doc; three judgment calls are worth
recording because they depart from the audit's literal suggested fix:

1. Deck-E's chat panel keeps NO aria-modal, on purpose. DeckeChat.tsx already
   carries an extensive comment explaining that the header and sidebar are
   deliberately reachable while the panel is open — a considered rejection of
   true modality, not an oversight. Adding aria-modal="true" would make the
   markup lie about that design. What WAS missing (and is now fixed) is
   aria-expanded on the launcher button. Focus-into-composer (desktop) and
   focus-return-on-close were already correctly implemented; an initial probe
   suggesting otherwise turned out to be a fixture gap (the shared admin.mjs
   fixture defaults state.balance to 0, which renders Deck-E's "Out of
   credits" notice in place of the composer entirely) rather than a product
   bug — fixed in this worktree's own .sim/server-a11y.mjs copy, not in the
   shared fixture.

2. The danger-button fill got a NEW token pair, not a value change to the
   existing action-danger/action-danger-hover tokens. Those two are also used
   as a bare foreground/border colour on several dark surfaces (KebabMenu's
   and BattlesTab's rest-state labels, AgentAccess's hover state); darkening
   them to fix the flat "remove"/"delete" icon-buttons (3.81:1 → needs 4.5:1)
   would have dropped an already-passing foreground pairing to 3.67:1. Added
   action-danger-fill (red-600, reused from the old hover value) and
   action-danger-fill-hover (red-700, new) instead, and repointed exactly the
   8 call sites that pair a danger background with white text.

3. FilterControls' inactive sort-chip chevron does not fully clear 3:1.
   Swapping its token to icon-muted (the nav-rail's fix) only reaches 2.05:1
   there, because this chevron sits on surface-tertiary rather than
   surface-primary — a different background than the audit's cited
   measurement. Moved it to text-secondary instead (3.88:1, a genuine pass),
   a slightly less "dim" hint than before; flagged rather than silently
   claiming the audit's literal token swap as a full fix.

**Implications:** text-muted moved from #8b847e to #948d87 (app-wide — every
existing use gets more contrast, none regresses: 4.75→5.35:1 on
surface-primary, 4.12→4.64:1 on surface-secondary). New tokens:
action-danger-fill, action-danger-fill-hover. A small axe-core regression
gate (tests/browser/a11y.mjs, wired into pnpm test:browser) now runs on 3
routes at 390px on every CI run — a future button-name/select-name/contrast-
shaped regression on those routes fails the suite instead of waiting for the
next manual audit. axe-core is a new devDependency (workspace root). See the
PR description for axe before/after counts, screenshots, and exact contrast
ratios.

**Update (same day, post-review):** Astra's independent review (codex review
--base origin/main) found 3 valid P2 findings, all fixed before merge with
origin/main's #220: the mobile nav drawer had no in-dialog dismiss control
(added a labelled "Close navigation" button — `aria-modal="true"` can make
the header's own toggle unreachable to AT that honors modality); the route
announcer's text-equality dedup treated a STALE heading — kept mounted by
TanStack Query's `keepPreviousData` while a new catalog page's data loads —
as "this navigation is done," so the real heading was never announced once it
actually arrived (removed the dedup; `aria-live` only fires on a genuine text
change, so writing unconditionally is safe); and the announcer's 4s fallback
was checked only inside the `MutationObserver`'s own callback, so a route
that fails fast with no further DOM mutations never triggered it (replaced
with an independent `setTimeout`). Full disposition posted on the PR.

**Update 2 (same day, caught by CI, not by review):** The Astra fix above
introduced a real regression — writing `routeAnnouncer.textContent`
unconditionally on every call, combined with observing `document.body`'s
whole subtree (`routeAnnouncer` was a sibling of the React root under
`body`), meant every write was itself an observed mutation: write → new
mutation record → callback fires → writes again → forever. `.textContent`
tears down and recreates its text node on every assignment regardless of
whether the string changed, so this looped even when the announced text was
already correct. Effect: the main thread livelocked on an unbounded chain of
`MutationObserver` microtasks on the FIRST route render of every single page
load, and never yielded again — reproduced in isolation via
`tests/browser/upcoming.mjs`'s `checkUpcoming` (`page.goto` completes, then
every subsequent Playwright call, including a bare `body.innerText()` read,
times out because the tab is completely unresponsive). This is what broke
CI's `browser` job twice in a row — not flakiness, as first assumed. Fixed by
observing the React root (`#root`) instead of `document.body`;
`routeAnnouncer` is a sibling of it, not a descendant, so writing its text no
longer feeds back into the observer. Verified by reproducing `checkUpcoming`
again (clean at both viewports) and re-running the Astra-fix verification
live (drawer close button and the keepPreviousData announcer case both
correct, no hang).

