import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CaptureStore } from '@deckpal/storage';
import { SUGGESTIONS_PATH, parseSuggestion, readSuggestions, writeSuggestions } from '../queueSuggestions.js';

const card = {
  v: 1,
  by: 'agent:claude-sonnet-5.5+lc050',
  createdAt: '2026-11-26T08:00:00.000Z',
  verdict: 'card',
  crop: { x: -12.4, y: 300, size: 1004 },
  corners: [[0.3, 0.2], [0.7, 0.2], [0.7, 0.8], [0.3, 0.8]],
  topLeftIndex: 0,
  confidence: 'high',
  note: 'single card in hand',
};

test('a card suggestion parses, with the crop rounded to pixels', () => {
  const s = parseSuggestion('1790219626883', card);
  assert.ok(s);
  assert.equal(s.id, 1790219626883);
  assert.deepEqual(s.crop, { x: -12, y: 300, size: 1004 });
  assert.equal(s.corners?.length, 4);
});

test('a rejection needs a known reason and carries no corners', () => {
  const ok = parseSuggestion('1790219626883', { ...card, verdict: 'reject', invalidReason: 'multiple_no_clear_foreground', corners: undefined });
  assert.equal(ok?.invalidReason, 'multiple_no_clear_foreground');
  assert.equal(ok?.corners, undefined);
  assert.equal(parseSuggestion('1790219626883', { ...card, verdict: 'reject', invalidReason: 'nope' }), null);
});

test('malformed suggestions are refused, not stored', () => {
  assert.equal(parseSuggestion('abc', card), null, 'id must be a queue id');
  assert.equal(parseSuggestion('1790219626883', { ...card, corners: [[0, 0]] }), null);
  assert.equal(parseSuggestion('1790219626883', { ...card, corners: [[0, 0], [1, 0], [1, 9], [0, 1]] }), null, 'out of range');
  assert.equal(parseSuggestion('1790219626883', { ...card, confidence: 'sure' }), null);
  assert.equal(parseSuggestion('1790219626883', { ...card, topLeftIndex: 7 }), null);
});

function memoryStore(): CaptureStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    primary: null as never,
    legacy: null,
    list: async () => [],
    read: async (p: string) => (objects.has(p) ? { bytes: objects.get(p)!, contentType: 'application/json' } : null) as never,
    stat: async () => null,
    exists: async (p: string) => objects.has(p),
    put: async (input: { objectPath: string; bytes: Buffer }) => {
      objects.set(input.objectPath, input.bytes);
    },
    remove: async (p: string) => objects.delete(p),
  } as unknown as CaptureStore & { objects: Map<string, Buffer> };
}

test('writes merge over what is stored, null deletes, bad entries are reported', async () => {
  const store = memoryStore();
  const first = await writeSuggestions(store, { '1790219626883': card, '1790219627510': { ...card, verdict: 'back' } });
  assert.deepEqual([first.accepted, first.total, first.rejected.length], [2, 2, 0]);
  const second = await writeSuggestions(store, { '1790219627510': null, '1790219628720': { bad: true } });
  assert.deepEqual([second.accepted, second.removed, second.total, second.rejected], [0, 1, 1, ['1790219628720']]);
  assert.ok(store.objects.has(SUGGESTIONS_PATH));
  assert.deepEqual(Object.keys(await readSuggestions(store)), ['1790219626883']);
});
