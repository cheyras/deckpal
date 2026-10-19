-- 089 · Knowledge notes: short, sourced statements about how cards interact, shared by every account once a
-- reviewer approves them (Phase 6 of the plan approved 2026-10-13).
--
-- WHY. An agent that settles a disagreement by research (a ruling, how two cards interact) found something every
-- other player could use, and threw it away when the conversation ended. A note keeps it: the cards involved, the
-- statement, the source it came from and a quote from that source.
--
-- HIDDEN UNTIL APPROVED. Anything every account reads can be poisoned with a false fact or carry someone's personal
-- data. So a note is proposed as 'pending', visible only to its proposer, and becomes 'approved' (shown in get_card
-- and rules_lookup for everyone) only through knowledge_note_review(), which requires the knowledge.review permission
-- in a signed-in browser session.
--
-- ONE WAY IN. A note is stored only by knowledge_note_propose(), never by a table INSERT: on cloud a client holds the
-- same `authenticated` role as the API, so anything the API alone enforced could be skipped by calling Supabase
-- directly. The function enforces the limits (20 waiting, 20 an hour), drops duplicates and refuses the plainest
-- personal data. The reviewer's other flags are not stored at all: the API computes them from the stored note when the
-- queue is read, so no caller can supply them.
--
-- NOT ACCOUNT DATA. A note is not part of anyone's collection, so it is not in the mutation log and `revert` does not
-- touch it; the proposer cannot edit it after proposing, and a rejection is the way a pending note leaves the queue.
--
-- Forward-only (B4). RLS for Supabase is 090 (@supabase-only).

CREATE TABLE public.knowledge_note (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Card names as players write them, lowercased for matching (the catalog has many printings per name).
  card_names    TEXT[] NOT NULL CHECK (cardinality(card_names) BETWEEN 1 AND 6),
  statement     TEXT NOT NULL CHECK (char_length(statement) BETWEEN 10 AND 600),
  source_url    TEXT NOT NULL CHECK (char_length(source_url) <= 500 AND source_url ~ '^https://'),
  quote         TEXT NOT NULL CHECK (char_length(quote) BETWEEN 5 AND 600),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_by   TEXT NOT NULL,
  proposed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_reason TEXT CHECK (char_length(review_reason) <= 500),
  CHECK ((status = 'pending') = (reviewed_at IS NULL))
);

-- Closed from the moment it exists. The runner commits each file on its own, so between this file and 090 (or on a
-- cloud where 090 has not run) Supabase's default grants would otherwise let a client read every note or insert an
-- approved one. With RLS on and no policy yet, client roles see and write nothing; the API's own connection (the table
-- owner) and the SECURITY DEFINER functions below are not subject to it. 090 adds the policies.
ALTER TABLE public.knowledge_note ENABLE ROW LEVEL SECURITY;

CREATE INDEX knowledge_note_queue_idx ON public.knowledge_note (status, id DESC);
CREATE INDEX knowledge_note_cards_idx ON public.knowledge_note USING gin (card_names);
CREATE INDEX knowledge_note_proposer_idx ON public.knowledge_note (proposed_by, id DESC);

-- The reviewer permission: seeded to the admin tiers (40+), as decke.improvement.read was (078); the ceiling below
-- also lets a contributor role (30) be given it, so the owner can widen review without a migration.
INSERT INTO public.admin_permission(key, permission_group, description)
VALUES ('knowledge.review', 'Content', 'Review and approve knowledge notes proposed by agents before every account sees them.')
ON CONFLICT DO NOTHING;
INSERT INTO public.admin_role_permission(role_id, permission_key)
SELECT id, 'knowledge.review' FROM public.admin_role WHERE system AND tier >= 40
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_permission_ceiling(p_tier integer) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(array_agg(key ORDER BY key),'{}') FROM public.admin_permission WHERE
 key NOT IN('roles.manage','roles.assign','scanner.use','decke.use')
 AND (p_tier>=40 OR (p_tier>=30 AND key IN('devtools.access','design.view','diagnostics.view','scanner.label','knowledge.review')))
$$;

-- The reviewer guard. Not admin_require_permission(): that also requires admin.access, which a contributor role
-- (tier 30) can never hold, so a contributor given knowledge.review could not review. This asks for exactly what
-- reviewing needs: a signed-in browser session, an active account, initialized administration, and knowledge.review.
CREATE FUNCTION public.knowledge_require_reviewer() RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text := public.admin_actor_id();
BEGIN
 IF actor IS NULL OR NOT public.admin_is_session() OR NOT public.admin_account_active(actor) THEN
  RAISE EXCEPTION 'A signed-in active account is required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.admin_state WHERE bootstrapped_at IS NOT NULL) THEN RAISE EXCEPTION 'Administration is not initialized' USING ERRCODE='55000'; END IF;
 IF NOT ('knowledge.review' = ANY(public.admin_permissions(actor))) THEN RAISE EXCEPTION 'Permission denied: knowledge.review' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION public.knowledge_require_reviewer() FROM PUBLIC;

