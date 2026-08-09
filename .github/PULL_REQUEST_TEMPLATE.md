## Summary

<!-- What does this PR do and why? -->

## Checklist

- [ ] Typecheck passes (`pnpm -r exec tsc --noEmit` after building `@deckscout/db`)
- [ ] Pure tests pass (`pnpm --filter deckscout-api test:deck`)
- [ ] All affected apps build successfully
- [ ] UI changes: verified in a real browser at desktop **and** 390px viewport; screenshots attached below
- [ ] Migrations: new file only (never edited a shipped `.sql`)
- [ ] `DECISIONS.md` entry added if this involves a non-trivial decision
- [ ] `research/SCHEMA.md` updated if the schema changed

## Screenshots

<!-- For UI changes: desktop and 390px viewport. Delete this section if not applicable. -->

## Test plan

<!-- How did you verify this works? What did you check beyond the checklist? -->
