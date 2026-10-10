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
const toolArguments = (...rest) => JSON.stringify(rest) + '\n';
test('initialization options override CLI executable and pass direct arguments', async t => {
  const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
  await c.initialize({ executable: fixture, indentWidth: 4, lineWidth: 120, timeoutMs: 500 }); const uri = c.open('args', 'untitled:Untitled-1');
  assert.equal((await c.format(uri)).result[0].newText, toolArguments('--prefer-config', '--indent-width', '4', '--line-width', '120', '--indent-style', 'space', '--max-blank-lines', '1', '-'));
});
test('file URIs add the stdin path after --prefer-config and new options reach the CLI', async t => {
  const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
  await c.initialize({ executable: fixture, indentWidth: 4, lineWidth: 120, indentStyle: 'tab', maxBlankLines: 0, timeoutMs: 500 }); const uri = c.open('args', 'file:///project/a.rv');
  assert.equal((await c.format(uri)).result[0].newText, toolArguments('--prefer-config', '--stdin-filepath', '/project/a.rv', '--indent-width', '4', '--line-width', '120', '--indent-style', 'tab', '--max-blank-lines', '0', '-'));
});
test('the default file URI also supplies its path and the default layout', async t => {
  const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
  await c.initialize({ executable: fixture, timeoutMs: 500 }); c.open('args');
  assert.equal((await c.format()).result[0].newText, toolArguments('--prefer-config', '--stdin-filepath', '/unsaved.revo', '--indent-width', '2', '--line-width', '80', '--indent-style', 'space', '--max-blank-lines', '1', '-'));
});
test('percent-encoded file URIs are decoded to the filesystem path', async t => {
  const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
  await c.initialize({ executable: fixture, timeoutMs: 500 }); const uri = c.open('args', 'file:///my%20project/a%23b.rv');
  assert.equal(JSON.parse((await c.format(uri)).result[0].newText).slice(0, 3).join(' '), '--prefer-config --stdin-filepath /my project/a#b.rv');
});
for (const uri of ['untitled:Untitled-1', 'http://example.com/a.rv', 'vscode-vfs://github/owner/repo/a.rv', 'file://remote-host/project/a.rv', 'file:///project/a%2Fb.rv', 'file:///project/a%00b.rv', 'not a uri']) {
  test(`no stdin path is sent for ${uri}`, async t => {
    const c = new Client('/nonexistent/revofmt'); t.after(() => c.stop());
    await c.initialize({ executable: fixture, timeoutMs: 500 }); c.open('args', uri);
    const argv = JSON.parse((await c.format(uri)).result[0].newText);
    assert.equal(argv[0], '--prefer-config'); assert.equal(argv[1], '--indent-width'); assert.equal(argv.includes('--stdin-filepath'), false);
  });
}
test('a configuration error is shown as an error message before the empty result', async t => {
  const c = client(t); await c.initialize(); c.open('config-error'); const response = await c.format();
  assert.deepEqual(response.result, []);
  assert.deepEqual(c.notifications, [{ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 1, message: 'revofmt: bad revofmt.toml' } }]);
  assert.ok(c.messages.indexOf(c.notifications[0]) < c.messages.indexOf(response));
});
test('a diagnostic that already starts with revofmt: is shown unchanged, not prefixed twice', async t => {
  const c = client(t); await c.initialize(); c.open('prefixed-error'); const response = await c.format();
  assert.deepEqual(response.result, []);
  assert.deepEqual(c.notifications.map(n => n.params), [{ type: 1, message: 'revofmt: stdin: expected identifier at byte 10' }]);
});
test('a configuration error with inherited pipes still reports the stderr collected so far promptly', async t => {
  const c = client(t); await c.initialize(); c.open('config-error-inherited'); const start = Date.now();
  assert.deepEqual((await c.format()).result, []); assert.ok(Date.now() - start < 700);
  assert.deepEqual(c.notifications.map(n => n.params), [{ type: 1, message: 'revofmt: bad revofmt.toml' }]);
});
function earlyExit(t, body) {
  const file = path.join(temporary(t), 'early-exit.cjs');
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 }); return file;
}
test('a CLI that rejects its arguments before reading stdin still reports its diagnostic', async t => {
  // A source larger than the pipe buffer makes the write fail with EPIPE once the CLI is gone.
  const executable = earlyExit(t, "process.stderr.write('unknown option --prefer-config\\n'); process.exit(2);");
  const c = new Client(executable); t.after(() => c.stop()); await c.initialize(); c.open('let a = 1\n'.repeat(20000));
  assert.deepEqual((await c.format()).result, []);
  assert.deepEqual(c.notifications.map(n => n.params), [{ type: 1, message: 'revofmt: unknown option --prefer-config' }]);
});
test('a CLI that closes stdin early and exits successfully cannot return an edit', async t => {
  const executable = earlyExit(t, "process.stdout.write('let changed = 1\\n'); process.exit(0);");
  const c = new Client(executable); t.after(() => c.stop()); await c.initialize(); c.open('let a = 1\n'.repeat(20000));
  assert.deepEqual((await c.format()).result, []); assert.deepEqual(c.notifications, []);
});
for (const mode of ['nonzero', 'nonzero-inherited', 'blank-error', 'other-code-error', 'signal', 'invalid-error', 'overflow-error']) {
  test(`${mode} sends no notification`, async t => {
    const c = client(t); await c.initialize(); c.open(mode); assert.deepEqual((await c.format()).result, []);
    await delay(150); assert.deepEqual(c.notifications, []);
  });
}
test('a cancelled formatting request sends no diagnostic', async t => {
  const c = client(t); const marker = path.join(temporary(t), 'pid'); await c.initialize(); c.open(`wait ${marker}`);
  const response = c.format(); await started(marker); c.notify('$/cancelRequest', { id: response.id });
  assert.deepEqual((await response).result, []); await delay(150); assert.deepEqual(c.notifications, []);
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
