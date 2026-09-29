import assert from 'node:assert/strict'
import test from 'node:test'
import { faviconUrl, isHttpsSource, mergeSources } from '../sourcesState.js'
test('sources dedupe by URL and cap at twelve', () => { const sources = Array.from({ length: 13 }, (_, i) => ({ url: `https://site${i}.example`, title: String(i), host: `site${i}.example` })); assert.equal(mergeSources([[sources[0], sources[0]], sources]).length, 12) })
test('unsafe hosts have no favicon URL', () => assert.equal(faviconUrl('bad/path'), null))
test('only https sources become links', () => { assert.equal(isHttpsSource({ url: 'http://example.com' }), false); assert.equal(isHttpsSource({ url: 'https://example.com' }), true) })
