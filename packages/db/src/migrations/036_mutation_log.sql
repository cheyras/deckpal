-- 036 · The mutation log: what an agent (or the UI, or a script) actually did,
--       with enough before/after state to undo it exactly.
--
-- WHY THIS EXISTS
--
-- On 2026-08-19 a 99-item `log_cards` call was reported to the calling agent as
-- a connector error three times running. Every one of those "failures" had in
-- fact committed its writes: the MCP function was doing one HTTP round trip to
-- deckpal-api PER ITEM (~0.65 s each, measured), so a 99-item batch outran the
-- serverless wall clock and the response died while the writes stood. The agent
-- did the reasonable thing and retried, and quantities inflated up to 4x.
--
-- Recovering from that required hand-deriving 92 corrective deltas out of
-- `collection_event` under time pressure, because the only durable record was a
-- stream of signed deltas with no notion of "these 99 rows were ONE operation"
-- and no notion of "this operation has already been applied".
--
-- Two facts have to become representable in the schema for that class of
-- incident to stop being expensive:
--
--   1. A batch is a thing. It has an identity, an author, a status, and — if
--      the caller offers one — an idempotency key, so a retry after an
--      ambiguous failure is a provable no-op rather than a second application.
--   2. A change knows what it changed FROM. Deltas alone are what made the
--      recovery hard; every event here carries a `before` and an `after`.
--
-- WHAT THIS IS NOT
--
-- It is not a replacement for `collection_event`. That table is the collection's
-- own activity feed, it is what the stream overlay and the Activity view read,
-- and it predates this by seven migrations. `collection_event.batch_id` (below)
-- joins the two so one row can answer both "what happened to this card" and
-- "what operation did it belong to". Coverage begins the day this migration
-- ships; history written before it has no batch.
--
-- APPEND-ONLY, DELIBERATELY
--
-- `mutation_event` has no UPDATE path and no `reverted_by` column. A revert is
-- itself a batch whose events carry `reverts_event_id`, so "was this undone?"
-- is a query over appended rows rather than a mutable flag somebody could
-- rewrite — the same reasoning that keeps `collection_event` SELECT+INSERT only
-- (migration 021). RLS policies live in 037 (Supabase only).

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. mutation_batch — one row per mutating operation
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE mutation_batch (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

  -- Who wrote it. Same closed shape as collection_event.source (migration 018)
  -- so 'web' / 'deckpal-mcp' / an import script name mean the same thing here.
  source             TEXT NOT NULL DEFAULT 'web'
                     CONSTRAINT mutation_batch_source_shape
                     CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,39}$'),

  -- Which operation, e.g. 'log_cards', 'edit_list', 'delete_deck', 'revert'.
  tool               TEXT NOT NULL
                     CONSTRAINT mutation_batch_tool_shape
                     CHECK (tool ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  -- The caller's free-text note, carried through to every collection_event in
  -- the batch. Filtering on it is what let the incident be isolated at all.
  note               TEXT CONSTRAINT mutation_batch_note_len CHECK (char_length(note) <= 500),

  -- The idempotency key. Either supplied by the caller (then it is theirs to
  -- keep unique) or derived by the server from the batch's resolved content
  -- plus a time bucket. UNIQUE per user is the whole mechanism: a replay
  -- collides here and returns the stored response instead of writing again.
  idempotency_key    TEXT,

  -- A content hash WITHOUT the time bucket, so two batches that are byte-
  -- identical in intent can be recognised as duplicates even when they are
  -- deliberately allowed to both apply (a re-pull of the same cards a week
  -- later). Answers "have I seen this exact request before?" for warnings.
  request_fingerprint TEXT,

  status             TEXT NOT NULL DEFAULT 'pending'
                     CONSTRAINT mutation_batch_status
                     CHECK (status IN ('pending', 'committed', 'failed')),

  -- The exact payload the caller was given, replayed verbatim on a duplicate
  -- key. Storing the RESPONSE (not just the inputs) is what makes a replay
  -- indistinguishable from the original success.
  response           JSONB,
  summary            JSONB,

  -- Set when this batch is a revert, naming the batch it undoes. Whole-batch
  -- reverts only; per-event linkage lives on mutation_event.reverts_event_id,
  -- because a revert may target a single event, a time window, or one entity
  -- and therefore span or subset any number of batches.
  reverts_batch_id   UUID REFERENCES mutation_batch(id) ON DELETE SET NULL,

  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ
);

