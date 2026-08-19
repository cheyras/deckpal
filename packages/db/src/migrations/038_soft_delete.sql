-- 038 · Soft delete for lists and decks.
--
-- Until now `delete_list` and `delete_deck` said so in their own tool
-- descriptions: permanent, cascading, no undo. Deleting a deck took its entire
-- version history and every battle log attached to it. That is a stated
-- permanent-loss path in a product whose other write paths all dry-run first,
-- and it is the one hole the mutation log (036) could not fill: you cannot undo
-- a row that Postgres has already cascaded away.
--
-- So delete becomes reversible, and destruction becomes a separate, explicit
-- act ("purge") that the caller has to ask for by name.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Retention: indefinite, and said out loud
-- ══════════════════════════════════════════════════════════════════════════════
--
-- There is no timer. A soft-deleted row is kept until the owner purges it.
--
-- The alternative — "we keep it 30 days" — would need a scheduled sweeper this
-- project does not have, and an unenforced retention promise is worse than an
-- honest indefinite one: it reads as "gone soon" while the rows sit there for
-- ever. Indefinite retention is a real privacy consequence of this migration,
-- so it is documented in SECURITY.md and the purge path is reachable from every
-- surface that can delete (REST, MCP, UI), not buried.
--
-- Account deletion is unaffected: every one of these tables already cascades
-- from `app_user`, so removing a user still removes their soft-deleted rows.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- Why this is only two columns
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `list_item`, `binder_placement`, `deck_card`, `deck_version` and `battle_log`
-- all cascade from their parent. Soft delete never fires those cascades, so the
-- children simply stay put and a restore is `deleted_at = NULL` — nothing to
-- reconstruct. Purge does the real DELETE and the existing cascades take over.
--
-- No unique constraint mentions `name` on either table (checked: card_list has
-- only id-based uniques, deck likewise), so a soft-deleted list does not block
-- the owner from creating a new one with the same name.

ALTER TABLE card_list ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE deck      ADD COLUMN deleted_at TIMESTAMPTZ;

-- Every read filters `deleted_at IS NULL`, so the live-row indexes are partial:
-- they stay the size of the live set no matter how much is in the recycle bin.
CREATE INDEX card_list_live_idx ON card_list (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX deck_live_idx      ON deck      (user_id, updated_at DESC) WHERE deleted_at IS NULL;

-- The recycle-bin listing.
CREATE INDEX card_list_deleted_idx ON card_list (user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX deck_deleted_idx      ON deck      (user_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN card_list.deleted_at IS
  'Soft delete. Non-NULL rows are hidden from every read and restorable until an explicit purge. Retained indefinitely.';
COMMENT ON COLUMN deck.deleted_at IS
  'Soft delete. Non-NULL rows are hidden from every read and restorable until an explicit purge. Retained indefinitely.';
