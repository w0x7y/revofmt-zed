'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { Client } = require('./lsp/client.cjs');
const fixture = path.resolve(__dirname, 'lsp/fixture.cjs');
function client(t) { const c = new Client(fixture); t.after(() => c.stop()); return c; }
function temporary(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-job-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
async function started(file) { for (let i = 0; i < 200; i++) { if (fs.existsSync(file)) return Number(fs.readFileSync(file)); await delay(5); } assert.fail('Formatter did not start'); }
async function gone(pid) { for (let i = 0; i < 200; i++) { try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; } await delay(5); } assert.fail(`Formatter ${pid} survived cancellation`); }
for (const mode of ['overflow-out', 'overflow-error', 'invalid-error', 'invalid-utf8', 'carriage-return', 'nul', 'nonzero', 'signal']) {
  test(`${mode} cannot return an edit`, async t => { const c = client(t); await c.initialize(); c.open(mode); assert.deepEqual((await c.format()).result, []); });
}
test('stdout BOM is preserved rather than silently discarded by UTF-8 decoding', async t => {
  const c = client(t); await c.initialize(); c.open('bom'); assert.equal((await c.format()).result[0].newText, '\ufefflet changed = 1\n');
});
test('initialization options override CLI executable and pass direct arguments', async t => {
  const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
  await c.initialize({ executable: fixture, indentWidth: 4, lineWidth: 120, timeoutMs: 500 }); c.open('args');
  assert.equal((await c.format()).result[0].newText, '["--indent-width","4","--line-width","120","-"]\n');
});
test('missing executable returns no edits and leaves the protocol usable', async t => {
  const c = new Client('/does/not/exist'); t.after(() => c.stop()); await c.initialize(); c.open('anything');
  assert.deepEqual((await c.format()).result, []); assert.equal((await c.request('unknown', {})).error.code, -32601);
});
test('timeout kills the direct child and settles once', async t => {
  const c = client(t); const marker = path.join(temporary(t), 'pid'); await c.initialize({ timeoutMs: 200 }); c.open(`wait ${marker}`);
  const response = c.format(); const pid = await started(marker); assert.deepEqual((await response).result, []); await gone(pid);
  await delay(50); assert.equal(c.messages.filter(message => message.id === response.id).length, 1);
});
test('deadline settles even after direct-child exit with inherited pipes', async t => {
  const c = client(t); await c.initialize({ timeoutMs: 150 }); c.open('inherited'); const start = Date.now();
  assert.deepEqual((await c.format()).result, []); assert.ok(Date.now() - start < 700);
  await c.request('shutdown'); c.notify('exit'); assert.equal((await c.exited)[0], 0);
});
for (const action of ['cancel', 'change', 'close', 'supersede', 'shutdown', 'eof']) {
  test(`${action} stops current child and cannot emit stale edits`, async t => {
    const c = client(t); const marker = path.join(temporary(t), 'pid'); await c.initialize(); const uri = c.open(`wait ${marker}`);
    const first = c.format(uri); const pid = await started(marker);
    let second;
    if (action === 'cancel') c.notify('$/cancelRequest', { id: first.id });
    if (action === 'change') c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'new text' }] });
    if (action === 'close') c.notify('textDocument/didClose', { textDocument: { uri } });
    if (action === 'supersede') { fs.unlinkSync(marker); second = c.format(uri); }
    if (action === 'shutdown') await c.request('shutdown');
    if (action === 'eof') c.child.stdin.end();
    assert.deepEqual((await first).result, []); await gone(pid);
    if (second) { const next = await started(marker); c.notify('$/cancelRequest', { id: second.id }); assert.deepEqual((await second).result, []); await gone(next); }
    await delay(40); assert.equal(c.messages.filter(message => message.id === first.id).length, 1);
    if (action === 'change') assert.deepEqual((await c.format(uri)).result, []);
  });
}
test('at most eight URIs can run formatter jobs at once', async t => {
  const c = client(t); const directory = temporary(t); await c.initialize(); const requests = [];
  for (let i = 0; i < 8; i++) { const marker = path.join(directory, `pid-${i}`); c.open(`wait ${marker}`, `file:///${i}`); requests.push(c.format(`file:///${i}`)); await started(marker); }
  const rejectedMarker = path.join(directory, 'rejected'); c.open(`wait ${rejectedMarker}`, 'file:///ninth'); assert.deepEqual((await c.format('file:///ninth')).result, []); assert.equal(fs.existsSync(rejectedMarker), false);
  for (const request of requests) c.notify('$/cancelRequest', { id: request.id });
  for (const request of requests) assert.deepEqual((await request).result, []);
});

for (const mode of ['exact-out', 'exact-error']) {
  test(`${mode} remains admitted at its byte limit`, async t => { const c = client(t); await c.initialize(); c.open(mode); assert.equal((await c.format()).result.length, 1); });
}

test('nonzero exit settles promptly even with inherited pipes', async t => {
  const c = client(t); await c.initialize(); c.open('nonzero-inherited'); const start = Date.now();
  assert.deepEqual((await c.format()).result, []); assert.ok(Date.now() - start < 700);
});
