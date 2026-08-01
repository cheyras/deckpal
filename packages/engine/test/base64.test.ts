import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Base64 } from '../src/common/utils/base64';

describe('Base64', () => {

  let base64: Base64;

  beforeEach(() => {
    base64 = new Base64();
  });

  it('Should throw error if string has UTF-8 characters', () => {
    //when
    const foo = () => base64.encode('Żółcić gęślą jaźń');

    //then
    assert.throws(foo, { message: 'INVALID_CHARACTER_ERR: DOM Exception 5' });
  });

  it('Should encode to base64', () => {
    //when
    const encode1 = base64.encode('');
    const encode2 = base64.encode('123456');
    const encode3 = base64.encode('1234567');
    const encode4 = base64.encode('12345678');

    //then
    assert.strictEqual(encode1, '');
    assert.strictEqual(encode2, 'MTIzNDU2');
    assert.strictEqual(encode3, 'MTIzNDU2Nw==');
    assert.strictEqual(encode4, 'MTIzNDU2Nzg=');
  });

  it('Should throw error if base64 has invalid length', () => {
    //when
    const foo = () => base64.decode('AA');

    //then
    assert.throws(foo, { message: 'Cannot decode base64' });
  });

  it('Should throw error if base64 has invalid character', () => {
    //when
    const foo = () => base64.decode('!@#$');

    //then
    assert.throws(foo, { message: 'Cannot decode base64' });
  });

  it('Should decode from base64', () => {
    //when
    const decode1 = base64.decode('');
    const decode2 = base64.decode('MTIzNDU2');
    const decode3 = base64.decode('MTIzNDU2Nw==');
    const decode4 = base64.decode('MTIzNDU2Nzg=');

    //then
    assert.strictEqual(decode1, '');
    assert.strictEqual(decode2, '123456');
    assert.strictEqual(decode3, '1234567');
    assert.strictEqual(decode4, '12345678');
  });

});
