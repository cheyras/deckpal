#!/usr/bin/env bash
# scripts/triage-issue.sh — AI triage for issues filed via the in-app reporter.
#
# Called by .github/workflows/issue-triage.yml.  Reads the issue via `gh`,
# assembles bounded wiki context, calls the Anthropic API (Haiku), and posts a
# draft analysis as a GitHub comment.  Never modifies labels, priority, or issue
# state — comment-only.
#
# Required env:
#   ISSUE_NUMBER        — the GitHub issue number to triage
#   GITHUB_REPOSITORY   — owner/repo (set automatically by Actions)
#   GH_TOKEN            — GitHub token for `gh` CLI (set automatically by Actions)
#   ANTHROPIC_API_KEY   — Anthropic API key (repository secret)
#
# Optional env:
#   WIKI_DIR            — pre-cloned wiki directory (skips clone step)
#
# Exit codes:
#   0 on success, on missing key, or on any external-service failure.
#   The script never exits non-zero — a triage hiccup must not fail the
#   workflow and spam the issue author with a red CI notification.

set -euo pipefail

# ── Preflight ─────────────────────────────────────────────────────────────────

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "::notice title=AI triage not configured::ANTHROPIC_API_KEY secret is not set. See the header of .github/workflows/issue-triage.yml for setup instructions."
  exit 0
fi

: "${ISSUE_NUMBER:?ISSUE_NUMBER is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

# ── Fetch issue details ───────────────────────────────────────────────────────

issue_json=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" \
  --json title,body,labels 2>&1) || {
  echo "::warning::Could not fetch issue #${ISSUE_NUMBER} via gh CLI — skipping AI triage"
  exit 0
}

title=$(echo "$issue_json" | jq -r '.title // ""')
body_raw=$(echo "$issue_json" | jq -r '.body // ""')
labels=$(echo "$issue_json" | jq -r '[.labels[].name] | join(", ")')

# Cap the issue body at ~8000 chars to keep token usage reasonable on a cheap
# model.  The cap is generous — most in-app reports are a few hundred chars.
body="$body_raw"
if [ "${#body}" -gt 8000 ]; then
  body="${body:0:8000}

[... body truncated at 8000 characters for triage analysis]"
fi

# Determine kind from labels
kind="bug"
if echo "$labels" | grep -q "feature-request"; then
  kind="feature-request"
fi

# ── Assemble wiki context ─────────────────────────────────────────────────────
# Clone the public wiki (no auth needed) and extract bounded priority context.
# Project-Brief.md is the "what are we building" statement (~280 lines).
# Decision-Log.md recent entries capture what's actively being worked on /
# decided — the last 200 lines typically cover the 5-8 most recent decisions.
#
# Design choice: we do NOT feed the full 85KB Decision-Log.md to a cheap model.
# Recent entries are the live signal; the full history is noise for triage.

wiki_dir="${WIKI_DIR:-}"
cleanup_wiki=false

if [ -z "$wiki_dir" ]; then
  wiki_dir=$(mktemp -d)
  cleanup_wiki=true
  git clone --depth 1 --quiet \
    "https://github.com/${GITHUB_REPOSITORY}.wiki.git" "$wiki_dir" 2>/dev/null || {
    echo "::notice::Could not clone wiki — proceeding without priority context"
    wiki_dir=""
  }
fi

wiki_context=""
if [ -n "$wiki_dir" ] && [ -d "$wiki_dir" ]; then
  if [ -f "$wiki_dir/Project-Brief.md" ]; then
    wiki_context+="### Project Brief (mission statement & priorities)

$(cat "$wiki_dir/Project-Brief.md")

"
  fi

  if [ -f "$wiki_dir/Decision-Log.md" ]; then
    wiki_context+="### Recent Decisions (last entries — what's actively being worked on)

$(tail -n 200 "$wiki_dir/Decision-Log.md")
"
  fi
fi

if [ "$cleanup_wiki" = true ] && [ -n "$wiki_dir" ]; then
  rm -rf "$wiki_dir"
fi

# ── Build prompt ──────────────────────────────────────────────────────────────

if [ "$kind" = "bug" ]; then
  kind_instructions="This is a **bug report** filed via the in-app reporter.

Your analysis should cover:

1. **Report completeness** — Assess what information is present vs missing for
   someone to reproduce and fix this bug.  Specifically note: Are reproduction
   steps clear or inferable?  Is expected vs actual behavior stated?  Is
   environment context (page, viewport, user agent) present?  What clarifying
   questions would make this more actionable?

