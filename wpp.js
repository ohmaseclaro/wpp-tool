#!/usr/bin/env node
/**
 * Read and send WhatsApp messages using the linked session saved by `npm run login`.
 *
 *   node wpp.js <command> [args]        (see usage() at the bottom)
 *
 * Every command opens a headless WhatsApp Web, does its one thing and closes it.
 * Nothing stays connected between commands.
 */
const fs = require('fs');
const path = require('path');

const AUTH_DIR = process.env.WPP_AUTH_DIR || path.join(__dirname, '.wwebjs_auth');
const SESSION_DIR = path.join(AUTH_DIR, 'session');
const REPORTS = path.join(__dirname, 'reports');
const READY_TIMEOUT_MS = Number(process.env.WPP_READY_TIMEOUT_S || 90) * 1000;

// whatsapp-web.js reads the WhatsApp Web index response in a fire-and-forget handler, and that
// read sometimes rejects on a redirect. Nothing depends on it, so it must not kill the command.
process.on('unhandledRejection', (e) => {
  if (/Could not load response body/.test(e?.message)) return;
  throw e;
});

function authError(message, code) {
  const e = new Error(message);
  e[code] = true;
  return e;
}

const LOCK_WAIT_MS = Number(process.env.WPP_LOCK_WAIT_S || 180) * 1000;

// Opens WhatsApp Web on the saved profile, runs fn(client), always closes the browser.
// headless=false + interactive=true is the login flow: it waits for the QR to be scanned.
// Commands share one Chrome profile, so a second command waits for the first to finish.
async function withClient(fn, opts = {}) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      return await runClient(fn, opts);
    } catch (e) {
      if (!/browser is already running/.test(e.message) || Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function runClient(fn, { headless = true, interactive = false, timeoutMs = READY_TIMEOUT_MS } = {}) {
  if (!interactive && !fs.existsSync(SESSION_DIR)) {
    throw authError(`No session (${path.relative(process.cwd(), SESSION_DIR) || SESSION_DIR}). Run:  npm run login`, 'missing');
  }
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: { headless },
  });
  try {
    await new Promise((resolve, reject) => {
      // A run that died mid-session leaves WhatsApp Web's tab lock behind, and the next load stops at
      // "WhatsApp is open in another window". Before ready that is the only dialog, so take it over.
      const takeover = setInterval(() => {
        client.pupPage?.evaluate(() => {
          const buttons = document.querySelectorAll('[role=dialog] button');
          buttons[buttons.length - 1]?.click();
        }).catch(() => {});
      }, 2000);
      const timer = setTimeout(() => done(reject)(new Error(`WhatsApp Web not ready after ${timeoutMs / 1000}s`)), timeoutMs);
      const done = (f) => (v) => { clearTimeout(timer); clearInterval(takeover); f(v); };
      client.once('ready', done(resolve));
      client.once('auth_failure', done((m) => reject(authError(`auth failure: ${m}`, 'expired'))));
      client.on('qr', () => {
        if (interactive) return;
        // A QR on a headless run means the phone no longer recognises this device.
        done(reject)(authError('WhatsApp asked for a new QR — the linked session is gone', 'expired'));
      });
      // Taking over the tab lock reloads the page mid-initialize; the library re-injects on navigation.
      const reloaded = (e) => /Execution context was destroyed/.test(e.message);
      const reinject = async (tries) => {
        await new Promise((r) => setTimeout(r, 2000));
        await client.inject().catch((e) => (reloaded(e) && tries > 1 ? reinject(tries - 1) : Promise.reject(e)));
      };
      client.initialize().catch((e) => (reloaded(e) ? reinject(5) : Promise.reject(e))).catch(done(reject));
    });
    return await fn(client);
  } finally {
    // destroy() closes the browser and keeps the session; logout() would unlink the device.
    // Closing the page with unload handlers first lets WhatsApp Web release its tab lock.
    // The library re-injects on every navigation, and that throws unhandled once the page is gone.
    client.pupPage?.removeAllListeners('framenavigated');
    await client.pupPage?.close({ runBeforeUnload: true }).catch(() => {});
    await client.destroy().catch(() => {});
  }
}

