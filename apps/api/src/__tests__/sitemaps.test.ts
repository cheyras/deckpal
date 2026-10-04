import assert from 'node:assert/strict';
import { test } from 'node:test';
import { urlset } from '../sitemaps.js';

test('urlset is a valid sitemap with absolute, escaped URLs', () => {
  const xml = urlset(['/', '/series/scarlet-violet/sv03.5/199', '/series/x/y/A&B']);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((xml.match(/<url><loc>https:\/\/deckpal\.app\//g) ?? []).length, 3);
  assert.ok(xml.includes('<loc>https://deckpal.app/</loc>'));
  assert.ok(xml.includes('A&amp;B'), 'a raw ampersand would make the sitemap invalid XML');
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/);
});
