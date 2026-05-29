// test/qbo-client.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { createClient } = require('../qbo-client');

const TMP_LOG = path.join(os.tmpdir(), 'qbo-client-test-' + process.pid + '.jsonl');

test('read passes through to transport', async () => {
  let called = 0;
  const { apiCall } = await createClient({
    env: {}, script: 'unit', logPath: TMP_LOG,
    transport: async () => { called++; return { status: 200, headers: { get: () => 'tid-x' }, body: JSON.stringify({ ok: true }) }; },
  });
  const r = await apiCall('/query?query=SELECT');
  assert.equal(called, 1);
  assert.deepEqual(r, { ok: true });
});

test('write in default mode is dry-run, transport NOT called', async () => {
  let called = 0;
  const { apiCall, summary } = await createClient({
    env: {}, script: 'unit', logPath: TMP_LOG,
    transport: async () => { called++; return { status: 200, body: '{}' }; },
  });
  const r = await apiCall('/account', { method: 'POST', body: { Name: 'X' }, reason: 'x' });
  assert.equal(called, 0);
  assert.equal(r._dryRun, true);
  assert.equal(summary.dryRun, 1);
});

test('write with allow flag + reason calls transport', async () => {
  let called = 0;
  const { apiCall } = await createClient({
    env: { QBO_ALLOW_WRITES: '1' }, script: 'unit', logPath: TMP_LOG,
    transport: async () => { called++; return { status: 200, headers: { get: () => 'tid-x' }, body: JSON.stringify({ Account: { Id: '9' } }) }; },
  });
  await apiCall('/account', { method: 'POST', body: { Name: 'X' }, reason: 'create test acct' });
  assert.equal(called, 1);
});

test('destructive without destructive flag aborts before transport', async () => {
  let called = 0;
  const { apiCall } = await createClient({
    env: { QBO_ALLOW_WRITES: '1' }, script: 'unit', logPath: TMP_LOG,
    transport: async () => { called++; return { status: 200, body: '{}' }; },
  });
  await assert.rejects(
    apiCall('/journalentry?operation=delete', { method: 'POST', body: { Id: '1', SyncToken: '0' }, reason: 'r' }),
    /Destructive/);
  assert.equal(called, 0);
});

test('a 4xx/Fault write is logged as error and NOT counted as a successful write', async () => {
  const fs = require('fs');
  const log = path.join(os.tmpdir(), 'qbo-client-faulttest-' + process.pid + '.jsonl');
  if (fs.existsSync(log)) fs.unlinkSync(log);
  const { apiCall, summary } = await createClient({
    env: { QBO_ALLOW_WRITES: '1' }, script: 'unit', logPath: log,
    transport: async () => ({ status: 400, headers: { get: () => 'tid-f' },
      body: JSON.stringify({ Fault: { Error: [{ Message: 'Stale Object', code: '5010' }], type: 'ValidationFault' } }) }),
  });
  const r = await apiCall('/account', { method: 'POST', body: { Id: '1', SyncToken: '0', Name: 'X' }, reason: 'edit' });
  assert.ok(r.Fault, 'returns the Fault body so callers can handle it');
  assert.equal(summary.sentWrites, 0, 'rejected write is not counted as sent');
  const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
  assert.equal(entry.status, 400);
  assert.match(entry.error, /ValidationFault|Stale Object/);
  fs.unlinkSync(log);
});

test('sent call logs status and intuit_tid from real SDK response shape', async () => {
  const fs = require('fs');
  const log = path.join(os.tmpdir(), 'qbo-client-tidtest-' + process.pid + '.jsonl');
  if (fs.existsSync(log)) fs.unlinkSync(log);
  const { apiCall } = await createClient({
    env: {}, script: 'unit', logPath: log,
    transport: async () => ({ status: 200, headers: { get: (k) => k === 'intuit_tid' ? 'tid-abc' : null },
      body: JSON.stringify({ CompanyInfo: { CompanyName: 'X' } }) }),
  });
  await apiCall('/companyinfo/1');
  const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop());
  assert.equal(entry.status, 200);
  assert.equal(entry.intuit_tid, 'tid-abc');
  fs.unlinkSync(log);
});
