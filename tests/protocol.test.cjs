'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client, frame } = require('./lsp/client.cjs');
const fixture = path.resolve(__dirname, 'lsp/fixture.cjs');
function client(t) { const c = new Client(fixture); t.after(() => c.stop()); return c; }
test('uninitialized and unknown requests use protocol errors; notifications have no responses', async t => {
  const c = client(t); assert.equal((await c.format()).error.code, -32002); await c.initialize();
  c.notify('unknown', {}); c.notify('initialized', {}); c.notify('textDocument/formatting', {});
  const response = await c.request('unknown', {}); assert.equal(response.error.code, -32601); assert.equal(c.messages.length, 3);
});
test('malformed notifications never produce responses', async t => {
  const c = client(t); await c.initialize(); c.send({ jsonrpc: '1.0', method: 'unknown', params: {} });
  await c.request('unknown', {}); assert.equal(c.messages.length, 2);
});
test('shutdown responds null, rejects new requests, and exit ends normally', async t => {
  const c = client(t); await c.initialize(); assert.equal((await c.request('shutdown')).result, null);
  assert.equal((await c.format()).error.code, -32600); c.notify('exit'); assert.equal((await c.exited)[0], 0);
});
test('exit without shutdown ends with failure status', async t => { const c = client(t); c.notify('exit'); assert.equal((await c.exited)[0], 1); });
for (const options of [{ indentWidth: 0 }, { indentWidth: 1.5 }, { lineWidth: 241 }, { timeoutMs: 0 }, { timeoutMs: 60001 }, { maxBlankLines: 9 }, { maxBlankLines: -1 }, { maxBlankLines: 1.5 }, { maxBlankLines: '1' }, { maxBlankLines: null }, { indentStyle: 'tabs' }, { indentStyle: 'Space' }, { indentStyle: 1 }, { indentStyle: null }, { executable: 'relative' }, { executable: '/path\0bad' }, []]) {
  test(`rejects invalid initialization options ${JSON.stringify(options)}`, async t => { const c = client(t); assert.equal((await c.initialize(options)).error.code, -32602); assert.ok((await c.initialize()).result); });
}
for (const [options, message] of [[{ indentStyle: 'tabs' }, 'Invalid indentStyle'], [{ indentStyle: true }, 'Invalid indentStyle'], [{ maxBlankLines: 9 }, 'Invalid maxBlankLines'], [{ maxBlankLines: -1 }, 'Invalid maxBlankLines']]) {
  test(`names the invalid option ${JSON.stringify(options)}`, async t => { const c = client(t); assert.equal((await c.initialize(options)).error.message, message); });
}
for (const options of [{ indentStyle: 'tab', maxBlankLines: 0 }, { indentStyle: 'space', maxBlankLines: 8 }, { indentWidth: 1, lineWidth: 20, indentStyle: 'tab', maxBlankLines: 1, timeoutMs: 1 }]) {
  test(`accepts valid initialization options ${JSON.stringify(options)}`, async t => { const c = client(t); assert.ok((await c.initialize(options)).result); });
}
for (const params of [null, {}, { textDocument: { uri: 'file:///ok' }, options: {} }, { textDocument: { uri: 7 }, options: { tabSize: 2, insertSpaces: true } }, { textDocument: { uri: 'file:///ok' }, options: { tabSize: 0, insertSpaces: true } }]) {
  test(`invalid formatting request returns InvalidParams ${JSON.stringify(params)}`, async t => { const c = client(t); await c.initialize(); assert.equal((await c.request('textDocument/formatting', params)).error.code, -32602); });
}
test('framing handles byte-fragmented headers and Unicode payloads', async t => {
  const c = client(t); const promise = c.waitFor(41);
  const message = frame({ jsonrpc: '2.0', id: 41, method: 'initialize', params: { capabilities: {}, processId: null, clientInfo: { name: '😀' } } });
  for (const byte of message) c.child.stdin.write(Buffer.from([byte])); assert.ok((await promise).result);
});
test('parse errors reject malformed JSON and invalid UTF-8 without losing the next frame', async t => {
  const c = client(t); c.child.stdin.write(Buffer.from('Content-Length: 1\r\n\r\n{'));
  c.child.stdin.write(Buffer.concat([Buffer.from('Content-Length: 2\r\n\r\n'), Buffer.from([0xc3, 0x28])]));
  await c.initialize(); assert.equal(c.messages.length, 3); assert.deepEqual(c.messages.slice(0, 2).map(message => message.error.code), [-32700, -32700]);
});
for (const header of ['Content-Length: 2097153\r\n\r\n', 'Content-Length: 1\r\nContent-Length: 1\r\n\r\n', 'Content-Length: -1\r\n\r\n', 'Content-Length: 1e3\r\n\r\n', 'X: '.padEnd(8193, 'x')]) {
  test(`rejects malformed or over-budget headers: ${header.slice(0, 65)}`, async t => { const c = client(t); c.child.stdin.write(header); assert.equal((await c.exited)[0], 1); assert.equal(c.messages.length, 0); });
}
test('incomplete frame at EOF exits without hanging', async t => { const c = client(t); c.child.stdin.end('Content-Length: 100\r\n\r\n{}'); await c.exited; assert.equal(c.messages.length, 0); });
test('outgoing backpressure is bounded and cannot leave the server hanging', async t => {
  const c = client(t); await c.initialize(); c.child.stdout.pause();
  const bytes = frame({ jsonrpc: '2.0', id: 'x'.repeat(200000), method: 'unknown' });
  c.child.stdin.on('error', () => {});
  for (let i = 0; i < 16; i++) c.child.stdin.write(bytes);
  let deadline;
  try {
    const result = await Promise.race([c.exited, new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('Blocked output did not terminate')), 2500); })]);
    assert.equal(result[0], 1);
  } finally { clearTimeout(deadline); }
});

test('initialize rejects an array of parameters', async t => { const c = client(t); assert.equal((await c.request('initialize', [])).error?.code, -32602); });
test('initializationOptions null means defaults', async t => { const c = client(t); assert.ok((await c.initialize(null)).result); });
test('admits an exact-limit header', async t => {
  const c = client(t); const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'initialize', params: {} }));
  const prefix = `Content-Length: ${body.length}\r\nX: `;
  const header = prefix + 'x'.repeat(8192 - Buffer.byteLength(prefix) - 4) + '\r\n\r\n';
  const response = c.waitFor(41); c.child.stdin.write(Buffer.concat([Buffer.from(header), body])); assert.ok((await response).result);
});
test('admits an exact-limit wire payload', async t => {
  const c = client(t); await c.initialize(); const message = { jsonrpc: '2.0', id: 41, method: 'unknown', params: { padding: '' } };
  message.params.padding = 'x'.repeat(2097152 - Buffer.byteLength(JSON.stringify(message)));
  const response = c.waitFor(41); c.send(message); assert.equal((await response).error.code, -32601);
});
