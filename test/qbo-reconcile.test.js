// test/qbo-reconcile.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { findUnexplained } = require('../qbo-audit-reconcile');

test('CDC change present in our writes is explained', () => {
  const ours = new Set(['account:55']);
  const cdc = { CDCResponse: [{ QueryResponse: [{ Account: [{ Id: '55', MetaData: { LastUpdatedTime: 't' } }] }] }] };
  assert.deepEqual(findUnexplained(cdc, ours, ['Account']), []);
});

test('CDC change absent from our writes is flagged', () => {
  const ours = new Set();
  const cdc = { CDCResponse: [{ QueryResponse: [{ Account: [{ Id: '99', MetaData: { LastUpdatedTime: 't' }, status: 'Deleted' }] }] }] };
  const out = findUnexplained(cdc, ours, ['Account']);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'account:99');
  assert.equal(out[0].status, 'Deleted');
});
