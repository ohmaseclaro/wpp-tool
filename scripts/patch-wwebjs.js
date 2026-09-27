#!/usr/bin/env node
/**
 * Applies upstream fixes that whatsapp-web.js has not released yet. Idempotent; runs on postinstall.
 * Delete a patch once the pinned version contains it.
 */
const fs = require('fs');
const path = require('path');

const PATCHES = [
  {
    // wwebjs/whatsapp-web.js#201923 — media sends fail with "Data passed to getter must include an id property".
    file: 'src/util/Injected/Utils.js',
    anchor: '        // Bot\'s won\'t reply if canonicalUrl is set (linking)\n',
    insert: '        if (message.__x_id) delete message.__x_id; // wpp-tool: wwebjs#201923\n',
  },
];

const root = path.dirname(require.resolve('whatsapp-web.js/package.json'));
for (const p of PATCHES) {
  const file = path.join(root, p.file);
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(p.insert)) continue;
  if (!src.includes(p.anchor)) {
    console.error(`patch-wwebjs: anchor not found in ${p.file} — upstream changed; check whether the fix landed and update scripts/patch-wwebjs.js`);
    process.exit(1);
  }
  fs.writeFileSync(file, src.replace(p.anchor, p.insert + p.anchor));
  console.log(`patch-wwebjs: patched ${p.file}`);
}
