-- @supabase-only
-- 056 · Security and the write path for the $1 experiment (055).
--
-- Same shape as 054, and for the same reason: the subject of a measurement does
-- not get to write the measurement. Here that is sharper than usual, because
-- `ab_presets` decides which ladder somebody sees — an account that could set
-- its own arm could also, with a script, stuff the experiment.
--
-- Depends on: 055_billing_ab, 054_billing_rls, 053_billing.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. RLS — read your own events, write none of them
-- ══════════════════════════════════════════════════════════════════════════════
--
-- SELECT is granted rather than withheld only because it costs nothing: these
-- are rows about the reader, and a person asking "what has this app recorded
-- about me" deserves an answer. Nothing in the app reads them; the analysis is
-- an owner's SQL query.

ALTER TABLE billing_ab_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_ab_event_select ON billing_ab_event
  FOR SELECT USING (user_id = (SELECT auth.uid()));

REVOKE ALL    ON public.billing_ab_event FROM authenticated, anon;
GRANT  SELECT ON public.billing_ab_event TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Assignment, folded into the visit counter
-- ══════════════════════════════════════════════════════════════════════════════
--
-- `billing_touch_visit()` already runs exactly once per session per account and
-- is the first billing thing that happens on any app load, so it is the natural
-- place to bucket somebody: everyone who could possibly see the ask gets an arm,
-- and they get it before they see anything.
--
-- COALESCE, not an assignment: the arm is written when it is NULL and never
-- again, including on the next visit, including if this function is later
-- edited. The whole validity of the experiment rests on that word.
--
-- `random()` rather than a hash of the user id. A hash is reproducible, which
-- sounds like a virtue until somebody changes the salt or the bucket count and
-- silently re-randomises a running experiment; a stored coin flip cannot be
-- re-derived and therefore cannot be accidentally re-derived differently.
--
-- NOTE the unconditional-assignment trap this avoids: the UPDATE below sets the
-- arm on EVERY call, not only inside the six-hour visit branch. If assignment
-- lived in that branch, an account whose last visit was under six hours ago
-- would keep a NULL arm and be shown the default ladder while being counted as
-- unassigned — a silent, self-selecting hole in the sample.

CREATE OR REPLACE FUNCTION public.billing_touch_visit()
RETURNS public.billing_account
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  row public.billing_account;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_touch_visit: no authenticated user';
  END IF;

  INSERT INTO public.billing_account (user_id) VALUES (uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- The arm, once and for ever. Separate from the visit count on purpose: this
  -- must happen even when the visit is inside the six-hour floor.
  UPDATE public.billing_account b
     SET ab_presets = COALESCE(
           b.ab_presets,
           CASE WHEN random() < 0.5 THEN 'with_1' ELSE 'without_1' END
         )
   WHERE b.user_id = uid
     AND b.ab_presets IS NULL;

  UPDATE public.billing_account b
     SET visit_count   = b.visit_count + 1,
         last_visit_at = now(),
         updated_at    = now()
   WHERE b.user_id = uid
     AND (b.last_visit_at IS NULL OR b.last_visit_at < now() - interval '6 hours')
  RETURNING b.* INTO row;

  IF NOT FOUND THEN
    SELECT * INTO row FROM public.billing_account WHERE user_id = uid;
  END IF;

  RETURN row;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Recording an event
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The VARIANT IS NOT A PARAMETER. It is read from the caller's own row inside
-- the function, so a client cannot label its event with an arm it was not in —
-- which is the one input that would make the resulting numbers meaningless
-- rather than merely noisy.
--
-- An account with no arm yet records nothing and returns quietly. That can only
-- happen if an event somehow precedes the account's first `billing_touch_visit`,
-- and dropping the row is right: a `shown` with no arm is not attributable to
-- either side, and inventing an arm at write time would put a self-selected
-- sample into the sample.

CREATE OR REPLACE FUNCTION public.billing_record_ab_event(
  p_kind    text,
  p_context text,
  p_amount  integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid     uuid := (SELECT auth.uid());
  v_arm   text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'billing_record_ab_event: no authenticated user';
  END IF;

  SELECT ab_presets INTO v_arm FROM public.billing_account WHERE user_id = uid;
  IF v_arm IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.billing_ab_event (user_id, variant, kind, amount_cents, context)
  VALUES (uid, v_arm, p_kind, p_amount, left(coalesce(p_context, 'unknown'), 40));
END;
$$;

REVOKE ALL ON FUNCTION public.billing_record_ab_event(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_record_ab_event(text, text, integer) TO authenticated;
