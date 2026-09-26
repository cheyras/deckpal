import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIssueBody,
  parseKind,
  labelsForKind,
  isSensitiveBugPage,
  sanitizePagePath,
  decodeScreenshot,
  type IssueBodyParams,
} from '../routes/bugs.js';
import { ApiError } from '../http.js';

/**
 * Unit tests for the pure helpers behind the bug/feature-request reporter
 * (issue body formatting, kind parsing, label selection, sensitive-page
 * detection, page-path sanitizing, screenshot decoding). No network, no DB.
 *
 * Run: node --import tsx --test src/__tests__/bugs.test.ts
 */

// A minimal valid PNG: just the 8-byte magic-number signature plus padding.
// sniffContentType only inspects the header, so this reads as `image/png`.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
function pngDataUrl(): string {
  return `data:image/png;base64,${PNG_HEADER.toString('base64')}`;
}

describe('formatIssueBody', () => {
  const base: IssueBodyParams = {
    description: 'Cards in the binder view overlap when scrolling fast.',
    page: '/series/scarlet-violet/sets/sv8',
    viewport: '1920x1080',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0',
    reportId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };

  test('includes description, page, viewport, user agent, and report ID', () => {
    const body = formatIssueBody(base);

    assert.ok(body.includes(base.description), 'description missing');
    assert.ok(body.includes(`**Page:** ${base.page}`), 'page missing');
    assert.ok(body.includes(`**Viewport:** ${base.viewport}`), 'viewport missing');
    assert.ok(body.includes(`**User Agent:** ${base.userAgent}`), 'user agent missing');
    assert.ok(body.includes(`\`Report-ID: ${base.reportId}\``), 'report ID missing');
  });

  test('never includes email or user id', () => {
    const body = formatIssueBody(base);

    // Ensure no email-like patterns or UUID-like patterns beyond the Report-ID.
    const lines = body.split('\n');
    for (const line of lines) {
      if (line.includes('Report-ID:')) continue; // report ID is expected
      assert.ok(!line.toLowerCase().includes('email'), `unexpected "email" in: ${line}`);
      assert.ok(!line.toLowerCase().includes('user_id'), `unexpected "user_id" in: ${line}`);
      assert.ok(!line.toLowerCase().includes('user id'), `unexpected "user id" in: ${line}`);
    }
  });

  test('notes the screenshot was saved privately, without ever printing a URL', () => {
    const body = formatIssueBody({ ...base, screenshotSaved: true });

    assert.ok(body.includes('**Screenshot:**'), 'screenshot header missing');
    assert.ok(body.includes('saved privately'), 'privacy note missing');
    assert.ok(!body.includes('![screenshot]'), 'must never embed an image markdown link');
    assert.ok(!/https?:\/\//.test(body), 'must never contain a URL of any kind');
    assert.ok(!body.includes('omitted'), 'should not mention omitted');
  });

  test('notes screenshot omission when none was saved', () => {
    const body = formatIssueBody(base);

    assert.ok(body.includes('Screenshot omitted'), 'omission note missing');
    assert.ok(!body.includes('![screenshot]'), 'should not include image markdown');
  });

  test('omits viewport and user agent sections when empty', () => {
    const body = formatIssueBody({ ...base, viewport: '', userAgent: '' });

    assert.ok(!body.includes('**Viewport:**'), 'viewport should be omitted');
    assert.ok(!body.includes('**User Agent:**'), 'user agent should be omitted');
    // Page and report ID should still be present.
    assert.ok(body.includes(`**Page:** ${base.page}`), 'page missing');
    assert.ok(body.includes(`Report-ID: ${base.reportId}`), 'report ID missing');
  });

  test('report ID is always on its own line in backtick code', () => {
    const body = formatIssueBody(base);
    const reportLine = body.split('\n').find((l) => l.includes('Report-ID'));
    assert.ok(reportLine, 'report ID line not found');
    assert.match(reportLine!, /^`Report-ID: .+`$/);
  });
});

describe('parseKind', () => {
  test('defaults to "bug" when kind is omitted', () => {
    assert.equal(parseKind(undefined), 'bug');
  });

  test('accepts "feature"', () => {
    assert.equal(parseKind('feature'), 'feature');
  });

  test('falls back to "bug" for an invalid value rather than erroring', () => {
    assert.equal(parseKind('typo'), 'bug');
    assert.equal(parseKind(''), 'bug');
    assert.equal(parseKind(null), 'bug');
    assert.equal(parseKind(123), 'bug');
    assert.equal(parseKind({ kind: 'feature' }), 'bug');
  });

  test('explicit "bug" stays "bug"', () => {
    assert.equal(parseKind('bug'), 'bug');
  });
});

describe('labelsForKind', () => {
  test('bug reports carry both the umbrella and "bug" labels', () => {
    const labels = labelsForKind('bug').map((l) => l.name);
    assert.deepEqual(labels, ['in-app-report', 'bug']);
  });

  test('feature requests carry both the umbrella and "feature-request" labels', () => {
    const labels = labelsForKind('feature').map((l) => l.name);
    assert.deepEqual(labels, ['in-app-report', 'feature-request']);
  });

  test('the umbrella "in-app-report" label is unchanged across kinds', () => {
    const bugLabel = labelsForKind('bug')[0]!;
    const featureLabel = labelsForKind('feature')[0]!;
    assert.deepEqual(bugLabel, featureLabel);
    assert.equal(bugLabel.name, 'in-app-report');
  });

  test('kind-specific labels use distinct colors', () => {
    const bugColor = labelsForKind('bug')[1]!.color;
    const featureColor = labelsForKind('feature')[1]!.color;
    assert.notEqual(bugColor, featureColor);
  });
});

// ── Sensitive-page detection (SEC-06) ────────────────────────────────────────
//
// MIRRORS apps/web/src/components/BugReport.tsx's `isSensitiveBugPage`. A
// screenshot must never be captured or stored for any of these — the
// reporter's own account details (Profile, billing) or another signed-in
// user's (any /admin page).

describe('isSensitiveBugPage', () => {
  test('flags /admin and every path beneath it', () => {
    assert.equal(isSensitiveBugPage('/admin'), true);
    assert.equal(isSensitiveBugPage('/admin/users'), true);
    assert.equal(isSensitiveBugPage('/admin/users/10000000-0000-4000-8000-000000000002'), true);
  });

  test('flags /profile and /credits', () => {
    assert.equal(isSensitiveBugPage('/profile'), true);
    assert.equal(isSensitiveBugPage('/credits'), true);
    assert.equal(isSensitiveBugPage('/credits?checkout=1'), true);
  });

  test('does not flag ordinary pages', () => {
    for (const page of ['/', '/series', '/lists', '/decks/abc', '/insights', '/devtools']) {
      assert.equal(isSensitiveBugPage(page), false, `${page} should not be sensitive`);
    }
  });

  test('does not flag a path that merely starts with the same letters', () => {
    // A prefix match, not a substring match: `/administer` is not `/admin`.
    assert.equal(isSensitiveBugPage('/administer'), false);
    assert.equal(isSensitiveBugPage('/profiles'), false);
    assert.equal(isSensitiveBugPage('/credits-info'), false);
  });

  test('flags a self-host page under the /deckpal mount prefix', () => {
    // The self-host SPA is served at basepath `/deckpal` (main.tsx), so
    // window.location.pathname there is `/deckpal/admin/users`, not
    // `/admin/users`. A naive prefix check would silently never protect a
    // self-host admin page — this caught a real bug during development
    // (confirmed live in tests/browser/bugReport.mjs against the actual
    // self-host build).
    assert.equal(isSensitiveBugPage('/deckpal/admin/users'), true);
    assert.equal(isSensitiveBugPage('/deckpal/profile'), true);
    assert.equal(isSensitiveBugPage('/deckpal/credits?checkout=1'), true);
    assert.equal(isSensitiveBugPage('/deckpal/series'), false);
    assert.equal(isSensitiveBugPage('/deckpal'), false);
  });
});

describe('sanitizePagePath', () => {
  test('strips a query string', () => {
    assert.equal(sanitizePagePath('/admin/users?search=someone%40example.com'), '/admin/users');
  });

  test('strips a fragment', () => {
    assert.equal(sanitizePagePath('/series/sv8#panel'), '/series/sv8');
  });

  test('strips both, query first', () => {
    assert.equal(sanitizePagePath('/lists/abc?tab=cards#top'), '/lists/abc');
  });

  test('leaves a plain path untouched', () => {
    assert.equal(sanitizePagePath('/decks/xyz'), '/decks/xyz');
  });
});

// ── Screenshot decoding (SEC-06) ─────────────────────────────────────────────
//
// The content type must come from the bytes (`sniffContentType`), never from
// the data URL's declared `image/xyz` prefix — the prefix is just a string
// the client wrote, not a guarantee about what follows it.

describe('decodeScreenshot', () => {
  test('accepts a real PNG and reports the sniffed content type', () => {
    const decoded = decodeScreenshot(pngDataUrl());
    assert.equal(decoded.contentType, 'image/png');
    assert.ok(decoded.buf.equals(PNG_HEADER));
  });

  test('rejects a data URL that is not the expected shape', () => {
    assert.throws(() => decodeScreenshot('data:text/plain;base64,aGk='), ApiError);
    assert.throws(() => decodeScreenshot('not-a-data-url-at-all'), ApiError);
  });

  test('rejects HTML bytes wrapped in a PNG-declared data URL', () => {
    // The declared prefix says PNG; the bytes say otherwise. This is exactly
    // the gap the audit flagged: trusting `m[1]` let a hostile upload lie
    // about its own type. sniffContentType reads `application/octet-stream`
    // for this, which is not in ACCEPTED_SCREENSHOT_TYPES.
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const hostileDataUrl = `data:image/png;base64,${html.toString('base64')}`;
    assert.throws(
      () => decodeScreenshot(hostileDataUrl),
      (err: unknown) => err instanceof ApiError && err.status === 400,
    );
  });

  test('rejects a screenshot over the size cap', () => {
    // 9 MB of PNG-signature-prefixed bytes, over the 8 MB decoded cap.
    const big = Buffer.concat([PNG_HEADER, Buffer.alloc(9 * 1024 * 1024)]);
    const dataUrl = `data:image/png;base64,${big.toString('base64')}`;
    assert.throws(
      () => decodeScreenshot(dataUrl),
      (err: unknown) => err instanceof ApiError && err.status === 400,
    );
  });
});
