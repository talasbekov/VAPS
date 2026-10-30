const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../next.config.js');

test('the bounded API proxy budget permits the backend 60-second document converter deadline', () => {
  assert.ok(config.experimental.proxyTimeout >= 75000, 'proxy must allow conversion plus response transport');
  assert.ok(config.experimental.proxyTimeout <= 120000, 'proxy must retain a finite, bounded deadline');
});
