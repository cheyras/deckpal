## Summary

<!-- What does this PR do and why? -->

## Checklist

- [ ] Typecheck passes (`pnpm -r exec tsc --noEmit` after building `@deckpal/db`)
- [ ] Pure tests pass (`pnpm --filter deckpal-api test:deck`)
- [ ] All affected apps build successfully
- [ ] UI changes: verified in a real browser at desktop **and** 390px viewport; screenshots attached below
- [ ] Migrations: new file only (never edited a shipped `.sql`)
- [ ] A file in `decisions/YYYY/` added if this involves a non-trivial decision (`pnpm decisions new "Title"`)
- [ ] `research/SCHEMA.md` updated if the schema changed

## Screenshots

<!-- For UI changes: desktop and 390px viewport. Delete this section if not applicable. -->

## Test plan

<!-- How did you verify this works? What did you check beyond the checklist? -->
