// test-connection.js
//
// Verify your credentials + tokens work. Read-only: fetches company info.
//   node test-connection.js
'use strict';
const { createClient } = require('./qbo-client');

(async () => {
  const { apiCall, printSummary, realm } = await createClient();
  const info = await apiCall(`/companyinfo/${realm}?minorversion=75`);
  const name = info && info.CompanyInfo && info.CompanyInfo.CompanyName;
  if (name) {
    console.log(`\nConnection successful! Company: ${name}`);
  } else {
    console.log('\nConnected, but no CompanyInfo returned. Response:');
    console.log(JSON.stringify(info, null, 2).slice(0, 500));
  }
  printSummary();
})().catch(e => { console.error('Connection failed:', e.message || e); process.exit(1); });
