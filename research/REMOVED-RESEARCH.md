# REMOVED-RESEARCH.md — documents that used to live in `research/`, and why they don't

**Date:** 2026-08-31 · **Decided by:** repo owner (@cheyras)

Three research documents were removed from this directory on the date above.
They are named here so that a citation to one of them, in a document or a code
comment that survived, resolves to an explanation rather than to nothing.

| Removed file | What it was |
|---|---|
| `BEHAVIOR-SPEC.md` | A reverse-specification of a third-party collection tracker's interaction behaviour, written from its help-centre articles and from browser captures of its pages. |
| `ROUTE-MAP.md` | The same product's URL and information-architecture structure, extracted from those captures. |
| `INTERACTION-CAPTURE.md` | A second capture pass over the same product — motion, hover/focus states, breakpoints, view geometry. |

## Why they went

DeckPal was built after studying an existing product in the same category. That
study produced two different kinds of document, and only one of them is ours to
keep:

- **Documents describing DeckPal's own design**, which cite that study as
  evidence. `SCHEMA.md`, `DECK-FORMATS.md` and `TCGCSV-VARIANTS.md` are these.
  The analysis, the schema, the rules and the measurements are original work.
  They stay; their attributions now name "the reference tracker" rather than the
  product, because the attribution's job is to say *how confident a claim is*,
  not to advertise where it was read.
- **Documents whose entire subject is the other product** — its behaviour, its
  routes, its stylesheets. Those three describe someone else's software and
  contain nothing of DeckPal's. Rewording them would have produced a comparison
  with the compared thing removed, which is worse than either keeping or
  deleting them. They were deleted.

This follows the same call made on 2026-08-26 for `AUTH-CAPTURES.md` and
`COLLECTION-TRANSFER.md`, and completes it.

## What this means for citations

Section pointers such as `BEHAVIOR-SPEC.md §8.4` still appear in `SCHEMA.md`,
`DECK-FORMATS.md`, a handful of code comments, and in migrations `003` and `013`
(which are checksummed and immutable — see AGENTS.md B4 — so they could not have
been edited even if it were desirable). Read them as **dated provenance marks**:
they record that a claim was evidenced at the time it was written, and against
what. They are not live links, and nothing in the codebase needs them to be.

Where a claim actually matters, it is verified somewhere that still exists — the
migrations in `packages/db/src/migrations/` are the schema of record, the pure
rule functions in `apps/api/src/insights/` carry their own unit tests, and
`DECISIONS.md` carries the dated reasoning.

## The record itself

The reasoning behind the removal, and the per-file sort, is logged in
`DECISIONS.md` under **2026-08-31 — "Retire the third-party reference surface"**.