async function listChats(client) {
  return (await client.getChats()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

const iso = (ts) => (ts ? new Date(ts * 1000).toISOString() : null);

function chatJson(c) {
  return {
    id: c.id._serialized,
    name: c.name,
    isGroup: c.isGroup,
    unread: c.unreadCount,
    archived: c.archived,
    last: iso(c.timestamp),
    lastMessage: c.lastMessage ? (c.lastMessage.fromMe ? 'me: ' : '') + (c.lastMessage.body || `<${c.lastMessage.type}>`) : null,
  };
}

function messageJson(m, names = {}) {
  const sender = m.author || m.from;
  return {
    id: m.id._serialized,
    at: iso(m.timestamp),
    fromMe: m.fromMe,
    author: m.fromMe ? 'me' : names[sender] || m._data?.notifyName || sender,
    type: m.type,
    body: m.body,
    hasMedia: m.hasMedia,
    quotedId: m.hasQuotedMsg ? m._data?.quotedStanzaID || true : undefined,
  };
}

// Senders come as bare ids (often @lid); resolve each distinct one to a contact name once.
async function senderNames(client, msgs) {
  const ids = [...new Set(msgs.filter((m) => !m.fromMe).map((m) => m.author || m.from))];
  const names = {};
  for (const id of ids) {
    const c = await client.getContactById(id).catch(() => null);
    const name = c && (c.name || c.pushname || c.number);
    if (name) names[id] = name;
  }
  return names;
}

const digitsOf = (q) => String(q).replace(/[\s+\-()]/g, '');
const isPhone = (q) => /^\d{8,15}$/.test(digitsOf(q));

// Pure: which of these chats does `q` mean? Exact id > phone > exact name > name substring.
function matchChats(chats, q) {
  const needle = String(q).trim().toLowerCase();
  if (needle.includes('@')) return chats.filter((c) => c.id._serialized.toLowerCase() === needle);
  if (isPhone(q)) {
    const d = digitsOf(q);
    return chats.filter((c) => c.id.user === d);
  }
  const exact = chats.filter((c) => (c.name || '').toLowerCase() === needle);
  if (exact.length) return exact;
  return chats.filter((c) => (c.name || '').toLowerCase().includes(needle));
}

async function resolveChat(client, q) {
  if (!q) throw new Error('Usage: needs a chat (name, phone number or id)');
  const hits = matchChats(await listChats(client), q);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const list = hits.slice(0, 10).map((c) => `  ${c.id._serialized}  ${c.name}`).join('\n');
    throw new Error(`"${q}" matches ${hits.length} chats — pass the id:\n${list}`);
  }
  // A number with no existing chat is still sendable if it is on WhatsApp.
  if (isPhone(q)) {
    const id = await client.getNumberId(digitsOf(q));
    if (id) return client.getChatById(id._serialized);
    throw new Error(`${q} is not on WhatsApp`);
  }
  throw new Error(`No chat matches "${q}"`);
}

const commands = {
  async chats(a) {
    return withClient(async (client) => {
      let chats = await listChats(client);
      if (a.unread) chats = chats.filter((c) => c.unreadCount > 0);
      if (!a.archived) chats = chats.filter((c) => !c.archived);
      if (a.query) chats = matchChats(chats, a.query);
      return chats.slice(0, Number(a.limit || 30)).map(chatJson);
    });
  },

  async messages(a) {
    return withClient(async (client) => {
      const chat = await resolveChat(client, a._[0]);
      const msgs = await chat.fetchMessages({ limit: Number(a.limit || 50) });
      const names = await senderNames(client, msgs);
      return { chat: chatJson(chat), messages: msgs.map((m) => messageJson(m, names)) };
    });
  },

  async unread(a) {
    return withClient(async (client) => {
      const chats = (await listChats(client)).filter((c) => c.unreadCount > 0 && !c.archived);
      const out = [];
      for (const chat of chats.slice(0, Number(a.limit || 20))) {
        const msgs = await chat.fetchMessages({ limit: chat.unreadCount });
        const names = await senderNames(client, msgs);
        out.push({ chat: chatJson(chat), messages: msgs.map((m) => messageJson(m, names)) });
      }
      return out;
    });
  },

  async contacts(a) {
    return withClient(async (client) => {
      const needle = (a._[0] || '').toLowerCase();
      return (await client.getContacts())
        .filter((c) => c.isMyContact && !c.isGroup)
        .filter((c) => !needle || `${c.name} ${c.pushname} ${c.number}`.toLowerCase().includes(needle))
        .map((c) => ({ id: c.id._serialized, name: c.name, pushname: c.pushname, number: c.number }));
    });
  },

  async send(a) {
    const text = a['text-file'] ? fs.readFileSync(a['text-file'], 'utf8') : a._.slice(1).join(' ');
    if (!a._[0] || (!text && !a.file)) throw new Error('Usage: send <CHAT> <TEXT...> | --text-file F | --file F [--caption T]');
    return withClient(async (client) => {
      const chat = await resolveChat(client, a._[0]);
      const opts = { sendSeen: false, waitUntilMsgSent: true };
      let content = text;
      if (a.file) {
        const { MessageMedia } = require('whatsapp-web.js');
        content = MessageMedia.fromFilePath(a.file);
        opts.caption = a.caption || text || undefined;
      }
      if (a['dry-run']) return { dryRun: true, to: chatJson(chat), text: a.file ? undefined : text, file: a.file };
      const startedAt = Math.floor(Date.now() / 1000) - 5;
      let msg = await client.sendMessage(chat.id._serialized, content, opts);
      // sendMessage has resolved undefined after a successful send; confirm from the chat before failing.
      if (!msg) {
        const recent = await chat.fetchMessages({ limit: 5 });
        msg = recent.reverse().find((m) => m.fromMe && m.timestamp >= startedAt && (a.file ? m.hasMedia : m.body === text));
      }
      if (!msg) throw new Error(`Send not confirmed — check the chat with \`messages\` before retrying, it may have gone out`);
      return { sent: true, to: chatJson(chat), message: messageJson(msg) };
    });
  },

  async download(a) {
    const id = a._[0];
    if (!id) throw new Error('Usage: download <MESSAGE_ID>');
    return withClient(async (client) => {
      const msg = await client.getMessageById(id);
      if (!msg) throw new Error(`No message ${id}`);
      if (!msg.hasMedia) throw new Error(`Message ${id} has no media`);
      const media = await msg.downloadMedia();
      if (!media) throw new Error('Media is no longer available on WhatsApp servers');
      const ext = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
      const name = (media.filename || `${msg.id.id}.${ext}`).replace(/[/\\:\0]/g, '_');
      fs.mkdirSync(REPORTS, { recursive: true });
      const file = path.join(REPORTS, name);
      fs.writeFileSync(file, Buffer.from(media.data, 'base64'));
      return { file, mimetype: media.mimetype, bytes: fs.statSync(file).size };
    });
  },

  async me() {
    return withClient(async (client) => ({ id: client.info.wid._serialized, name: client.info.pushname, platform: client.info.platform }));
  },
};

const BOOLS = new Set(['unread', 'archived', 'help', 'dry-run']);
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLS.has(key)) { out[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    out[key] = value;
  }
  return out;
}

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    if (!cmd || cmd === '--help' || cmd === '-h') return usage();
    if (!commands[cmd]) { usage(cmd); process.exit(1); }
    const args = parseArgs(argv.slice(1));
    const text = JSON.stringify(await commands[cmd](args), null, 2);
    if (args.out) {
      fs.mkdirSync(REPORTS, { recursive: true });
      const file = path.isAbsolute(args.out) ? args.out : path.join(REPORTS, args.out);
      fs.writeFileSync(file, text);
      console.log(`→ ${file}`);
    } else {
      console.log(text);
    }
  })().catch((e) => {
    console.error('Error:', e.message);
    if (e.expired || e.missing) console.error('A human must (re-)run:  npm run login');
    process.exit(1);
  });
}

function usage(bad) {
  if (bad) console.error(`Unknown command "${bad}"\n`);
  console.log(`WhatsApp from the CLI, using the session from \`npm run login\`.
Each command opens headless WhatsApp Web (~5s), acts, and closes it.

<CHAT> is a chat id (5511999999999@c.us / 1203...@g.us), a phone number with country
code, or a chat name (exact match first, then substring; ambiguous names list the ids).

Read (never marks anything as read)
  chats [--unread] [--archived] [--query T] [--limit N]   default 30, newest first
  messages <CHAT> [--limit N]                  last N messages, default 50
  unread [--limit N]                           unread messages of every unread chat
  contacts [substr]                            saved contacts
  download <MESSAGE_ID>                        save a message's media under reports/
  me                                           which account is linked

Write
  send <CHAT> <TEXT...>                        or --text-file F; --file F [--caption T] for media
       [--dry-run]                             resolve the chat and print what would go, send nothing

Common
  --out FILE     write the JSON under reports/ instead of stdout`);
}

module.exports = { withClient, parseArgs, matchChats, isPhone, AUTH_DIR, SESSION_DIR };
