import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COSMETIC_TOOLS, spokeAndSettled } from '../stopRule.js';

const calls = (...toolNames: string[]) => toolNames.map((toolName) => ({ toolName }));

test('the cosmetic set contains only the two server-side settling gestures', () => {
  assert.deepEqual([...COSMETIC_TOOLS], ['express', 'showScreen']);
});

test('lookup then answer text and express settles', () => {
  assert.equal(spokeAndSettled([
    { toolCalls: calls('search_cards') },
    { text: 'I found it.', toolCalls: calls('express') },
  ]), true);
});

test('interim text before a later data call does not settle on a silent express', () => {
  assert.equal(spokeAndSettled([
    { text: 'Found these; now checking prices.' },
    { toolCalls: calls('card_prices') },
    { toolCalls: calls('express') },
  ]), false);
});

test('interim text plus data call then text and showScreen settles', () => {
  assert.equal(spokeAndSettled([
    { text: 'Found these; now checking prices.', toolCalls: calls('card_prices') },
    { text: 'Here are the prices.', toolCalls: calls('showScreen') },
  ]), true);
});

test('lookup then text and showScreen settles', () => {
  assert.equal(spokeAndSettled([
    { toolCalls: calls('decks') },
    { text: 'Here is your deck.', toolCalls: calls('showScreen') },
  ]), true);
});

test('cosmetic gesture without text anywhere does not settle', () => {
  assert.equal(spokeAndSettled([{ toolCalls: calls('express') }]), false);
});

test('a final data-tool call never settles', () => {
  assert.equal(spokeAndSettled([
    { text: 'Checking that now.' },
    { text: 'Still checking.', toolCalls: calls('battle_logs') },
  ]), false);
});
