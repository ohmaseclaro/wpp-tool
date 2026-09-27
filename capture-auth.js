#!/usr/bin/env node
/**
 * Link this tool as a WhatsApp device (scan a QR once) → .wwebjs_auth/
 * Run once; re-run when `npm run check` says the session expired.
 *
 *   npm run login      (or: node capture-auth.js)
 *
 * Interactive, human-only: a scheduled agent must never call this.
 */
const { withClient } = require('./wpp');

const TIMEOUT_MIN = Number(process.env.LOGIN_TIMEOUT_MIN || 5);

console.log('\nA browser window is opening on WhatsApp Web.');
console.log('  1) On your phone: WhatsApp → Settings → Linked devices → Link a device');
console.log('  2) Scan the QR in the window');
console.log(`\nWaiting up to ${TIMEOUT_MIN} min — the window closes on its own once linked.`);

withClient(
  async (client) => {
    // Give WhatsApp Web a moment to flush the new session to the profile before closing.
    await new Promise((r) => setTimeout(r, 5000));
    return client.info;
  },
  { headless: false, interactive: true, timeoutMs: TIMEOUT_MIN * 60_000 }
)
  .then((info) => {
    console.log(`\nLinked as ${info.pushname} (${info.wid.user}) → .wwebjs_auth/`);
    console.log('Keep .wwebjs_auth/ private — it is your live WhatsApp session. It is gitignored; never copy or print it.');
    process.exit(0);
  })
  .catch((e) => { console.error('\nNothing linked:', e.message); process.exit(1); });
