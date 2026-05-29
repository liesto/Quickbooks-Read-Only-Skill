// authorize.js
//
// One-time OAuth authorization for QuickBooks Online. Run this once to mint your
// tokens; afterward qbo-client.js auto-refreshes them (until the refresh token
// lapses after ~100 days of disuse, at which point you re-run this).
//
//   node authorize.js
//
// Reads QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_ENVIRONMENT from .env.
'use strict';
const OAuthClient = require('intuit-oauth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '.env');
const TOKEN_PATH = path.join(__dirname, 'token.json');
// Production apps require an HTTPS redirect; Intuit's OAuth Playground URL is the
// simplest pre-registered option. Add it under your app's Redirect URIs.
const REDIRECT_URI = 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl';

if (fs.existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const clientId = process.env.QBO_CLIENT_ID;
const clientSecret = process.env.QBO_CLIENT_SECRET;
const environment = (process.env.QBO_ENVIRONMENT || 'production').toLowerCase();
if (!clientId || !clientSecret) {
  console.error('Set QBO_CLIENT_ID and QBO_CLIENT_SECRET in .env first (copy .env.example).');
  process.exit(1);
}

const oauthClient = new OAuthClient({ clientId, clientSecret, environment, redirectUri: REDIRECT_URI });

const authUri = oauthClient.authorizeUri({
  scope: [OAuthClient.scopes.Accounting],
  state: 'qbo-readonly-auth',
});

console.log('\n1. Make sure this redirect URI is registered on your Intuit app:');
console.log(`   ${REDIRECT_URI}`);
console.log('\n2. Open this URL in your browser, log in, and authorize:\n');
console.log(authUri);
console.log('\n3. You will land on the OAuth Playground page.');
console.log('4. Copy the FULL redirect URL from your browser address bar and paste it below.');
console.log('   (It contains both `code` and `realmId`.)\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the redirect URL here: ', async (url) => {
  try {
    const authResponse = await oauthClient.createToken(url);
    const tokens = authResponse.getJson();
    tokens._savedAt = new Date().toISOString();
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    const realmMatch = /realmId=(\d+)/.exec(url);
    console.log('\nTokens saved to token.json.');
    console.log('Access token expires in:', Math.round(tokens.expires_in / 60), 'minutes (auto-refreshed by qbo-client.js).');
    console.log('Refresh token expires in:', Math.round(tokens.x_refresh_token_expires_in / 86400), 'days (rolling).');
    if (realmMatch) {
      console.log(`\nYour realm (company) ID is: ${realmMatch[1]}`);
      console.log('Put this in .env as QBO_REALM_ID.');
    } else {
      console.log('\nCould not find realmId in the URL — copy it from the redirect URL into .env as QBO_REALM_ID.');
    }
  } catch (e) {
    console.error('\nAuth error:', e.message || e);
    if (e.authResponse && typeof e.authResponse.text === 'function') console.error(e.authResponse.text());
  }
  rl.close();
});
