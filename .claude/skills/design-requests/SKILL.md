---
name: design-requests
description: Drain the design-system change-request queue. Claim a queued request, read the intent, apply the change with real judgment to source files, and write a done/failed result. Never commits — the owner reviews via git diff. Use when the owner asks to "process design requests", "drain the queue", or "handle design changes".
---

# design-requests — drain the design-system change-request queue

This skill is the supervised consumer for the design-system editor's Lane B
(agent-mediated change requests). The owner submits requests from the
`/design` route's "Send to agent" composer; this skill picks them up, reasons
about what to change, applies edits to real source files, and writes a
result file. The dev server's HMR picks up changes instantly so the owner
sees results in the catalog they're looking at.

**Operating principle:** every request is genuine reasoning work, not template
substitution. "Increase button md height" might be a one-line edit to a
SIZE record; "add a new outline variant" might be a new entry in a VARIANT
record plus a type union change plus new gallery entries. Read the source
file, understand the component's structure, and apply the change the way a
careful developer would.

---

## Safety checks (run FIRST, every time)

1. **Confirm you are in the design-system worktree.**
   ```bash
   pwd
   git rev-parse --abbrev-ref HEAD
   ```
   The branch must be `design-system` and the working directory must be
   `/home/cheyras/deckpal-worktrees/design-system`. If either check fails,
   **stop immediately** — you may be in the main worktree at
   `/home/cheyras/deckpal` which must never be touched by this skill.

2. **Confirm the dev server is running and reports the correct worktree.**
   ```bash
   curl -s http://localhost:5199/__design/health
   ```
   The response's `worktree` field must match this worktree path. If the dev
   server is not running or reports a different worktree, stop.

---

## The queue loop

### 1. Scan for pending requests

```bash
ls design-requests/queue/
```

If the directory is empty, report "No pending requests" and stop.

### 2. Claim a request

Pick the oldest file (alphabetically first by UUID, or inspect `createdAt`).
Move it to `working/`:

```bash
mv design-requests/queue/<id>.json design-requests/working/<id>.json
```

### 3. Read the request

```bash
cat design-requests/working/<id>.json
```

The JSON contains:
- `id` — the request UUID
- `kind` — e.g. `component-change`
- `target` — the component or primitive name
- `intent` — free-text description of what to change
- `context` — object with `component`, `source` (repo-relative path),
  `section`, optionally `currentKnobState` and `activeTokenOverrides`
- `createdAt` — ISO timestamp
- `status` — will be `queued` (from when it was written; now claimed)

### 4. Validate the source file exists

Read the `source` path from `context.source`. If the file does not exist at
that repo-relative path, this is a failed request — skip to step 6 (failure
path).

### 5. Apply the change with judgment

Read the source file in full. Understand the component's structure: its props
interface, variant records, size records, style patterns, exports.

Then apply the intent. Common patterns:

- **Default-prop edit** ("increase md height to 46px"): find the SIZE/VARIANT
  record entry and edit the value.
- **New variant** ("add an outline variant"): add a new entry to the VARIANT
  record, extend the type union, add gallery entries if a gallery file exists.
- **Token promotion** ("use a token for this color"): replace a hardcoded hex
  with a `var(--color-*)` reference or a Tailwind token class.
- **Multi-file change** ("add a new font option"): may require editing
  `theme.css`, adding an `@import`, and updating the component.
- **Gallery update** ("add a variant to the gallery"): edit the co-located
  `.gallery.tsx` file.

**Rules:**
- Edit only files under `apps/web/src/` unless the intent specifically
  requires touching `theme.css` (which is also under `apps/web/src/`).
- If the change would require editing files outside `apps/web/src/`, fail
  with a clear explanation of why.
- Preserve existing code style, indentation, and patterns.
- Do not add new npm dependencies.
- **Never run `git commit`.** Leave changes in the working tree for the owner
  to review via `git diff`.

Record which files you changed and write a brief summary of what you did.

### 6. Write the result

**Success path:** write `design-requests/done/<id>.json`. The file must
include the **original request fields** (so the GET endpoint and
RequestsPanel can display kind, target, intent, createdAt) plus a nested
`result` object with the agent's output:

```json
{
  "id": "<request-id>",
  "kind": "<original kind>",
  "target": "<original target>",
  "intent": "<original intent>",
  "context": { "...original context..." },
  "createdAt": "<original createdAt>",
  "status": "done",
  "result": {
    "id": "<request-id>",
    "status": "done",
    "summary": "Changed the md size height from 44px to 46px in the SIZE record.",
    "filesChanged": ["apps/web/src/components/ui/Button.tsx"],
    "startedAt": "<ISO timestamp when you claimed it>",
    "finishedAt": "<ISO timestamp now>",
    "agent": "Claude Code (design-requests skill)"
  }
}
```

Then remove the working file:
```bash
rm design-requests/working/<id>.json
```

**Failure path:** write `design-requests/failed/<id>.json` with the same
structure (original fields + nested result):

```json
{
  "id": "<request-id>",
  "kind": "<original kind>",
  "target": "<original target>",
  "intent": "<original intent>",
  "context": { "...original context..." },
  "createdAt": "<original createdAt>",
  "status": "failed",
  "result": {
    "id": "<request-id>",
    "status": "failed",
    "summary": "Cannot apply: source file does not exist.",
    "error": "File apps/web/src/components/ui/NonExistent.tsx not found at the expected path.",
    "filesChanged": [],
    "startedAt": "<ISO timestamp>",
    "finishedAt": "<ISO timestamp>",
    "agent": "Claude Code (design-requests skill)"
  }
}
```

Then remove the working file:
```bash
rm design-requests/working/<id>.json
```

### 7. Repeat

If more files remain in `queue/`, go back to step 2. Otherwise, report what
you processed.

---

## What this skill does NOT do

- **Never commits.** The owner reviews via `git diff` and commits themselves.
- **Never pushes.**
- **Never edits files outside `apps/web/src/`** (except `theme.css` which is
  inside that tree).
- **Never touches the main worktree** at `/home/cheyras/deckpal`.
- **Never installs dependencies** — if a change requires a new package, fail
  with an explanation.
- **Never runs `Phase 3b`** (the unsupervised SDK daemon) — that is explicitly
  not approved.

---

## Definition of done

- Every request from `queue/` has been moved to either `done/` or `failed/`.
- The `working/` directory is empty (no stuck requests).
- Each done result has a clear `summary` and accurate `filesChanged`.
- Each failed result has a clear `error` explaining why.
- No files outside `apps/web/src/` were modified.
- No git commits were made.
- Report to the owner: what was processed, what changed, what failed.
