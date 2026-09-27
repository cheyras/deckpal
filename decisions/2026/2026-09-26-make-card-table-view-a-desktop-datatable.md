---
date: "2026-09-26"
title: "Make card Table view a desktop DataTable"
decided_by: "Chey (via Codex)"
areas: ["frontend","catalog"]
supersedes: ["PERF-03 mobile counter compromise and separate-card table layout"]
---
## 2026-09-26 — Make card Table view a desktop DataTable
**Decided by:** Chey (via Codex)

**Decision:** The list and set Table views use the shared semantic `DataTable`, with one continuous surface, aligned columns, row dividers, and inline quantity counters. `DataTable` now offers opt-in window virtualization for complete local result sets; existing paged admin tables keep their previous behavior. Below 768px, the view toggle offers Grid and Binder. A saved `view=table` URL displays Grid at that width without changing the URL, so Table returns when the viewport widens.

**Why:** The earlier header over separated card tiles did not read as a table. Chey asked for a proper table component and a desktop-only treatment. Keeping the focused virtual row mounted also closes Astra's keyboard focus finding: scrolling the page no longer removes the link that must regain focus after the card sheet closes.

**Implications:** This supersedes the mobile counter compromise and the earlier claim in the PERF-03 entry that `DataTable` was unsuitable: the shared component now supports both its existing paged callers and the opt-in 3,200-row list. Headless Chromium on the same fixture, under the shared heavy-browser lock, measured desktop DOM nodes at 532 before and 574 after; browser task time was 93 ms before and 90 ms after (load averages about 18 and 14). The focused browser regression bounds both DOM size and visible-load time, checks the 390px fallback and URL preservation, column alignment, sorting, row opening, deep scroll, and focus return. Native browser find and print still see only mounted rows; Print checklist remains server generated. The before/after board is in the handoff folder for the supervisor to publish.
An independent review found that the shared virtualizer also needs the body's saved scroll position while a sheet fixes the body in place. It measures that position during the lock and remeasures when the body unlocks; the browser regression checks a deep row while the sheet is open and after it closes.
The focused 3,200-row regression is registered in the browser shard inventory, so pull-request CI enforces its DOM and visible-load bounds. Modified and middle clicks on a row cell open the card in a new tab, as they did when the whole row was a link.
The final desktop treatment keeps rows at the 69px height set by the 52px card art and its padding, centers every cell vertically, and shows a dash for cards without a variant. Narrower column widths let all six columns fit from the 768px Table breakpoint upward; long variant labels truncate inside their cell and retain their full title on hover. A plain click on a non-link cell focuses the card link before opening its sheet, so closing the sheet returns keyboard focus to the row.
When Deck-E asks to reveal an off-screen card in Table view, the virtual table now keeps that row mounted at its document position. Deck-E's flight owns the scroll to it, matching Grid view's single-scroll behavior.
