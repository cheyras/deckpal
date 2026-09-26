-- Scanner voice commands ship as a BETA: off for every tier, Owner included, until the account opts in (DECISIONS.md 2026-09-26).
-- Not experimental, which Superadmin/Owner receive automatically: real-iPhone transcription beside the live camera is unverified.
-- A catalog row only. Voice is client-side speech recognition with no API surface, so it mints no permission; the web reads features[].enabled.
SELECT pg_advisory_xact_lock(741290064);
INSERT INTO public.app_feature(key,label,lifecycle) VALUES('scanner_voice','Scanner voice commands','beta') ON CONFLICT(key) DO NOTHING;
