#!/usr/bin/env node
/** Offline checks for the argument/chat-matching logic. No browser, no session needed. */
const assert = require('assert');
const { parseArgs, matchChats, isPhone } = require('./wpp');

const a = parseArgs(['Mom', 'hello', 'there', '--limit', '5', '--unread', '--dry-run']);
assert.deepStrictEqual(a._, ['Mom', 'hello', 'there']);
assert.strictEqual(a.limit, '5');
assert.strictEqual(a.unread, true);
assert.strictEqual(a['dry-run'], true);
assert.throws(() => parseArgs(['--limit']), /needs a value/);

assert.ok(isPhone('+55 (11) 99999-9999'));
assert.ok(!isPhone('Mom'));
assert.ok(!isPhone('1234'));

const chat = (id, name) => ({ id: { _serialized: id, user: id.split('@')[0] }, name });
const chats = [
  chat('5511999990000@c.us', 'Mom'),
  chat('5511999991111@c.us', 'Mom Work'),
  chat('120363000000000001@g.us', 'Family'),
  chat('5511999992222@c.us', 'Family Doctor'),
];
const names = (q) => matchChats(chats, q).map((c) => c.name);
assert.deepStrictEqual(names('mom'), ['Mom']);
assert.deepStrictEqual(names('work'), ['Mom Work']);
assert.deepStrictEqual(names('fam'), ['Family', 'Family Doctor']);
assert.deepStrictEqual(names('120363000000000001@g.us'), ['Family']);
assert.deepStrictEqual(names('+55 11 99999-2222'), ['Family Doctor']);
assert.deepStrictEqual(names('5511000000000'), []);
assert.deepStrictEqual(names('nobody'), []);

console.log('selftest ok');
