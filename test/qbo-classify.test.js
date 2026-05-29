// test/qbo-classify.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyCall } = require('../qbo-classify');

test('GET is READ', () => {
  assert.equal(classifyCall({ method: 'GET', urlPath: '/account/55' }).type, 'READ');
});

test('POST to /query is READ', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/query?query=SELECT...' });
  assert.equal(c.type, 'READ');
  assert.equal(c.isWrite, false);
});

test('POST to entity with no Id is CREATE', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/account', body: { Name: 'X' } });
  assert.equal(c.type, 'CREATE');
  assert.equal(c.isWrite, true);
  assert.equal(c.isDestructive, false);
});

test('POST with Id + SyncToken is EDIT', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/account',
    body: { Id: '55', SyncToken: '3', Name: 'X' } });
  assert.equal(c.type, 'EDIT');
  assert.equal(c.id, '55');
  assert.equal(c.syncToken, '3');
});

test('operation=delete is DELETE and destructive', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/journalentry?operation=delete',
    body: { Id: '9', SyncToken: '1' } });
  assert.equal(c.type, 'DELETE');
  assert.equal(c.isDestructive, true);
});

test('operation=void is VOID and destructive', () => {
  assert.equal(classifyCall({ method: 'POST', urlPath: '/payment?operation=void',
    body: { Id: '9', SyncToken: '1' } }).type, 'VOID');
});

test('/batch is BATCH and destructive (fail-closed)', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/batch', body: { BatchItemRequest: [] } });
  assert.equal(c.type, 'BATCH');
  assert.equal(c.isDestructive, true);
});

test('body as JSON string is parsed for Id/SyncToken', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/account',
    body: JSON.stringify({ Id: '7', SyncToken: '0' }) });
  assert.equal(c.type, 'EDIT');
});

test('nested entity wrapper body is unwrapped', () => {
  const c = classifyCall({ method: 'POST', urlPath: '/account',
    body: { Account: { Id: '7', SyncToken: '0' } } });
  assert.equal(c.id, '7');
});
