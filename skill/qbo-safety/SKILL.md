---
name: qbo-safety
description: Use whenever working with the QuickBooks Online (QBO) API — any query, script, or change that touches a QuickBooks company via the Intuit Accounting API. The QBO API key grants FULL read+write access; this skill enforces read-by-default, explicitly-confirmed writes, and full audit logging through the qbo-client.js wrapper.
---

# QBO Safety Protocol

The QuickBooks Online API key grants **full read AND write** access — the
`com.intuit.quickbooks.accounting` scope is a single combined scope, not read-only.
There is no read-only API key. These rules are mandatory for every QBO interaction.

## Rules

1. **All QBO access goes through `qbo-client.js`.** Never call `OAuthClient.makeApiCall`
   directly and never write a new script that builds its own OAuth client. Use:
   `const { apiCall, printSummary, snapshot } = await createClient();`

2. **Default to reads. Never write unless the user explicitly directs it.** Reading data
   (queries, reports, GETs) needs no permission. Creating, editing, deleting, voiding,
   or merging does.

3. **Before any write, confirm with the user.** State exactly what will change: the
   entity type, the specific records, the fields, and the before/after values. Wait for
   an explicit "yes." Only then run the script with `QBO_ALLOW_WRITES=1` and a `reason`.

4. **Deletes, voids, and merges need a second, separate confirmation** and the additional
   `QBO_ALLOW_DESTRUCTIVE=1` flag. Treat them as irreversible.

5. **Snapshot before mutating.** For any non-trivial write batch, call `snapshot(label, query)`
   first so the prior state is captured and diffable.

6. **Report after every call and every run.** Tell the user each call's classification
   (READ / CREATE / EDIT / DELETE) and outcome, and surface the end-of-run summary from
   `printSummary()`.

7. **The wrapper is fail-closed and you must not bypass it.** It defaults to dry-run,
   enforces a realm guard and a 25-write blast-radius cap, and logs every call to
   `qbo-audit.jsonl`. Do not set `QBO_BULK_OK` or disable any guard without explicit
   user instruction.

## Runtime flags (set only after the user confirms)

- `QBO_ALLOW_WRITES=1` — permit create/edit. Each write also needs a `reason`.
- `QBO_ALLOW_DESTRUCTIVE=1` — additionally permit delete/void/merge.
- `QBO_BULK_OK=1` — exceed the 25-write-per-run cap.

## Periodic check

Run `node qbo-audit-reconcile.js` to diff QBO's Change Data Capture (CDC) feed against
`qbo-audit.jsonl` and surface any change not made by this tooling. Reconcile within the
CDC window (~30 days).
