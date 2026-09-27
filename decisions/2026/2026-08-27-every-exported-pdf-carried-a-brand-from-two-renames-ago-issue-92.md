---
date: "2026-08-27"
title: "Every exported PDF carried a brand from two renames ago (issue #92)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-27 — Every exported PDF carried a brand from two renames ago (issue #92)
**Decided by:** Claude Opus 5 on behalf of @cheyras

**The defect.** `header()` in `apps/api/src/export/pdf.ts` drew the literal
string `'pokédex'` as the title band's right-aligned brand mark. Every deck
export, list export and set checklist this product has ever produced shipped
with it. The same page's footer stamp said `DeckPal · deck export · …` and the
document's `Author` said `DeckPal`, so a single sheet of paper carried two
different product names — and the older one is two renames stale
(pokédex → DeckScout → DeckPal).

**Root cause, and why the fix is a constant.** The brand was spelled out as
five separate string literals in one file: the header mark, three footer
stamps, and the `Author` field. The renames swept four and missed one, because
nothing connects those literals to each other and nothing renders a PDF where a
reviewer would see it. There is now one `BRAND` constant and the five sites
read from it, so the next rename has one place to land. That is the whole
behavioural change; the constant's value is the string the other four already
had, which is why the before/after `pdftotext` diff is exactly one line per
document.

**The other direction matters just as much.** `pokedex` is *also* a live
feature name in this product — the `/pokedex` route, the `pokedex_binder` list
kind, the "Pokédex binder" label, and the `Pokédex` pseudo-set-id on species
rows. Those are correct and were deliberately left alone. This is not a
hypothetical: a previous `pokedex → deckpal` sweep hit the API path and 404'd
every species page, a scar still commented in `apps/web/src/lib/api.ts`. So the
regression suite pins **both** directions — the brand mark must say DeckPal,
and the feature labels must survive — and `BRAND`'s doc comment says which is
which.

**Verified by rendering actual PDFs, not by reading the diff.** A throwaway
harness (in the agent's scratchpad, not `scripts/` — B1) called the three
builders with fixture data and wrote real files. `pdftotext` before: header
`pokédex`; after: `DeckPal`; the diff is one line per document and nothing
else moved. The pages were then rasterised with the Windows built-in
`Windows.Data.Pdf` renderer and **looked at**: the before shows a red `pokédex`
top-right over a `DeckPal` footer, the after shows `DeckPal` in both, and the
list export still reads "Pokédex binder list" with per-row "Pokédex".

**A test that fails first.** `apps/api/src/export/__tests__/pdf.test.ts` renders
each export to a buffer, inflates the Flate content stream and rejoins pdfkit's
kerned `[<hex> … ] TJ` runs into the strings actually drawn on the page. It
asserts on the PDF's bytes rather than on the module's own constant, because a
test that imports the literal it is checking proves nothing. Against the
pre-fix file: **6 of 9 fail** (the 3 that pass are the footer-stamp assertions,
which were already correct — matching the bug report exactly). After: **9/9**.
Wired into CI as its own `test:export` step, since CI does not run
`pnpm -r test` and an unwired suite never runs at all.

**Also fixed:** the stale comment on `.brand-wordmark` in
`apps/web/src/theme.css`, which described the app logotype as rendering
"Pokédex". All six call sites render `DeckPal`; only the comment was left
behind by the 2026-08-09 rename. Comment-only, no CSS changed.

**Implications.**
- Add brand text to a PDF through `BRAND`, never as a literal.
- `BRAND` is the *product* name. The dex feature kept its name; do not let a
  future rename sweep `pokedex_binder`, `/pokedex`, or the "Pokédex" labels.
- No env var, no schema, no infra: B9 and B11 are not in play.

---