2. **Priority assessment** — Using the project context below, assess where this
   bug fits relative to current priorities.  Is it likely a regression in active
   work?  Does it touch a critical user path?  How urgent does it seem?

IMPORTANT: Do NOT claim you reproduced or verified the bug.  You have no access
to the application.  Only assess the report's quality and priority."
else
  kind_instructions="This is a **feature request** filed via the in-app reporter.

Your analysis should cover:

1. **Request clarity** — Is the desired behavior well-defined?  Are there edge
   cases or ambiguities worth calling out?  What additional detail would help
   the maintainer evaluate this?

2. **Priority assessment** — Using the project context below, assess where this
   request fits relative to current priorities.  Does it align with the stated
   mission?  Does it overlap with or build on recent decisions?  Where might it
   fit in the project's trajectory?"
fi

system_prompt="You are a triage assistant for the DeckScout open-source project — a Pokemon TCG collection manager and deck builder.  You review issues filed via the in-app reporter and produce a brief, helpful analysis for the human maintainer.

You are producing a DRAFT analysis.  Your output will be posted as a GitHub issue comment, clearly labeled as AI-generated and non-authoritative.  The maintainer makes all actual triage decisions — you are a second pair of eyes, not a decision-maker.

Guidelines:
- Be concise and specific.  A few focused paragraphs, not a wall of text.
- Be honest about uncertainty.  If you cannot assess something, say so.
- Do not invent information you do not have.
- Reference specific project context (decisions, priorities) when relevant.
- Do not suggest changes to labels, issue state, or priority fields — you are
  comment-only."

user_prompt="${kind_instructions}

---

**Issue #${ISSUE_NUMBER}: ${title}**
Kind: ${kind}
Labels: ${labels}

**Issue body:**
${body}

---

**Project context (from wiki):**
${wiki_context:-No wiki context available — assess the issue on its own merits.}"

# ── Call the Anthropic API ────────────────────────────────────────────────────

# Build the request payload with jq to safely handle arbitrary issue content
# (newlines, quotes, special characters in the body).
request_body=$(jq -n \
  --arg model "claude-haiku-4-5" \
  --argjson max_tokens 4096 \
  --arg system "$system_prompt" \
  --arg user_content "$user_prompt" \
  '{
    model: $model,
    max_tokens: $max_tokens,
    system: $system,
    messages: [{role: "user", content: $user_content}]
  }')

response=$(curl -s -w "\n%{http_code}" \
  --max-time 60 \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "$request_body" \
  "https://api.anthropic.com/v1/messages") || {
  echo "::warning::Anthropic API request failed (network error) — skipping AI triage"
  exit 0
}

# Split the response: last line is the HTTP status code, everything before is
# the response body.
http_code=$(echo "$response" | tail -1)
response_body=$(echo "$response" | sed '$d')

if [ "$http_code" != "200" ]; then
  echo "::warning::Anthropic API returned HTTP ${http_code} — skipping AI triage"
  # Log a bounded snippet for debugging, never the full response (could be large
  # on a 4xx with a detailed error body).
  echo "Response (first 500 chars): $(echo "$response_body" | head -c 500)"
  exit 0
fi

# Extract the text content from the API response.
ai_text=$(echo "$response_body" | jq -r '
  [.content[] | select(.type == "text") | .text] | join("\n")
')

if [ -z "$ai_text" ] || [ "$ai_text" = "null" ]; then
  echo "::warning::Anthropic API returned empty content — skipping AI triage"
  exit 0
fi

# ── Post the comment ──────────────────────────────────────────────────────────
# Use --body-file with stdin to avoid shell escaping issues with the AI output.

{
  printf '🤖 **AI Triage (draft — for maintainer review, not authoritative)**\n\n'
  printf '%s\n\n' "$ai_text"
  printf -- '---\n'
  printf '<sub>Generated by the <a href="https://github.com/%s/blob/main/.github/workflows/issue-triage.yml">issue-triage</a> workflow · model: claude-haiku-4-5 · wiki context: Project-Brief, recent Decision-Log</sub>\n' "$GITHUB_REPOSITORY"
} | gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --body-file - || {
  echo "::warning::Failed to post triage comment on issue #${ISSUE_NUMBER}"
  exit 0
}

echo "::notice::AI triage comment posted on issue #${ISSUE_NUMBER}"
