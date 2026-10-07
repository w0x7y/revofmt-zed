'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Client } = require('./lsp/client.cjs');
const fixture = path.resolve(__dirname, 'lsp/fixture.cjs');
function client(t) { const c = new Client(fixture); t.after(() => c.stop()); return c; }
for (const [name, source] of [['CR', 'args\ntext\r\n'], ['NUL', 'args\ntext\0'], ['high surrogate', 'args\n\ud800'], ['low surrogate', 'args\n\udc00'], ['oversize UTF-8', 'args\n' + '😀'.repeat(65537)]]) {
  test(`rejects ${name} source before invoking formatter`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-admission-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const marker = path.join(directory, 'unexpected-spawn');
    const c = client(t); await c.initialize(); c.open(source.replace('args\n', `args ${marker}\n`));
    assert.deepEqual((await c.format()).result, []); assert.equal(fs.existsSync(marker), false);
  });
}
for (const changes of [[{ text: 'args', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }], [{ text: 'args', rangeLength: 0 }], [{ text: '\r' }], null]) {
  test(`invalid full-sync change invalidates the document: ${JSON.stringify(changes)}`, async t => {
    const c = client(t); await c.initialize(); const uri = c.open('args');
    c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: changes }); assert.deepEqual((await c.format()).result, []);
  });
}
test('a repeated or older version invalidates the document until a fresh open', async t => {
  const c = client(t); await c.initialize(); const uri = c.open('args', 'file:///version', 3);
  c.notify('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: 'args' }] }); assert.deepEqual((await c.format(uri)).result, []);
  c.open('args', uri, 4); assert.equal((await c.format(uri)).result.length, 1);
});
test('source exactly at the UTF-8 byte limit is admitted', async t => {
  const c = client(t); await c.initialize(); const source = 'args\n' + '😀'.repeat(65534) + 'abc'; assert.equal(Buffer.byteLength(source), 262144);
  c.open(source); assert.equal((await c.format()).result.length, 1);
});
test('document count is bounded and closing a document releases capacity', async t => {
  const c = client(t); await c.initialize(); for (let i = 0; i < 64; i++) c.open('args', `file:///${i}`);
  c.open('args', 'file:///overflow'); assert.deepEqual((await c.format('file:///overflow')).result, []);
  c.notify('textDocument/didClose', { textDocument: { uri: 'file:///0' } }); c.open('args', 'file:///overflow'); assert.equal((await c.format('file:///overflow')).result.length, 1);
});
test('aggregate byte capacity is bounded and released after invalid changes', async t => {
  const c = client(t); await c.initialize(); const large = 'args\n' + 'x'.repeat(262139);
  for (let i = 0; i < 8; i++) c.open(large, `file:///${i}`);
  c.open('args', 'file:///overflow'); assert.deepEqual((await c.format('file:///overflow')).result, []);
  c.notify('textDocument/didChange', { textDocument: { uri: 'file:///0', version: 2 }, contentChanges: [{ text: '\r' }] });
  c.open('args', 'file:///overflow'); assert.equal((await c.format('file:///overflow')).result.length, 1);
});

test('valid full-text change entries apply in order and final text wins', async t => {
  const c = client(t); await c.initialize(); const uri = c.open('initial');
  c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'first' }, { text: 'args' }] });
  assert.equal((await c.format(uri)).result.length, 1);
});
for (const changes of [[], [{ text: '\r' }, { text: 'args' }], [{ text: 'args' }, { text: 'invalid', range: {} }]]) {
  test(`any invalid entry invalidates a complete change list: ${JSON.stringify(changes)}`, async t => {
    const c = client(t); await c.initialize(); const uri = c.open('args');
    c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: changes }); assert.deepEqual((await c.format(uri)).result, []);
  });
}
