import { Router } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncHandler, badRequest, str } from '../http.js';

/**
 * In-app bug reporter. The top-nav "Report a bug" button captures a screenshot of
 * what the user is looking at (client-side, sans the modal), and POSTs it here with
 * a free-text comment and the current page. We persist each report as a folder under
 * the repo's `issues/` dir so it lives in the codebase — the `fix-issues` skill walks
 * that dir, fixes each open issue, verifies it, then deletes the screenshot and marks
 * it resolved. No DB: these are developer artefacts, not user data.
 *
 * One writer, tiny payloads, no auth of its own (nginx/the SSO gate is the ingress).
 */
export const bugsRouter: Router = Router();

// Walk up from this compiled file to the repo root (marked by pnpm-workspace.yaml),
// so the path is correct whether we run from dist/ (pm2) or src/ (tsx dev).
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
const ISSUES_DIR = join(repoRoot(), 'issues');

const MAX_TEXT = 20_000;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8 MB decoded — generous for a JPEG viewport grab
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

// Filesystem-safe, sortable id from an ISO timestamp + short random suffix.
function newId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

bugsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = str(body.text)?.trim();
    if (!text) throw badRequest('A bug description is required.');
    if (text.length > MAX_TEXT) throw badRequest('Description too long.');

    const page = str(body.page)?.slice(0, 2000) ?? '(unknown)';
    const userAgent = str(body.userAgent)?.slice(0, 500) ?? str(req.headers['user-agent'])?.slice(0, 500) ?? '';
    const viewport = str(body.viewport)?.slice(0, 40) ?? '';
    const screenshot = str(body.screenshot);

    let imgExt: string | null = null;
    let imgBuf: Buffer | null = null;
    if (screenshot) {
      const m = DATA_URL_RE.exec(screenshot);
      if (!m) throw badRequest('screenshot must be a data:image/(png|jpeg|webp);base64 URL.');
      imgBuf = Buffer.from(m[2]!, 'base64');
      if (imgBuf.length > MAX_IMG_BYTES) throw badRequest('Screenshot too large.');
      imgExt = m[1] === 'jpeg' ? 'jpg' : m[1]!;
    }

    const id = newId();
    const dir = join(ISSUES_DIR, id);
    mkdirSync(dir, { recursive: true });

    const shotName = imgExt ? `screenshot.${imgExt}` : null;
    const report = [
      '---',
      `id: ${id}`,
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
