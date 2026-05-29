// qbo-client.js
'use strict';
const OAuthClient = require('intuit-oauth');
const fs = require('fs');
const path = require('path');
const { classifyCall } = require('./qbo-classify');
const { evaluateGate } = require('./qbo-gate');
const { buildLogEntry, appendLog } = require('./qbo-audit-log');

const TOKEN_PATH = path.join(__dirname, 'token.json');
const ENV_PATH = path.join(__dirname, '.env');
const API_HOSTS = {
  production: 'https://quickbooks.api.intuit.com',
  sandbox: 'https://sandbox-quickbooks.api.intuit.com',
};

function loadEnv() {
  if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const realm = process.env.QBO_REALM_ID;
  const environment = (process.env.QBO_ENVIRONMENT || 'production').toLowerCase();
  if (!clientId || !clientSecret || !realm) {
    throw new Error('QBO_CLIENT_ID, QBO_CLIENT_SECRET, and QBO_REALM_ID must be set in .env (copy .env.example).');
  }
  return { clientId, clientSecret, realm, environment };
}

function scriptName() { return path.basename(process.argv[1] || 'unknown'); }
function nowIso() { return new Date().toISOString(); }

// opts.transport injects a fake makeApiCall for tests (no credentials/network needed).
// opts.env overrides the env read by the gate. opts.realm sets the realm in test mode.
async function createClient(opts = {}) {
  const env = opts.env || process.env;
  const script = opts.script || scriptName();
  const logPath = opts.logPath;

  let realm, apiBase, transport = opts.transport;
  if (transport) {
    // Injection / test mode — no .env, OAuth, or token file required.
    realm = opts.realm || env.QBO_REALM_ID || 'TEST_REALM';
    apiBase = API_HOSTS.production;
  } else {
    const cfg = loadEnv();
    realm = cfg.realm;
    apiBase = API_HOSTS[cfg.environment] || API_HOSTS.production;
    const o = new OAuthClient({ clientId: cfg.clientId, clientSecret: cfg.clientSecret,
      environment: cfg.environment, redirectUri: 'http://localhost:3000/callback' });
    const stored = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    o.setToken(stored);
    // isAccessTokenValid() is unreliable after reloading token.json (the SDK does not
    // persist when the token was minted), so a stale access token reads as "valid" and
    // the call 401s. Track our own _savedAt and refresh only when the access token is
    // older than 55 min. Refreshing on EVERY run would rotate the refresh token each
    // time, and rapid back-to-back runs can transiently 401 on a freshly minted token.
    const savedAt = stored._savedAt ? Date.parse(stored._savedAt) : 0;
    if (!savedAt || Date.now() - savedAt > 55 * 60 * 1000) {
      const refreshed = await o.refresh();
      const tok = refreshed.getJson();
      tok._savedAt = new Date().toISOString();
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tok, null, 2));
    }
    transport = (args) => o.makeApiCall(args);
  }

  const expectedRealm = opts.expectedRealm || realm;

  const summary = { READ: 0, CREATE: 0, EDIT: 0, DELETE: 0, VOID: 0, MERGE: 0, BATCH: 0,
    sent: 0, sentWrites: 0, dryRun: 0, ids: [] };
  let writeCount = 0;

  async function apiCall(urlPath, init = {}) {
    const method = init.method || 'GET';
    const body = init.body || null;
    const classification = classifyCall({ method, urlPath, body });
    const gate = evaluateGate(classification, { env, realm, expectedRealm, writeCount, reason: init.reason });
    summary[classification.type] = (summary[classification.type] || 0) + 1;

    if (gate.mode === 'ABORT') {
      appendLog(buildLogEntry({ timestamp: nowIso(), script, classification, mode: 'ABORT',
        method, urlPath, reason: init.reason, body, error: gate.error }), logPath);
      throw new Error(gate.error);
    }

    if (gate.mode === 'DRY_RUN') {
      summary.dryRun++;
      console.log(`[DRY_RUN][${classification.type}] ${urlPath}`);
      console.log(`  WOULD WRITE: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
      appendLog(buildLogEntry({ timestamp: nowIso(), script, classification, mode: 'DRY_RUN',
        method, urlPath, reason: init.reason, body }), logPath);
      return { _dryRun: true, intent: classification };
    }

    // Count toward the blast-radius cap before sending: a failed/4xx write still
    // consumes a slot, which is intentional (a tight loop of failing writes cannot
    // bypass the cap by never "succeeding").
    if (classification.isWrite) writeCount++;
    let status = null, intuitTid = null, parsed = null;
    try {
      // Only include body when there is one. Passing body:null on a GET makes
      // intuit-oauth add a Content-Type header, which QBO rejects (error 2010).
      const args = {
        url: `${apiBase}/v3/company/${realm}${urlPath}`,
        method,
        headers: { Accept: 'application/json', ...(init.headers || {}) },
      };
      if (body) args.body = body;
      const r = await transport(args);
      // intuit-oauth@4.2.2 resolves to { status, statusText, headers, json, body }.
      status = r.status || 200;
      const h = r.headers;
      intuitTid = h ? ((h.get && h.get('intuit_tid')) || h.intuit_tid || null) : null;
      const b = (r.body !== undefined && r.body !== null) ? r.body : r.json;
      parsed = typeof b === 'string' ? JSON.parse(b) : b;
    } catch (e) {
      const errStatus = e.authResponse && e.authResponse.response ? e.authResponse.response.status : null;
      appendLog(buildLogEntry({ timestamp: nowIso(), script, classification, mode: 'SENT',
        method, urlPath, reason: init.reason, body, status: errStatus, error: e.message || String(e) }), logPath);
      throw e;
    }

    // The SDK resolves (does not throw) on 4xx (validateStatus < 500), and QBO can
    // return a 200 with a Fault body. Treat either as a failed call: log it with the
    // fault and do NOT count it as a successful sent write — but still return the body
    // so callers' existing Fault handling keeps working.
    const fault = parsed && parsed.Fault ? parsed.Fault : null;
    if (status >= 300 || fault) {
      const errMsg = fault ? JSON.stringify(fault).slice(0, 300) : `HTTP ${status}`;
      console.log(`[${classification.type}] ${classification.entity} FAILED (status ${status})`);
      appendLog(buildLogEntry({ timestamp: nowIso(), script, classification, mode: 'SENT',
        method, urlPath, reason: init.reason, body, status, intuitTid, error: errMsg }), logPath);
      return parsed;
    }

    summary.sent++;
    if (classification.isWrite) {
      summary.sentWrites++;
      // Pull the created/edited entity id by entity name (e.g. parsed.Account.Id),
      // not the first object that happens to have an Id.
      const entKey = parsed && Object.keys(parsed).find(k => k.toLowerCase() === classification.entity);
      const ent = entKey ? parsed[entKey] : null;
      if (ent && ent.Id) summary.ids.push(`${classification.entity}:${ent.Id}`);
    }
    console.log(`[${classification.type}] ${classification.entity}` +
      (classification.id ? ` id=${classification.id}` : ''));
    appendLog(buildLogEntry({ timestamp: nowIso(), script, classification, mode: 'SENT',
      method, urlPath, reason: init.reason, body, status, intuitTid }), logPath);
    return parsed;
  }

  async function snapshot(label, urlPath) {
    const data = await apiCall(urlPath);
    const dir = path.join(__dirname, 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${label}-${nowIso().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`Snapshot saved: ${file}`);
    return file;
  }

  function printSummary() {
    const w = summary.CREATE + summary.EDIT + summary.DELETE + summary.VOID + summary.MERGE + summary.BATCH;
    console.log(`\n--- QBO run summary (${script}) ---`);
    console.log(`  reads: ${summary.READ} (all sent)  writes: ${w} (sent ${summary.sentWrites}, dry-run ${summary.dryRun})`);
    console.log(`  create ${summary.CREATE}  edit ${summary.EDIT}  delete ${summary.DELETE}` +
      `  void ${summary.VOID}  merge ${summary.MERGE}  batch ${summary.BATCH}`);
    if (summary.ids.length) console.log(`  entities written: ${summary.ids.join(', ')}`);
  }

  return { apiCall, snapshot, printSummary, realm, summary };
}

module.exports = { createClient };
