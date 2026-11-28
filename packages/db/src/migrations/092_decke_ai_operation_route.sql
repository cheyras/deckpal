-- 092 · Which road served each Deck-E model call.
--
-- Anthropic models now go to the Anthropic API first on the owner's own key
-- (ANTHROPIC_API_KEY) and fall back to the Vercel AI Gateway only when that
-- account is out of credit or over a usage/spend limit (apps/api/src/decke/
-- aiRoute.ts). Every other column of an operation row is identical on either
-- road by design, so this is the one place the owner can see the switch:
--
--   direct            Anthropic API, owner's key
--   gateway           AI Gateway (every non-Anthropic model; every model when
--                     ANTHROPIC_API_KEY is unset)
--   gateway_fallback  AI Gateway, because the direct call was refused for
--                     credit/usage/spend or a rejected key
--
-- NULL for rows written before this migration, for failed calls (no provider
-- metadata to read), and for import-fix settlements, whose SECURITY DEFINER
-- finish function is unchanged. The application tolerates this column being
-- absent (usage.ts falls back to the pre-092 UPDATE on 42703), so applying it
-- after the deploy loses only the route of the calls in between, never a meter
-- reading.
ALTER TABLE public.decke_ai_operation
  ADD COLUMN IF NOT EXISTS route text
  CHECK (route IS NULL OR route IN ('direct', 'gateway', 'gateway_fallback'));
