import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StateLog } from '../src/common/store/state/state-log';
import { GameLog } from '../src/common/game-message';

describe('StateLog', () => {
  describe('constructor', () => {
    it('should initialize with required message only', () => {
      const log = new StateLog(GameLog.LOG_GAME_FINISHED);
      assert.strictEqual(log.id, 0);
      assert.strictEqual(log.client, 0);
      assert.deepStrictEqual(log.params, {});
      assert.strictEqual(log.message, GameLog.LOG_GAME_FINISHED);
    });

    it('should initialize with message and params', () => {
      const params = { cardName: 'Test Card', playerId: 1 };
      const log = new StateLog(GameLog.LOG_PLAYER_PLAYS_ITEM, params);
      assert.strictEqual(log.id, 0);
      assert.strictEqual(log.client, 0);
      assert.deepStrictEqual(log.params, params);
      assert.strictEqual(log.message, GameLog.LOG_PLAYER_PLAYS_ITEM);
    });

    it('should initialize with message, params and client', () => {
      const params = { cardName: 'Test Card', playerId: 1 };
      const log = new StateLog(GameLog.LOG_PLAYER_PLAYS_ITEM, params, 2);
      assert.strictEqual(log.id, 0);
      assert.strictEqual(log.client, 2);
      assert.deepStrictEqual(log.params, params);
      assert.strictEqual(log.message, GameLog.LOG_PLAYER_PLAYS_ITEM);
    });

    it('should handle empty params', () => {
      const log = new StateLog(GameLog.LOG_GAME_FINISHED, {}, 2);
      assert.deepStrictEqual(log.params, {});
    });

    it('should keep params reference', () => {
      const params = { cardName: 'Test Card', playerId: 1 };
      const log = new StateLog(GameLog.LOG_GAME_FINISHED, params);
      assert.strictEqual(log.params, params);
    });
  });
});