import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, q1, rlsStore } from '../db.js';
import { asyncHandler, badRequest, str } from '../http.js';

/**
 * In-app bug / feature-request reporter.
 *
 * **Cloud mode** (GITHUB_TOKEN + GITHUB_REPO set):
 *   1. Insert a `bug_report` row (user id from JWT, email from JWT claim,
 *      `kind` = 'bug' | 'feature').
 *   2. Create a GitHub issue via REST, labeled with the umbrella
 *      "in-app-report" label AND a kind-specific label ("bug" or
 *      "feature-request") — see `labelsForKind()`.
 *   3. Optionally upload the screenshot to Supabase Storage and append a
 *      signed URL to the issue body.
 *   4. Store the returned issue number on the row.
 *   The reporter's identity (email, user id) is NEVER included in the public
 *   issue — it stays in the private `bug_report` table.
 *
 * **Self-host mode** (no GITHUB_TOKEN):
 *   Persists each report as a folder under the repo's `issues/` dir (the
 *   `fix-issues` skill walks that dir). No DB.
 *
 * GitHub or storage failures are non-fatal: the DB row persists regardless,
 * and the response is 202 with a note explaining the partial state.
 */
export const bugsRouter: Router = Router();

// ── Environment ───────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const GITHUB_REPO = process.env.GITHUB_REPO ?? ''; // e.g. "cheyras/deckpal"
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const isCloudMode = !!(GITHUB_TOKEN && GITHUB_REPO);
const hasStorage = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

// ── Self-host: repo-root detection (unchanged from original) ──────────────────

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('repo root (pnpm-workspace.yaml) not found from ' + fileURLToPath(import.meta.url));
}

// Only resolved in self-host mode — avoid crashing cloud deployments where the
// repo root may not exist.
let issuesDir: string | undefined;
function getIssuesDir(): string {
  if (!issuesDir) issuesDir = join(repoRoot(), 'issues');
  return issuesDir;
}

// ── Per-IP rate limiter (no external dependency) ─────────────────────────────
const RATE_MAX = 10; // max bug reports per IP per hour
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_SWEEP_MS = 10 * 60 * 1000; // sweep stale entries every 10 min
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(ip);
  }
}, RATE_SWEEP_MS).unref();

function rateOk(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

// ── Shared constants ──────────────────────────────────────────────────────────

const MAX_TEXT = 20_000;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8 MB decoded
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

// Filesystem-safe, sortable id from an ISO timestamp + short random suffix.
function newId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

// ── Kind (bug vs feature request) — pure, tested ───────────────────────────────

export type BugKind = 'bug' | 'feature';

/**
 * Parse `kind` from the request body. Additive field: anything other than
 * the literal string 'feature' (missing, wrong type, or an unrecognized
 * value) falls back to 'bug' rather than 400ing — old clients that never
 * send it should keep working exactly as before.
 */
export function parseKind(raw: unknown): BugKind {
  return raw === 'feature' ? 'feature' : 'bug';
}

export interface LabelSpec {
  name: string;
  color: string;
  description: string;
}

// Unchanged — every open issue this reporter has ever filed already carries
// this umbrella label, so it keeps being applied regardless of kind.
const IN_APP_REPORT_LABEL: LabelSpec = {
  name: 'in-app-report',
  color: 'd73a4a',
  description: 'Submitted via the in-app reporter',
};

const BUG_LABEL: LabelSpec = {
  name: 'bug',
  color: 'd73a4a',
  description: "Something isn't working as expected",
};

const FEATURE_LABEL: LabelSpec = {
  name: 'feature-request',
  color: 'a2eeef',
  description: 'A request for new functionality',
};

/**
 * Labels to apply to a GitHub issue for a given report kind: the umbrella
 * "in-app-report" label (unchanged) plus one kind-specific label.
 */
export function labelsForKind(kind: BugKind): LabelSpec[] {
  return [IN_APP_REPORT_LABEL, kind === 'feature' ? FEATURE_LABEL : BUG_LABEL];
}

// ── Issue-body formatting (pure, tested) ──────────────────────────────────────

export interface IssueBodyParams {
  description: string;
  page: string;
  viewport: string;
  userAgent: string;
  reportId: string;
  screenshotUrl?: string;
}

/**
 * Format a GitHub issue body from report data.
 * PRIVACY: never includes email, user id, or any identifying info.
 */
export function formatIssueBody(p: IssueBodyParams): string {
  const lines: string[] = [];
  lines.push(p.description);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**Page:** ${p.page}`);
  if (p.viewport) lines.push(`**Viewport:** ${p.viewport}`);
  if (p.userAgent) lines.push(`**User Agent:** ${p.userAgent}`);
  lines.push('');
  if (p.screenshotUrl) {
    lines.push('**Screenshot:**');
    lines.push(`![screenshot](${p.screenshotUrl})`);
    lines.push('');
  } else {
    lines.push('*Screenshot omitted — not available or storage not configured.*');
    lines.push('');
  }
  lines.push(`\`Report-ID: ${p.reportId}\``);
  return lines.join('\n');
}

