-- 022 · Bug report table for the in-app bug reporter.
-- Stores reports with optional GitHub issue linkage. Works on any Postgres 15+;
-- does NOT reference auth.users (RLS is in 023).

CREATE TABLE bug_report (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES app_user(id) ON DELETE SET NULL,
  reporter_email TEXT,
  github_issue_number INTEGER,
  page          TEXT,
  viewport      TEXT,
  user_agent    TEXT,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'resolved')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
