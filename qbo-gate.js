// qbo-gate.js
'use strict';

// Pure, fail-closed gate evaluation. No I/O; env + run state are passed in.
//
// Order matters: reads always pass; then realm guard, dry-run default, reason
// requirement, destructive tier, and finally the blast-radius cap. A wrong realm
// aborts even on a fully-permissioned run.
const DEFAULT_BULK_CAP = 25;

function truthy(v) { return v === '1' || v === 'true' || v === 'yes'; }

function evaluateGate(classification, { env = {}, realm, expectedRealm, writeCount = 0, reason = '' } = {}) {
  const { type, isWrite, isDestructive } = classification;

  if (!isWrite) return { mode: 'SENT', type };

  // Realm guard: every write must target the single configured company.
  if (!expectedRealm || realm !== expectedRealm) {
    return { mode: 'ABORT', type,
      error: `Realm guard: write target realm ${realm} does not match configured QBO_REALM_ID ${expectedRealm || '(unset)'}` };
  }

  if (!truthy(env.QBO_ALLOW_WRITES)) {
    return { mode: 'DRY_RUN', type, note: 'QBO_ALLOW_WRITES not set' };
  }

  if (!reason || !String(reason).trim()) {
    return { mode: 'ABORT', type,
      error: `Write blocked: a non-empty reason is required for ${type} calls` };
  }

  if (isDestructive && !truthy(env.QBO_ALLOW_DESTRUCTIVE)) {
    return { mode: 'ABORT', type,
      error: `Destructive op ${type} blocked: set QBO_ALLOW_DESTRUCTIVE=1 to permit` };
  }

  const cap = env.QBO_BULK_CAP ? parseInt(env.QBO_BULK_CAP, 10) : DEFAULT_BULK_CAP;
  if (writeCount >= cap && !truthy(env.QBO_BULK_OK)) {
    return { mode: 'ABORT', type,
      error: `Blast-radius cap reached (${cap} writes this run). Set QBO_BULK_OK=1 to exceed.` };
  }

  return { mode: 'SENT', type };
}

module.exports = { evaluateGate, DEFAULT_BULK_CAP };