/**
 * Truncate description to ~60 chars for the issue title, breaking at a word
 * boundary when possible.
 */
function issueTitle(description: string): string {
  const oneLine = description.replace(/\n/g, ' ').trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.lastIndexOf(' ', 60);
  return (cut > 20 ? oneLine.slice(0, cut) : oneLine.slice(0, 60)) + '...';
}

// ── GitHub helpers (plain fetch, no new dependency) ───────────────────────────

const GH_API = 'https://api.github.com';

function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'deckpal-api',
  };
}

/** Ensure the given label exists on the repo; create it on 404. */
async function ensureLabel(label: LabelSpec): Promise<void> {
  const res = await fetch(
    `${GH_API}/repos/${GITHUB_REPO}/labels/${encodeURIComponent(label.name)}`,
    { headers: ghHeaders() },
  );
  if (res.ok) return;
  if (res.status === 404) {
    const createRes = await fetch(`${GH_API}/repos/${GITHUB_REPO}/labels`, {
      method: 'POST',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: label.name,
        color: label.color,
        description: label.description,
      }),
    });
    if (!createRes.ok && createRes.status !== 422) {
      // 422 = label already exists (race). Anything else is unexpected.
      throw new Error(`Failed to create label "${label.name}": ${createRes.status}`);
    }
    return;
  }
  throw new Error(`Failed to check label "${label.name}": ${res.status}`);
}

interface GhIssueResult {
  number: number;
  html_url: string;
}

