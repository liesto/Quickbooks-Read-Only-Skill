#!/usr/bin/env node
'use strict';
// PostToolUse hook (Claude Code) that surfaces the QBO read/write tally.
//
// qbo-safety rule 6 requires reporting the READ/write classification of every
// QBO call to the user. That depends on the model remembering to do it, which
// drifts over long sessions. This hook makes it reliable: after each Bash tool
// call it reads any NEW lines appended to the audit log and injects a
// system-reminder with the per-run tally, so the model is prompted with the
// numbers already computed.
//
// It is purely additive — it does not gate writes (the wrapper does that) and
// cannot author the model's reply; it only pushes the tally into context.
//
// Config (env, both optional):
//   QBO_AUDIT_LOG         path to qbo-audit.jsonl (default: ./qbo-audit.jsonl next to this script)
//   QBO_AUDIT_HOOK_STATE  path to the high-water-mark state file
//                         (default: .audit-hook-state.json next to the log)
//
// Robustness: self-gates on new audit lines, so it stays silent on non-QBO Bash
// calls. Never blocks the tool flow — any failure exits 0 with no output.

const fs = require('fs');
const path = require('path');

const LOG = process.env.QBO_AUDIT_LOG || path.join(__dirname, 'qbo-audit.jsonl');
const STATE = process.env.QBO_AUDIT_HOOK_STATE || path.join(path.dirname(LOG), '.audit-hook-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).lines || 0; } catch { return null; }
}
function writeState(lines) {
  try { fs.writeFileSync(STATE, JSON.stringify({ lines })); } catch { /* ignore */ }
}

try {
  if (!fs.existsSync(LOG)) process.exit(0);
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  const last = readState();

  // First run with no state: sync to current length and stay silent, so we
  // never replay historical entries as if they happened this run.
  if (last === null) { writeState(lines.length); process.exit(0); }

  // No new QBO activity since last check.
  if (lines.length <= last) { if (lines.length < last) writeState(lines.length); process.exit(0); }

  const fresh = lines.slice(last);
  writeState(lines.length);

  const tally = { READ: 0, CREATE: 0, EDIT: 0, DELETE: 0, VOID: 0, MERGE: 0, other: 0 };
  let dryRun = 0, aborted = 0, errors = 0;
  for (const l of fresh) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    const t = (e.type || 'other').toUpperCase();
    if (t in tally) tally[t]++; else tally.other++;
    if (e.mode === 'DRY_RUN') dryRun++;
    else if (e.mode === 'ABORT') aborted++;
    if (e.error) errors++;
  }
  const writes = tally.CREATE + tally.EDIT + tally.DELETE + tally.VOID + tally.MERGE;

  let msg = `QBO audit (this run): READ ${tally.READ} · write ${writes}`;
  if (writes) msg += ` — CREATE ${tally.CREATE} EDIT ${tally.EDIT} DELETE ${tally.DELETE} VOID ${tally.VOID} MERGE ${tally.MERGE}`;
  if (dryRun) msg += ` · ${dryRun} dry-run`;
  if (aborted) msg += ` · ${aborted} aborted`;
  if (errors) msg += ` · ${errors} with errors`;
  msg += `. Per qbo-safety rule 6, surface this READ/write tally to the user in your reply.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg },
  }));
} catch {
  process.exit(0);
}
