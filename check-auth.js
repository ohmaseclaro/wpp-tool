#!/usr/bin/env node
/**
 * Check whether the linked WhatsApp session still works — for scripts / scheduled agents.
 *
 *   npm run check      (or: node check-auth.js)
 *
 * Exit codes:
 *   0  valid   — session works
 *   1  expired — WhatsApp unlinked this device; a human must re-run `npm run login`
 *   2  missing — no .wwebjs_auth/ session; run `npm run login`
 *   3  error   — unexpected failure (network, browser, timeout)
 */
const { withClient } = require('./wpp');

withClient(async (client) => client.info)
  .then((info) => {
    console.log(`VALID   ${info.pushname} (${info.wid.user})`);
    process.exit(0);
  })
  .catch((e) => {
    if (e.missing) { console.log(`MISSING: ${e.message}`); process.exit(2); }
    if (e.expired) { console.log(`EXPIRED ${e.message} — a human must re-run: npm run login`); process.exit(1); }
    console.log('ERROR:', e.message);
    process.exit(3);
  });