async function createGhIssue(title: string, body: string, kind: BugKind): Promise<GhIssueResult> {
  const labels = labelsForKind(kind);
  for (const label of labels) {
    await ensureLabel(label);
  }
  const res = await fetch(`${GH_API}/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, labels: labels.map((l) => l.name) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub issue creation failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as GhIssueResult;
  return { number: data.number, html_url: data.html_url };
}

// ── Supabase Storage helpers ─────────────────────────────────────────────────

async function uploadScreenshot(
  reportId: string,
  imgBuf: Buffer,
  contentType: string,
): Promise<string | null> {
  if (!hasStorage) return null;
  try {
    // Upload to bug-reports/<id>/screenshot.jpg
    const objectPath = `${reportId}/screenshot.jpg`;
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/bug-reports/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: new Uint8Array(imgBuf),
      },
    );
    if (!uploadRes.ok) {
      console.error(`[bugs] Storage upload failed: ${uploadRes.status}`);
      return null;
    }

    // Create a long-lived signed URL (1 year)
    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/bug-reports/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 365 * 24 * 60 * 60 }),
      },
    );
    if (!signRes.ok) {
      console.error(`[bugs] Storage sign failed: ${signRes.status}`);
      return null;
    }
    const signData = (await signRes.json()) as { signedURL: string };
    // signedURL is a relative path; prefix with the Supabase URL.
    return `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
  } catch (err) {
    console.error('[bugs] Storage error:', err);
    return null;
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

bugsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    if (!rateOk(req.ip ?? 'unknown')) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many reports — try again later.' } });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = str(body.text)?.trim();
    if (!text) throw badRequest('A bug description is required.');
    if (text.length > MAX_TEXT) throw badRequest('Description too long.');

    const kind = parseKind(body.kind);
    const page = str(body.page)?.slice(0, 2000) ?? '(unknown)';
    const userAgent = str(body.userAgent)?.slice(0, 500) ?? str(req.headers['user-agent'])?.slice(0, 500) ?? '';
    const viewport = str(body.viewport)?.slice(0, 40) ?? '';
    const screenshot = str(body.screenshot);

    let imgBuf: Buffer | null = null;
    let imgContentType = 'image/jpeg';
    if (screenshot) {
      const m = DATA_URL_RE.exec(screenshot);
      if (!m) throw badRequest('screenshot must be a data:image/(png|jpeg|webp);base64 URL.');
      imgBuf = Buffer.from(m[2]!, 'base64');
      if (imgBuf.length > MAX_IMG_BYTES) throw badRequest('Screenshot too large.');
      imgContentType = `image/${m[1]}`;
    }

    // ── Cloud mode: DB row + GitHub issue ────────────────────────────────────
    if (isCloudMode) {
      const userId = req.user?.id ?? null;
      const email = req.user?.email ?? null;

      // 1. Insert the bug_report row (always persists, regardless of GH outcome).
      const row = await q1<{ id: string }>(
        `INSERT INTO bug_report (user_id, reporter_email, page, viewport, user_agent, description, kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [userId, email, page, viewport, userAgent, text, kind],
      );
      const reportId = row!.id;

      // 2. Optionally upload screenshot to Supabase Storage.
      let screenshotUrl: string | undefined;
      if (imgBuf) {
        const url = await uploadScreenshot(reportId, imgBuf, imgContentType);
        if (url) screenshotUrl = url;
      }

      // 3. Create the GitHub issue.
      let issueUrl: string | undefined;
      let issueNumber: number | undefined;
      let note: string | undefined;
      try {
        const issueBody = formatIssueBody({
          description: text,
          page,
          viewport,
          userAgent,
          reportId,
          screenshotUrl,
        });
        const gh = await createGhIssue(issueTitle(text), issueBody, kind);
        issueNumber = gh.number;
        issueUrl = gh.html_url;

        // 4. Store the issue number on the row.
        // The user's RLS policy grants INSERT + SELECT but not UPDATE —
        // the issue number is server bookkeeping, not a user action.
        // We must use the SAME client (to see the uncommitted INSERT) but
        // temporarily reset to the session/pool role (which has BYPASSRLS)
        // so the UPDATE isn't blocked by RLS. In self-host mode (no RLS
        // client) pool.query is fine.
        const rlsClient = rlsStore.getStore();
        if (rlsClient) {
          await rlsClient.query('RESET ROLE');
          await rlsClient.query(
            `UPDATE bug_report SET github_issue_number = $1 WHERE id = $2`,
            [issueNumber, reportId],
          );
          await rlsClient.query(`SET LOCAL role = 'authenticated'`);
        } else {
          await pool.query(
            `UPDATE bug_report SET github_issue_number = $1 WHERE id = $2`,
            [issueNumber, reportId],
          );
        }
      } catch (err) {
        console.error('[bugs] GitHub issue creation failed:', err);
        note = 'Report saved but GitHub issue creation failed. It will be reviewed from the database.';
      }

      const status = issueUrl ? 201 : 202;
      res.status(status).json({
        id: reportId,
        ...(issueUrl ? { issueUrl } : {}),
        ...(issueNumber ? { issueNumber } : {}),
        ...(note ? { note } : {}),
      });
      return;
    }

    // ── Self-host mode: filesystem (unchanged behavior) ─────────────────────
    const id = newId();
    const dir = join(getIssuesDir(), id);
    mkdirSync(dir, { recursive: true });

    let imgExt: string | null = null;
    if (screenshot) {
      const m = DATA_URL_RE.exec(screenshot);
      if (m) imgExt = m[1] === 'jpeg' ? 'jpg' : m[1]!;
    }

    const shotName = imgExt ? `screenshot.${imgExt}` : null;
    const report = [
      '---',
      `id: ${id}`,
      `kind: ${kind}`,
      'status: open',
      `createdAt: ${new Date().toISOString()}`,
      `page: ${page}`,
      viewport ? `viewport: ${viewport}` : null,
      userAgent ? `userAgent: ${userAgent.replace(/\n/g, ' ')}` : null,
      shotName ? `screenshot: ${shotName}` : 'screenshot: (none)',
      '---',
      '',
      text,
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');

    await writeFile(join(dir, 'report.md'), report, 'utf8');
    if (imgBuf && shotName) await writeFile(join(dir, shotName), imgBuf);

    res.status(201).json({ id, saved: `issues/${id}/` });
  }),
);
