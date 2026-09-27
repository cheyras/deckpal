# DeckPal decisions

Each decision has its own dated file under [`decisions/YYYY/`](decisions/). New decisions go there; this guide stays short so parallel pull requests do not all edit the same file.

- Add one: `pnpm decisions new "Short title"`, fill in the template, then run `pnpm decisions:check`.
- Find one: `pnpm decisions list`, `pnpm decisions recent`, `pnpm decisions search "phrase"`, or `pnpm decisions show <date-or-title>`.
- Resolve an old `DECISIONS.md YYYY-MM-DD` citation: use the [historical index](decisions/INDEX.md). Several decisions can share a date.
- Convert entries appended by an open branch after merging main (or while resolving that merge): `pnpm decisions adopt-branch`, stage the new files and restored guide, then complete the merge or commit. The command can be run twice safely.
- Refresh the wiki Decision Log: `pnpm decisions:wiki --output <path-to-wiki-clone>/Decision-Log.md --agent "<your agent name>"`.

The original 1.3 MB log was split without changing its entry bodies. `pnpm decisions:check` verifies every historical body's byte count and SHA-256, then reconstructs and checks the complete original document. The opening note and five undated progress sections live under [`decisions/legacy/`](decisions/legacy/). Front matter and filenames are new metadata; historical body text, punctuation, whitespace, and ordering have no normalization.
