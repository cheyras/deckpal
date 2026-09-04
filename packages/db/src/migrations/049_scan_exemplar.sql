-- 049 · The verify flywheel: what a confirmed scan leaves behind.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- THE COMMITMENTS THIS TABLE MAKES, AND WHY THEY CANNOT BE ADDED LATER
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Owner ruling, 2026-09-04 (PLAN.md, "Sleeve-invariance addendum"), verbatim on
-- the point that matters here: finish discrimination must improve over time
-- REGARDLESS of sleeve, and the schema commitments are "FROM DAY ONE (cannot be
-- retrofitted)". Three of them:
--
--   1. Each verified scan stores embeddings from MULTIPLE FRAMES (2-3 tilts).
--      The reason is physical, not statistical: sleeve gloss slides across the
--      card as one uniform highlight when the card tilts, while card foil
--      shifts as a patterned field. One frame cannot tell those apart; two or
--      three can. A single-vector-per-scan table would be cheaper today and
--      would make the sleeve problem permanently unsolvable with the data it
--      collected, which is what "cannot be retrofitted" means.
--
--   2. An OPTIONAL SLEEVE LABEL per exemplar, filled by occasional user input
--      now and by a classifier later.
--
--   3. Evaluation and targeted collection STRATIFIED over the (finish x sleeve)
--      grid — hence the index on (variant_id, sleeve), which is what makes
--      "how many matte-sleeved reverse holos do we have" a query.
--
-- And from the main ruling: the flywheel stores EMBEDDINGS BY DEFAULT, not user
-- photographs. Retaining a crop is a separate, opt-in tier. The consent
-- machinery below is that tier, and it is enforced rather than intended — see
-- "WHY A TRIGGER".
--
-- ══════════════════════════════════════════════════════════════════════════════
-- TWO TABLES, BECAUSE A FRAME IS NOT AN EXEMPLAR
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `scan_exemplar` is the LABELLED EVENT: this reader confirmed that this
-- capture is this card, in this printing, in this sleeve, on this build.
-- `scan_exemplar_frame` is the EVIDENCE: one row per frame, each with its own
-- vector. The alternative — an array of vectors on one row — is not available
-- in any useful form (pgvector indexes a column, not an element of an array),
-- and would have made per-frame quality metadata a parallel array, which is the
-- shape that goes wrong the first time somebody filters one and not the other.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHAT IS STORED ABOUT THE MACHINE'S OWN GUESS, AND WHY
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `identity_level` and `identity_similarity` record what the matcher SAID
-- before the reader corrected or confirmed it. That pair is the entire
-- calibration dataset for the confidence gate: "of the scans we called
-- confident, how many did the reader change" is the question
-- p2-work/phash-on-crops answered by hand for dHash (0 correct out of 4) and
-- the question this column pair answers continuously, without anybody
-- photographing anything on purpose.
--
-- `corrected` is therefore a first-class column and not derivable: the reader
-- may confirm the top candidate, pick a different one from the top-5, or search
-- the catalogue outright, and only the write path knows which happened.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- SLEEVE IS TEXT + CHECK, NOT AN ENUM TYPE
-- ══════════════════════════════════════════════════════════════════════════════
--
-- A Postgres ENUM would be the tidier declaration and the wrong one here.
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block against a
-- pre-existing type, and this project's migration runner wraps EVERY migration
-- in one (packages/db/src/migrate.ts). So the day somebody needs 'sleeve +
-- toploader' or a brand-specific class, an enum makes that migration
-- impossible to write in the house style. TEXT + CHECK costs nothing and stays
-- extensible; 003 makes the same call for `card.category`.
--
-- NULL is a real and expected value: it means nobody has said. It is NOT
-- 'none' — an unsleeved card and an unasked question are different facts, and
-- collapsing them would poison exactly the stratification this table exists for.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The rule is: a retained crop requires recorded consent. The consent lives on
-- the exemplar and the crop reference lives on the frame, and a CHECK
-- constraint cannot see another table. A trigger can, and this one refuses the
-- write rather than repairing it.
--
-- The same reasoning as contract B1's `image_object` -> `image_asset` foreign
-- key: a stored image with no provenance record is made UNREPRESENTABLE rather
-- than merely discouraged. Here the fact being made unrepresentable is a
-- retained photograph of somebody's card with no record that they agreed.
--
-- WITHDRAWING CONSENT IS DELIBERATELY A TWO-STEP. Setting `crop_consent_at`
-- back to NULL while crops are still referenced raises. The caller must delete
-- the objects and clear `crop_object_key` first, and then withdraw. An
-- ON DELETE-style cascade here would let the row say "no consent" while the
-- bytes were still in the bucket, which is the exact state the tier must not
-- be able to reach.

