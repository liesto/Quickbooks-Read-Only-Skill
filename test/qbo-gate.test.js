// test/qbo-gate.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateGate } = require('../qbo-gate');

const REALM = '1234567890';
const read = { type: 'READ', isWrite: false, isDestructive: false };
const create = { type: 'CREATE', isWrite: true, isDestructive: false };
const del = { type: 'DELETE', isWrite: true, isDestructive: true };

test('reads always send', () => {
  assert.equal(evaluateGate(read, { env: {}, realm: REALM, expectedRealm: REALM }).mode, 'SENT');
});

test('write defaults to dry-run when QBO_ALLOW_WRITES unset', () => {
  assert.equal(evaluateGate(create, { env: {}, realm: REALM, expectedRealm: REALM, reason: 'x' }).mode, 'DRY_RUN');
});

test('write aborts on wrong realm even with writes allowed', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1' }, realm: 'WRONG', expectedRealm: REALM, reason: 'x' });
  assert.equal(g.mode, 'ABORT');
  assert.match(g.error, /Realm guard/);
});

test('write with allow + reason sends', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1' }, realm: REALM, expectedRealm: REALM, reason: 'fix CoA' });
  assert.equal(g.mode, 'SENT');
});

test('write with allow but no reason aborts', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1' }, realm: REALM, expectedRealm: REALM, reason: '' });
  assert.equal(g.mode, 'ABORT');
  assert.match(g.error, /reason is required/);
});

test('destructive blocked without QBO_ALLOW_DESTRUCTIVE', () => {
  const g = evaluateGate(del, { env: { QBO_ALLOW_WRITES: '1' }, realm: REALM, expectedRealm: REALM, reason: 'r' });
  assert.equal(g.mode, 'ABORT');
  assert.match(g.error, /Destructive/);
});

test('destructive sends with both flags + reason', () => {
  const g = evaluateGate(del, { env: { QBO_ALLOW_WRITES: '1', QBO_ALLOW_DESTRUCTIVE: '1' },
    realm: REALM, expectedRealm: REALM, reason: 'r' });
  assert.equal(g.mode, 'SENT');
});

test('blast-radius cap aborts the 26th write', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1' }, realm: REALM, expectedRealm: REALM,
    reason: 'r', writeCount: 25 });
  assert.equal(g.mode, 'ABORT');
  assert.match(g.error, /Blast-radius/);
});

test('QBO_BULK_OK lifts the cap', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1', QBO_BULK_OK: '1' },
    realm: REALM, expectedRealm: REALM, reason: 'r', writeCount: 100 });
  assert.equal(g.mode, 'SENT');
});

test('missing expectedRealm aborts any write (fail-closed)', () => {
  const g = evaluateGate(create, { env: { QBO_ALLOW_WRITES: '1' }, realm: REALM, reason: 'r' });
  assert.equal(g.mode, 'ABORT');
  assert.match(g.error, /Realm guard/);
});
