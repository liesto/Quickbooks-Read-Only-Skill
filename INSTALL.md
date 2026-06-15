# Install & Setup

Step-by-step setup for the QuickBooks Read-Only Skill. Plan for ~15 minutes the first
time, mostly creating the Intuit app.

## Prerequisites

- **Node.js 20.12 or newer** (uses the built-in `process.loadEnvFile()` and `node:test` —
  no extra dependencies for either). Check with `node --version`.
- A QuickBooks Online company you administer.
- An [Intuit Developer](https://developer.intuit.com) account (free).

---

## 1. Get the code

```
git clone https://github.com/liesto/Quickbooks-Read-Only-Skill.git
```

```
cd Quickbooks-Read-Only-Skill
```

```
npm install
```

This installs the one dependency, `intuit-oauth`. Confirm everything works before adding
any credentials — the tests are hermetic:

```
npm test
```

You should see `tests 30 / pass 30 / fail 0`.

---

## 2. Create your Intuit app

Each user needs their own app — credentials are not shareable, and each app connects to
your own QuickBooks company.

1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in.
2. Create a new app and select the **Accounting** scope (`com.intuit.quickbooks.accounting`).
3. Open the app's **Keys & credentials**. For real data use the **Production** keys (for
   testing against a sandbox company, use the Development keys and set
   `QBO_ENVIRONMENT=sandbox` below).
4. Under **Redirect URIs**, add Intuit's OAuth Playground URL exactly:

```
https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl
```

Production keys may require completing Intuit's short app questionnaire first.

---

## 3. Configure `.env`

Copy the template:

```
cp .env.example .env
```

Open `.env` and paste your **Client ID** and **Client Secret**. Leave `QBO_REALM_ID`
blank for now — you'll get it in the next step. Set `QBO_ENVIRONMENT` to `production`
(or `sandbox`).

`.env` is gitignored. Never commit it.

---

## 4. Authorize (one time)

```
node authorize.js
```

Follow the prompts: open the printed URL, log in to QuickBooks, authorize the app, then
copy the **full redirect URL** from your browser's address bar and paste it back into the
terminal. The script saves your tokens to `token.json` and prints your **realm (company)
id**.

Put that realm id into `.env` as `QBO_REALM_ID`.

> `token.json` is gitignored. After this, `qbo-client.js` refreshes the access token
> automatically. You only re-run `authorize.js` if the refresh token lapses (after ~100
> days of no use).

---

## 5. Verify a read works

```
node test-connection.js
```

Expected: `Connection successful! Company: <your company name>` and a run summary showing
`writes: 0`.

---

## 6. Install the Claude skill

Copy the skill into your Claude skills directory so Claude loads it automatically whenever
you work with QuickBooks:

```
cp -R skill/qbo-safety ~/.claude/skills/qbo-safety
```

That's it. When you ask Claude to query QuickBooks in this project, it will route through
`qbo-client.js`, announce each call, and refuse to write without your explicit go-ahead.

---

## 7. (Optional) Install the audit-tally hook

Rule 6 asks Claude to report the READ/write tally after every QBO call. Over a long
session that habit can drift. `qbo-audit-hook.js` is a Claude Code **PostToolUse** hook
that makes it reliable: after each Bash tool call it reads any new lines appended to
`qbo-audit.jsonl` and injects a `READ n · write n` tally into Claude's context, so the
numbers are in front of it (already computed) when it replies.

It is purely additive — it does **not** gate writes (the wrapper does that) and cannot
author Claude's reply; it only surfaces the tally. It self-gates on new audit lines, so
it stays silent on non-QBO Bash calls and never blocks the tool flow.

Add this to `~/.claude/settings.json` (merge into any existing `hooks`), pointing the
command at wherever you cloned this repo:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/absolute/path/to/Quickbooks-Read-Only-Skill/qbo-audit-hook.js\"",
            "timeout": 10,
            "statusMessage": "Checking QBO audit tally"
          }
        ]
      }
    ]
  }
}
```

If your audit log lives somewhere other than next to the script, point the hook at it
with the `QBO_AUDIT_LOG` env var (and optionally `QBO_AUDIT_HOOK_STATE` for the
high-water-mark file). The hook tracks how many audit lines it has already reported in a
small state file (`.audit-hook-state.json`, gitignored) so each firing reports only that
run's delta. On first run with no state it syncs silently rather than replaying history.

After editing settings, open `/hooks` once (or restart Claude Code) so the new hook is
picked up.

---

## Daily use

**Read (the default — nothing special needed):**

```
node your-script.js
```

Write your own scripts against the wrapper like this:

```js
const { createClient } = require('./qbo-client');
const { apiCall, printSummary } = await createClient();
const data = await apiCall('/query?query=' + encodeURIComponent('SELECT * FROM Account') + '&minorversion=75');
printSummary();
```

**Perform a confirmed write** (only after you've decided to): the run needs the flag, and
each write call in your code must pass a `reason`:

```
QBO_ALLOW_WRITES=1 node your-write-script.js
```

**A delete / void / merge** additionally needs:

```
QBO_ALLOW_DESTRUCTIVE=1 QBO_ALLOW_WRITES=1 node your-destructive-script.js
```

**Audit for changes not made by this tooling:**

```
node qbo-audit-reconcile.js
```

See [README.md](README.md) for how classification, the gate, the audit log, and recovery
work — and the risks.
