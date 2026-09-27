---
date: "2026-08-11"
title: "Delete buttons buried in a kebab menu (issue #34)"
decided_by: "agent, per issue #34 (\"bury it in a kebab menu... do this in"
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Delete buttons buried in a kebab menu (issue #34)

**Decided by:** agent, per issue #34 ("bury it in a kebab menu... do this in
every similar instance, not just on this page").

**Decision:** Added a reusable `KebabMenu` component
(`apps/web/src/components/KebabMenu.tsx`) — a trigger button + dismissible
dropdown, outside-click/Escape to close — and used it at the two call sites
that matched the reported pattern: a standalone, always-visible,
danger-colored icon button that deletes the whole entity, sitting directly
next to the entity's editable title.

1. `apps/web/src/routes/DeckBuilder.tsx` — deck header, replaced the bare
   "Delete deck" button with the kebab trigger.
2. `apps/web/src/routes/ListDetail.tsx` — list header, same replacement for
   "Delete list".

Both still open the exact same, unmodified `ConfirmModal` flow on click — only
the trigger changed. The menu itself carries one item today
(`{ key: 'delete', label: '...', danger: true }`); only that item is
danger-colored, not the menu chrome. Added a `kebab` icon (three vertical
dots) to `Icon.tsx` for the trigger.

**Scope confirmed, not touched:** grepped every `text-action-danger` /
`bg-action-danger` button in `apps/web/src` (`ListDetail.tsx:97` "Remove
{item}", `Profile.tsx:301` "Remove showcase card", `CardTile.tsx:278` hover
remove, `AgentAccess.tsx:330` "Revoke" token). All are per-row/per-item
actions inside a list, not a whole-entity delete beside a page title, and stay
as quick, visible actions on purpose. `BattlesTab.tsx`'s "Delete Log" is
already behind progressive disclosure (only rendered once a battle-log row is
expanded) — not "in the open" the way the issue describes, so it was left
alone too.

**Why:** The issue explicitly asked for a reusable component ("do this in
every similar instance"), not a one-off fix, and DeckPal's stated
convention is that repeated UI patterns become shared components. Built to
hold more than one item on purpose — a real menu, not a delete button
wearing a costume — even though only one item exists at either call site
today.

**Verified:** `pnpm --filter deckpal-web typecheck` clean. Browser
(Playwright, QA account) against a local dev build in cloud mode
(`.env.cloud`), proxying `/api` straight to the deployed `deckpal.app` API
for this pass — a purely frontend change, so no local `apps/api` instance was
needed (the vite.config.ts proxy tweak was reverted before commit). Created
and later cleaned up a throwaway deck and a throwaway list on the QA account:
confirmed the bare delete button is gone, the kebab trigger renders in its
place, opening it reveals the menu, outside-click and Escape both dismiss it,
"Delete deck"/"Delete list" opens the same `ConfirmModal`, and Cancel leaves
the deck/list intact. Screenshotted closed + open on both pages at desktop
and 390px.

**Implications:** Future whole-entity-delete-next-to-a-title UI should reach
for `KebabMenu` first rather than a bare danger icon button.

_Filed by agent on behalf of @cheyras — 2026-08-11._