-- Propose a note: the only way one is stored. Any signed-in active account, by browser session or access token (agents
-- propose through tokens). Card names arrive already in the API's normal form (noteKey), so are only trimmed here.
-- Returns the stored note, or the existing one when the same statement about the same cards is already waiting (this
-- account's) or approved (anyone's), with `duplicate` set.
CREATE FUNCTION public.knowledge_note_propose(p_cards text[], p_statement text, p_source_url text, p_quote text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 actor text := public.admin_actor_id();
 cards text[];
 stmt text := btrim(regexp_replace(coalesce(p_statement, ''), '\s+', ' ', 'g'));
 quote text := btrim(regexp_replace(coalesce(p_quote, ''), '\s+', ' ', 'g'));
 url text := btrim(coalesce(p_source_url, ''));
 hit public.knowledge_note;
BEGIN
 IF actor IS NULL OR NOT public.admin_account_active(actor) THEN RAISE EXCEPTION 'A signed-in active account is required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT c), '{}') INTO cards FROM (SELECT lower(btrim(regexp_replace(x, '\s+', ' ', 'g'))) c FROM unnest(coalesce(p_cards, '{}')) x) s WHERE c <> '';
 -- Personal data, refused at the boundary: an email in any text, anything after an @ or an encoded @ in the link
 -- (a rulings page never needs one), and a run of ten or more digits in the text (a phone number).
 IF concat_ws(E'\n', stmt, quote, array_to_string(cards, E'\n')) ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
    OR url ~* '(@|%40|%2540)'
    OR concat_ws(E'\n', stmt, quote) ~ '(\+?[0-9][ .-]?){9,}[0-9]' THEN
  RAISE EXCEPTION 'The note contains personal data (an email address, a phone number, or an @ in the link)' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('knowledge_note_propose:' || actor));
 SELECT * INTO hit FROM public.knowledge_note n
  WHERE n.card_names @> cards AND n.card_names <@ cards AND lower(n.statement) = lower(stmt)
    AND (n.status = 'approved' OR (n.status = 'pending' AND n.proposed_by = actor)) LIMIT 1;
 IF FOUND THEN RETURN to_jsonb(hit) || '{"duplicate": true}'::jsonb; END IF;
 IF (SELECT count(*) FROM public.knowledge_note WHERE proposed_by = actor AND status = 'pending') >= 20 THEN
  RAISE EXCEPTION 'This account has 20 notes waiting for review' USING ERRCODE='54000';
 END IF;
 IF (SELECT count(*) FROM public.knowledge_note WHERE proposed_by = actor AND proposed_at > now() - interval '1 hour') >= 20 THEN
  RAISE EXCEPTION 'This account proposed 20 notes in the last hour' USING ERRCODE='54000';
 END IF;
 INSERT INTO public.knowledge_note (card_names, statement, source_url, quote, proposed_by)
 VALUES (cards, stmt, url, quote, actor) RETURNING * INTO hit;
 RETURN to_jsonb(hit) || '{"duplicate": false}'::jsonb;
END $$;

-- The review queue, newest first, for a reviewer only.
CREATE FUNCTION public.knowledge_note_queue(p_status text, p_before bigint, p_limit integer)
RETURNS SETOF public.knowledge_note LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.knowledge_require_reviewer();
 IF p_status NOT IN ('pending','approved','rejected') THEN RAISE EXCEPTION 'Unknown status %', p_status USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT * FROM public.knowledge_note n
  WHERE n.status = p_status AND (p_before IS NULL OR n.id < p_before)
  ORDER BY n.id DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
END $$;

-- Approve or reject a pending note. Decided once: a decided note is not re-decided here (P0002), and every decision
-- is in the admin audit log.
CREATE FUNCTION public.knowledge_note_review(p_id bigint, p_decision text, p_reason text)
RETURNS public.knowledge_note LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor text := public.knowledge_require_reviewer(); before public.knowledge_note; after public.knowledge_note;
BEGIN
 IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE='22023'; END IF;
 SELECT * INTO before FROM public.knowledge_note WHERE id = p_id AND status = 'pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No pending note %', p_id USING ERRCODE='P0002'; END IF;
 UPDATE public.knowledge_note SET status = p_decision, reviewed_by = actor, reviewed_at = now(), review_reason = nullif(btrim(p_reason), '')
  WHERE id = p_id RETURNING * INTO after;
 PERFORM public.admin_audit_append('knowledge.' || p_decision, 'knowledge_note', p_id::text, to_jsonb(before), to_jsonb(after), nullif(btrim(p_reason), ''));
 RETURN after;
END $$;

REVOKE ALL ON FUNCTION public.knowledge_note_queue(text,bigint,integer), public.knowledge_note_review(bigint,text,text), public.knowledge_note_propose(text[],text,text,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.knowledge_note_queue(text,bigint,integer), public.knowledge_note_review(bigint,text,text), public.knowledge_note_propose(text[],text,text,text) TO authenticated;
 END IF;
END $$;