-- The replay lookup. Partial because most batches (dry runs never get here, and
-- UI writes do not bother) carry no key, and NULLs must not collide.
CREATE UNIQUE INDEX mutation_batch_idem_uq
  ON mutation_batch (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The history feed.
CREATE INDEX mutation_batch_user_started_idx ON mutation_batch (user_id, started_at DESC);
-- "have I seen this exact request lately?"
CREATE INDEX mutation_batch_fingerprint_idx
  ON mutation_batch (user_id, request_fingerprint, started_at DESC)
  WHERE request_fingerprint IS NOT NULL;

COMMENT ON TABLE  mutation_batch IS
  'One row per mutating operation. Carries the idempotency key that makes a retry after an ambiguous failure a no-op.';
COMMENT ON COLUMN mutation_batch.response IS
  'The exact response the caller received. Replayed verbatim when a duplicate idempotency key arrives.';
COMMENT ON COLUMN mutation_batch.idempotency_key IS
  'Caller-supplied, or server-derived as <content fingerprint>#<15-minute bucket>. UNIQUE per user.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. mutation_event — one row per thing changed, with before AND after
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE mutation_event (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id          UUID NOT NULL REFERENCES mutation_batch(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

  -- What kind of thing changed, and which one. entity_id is TEXT because the
  -- app's ids are variously BIGINT (card_variant) and UUID (list, deck, item).
  entity_type       TEXT NOT NULL
                    CONSTRAINT mutation_event_entity_type
                    CHECK (entity_type IN ('collection_item', 'card_list', 'list_item', 'deck', 'deck_card',
                                           'deck_strategy', 'battle_log')),
  entity_id         TEXT NOT NULL,

  -- e.g. 'quantity.delta', 'quantity.set', 'list.create', 'list.rename',
  -- 'list.item.add', 'list.item.remove', 'list.delete', 'deck.delete',
  -- 'deck.strategy.set', 'battle_log.create'.
  operation         TEXT NOT NULL
                    CONSTRAINT mutation_event_operation_shape
                    CHECK (operation ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),

  -- The whole point. `before` is NULL when the entity did not exist; `after` is
  -- NULL when it no longer does.
  before            JSONB,
  after             JSONB,

  -- Numeric changes only, and BOTH numbers, because they can differ: the
  -- collection clamps to [0, 100000], so a requested -3 against a quantity of 1
  -- has an effective delta of -1. Reverting the REQUESTED value would be wrong
  -- and reverting the EFFECTIVE value is only right while nothing clamped —
  -- storing both is what lets revert detect the difference and refuse.
  requested_delta   INTEGER,
  effective_delta   INTEGER,

  -- Set when this event is the undo of an earlier one. Append-only linkage:
  -- there is no UPDATE on this table, so "was event X reverted?" is
  -- `EXISTS (SELECT 1 FROM mutation_event WHERE reverts_event_id = X)`.
  reverts_event_id  BIGINT REFERENCES mutation_event(id) ON DELETE SET NULL,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mutation_event_batch_idx  ON mutation_event (batch_id, id);
CREATE INDEX mutation_event_feed_idx   ON mutation_event (user_id, occurred_at DESC, id DESC);
CREATE INDEX mutation_event_entity_idx ON mutation_event (user_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX mutation_event_reverts_idx ON mutation_event (reverts_event_id) WHERE reverts_event_id IS NOT NULL;

COMMENT ON TABLE  mutation_event IS
  'Append-only: one row per changed thing, with before/after snapshots. Never UPDATEd — a revert appends its own events.';
COMMENT ON COLUMN mutation_event.requested_delta IS
  'What the caller asked for. Differs from effective_delta whenever the [0,100000] clamp bit.';
COMMENT ON COLUMN mutation_event.effective_delta IS
  'What actually changed. Reverting this is only exact when it equals -requested_delta.';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Join the collection's own feed to the new batches
-- ══════════════════════════════════════════════════════════════════════════════
-- Nullable and unindexed-by-default on purpose: every row written before this
-- migration legitimately has no batch, and the column is read by batch, which
-- the partial index below serves.

ALTER TABLE collection_event
  ADD COLUMN batch_id UUID REFERENCES mutation_batch(id) ON DELETE SET NULL;

CREATE INDEX collection_event_batch_idx ON collection_event (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN collection_event.batch_id IS
  'The mutation_batch this change belonged to. NULL for anything written before migration 036.';