CREATE TABLE scan_exemplar (
  id                  BIGSERIAL   PRIMARY KEY,
  user_id             uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- What the reader confirmed. Never the matcher's guess — see `identity_*`.
  card_id             BIGINT      NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  -- The printing. NULL means the reader was not asked (single-variant card) or
  -- has not answered; per the ruling a multi-variant card cannot be COMMITTED
  -- with a null variant, but it can certainly be recorded as an exemplar with
  -- one, and pretending otherwise would throw away the identity evidence.
  variant_id          BIGINT      REFERENCES card_variant(id) ON DELETE SET NULL,
  -- NULL = nobody has said. Not the same as 'none'. See the header.
  sleeve              TEXT,
  -- What the matcher claimed, before the reader had their say.
  identity_level      TEXT        NOT NULL,
  identity_similarity REAL,
  -- TRUE when the reader chose something other than the matcher's top-1.
  corrected           BOOLEAN     NOT NULL DEFAULT FALSE,
  -- packages/matching `embedStamp()`. Frames of one exemplar share it; a
  -- re-embed under a new stamp is a new exemplar, not an edit of this one.
  pipeline            TEXT        NOT NULL,
  -- The DETECTOR's PIPELINE_VERSION (apps/web/src/scan/engine/frame.ts), which
  -- owns that number. Recorded here because an exemplar's crop geometry depends
  -- on which canonical frame produced it, and a corpus that cannot be split by
  -- that is a corpus that silently mixes two datasets.
  frame_pipeline_version SMALLINT NOT NULL,
  -- Build attribution, same shape and the same reason as decke_turn (043):
  -- "did this get worse, and when" must be a query.
  build_pr            INTEGER,
  build_sha           TEXT,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ── the OPT-IN crop-retention tier ──────────────────────────────────────────
  -- Default OFF. `crop_retained` is the reader's standing choice; the timestamp
  -- is when they made it, which is the auditable half and the one the trigger
  -- checks. Both must be set for a crop to exist anywhere.
  crop_retained       BOOLEAN     NOT NULL DEFAULT FALSE,
  crop_consent_at     TIMESTAMPTZ,
  CONSTRAINT scan_exemplar_sleeve_check
    CHECK (sleeve IS NULL OR sleeve IN ('none', 'penny', 'matte', 'gloss', 'toploader')),
  CONSTRAINT scan_exemplar_identity_level_check
    CHECK (identity_level IN ('confident', 'uncertain', 'none')),
  CONSTRAINT scan_exemplar_similarity_range
    CHECK (identity_similarity IS NULL OR identity_similarity BETWEEN -1 AND 1),
  -- The flag and the record of consent travel together or not at all. A
  -- `crop_retained` with no timestamp is a claim nobody can audit.
  CONSTRAINT scan_exemplar_consent_pair
    CHECK ((crop_retained AND crop_consent_at IS NOT NULL) OR (NOT crop_retained))
);

-- "This reader's exemplars, newest first" — the account-history read, and the
-- one a deletion request starts from.
CREATE INDEX scan_exemplar_user_idx ON scan_exemplar (user_id, captured_at DESC);

-- THE STRATIFICATION INDEX, which is commitment (3) of the addendum: counting
-- and sampling across the (finish x sleeve) grid. `variant_id` stands in for
-- finish because the catalogue's variant IS the printing's finish.
CREATE INDEX scan_exemplar_variant_sleeve_idx ON scan_exemplar (variant_id, sleeve);

-- "Everything collected under this pipeline", for building an evaluation set
-- that is not silently two datasets.
CREATE INDEX scan_exemplar_pipeline_idx ON scan_exemplar (pipeline, frame_pipeline_version);

