// test/qbo-audit-log.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLogEntry, appendLog, redact } = require('../qbo-audit-log');

const classification = { type: 'CREATE', entity: 'account', id: null, syncToken: null, operation: null };

test('buildLogEntry captures required fields', () => {
  const e = buildLogEntry({ timestamp: '2026-05-28T00:00:00.000Z', script: 's.js',
    classification, mode: 'DRY_RUN', method: 'POST', urlPath: '/account',
    reason: 'test', body: { Name: 'X' } });
  assert.equal(e.ts, '2026-05-28T00:00:00.000Z');
  assert.equal(e.script, 's.js');
  assert.equal(e.type, 'CREATE');
  assert.equal(e.mode, 'DRY_RUN');
  assert.equal(e.method, 'POST');
  assert.equal(e.url, '/account');
  assert.equal(e.reason, 'test');
  assert.deepEqual(e.request, { Name: 'X' });
});

test('redact hides secret-like keys', () => {
  const out = redact({ access_token: 'abc', Name: 'ok', nested: { refresh_token: 'z' } });
  assert.equal(out.access_token, '[REDACTED]');
  assert.equal(out.Name, 'ok');
  assert.equal(out.nested.refresh_token, '[REDACTED]');
});

test('appendLog writes one JSONL line', () => {
  const tmp = path.join(os.tmpdir(), `qbo-audit-test-${process.pid}.jsonl`);
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  const e = buildLogEntry({ timestamp: '2026-05-28T00:00:00.000Z', script: 's.js',
    classification, mode: 'SENT', method: 'GET', urlPath: '/account/1' });
  appendLog(e, tmp); appendLog(e, tmp);
  const lines = fs.readFileSync(tmp, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).script, 's.js');
  fs.unlinkSync(tmp);
});
