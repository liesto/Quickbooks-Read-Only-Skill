# QuickBooks Read-Only Skill

A safety wrapper plus a [Claude](https://claude.com/claude-code) skill that makes the
**full-access** QuickBooks Online (QBO) API behave **read-only by default**. Reads run
freely; writes are blocked unless you explicitly enable them; every single API call is
classified and written to an append-only audit log; and a reconcile tool can detect
changes that happened outside this tooling.

It is designed for the situation where you (or an AI assistant) want to *query* your
QuickBooks data safely, but the only API key QuickBooks gives you can also delete it.

---

## Why this exists

**QuickBooks Online has no read-only API key.** The Intuit Accounting API exposes a
single OAuth scope — `com.intuit.quickbooks.accounting` — and it grants **both read and
write**. There is no "viewer" credential. If you can query an invoice, the same token can
edit it, void it, or delete it. Any doc or setup guide that calls this connection
"read-only" is describing *intent*, not a technical limit.

**Worse: almost everything in the QBO API is an HTTP POST.** You cannot tell reads from
writes by the HTTP method, the way you can with most REST APIs:

| What you're doing | How QBO expresses it |
|---|---|
| Read via query | `POST /v3/company/<realm>/query` |
| Create | `POST /v3/company/<realm>/account` (no `Id` in body) |
| Edit | `POST /v3/company/<realm>/account` (body has `Id` + `SyncToken`) |
| Delete / void | `POST /v3/company/<realm>/journalentry?operation=delete` |
| Batch (mixed) | `POST /v3/company/<realm>/batch` |

So a naive "only allow GET" guard would block legitimate reads (which are POSTs to
`/query`) and would happily wave through a delete. Telling the difference requires
inspecting the **URL path, the `operation` query parameter, and the request body shape** —
which is exactly what this wrapper does.

This matters even more when an LLM is driving. A model asked to "pull my P&L" is one
malformed instruction or one confused step away from issuing a POST that mutates the
books. This project makes that structurally hard instead of relying on good behavior.

---

## How it works

All access goes through one module, `qbo-client.js`. It is the only sanctioned path to
the API, and it does three things on every call: **classify, gate, log.**

### 1. Classify

`qbo-classify.js` labels each call as `READ`, `CREATE`, `EDIT`, `DELETE`, `VOID`,
`MERGE`, or `BATCH` — by looking at the method, the URL path, the `operation` param, and
whether the body carries an `Id` + `SyncToken`. It is **fail-closed**: anything it cannot
confidently identify as a read is treated as a write.

### 2. Gate (fail-closed, dry-run by default)

`qbo-gate.js` decides whether a call may be sent. Reads always pass. Writes are evaluated
in this order, and any failure stops the call:

1. **Realm guard** — the write must target your one configured company (`QBO_REALM_ID`).
2. **Dry-run default** — without `QBO_ALLOW_WRITES=1`, the write is **not sent**. The
   wrapper prints `WOULD WRITE` with the exact payload and logs the intent.
3. **Reason required** — each write must pass a non-empty `reason` describing why.
4. **Destructive tier** — `DELETE` / `VOID` / `MERGE` / `BATCH` need an *additional*
   `QBO_ALLOW_DESTRUCTIVE=1`. Enabling writes does not enable deletes.
5. **Blast-radius cap** — more than 25 writes in a single run aborts unless
   `QBO_BULK_OK=1`. This stops a runaway loop from mass-mutating.

The default state — the one you get if you do nothing — is **read freely, send no
writes.**

### 3. Log (append-only audit trail)

`qbo-audit-log.js` appends one JSON line to `qbo-audit.jsonl` for **every** call —
sent, dry-run, or aborted. Each line records the timestamp, the script that ran it, the
classification, the mode, the URL, the entity/`Id`/`SyncToken`, the request body (with
secret-like keys redacted), the HTTP status, and Intuit's own `intuit_tid` transaction
id. Tokens and secrets are never logged.

### How the assistant reinforces it to you

The bundled `qbo-safety` skill governs how an AI assistant (Claude) behaves, and the
wrapper backs it up in code so the discipline is visible, not just promised:

- **It announces what it's querying** before it runs — "I'm going to read the Account
  list," not a silent call.
- **It echoes the type of each call as it happens.** Every call prints its
  classification: `[READ] companyinfo`, `[CREATE] account id=143`, `[DRY_RUN][DELETE]
  journalentry`. You see, in plain language, what just executed.
- **It prints a run summary** at the end: how many reads, how many writes, how many were
  actually sent vs. dry-run, and the ids of anything written:
  ```
  --- QBO run summary (my-script.js) ---
    reads: 4 (all sent)  writes: 1 (sent 0, dry-run 1)
    create 1  edit 0  delete 0  void 0  merge 0  batch 0
  ```
- **It must ask before writing.** The skill requires the assistant to state exactly what
  will change and get an explicit "yes" before it ever sets `QBO_ALLOW_WRITES=1`.
- **The code does not trust any of that.** Even if the assistant ignores the skill, the
  gate still defaults writes to dry-run and the log still records every attempt.

---

## Recovering / auditing if the read-only directive is ignored

The whole point is that you are not trusting an LLM to behave. Two independent backstops
let you see and recover from anything that slips through:

### The append-only log (`qbo-audit.jsonl`)

Every call — including ones that were *attempted* — is recorded. If something was changed
through this tooling, there is a line for it, with the entity, the `Id`, the request body,
and Intuit's `intuit_tid`. To see exactly what was sent (as opposed to dry-run):

```
grep '"mode":"SENT"' qbo-audit.jsonl | grep -v '"type":"READ"'
```

Each entry's `intuit_tid` can be cross-referenced against QuickBooks' own in-app **Audit
Log** (Settings → Audit Log) to find and manually reverse a specific change. Because the
log is append-only and records the full request body, you can reconstruct what a write
*did* even after the fact.

### The reconcile tool (`qbo-audit-reconcile.js`)

This goes further: it catches changes the tooling didn't log at all — including edits made
by a person in the QuickBooks UI, by Zapier, by your accountant, or by a buggy script that
bypassed the wrapper. It pulls QuickBooks' **Change Data Capture (CDC)** feed and diffs it
against your audit log:

```
node qbo-audit-reconcile.js
```

Anything QuickBooks reports as changed that your log does not explain is flagged as
`UNEXPLAINED`. Run it regularly — QBO's CDC feed only covers a rolling ~30-day window.

> Note: neither backstop is a true rollback. QuickBooks has no general "undo." These tools
> tell you precisely *what* changed and *how*, so you can reverse it deliberately. The
> real protection is the dry-run-by-default gate that prevents the write in the first
> place.

---

## Risks and limitations

Read these before relying on it.

- **This is a safety layer, not a sandbox.** The token still has full write access. The
  protection is behavioral + procedural (classify/gate/log), not a permission boundary
  enforced by Intuit. If you explicitly set `QBO_ALLOW_WRITES=1` (and
  `QBO_ALLOW_DESTRUCTIVE=1`), the wrapper will write — that is the intended escape hatch,
  and it means a determined or careless run *can* change your books.
- **It only protects calls that go through `qbo-client.js`.** Any code that builds its own
  OAuth client, or a raw `curl` with the access token, bypasses every guard. Keep all
  access funneled through the wrapper.
- **No real rollback.** As above — the log and reconcile tool help you *find and undo*
  changes manually; they do not automatically revert them.
- **Reconcile coverage is bounded.** CDC covers ~30 days and a subset of entity types.
  A change older than the window, or to an entity not in the CDC set, won't be caught by
  reconcile (though if it went through the wrapper it's still in `qbo-audit.jsonl`).
- **You are responsible for your credentials.** `.env` and `token.json` hold secrets and
  live tokens. They are gitignored here — never commit them. The access token can read and
  write your real financial data.
- **Classification is heuristic.** It is conservative (fail-closed) and covers the
  documented QBO patterns, but Intuit can change the API. Treat an unexpected
  classification as a reason to stop and look, not to override.
- **An LLM can still be wrong inside the lines.** The gate stops *unauthorized* writes. It
  cannot tell whether an *authorized* write you approved is the correct one. Review what
  you confirm.
- **Not affiliated with or endorsed by Intuit.** "QuickBooks" is a trademark of Intuit
  Inc. Use at your own risk; see the MIT license. No warranty.

---

## Quick start

See **[INSTALL.md](INSTALL.md)** for full, step-by-step setup (creating an Intuit app,
authorizing, installing the Claude skill). The short version:

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Intuit app's client id/secret.
3. `node authorize.js` — authorize once; it prints your realm id for `.env`.
4. `node test-connection.js` — confirm a read works.
5. Install the skill: copy `skill/qbo-safety/` into `~/.claude/skills/`.

Run the tests anytime (no credentials needed — they're hermetic):

```
npm test
```

## Files

| File | Purpose |
|---|---|
| `qbo-client.js` | The wrapper. The only sanctioned API path. |
| `qbo-classify.js` | Pure: classify a call as READ/CREATE/EDIT/DELETE/VOID/MERGE/BATCH. |
| `qbo-gate.js` | Pure: the fail-closed, tiered write gate. |
| `qbo-audit-log.js` | Append-only logging + secret redaction. |
| `qbo-audit-reconcile.js` | Diff QBO's change feed against the audit log. |
| `authorize.js` | One-time OAuth setup. |
| `test-connection.js` | Read-only connectivity check. |
| `skill/qbo-safety/SKILL.md` | The Claude skill that enforces the protocol. |
| `test/` | Hermetic unit tests (30, no credentials required). |

## License

MIT. See [LICENSE](LICENSE).