-- The calibration read: of the scans the gate called confident, which were
-- corrected. Partial, because the interesting rows are the confident ones and
-- indexing the rest would triple it for no query.
CREATE INDEX scan_exemplar_calibration_idx ON scan_exemplar (identity_level, corrected)
  WHERE identity_level = 'confident';

CREATE TABLE scan_exemplar_frame (
  exemplar_id     BIGINT      NOT NULL REFERENCES scan_exemplar(id) ON DELETE CASCADE,
  -- 0,1,2… in capture order. Order is meaningful: the tilt sequence is the
  -- signal, so a frame that loses its position loses most of its value.
  frame_index     SMALLINT    NOT NULL,
  embedding       vector(384) NOT NULL,
  -- The detector's own view of this frame, for weighting later: how much of the
  -- reticle the card filled, and how sharp it was. Nullable because a frame
  -- recorded before those were measured is still a usable vector.
  inside_fraction REAL,
  sharpness       REAL,
  -- Storage key of the retained crop, in the same bucket algebra as card art
  -- (packages/storage). NULL is the DEFAULT and the norm: the flywheel keeps
  -- vectors, not photographs. Non-NULL requires consent — enforced below.
  crop_object_key TEXT,
  PRIMARY KEY (exemplar_id, frame_index),
  CONSTRAINT scan_exemplar_frame_index_range CHECK (frame_index BETWEEN 0 AND 15),
  CONSTRAINT scan_exemplar_frame_inside_range
    CHECK (inside_fraction IS NULL OR inside_fraction BETWEEN 0 AND 1)
);

CREATE OR REPLACE FUNCTION scan_exemplar_crop_requires_consent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  consented TIMESTAMPTZ;
BEGIN
  IF NEW.crop_object_key IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT crop_consent_at INTO consented FROM scan_exemplar WHERE id = NEW.exemplar_id;
  IF consented IS NULL THEN
    RAISE EXCEPTION
      'scan_exemplar_frame (%, %): a retained crop requires recorded consent on '
      'the exemplar (crop_consent_at is NULL). The flywheel stores embeddings by '
      'default; crop retention is opt-in.',
      NEW.exemplar_id, NEW.frame_index;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scan_exemplar_frame_consent
  BEFORE INSERT OR UPDATE OF crop_object_key ON scan_exemplar_frame
  FOR EACH ROW EXECUTE FUNCTION scan_exemplar_crop_requires_consent();

CREATE OR REPLACE FUNCTION scan_exemplar_withdrawal_clears_crops() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  remaining INTEGER;
BEGIN
  IF NEW.crop_consent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO remaining
    FROM scan_exemplar_frame
   WHERE exemplar_id = NEW.id AND crop_object_key IS NOT NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'scan_exemplar %: cannot withdraw crop consent while % retained crop(s) are '
      'still referenced. Delete the objects and clear crop_object_key first — a '
      'row that says "no consent" while the bytes are still in the bucket is the '
      'state this tier must not be able to reach.',
      NEW.id, remaining;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER scan_exemplar_withdrawal
  BEFORE UPDATE OF crop_consent_at ON scan_exemplar
  FOR EACH ROW EXECUTE FUNCTION scan_exemplar_withdrawal_clears_crops();

COMMENT ON TABLE scan_exemplar IS
  'One verified scan: what the reader confirmed, what the matcher had claimed, '
  'and under which pipeline. The verify flywheel''s labelled event. Stores no '
  'imagery itself — see scan_exemplar_frame.';

COMMENT ON TABLE scan_exemplar_frame IS
  'Per-frame evidence for one exemplar: 2-3 tilts, each with its own embedding. '
  'Multiple frames are a day-one commitment of the 2026-09-04 sleeve-invariance '
  'ruling, not an optimisation: sleeve gloss and card foil are separable across '
  'tilts and indistinguishable within one. crop_object_key is NULL unless the '
  'reader opted into crop retention, which a trigger enforces.';

COMMENT ON COLUMN scan_exemplar.sleeve IS
  'none|penny|matte|gloss|toploader, or NULL for "nobody has said" — which is a '
  'different fact from "none" and must not be folded into it.';
