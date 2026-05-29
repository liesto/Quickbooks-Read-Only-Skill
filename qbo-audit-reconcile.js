// qbo-audit-reconcile.js
//
// Diffs QuickBooks Online's Change Data Capture (CDC) feed against our append-only
// audit log and reports any entity QBO recorded as changed that our log does NOT
// explain — i.e., a change made outside this tooling (or one we failed to log).
//
// Usage:  node qbo-audit-reconcile.js [sinceISO]
// If no `since` is given, uses the last checkpoint, else the last 7 days.
// NOTE: QBO CDC covers a rolling ~30-day window and a subset of entities. Run it
// regularly so changes are caught inside that window.
'use strict';
const fs = require('fs');
const path = require('path');

const AUDIT_PATH = path.join(__dirname, 'qbo-audit.jsonl');
const CHECKPOINT_PATH = path.join(__dirname, '.reconcile-checkpoint.json');
const ENTITIES = ['Account', 'JournalEntry', 'Bill', 'Invoice', 'Purchase',
  'Vendor', 'Customer', 'Class', 'Item'];

// Pure: set of "entity:id" we wrote (SENT, non-READ) on/after `since`.
function loadAuditWrites(since, auditPath = AUDIT_PATH) {
  const set = new Set();
  if (!fs.existsSync(auditPath)) return set;
  for (const line of fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.mode === 'SENT' && e.type !== 'READ' && e.id && e.ts >= since) {
      set.add(`${String(e.entity).toLowerCase()}:${e.id}`);
    }
  }
  return set;
}

// Pure: CDC entries not explained by our write set.
function findUnexplained(cdcResponse, ourWrites, entities = ENTITIES) {
  const out = [];
  const blocks = (cdcResponse && cdcResponse.CDCResponse && cdcResponse.CDCResponse[0]
    && cdcResponse.CDCResponse[0].QueryResponse) || [];
  for (const qr of blocks) {
    for (const ent of entities) {
      for (const item of (qr[ent] || [])) {
        const key = `${ent.toLowerCase()}:${item.Id}`;
        if (!ourWrites.has(key)) {
          out.push({ key, lastUpdated: item.MetaData && item.MetaData.LastUpdatedTime, status: item.status || 'Updated' });
        }
      }
    }
  }
  return out;
}

async function main() {
  const { createClient } = require('./qbo-client');
  const sinceArg = process.argv[2];
  // Normalize a user-supplied since to UTC ISO so the lexicographic ts comparison
  // in loadAuditWrites is correct regardless of the offset format passed.
  const since = sinceArg
    ? new Date(sinceArg).toISOString()
    : (fs.existsSync(CHECKPOINT_PATH) ? JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8')).since
        : new Date(Date.now() - 7 * 86400000).toISOString());

  const { apiCall } = await createClient();
  const url = `/cdc?entities=${ENTITIES.join(',')}` +
    `&changedSince=${encodeURIComponent(since)}&minorversion=75`;
  const resp = await apiCall(url);

  const ours = loadAuditWrites(since);
  const unexplained = findUnexplained(resp, ours);

  if (unexplained.length === 0) {
    console.log(`Reconciled: every CDC change since ${since} is explained by qbo-audit.jsonl.`);
  } else {
    console.log(`UNEXPLAINED changes since ${since} (not made by this tooling) — ${unexplained.length}:`);
    for (const u of unexplained) console.log(`  ${u.key}  ${u.status}  ${u.lastUpdated || ''}`);
  }
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ since: new Date().toISOString() }, null, 2));
}

if (require.main === module) main().catch(e => { console.error('Reconcile error:', e.message || e); process.exit(1); });

module.exports = { loadAuditWrites, findUnexplained, ENTITIES };
