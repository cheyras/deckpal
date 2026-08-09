import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatIssueBody, type IssueBodyParams } from '../routes/bugs.js';

/**
 * Unit tests for the GitHub issue body formatter used by the bug reporter.
 * Pure-function tests — no network, no DB.
 *
 * Run: node --import tsx --test src/__tests__/bugs.test.ts
 */

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

  test('includes screenshot image when URL is provided', () => {
    const body = formatIssueBody({ ...base, screenshotUrl: 'https://example.com/shot.jpg' });

    assert.ok(body.includes('**Screenshot:**'), 'screenshot header missing');
    assert.ok(body.includes('![screenshot](https://example.com/shot.jpg)'), 'screenshot image missing');
    assert.ok(!body.includes('omitted'), 'should not mention omitted');
  });

  test('notes screenshot omission when no URL is provided', () => {
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
