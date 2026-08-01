import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Rules } from '../src/common/store/state/rules';

describe('Rules', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const rules = new Rules();
      assert.strictEqual(rules.formatName, '');
      assert.strictEqual(rules.firstTurnDrawCard, true);
      assert.strictEqual(rules.firstTurnUseSupporter, true);
      assert.strictEqual(rules.noPrizeForFossil, true);
    });

    it('should initialize with partial overrides', () => {
      const rules = new Rules({
        formatName: 'test-format',
        firstTurnDrawCard: false
      });
      assert.strictEqual(rules.formatName, 'test-format');
      assert.strictEqual(rules.firstTurnDrawCard, false);
      assert.strictEqual(rules.firstTurnUseSupporter, true);
      assert.strictEqual(rules.noPrizeForFossil, true);
    });

    it('should initialize with all overrides', () => {
      const rules = new Rules({
        formatName: 'test-format',
        firstTurnDrawCard: false,
        firstTurnUseSupporter: false,
        noPrizeForFossil: false
      });
      assert.strictEqual(rules.formatName, 'test-format');
      assert.strictEqual(rules.firstTurnDrawCard, false);
      assert.strictEqual(rules.firstTurnUseSupporter, false);
      assert.strictEqual(rules.noPrizeForFossil, false);
    });
  });
});