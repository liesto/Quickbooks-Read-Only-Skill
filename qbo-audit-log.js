// qbo-audit-log.js
'use strict';
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'qbo-audit.jsonl');
const SECRET_KEYS = /(token|secret|password|authorization)/i;

function redact(o) {
  if (!o || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v);
  return out;
}

function safeBody(body) {
  let obj = body;
  if (typeof body === 'string') { try { obj = JSON.parse(body); } catch { return '[unparsed body]'; } }
  return redact(obj);
}

// Pure: build the record. Caller injects timestamp for testability.
function buildLogEntry({ timestamp, script, classification, mode, method, urlPath,
                         status = null, intuitTid = null, reason = null, body = null,
                         error = null }) {
  return {
    ts: timestamp,
    script,
    type: classification.type,
    mode,                     // SENT | DRY_RUN | ABORT
    method: String(method || 'GET').toUpperCase(),
    url: urlPath,
    operation: classification.operation,
    entity: classification.entity,
    id: classification.id,
    syncToken: classification.syncToken,
    reason: reason || null,
    request: body ? safeBody(body) : null,
    status,
    intuit_tid: intuitTid,
    error: error || null,
  };
}

function appendLog(entry, logPath = LOG_PATH) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

module.exports = { buildLogEntry, appendLog, safeBody, redact, LOG_PATH };
