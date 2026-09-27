# wpp-tool

Read and send WhatsApp messages from the command line with your own WhatsApp account. No
Business API, no bot number, no server, and no process left running.

You link the tool once as a WhatsApp device, the same way you link WhatsApp Web. After that,
every command opens a headless WhatsApp Web, does one thing, prints JSON and closes the browser.
Between commands nothing is connected.

```bash
node wpp.js unread
node wpp.js messages "Mom" --limit 20
node wpp.js send "Mom" "on my way"
```

It is built for scripts and AI agents: plain JSON on stdout, stable exit codes, a `--dry-run` for
every send, and a session check to run before a batch.

> **Unofficial.** This project is not affiliated with or endorsed by WhatsApp or Meta. It drives
> WhatsApp Web through [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js). Automating a
> personal account can go against WhatsApp's Terms of Service, and accounts that send spam or bulk
> messages get banned. Use it for your own conversations at a human pace.

## Contents

- [Quick start](#quick-start)
- [Commands](#commands)
- [Output format](#output-format)
- [Session and exit codes](#session-and-exit-codes)
- [For AI agents](#for-ai-agents)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

## Quick start

Needs Node.js 20 or newer and a phone with WhatsApp.

```bash
git clone https://github.com/ohmaseclaro/wpp-tool.git
cd wpp-tool
npm install        # also downloads a Chrome for Testing into .cache/ (~150 MB)
npm run login      # scan the QR once
npm run check      # VALID  Your Name (5511999999999)
```

`npm run login` opens a Chrome window with a QR code. On your phone, open **WhatsApp → Settings →
Linked devices → Link a device** and scan it. The window closes by itself once the device is linked.
The phone then lists it as a linked "Chrome" device, and unlinking it there revokes the tool.

## Commands

```bash
node wpp.js <command> [args]        # or: npm run wpp -- <command> [args]
node wpp.js --help
```

Each command takes about 5 seconds, most of it spent loading WhatsApp Web. Commands share one
browser profile, so if one is already running the next waits for it to finish, then runs.

### Choosing a chat

Commands that take a `<CHAT>` accept any of these:

| Form | Example | Notes |
|------|---------|-------|
| Chat id | `5511999999999@c.us`, `120363...@g.us`, `1234...@lid` | Exact. Copy it from `chats` output. |
| Phone number | `+55 11 99999-9999` | With country code. Works even without an existing chat. |
| Name | `"Mom"`, `"Family"` | Exact name first, then substring, case-insensitive. |

If a name matches more than one chat, the command changes nothing. It fails and lists the matching
ids so you can pick one:

```
Error: "Ana" matches 2 chats — pass the id:
  5511911112222@c.us  Ana Souza
  5511933334444@c.us  Ana Lima
```

### Read

Reading never sends read receipts and never marks a chat as read.

| Command | What it returns |
|---------|-----------------|
| `chats [--unread] [--archived] [--query T] [--limit N]` | Chats, newest first. Default limit 30, archived chats hidden unless `--archived`. |
| `messages <CHAT> [--limit N]` | The last N messages of one chat, oldest first. Default 50. |
| `unread [--limit N]` | Every unread message, grouped by chat. Default 20 chats. |
| `contacts [TEXT]` | Your saved contacts, optionally filtered by name or number. |
| `download <MESSAGE_ID>` | Saves the message's photo, video, audio or document under `reports/`. |
| `me` | The linked account. |

### Send

| Command | What it does |
|---------|--------------|
| `send <CHAT> <TEXT...>` | Sends a text message. |
| `send <CHAT> --text-file FILE` | Sends the contents of a file, keeping line breaks. |
| `send <CHAT> --file FILE [--caption T]` | Sends a photo, video, audio or document. |
| `... --dry-run` | Resolves the chat and prints what would be sent, without sending. |

`send` waits until WhatsApp's server accepts the message and prints it back with its id. It does not
mark the chat as read.

```bash
node wpp.js send "+55 11 99999-9999" "Hello from the terminal" --dry-run
node wpp.js send "+55 11 99999-9999" "Hello from the terminal"
node wpp.js send "Family" --file ./photo.jpg --caption "look at this"
```

### Common options

| Option | Effect |
|--------|--------|
| `--out FILE` | Writes the JSON to `reports/FILE` (or an absolute path) instead of stdout. |

## Output format

Everything goes to stdout as JSON. Errors go to stderr as `Error: <message>` with exit code 1.
Timestamps are ISO 8601 in UTC.

**Chat** (`chats`, and the `chat`/`to` field elsewhere):

```json
{
  "id": "5511999999999@c.us",
  "name": "Mom",
  "isGroup": false,
  "unread": 2,
  "archived": false,
  "last": "2026-09-27T17:26:23.000Z",
  "lastMessage": "me: on my way"
}
```

**Message** (`messages`, `unread`, `send`):

```json
{
  "id": "true_5511999999999@c.us_3EB065DD31AB70F90DFF43",
  "at": "2026-09-27T17:26:23.000Z",
  "fromMe": true,
  "author": "me",
  "type": "chat",
  "body": "on my way",
  "hasMedia": false
}
```

- `author` is `"me"`, the contact's name when it is known, or the sender id.
- `type` is WhatsApp's own: `chat` (text), `image`, `video`, `ptt` (voice note), `audio`,
  `document`, `sticker`, `location`, `vcard`, `revoked` and a few more.
- For media messages `body` is the caption, and `hasMedia` is `true`. Pass the `id` to `download`.

| Command | Shape |
|---------|-------|
| `chats` | `Chat[]` |
| `messages` | `{ chat: Chat, messages: Message[] }` |
| `unread` | `{ chat: Chat, messages: Message[] }[]` |
| `contacts` | `{ id, name, pushname, number }[]` |
| `send` | `{ sent: true, to: Chat, message: Message }`, or with `--dry-run`: `{ dryRun: true, to: Chat, text, file }` |
| `download` | `{ file, mimetype, bytes }` |
| `me` | `{ id, name, platform }` |

## Session and exit codes

The linked session lives in `.wwebjs_auth/`. Check it before a batch of commands:

```bash
npm run check      # or: node check-auth.js
```

| Exit | Output starts with | Meaning | What to do |
|-----:|--------------------|---------|------------|
| `0` | `VALID` | The session works. | Run commands. |
| `1` | `EXPIRED` | WhatsApp asked for a new QR: the device was unlinked or timed out. | A human runs `npm run login`. |
| `2` | `MISSING` | No session saved yet. | A human runs `npm run login`. |
| `3` | `ERROR` | Network, browser or timeout problem. | Retry. Alert if it keeps failing. |

`wpp.js` itself exits `0` on success and `1` on any error. When the session is the cause, stderr also
says `A human must (re-)run: npm run login`.

WhatsApp unlinks a device when the phone has not been online for about 14 days, or when you unlink
it from the phone.

## For AI agents

Everything an agent needs, in one place.

**Before starting**
1. `cd` into this directory. Every command runs from here.
2. Run `node check-auth.js`. Exit `0` means go. Exit `1` or `2` means stop and ask the human to run
   `npm run login`. Never try to log in yourself: it needs the human's phone to scan a QR.

**Reading**
- `node wpp.js unread` is the usual "what's new". `node wpp.js chats` lists chats with their ids.
- `node wpp.js messages <CHAT> --limit N` gets one conversation.
- Reading is safe. It sends nothing and marks nothing as read.

**Sending**
- A message goes out under the human's name and cannot be unsent by this tool. Only send what the
  human asked for, to the person they named.
- Run the same `send` with `--dry-run` first and check that `to.name` is the intended chat.
- Prefer the chat `id` from a previous `chats` or `messages` result over a name.
- For long or multi-line text, write it to a file and use `--text-file`, which avoids shell quoting.
- If `send` fails with `Send not confirmed`, the message may have gone out. Run
  `node wpp.js messages <CHAT> --limit 5` and look before sending again.

**Mechanics**
- A command takes about 5 seconds. Commands run one at a time: a second command started while one
  is running waits for it, up to 3 minutes. Give each call a timeout of at least 120 seconds.
- Parse stdout as JSON. On a non-zero exit, read stderr instead.
- Never print, copy or upload `.wwebjs_auth/`. It is the human's live WhatsApp session.

Copy-paste recipes:

```bash
node check-auth.js || exit 1
node wpp.js unread
node wpp.js chats --query "Mom" --limit 5
node wpp.js messages "5511999999999@c.us" --limit 20
node wpp.js send "5511999999999@c.us" --text-file /tmp/reply.txt --dry-run
node wpp.js send "5511999999999@c.us" --text-file /tmp/reply.txt
node wpp.js download "false_5511999999999@c.us_3A1B2C3D4E5F"
```

## How it works

```
wpp.js <command>
  └─ launches Chrome for Testing (headless) on the profile in .wwebjs_auth/
       └─ WhatsApp Web restores the linked session, no QR needed
            └─ whatsapp-web.js calls WhatsApp Web's own modules to read or send
                 └─ prints JSON, closes the page, closes the browser
```

There are other ways to talk to WhatsApp from Node. This one was picked because of what it doesn't
need:

- **Baileys** speaks the WhatsApp protocol over a websocket with no browser. It is fast, but it
  keeps no message history: to read a conversation on demand you would have to stay connected and
  store every message yourself. WhatsApp Web loads history from the phone whenever you ask.
- **The official Cloud API** needs a Business account and a separate phone number. It can't read
  your personal chats.

| File | Purpose |
|------|---------|
| `wpp.js` | Every command. Also exports `withClient(fn)` if you want to script against whatsapp-web.js directly. |
| `capture-auth.js` | `npm run login`. Interactive, needs a human. |
| `check-auth.js` | `npm run check`. Non-interactive session check. |
| `selftest.js` | `npm test`. Offline tests for argument parsing and chat matching. |
| `scripts/patch-wwebjs.js` | Runs on `npm install`. Applies upstream fixes that whatsapp-web.js hasn't released yet. |
| `.puppeteerrc.cjs` | Keeps the downloaded Chrome inside `.cache/` in this project. |

Scripting with the same open/act/close lifecycle:

```js
const { withClient } = require('./wpp');

withClient(async (client) => {
  const chats = await client.getChats();
  return chats.filter((c) => c.unreadCount > 0).length;
}).then(console.log);
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `WPP_AUTH_DIR` | `./.wwebjs_auth` | Where the session is stored. Use a different one per account. |
| `WPP_READY_TIMEOUT_S` | `90` | How long to wait for WhatsApp Web to load. |
| `WPP_LOCK_WAIT_S` | `180` | How long a command waits for another running command to finish. |
| `LOGIN_TIMEOUT_MIN` | `5` | How long `npm run login` waits for the QR scan. |
| `PUPPETEER_EXECUTABLE_PATH` | bundled Chrome | Use another Chrome or Chromium binary. |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EXPIRED` / `WhatsApp asked for a new QR` | Run `npm run login` again. |
| `WhatsApp Web not ready after 90s` | Slow network or a WhatsApp outage. Retry, or raise `WPP_READY_TIMEOUT_S`. |
| `The browser is already running for .../session` | Another command held the profile for more than `WPP_LOCK_WAIT_S`. Check for a stuck `node wpp.js` process. |
| `Could not find Chrome` | `npx puppeteer browsers install chrome` |
| `patch-wwebjs: anchor not found` during install | The pinned whatsapp-web.js changed. See [Upgrading whatsapp-web.js](#upgrading-whatsapp-webjs). |
| Errors from inside WhatsApp Web such as `Error: r` | WhatsApp shipped a web update that whatsapp-web.js hasn't caught up with. Try the latest upstream commit. |

### Upgrading whatsapp-web.js

The dependency is pinned to an upstream commit, because the fixes for WhatsApp Web's mid-2026 changes
had not been published to npm yet. To move to a newer commit:

```bash
npm install "git+https://github.com/wwebjs/whatsapp-web.js.git#<commit>"
npm test && npm run check
```

Then send yourself a text and a photo. Remove any entry from `scripts/patch-wwebjs.js` whose fix has
landed upstream.

## Security

- `.wwebjs_auth/` is a full WhatsApp session. Anyone with a copy can read and send as you. It is
  gitignored. Don't share it, back it up somewhere public, or run the tool on a machine you don't
  trust. Unlinking the device from your phone revokes it.
- `npm audit` reports a path-traversal advisory in `extract-zip`, which Puppeteer uses only to unpack
  the Chrome it downloads from Google during `npm install`. No fixed version exists yet.

## License

[MIT](LICENSE)
