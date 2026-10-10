'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const url = require('node:url');
const { spawnSync } = require('node:child_process');
const { Client } = require('./lsp/client.cjs');
const formatter = process.env.REVOFMT_BIN;
assert.ok(formatter, 'Set REVOFMT_BIN to the actual revofmt executable');
function client(t, executable = formatter) { const c = new Client(executable); t.after(() => c.stop()); return c; }
function apply(text, edits) {
  if (!edits.length) return text;
  assert.equal(edits.length, 1);
  const { range, newText } = edits[0];
  const offset = position => text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  return text.slice(0, offset(range.start)) + newText + text.slice(offset(range.end));
}
test('initialization advertises UTF-16 full sync and formatting only', async t => {
  const c = client(t); const response = await c.initialize();
  assert.deepEqual(response.result.capabilities, { positionEncoding: 'utf-16', textDocumentSync: { openClose: true, change: 1 }, documentFormattingProvider: true });
});
test('formats unsaved text through the real CLI and reaches its fixed point', async t => {
  const c = client(t); await c.initialize(); const uri = c.open('let x=1');
  const response = await c.format(uri); assert.ok(response.result, JSON.stringify(response));
  const output = apply('let x=1', response.result); assert.equal(output, 'let x = 1\n');
  c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: output }] });
  assert.deepEqual((await c.format(uri)).result, []);
});
test('uses the unsaved buffer and leaves the named file untouched', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revofmt-lsp-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'source.revo'); fs.writeFileSync(file, 'let on_disk=7');
  const c = client(t); await c.initialize(); const source = 'let unsaved=8'; const uri = c.open(source, new URL(`file://${file}`).href);
  assert.equal(apply(source, (await c.format(uri)).result), 'let unsaved = 8\n'); assert.equal(fs.readFileSync(file, 'utf8'), 'let on_disk=7');
});
test('real CLI preserves opaque literal/comment bytes with UTF-16 edit coordinates', async t => {
  const source = 'let text="😀  value" # comment  bytes\nlet x=1\n';
  const expected = spawnSync(formatter, [], { input: source, encoding: 'utf8' }); assert.equal(expected.status, 0, expected.stderr);
  const c = client(t); await c.initialize(); c.open(source);
  assert.equal(apply(source, (await c.format()).result), expected.stdout);
  assert.ok(expected.stdout.includes('"😀  value"')); assert.ok(expected.stdout.includes('# comment  bytes'));
});
test('real CLI syntax failure produces no edits and shows the CLI diagnostic', async t => {
  const c = client(t); await c.initialize(); c.open('fn broken('); assert.deepEqual((await c.format()).result, []);
  assert.equal(c.notifications.length, 1); const { method, params } = c.notifications[0];
  assert.equal(method, 'window/showMessage'); assert.equal(params.type, 1); assert.match(params.message, /^revofmt: .*stdin/);
  assert.equal(params.message, params.message.trim());
});
function project(t, config) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revofmt-lsp-config-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (config !== undefined) fs.writeFileSync(path.join(directory, 'revofmt.toml'), config);
  return directory;
}
const fileUri = file => url.pathToFileURL(file).href;
test('a project revofmt.toml found from the file URI overrides the server settings, without writing the file', async t => {
  const directory = project(t, 'indent_style = "tab"\n'); const file = path.join(directory, 'a.rv'); const source = 'fn f() do\nlet x=1\nend';
  const c = client(t); await c.initialize({ indentStyle: 'space', indentWidth: 4, lineWidth: 40, maxBlankLines: 0 }); const uri = c.open(source, fileUri(file));
  assert.equal(apply(source, (await c.format(uri)).result), 'fn f() do\n\tlet x = 1\nend\n');
  assert.equal(fs.existsSync(file), false); assert.deepEqual(c.notifications, []);
});
test('configuration is found from an ancestor directory and omitted keys use built-in defaults', async t => {
  const directory = project(t, 'max_blank_lines = 0\n'); fs.mkdirSync(path.join(directory, 'nested/deeper'), { recursive: true });
  const source = 'fn f() do\nlet x=1\n\n\nlet y=2\nend'; const uri = fileUri(path.join(directory, 'nested/deeper/a.rv'));
  const c = client(t); await c.initialize({ indentStyle: 'tab', maxBlankLines: 2 }); c.open(source, uri);
  assert.equal(apply(source, (await c.format(uri)).result), 'fn f() do\n  let x = 1\n  let y = 2\nend\n');
});
test('a file URI without a project configuration uses the server settings', async t => {
  const directory = project(t); const source = 'fn f() do\nlet x=1\n\n\nlet y=2\nend'; const uri = fileUri(path.join(directory, 'a.rv'));
  const c = client(t); await c.initialize({ indentStyle: 'tab', maxBlankLines: 0 }); c.open(source, uri);
  assert.equal(apply(source, (await c.format(uri)).result), 'fn f() do\n\tlet x = 1\n\tlet y = 2\nend\n');
});
test('a buffer without a file path never discovers a configuration from the working directory', async t => {
  const directory = project(t, 'indent_style = "tab"\n'); const source = 'fn f() do\nlet x=1\nend';
  const c = new Client(formatter, { cwd: directory }); t.after(() => c.stop()); await c.initialize(); const uri = c.open(source, 'untitled:Untitled-1');
  assert.equal(apply(source, (await c.format(uri)).result), 'fn f() do\n  let x = 1\nend\n');
});
test('a malformed revofmt.toml produces no edits and an error message naming it', async t => {
  const directory = project(t, 'indent_style = "tabs"\n'); const source = 'fn f() do\nlet x=1\nend'; const uri = fileUri(path.join(directory, 'a.rv'));
  const c = client(t); await c.initialize(); c.open(source, uri); assert.deepEqual((await c.format(uri)).result, []);
  assert.equal(c.notifications.length, 1); const { method, params } = c.notifications[0];
  assert.equal(method, 'window/showMessage'); assert.equal(params.type, 1); assert.match(params.message, /^revofmt: /); assert.ok(params.message.includes('revofmt.toml'), params.message);
});
test('real CLI preserves supported interpolation modes', async t => {
  // Revo Parser.zig covers :v, :?, :p and the lone :d atom.
  const source = 'let t=1\nprint("#{t:v} #{t:?} #{t:p} #{:d}")';
  const expected = 'let t = 1\nprint("#{t:v} #{t:?} #{t:p} #{:d}")\n';
  const c = client(t); await c.initialize(); const uri = c.open(source);
  assert.equal(apply(source, (await c.format(uri)).result), expected);
  c.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: expected }] });
  assert.deepEqual((await c.format(uri)).result, []);
});
test('current compiler syntax rejection returns no LSP edits', {
  skip: process.env.REVOFMT_CURRENT_SYNTAX !== '1',
}, async t => {
  // Revo 71115de requires range-start/step adjacency; e94e6d8 rejects :d modes.
  const c = client(t); await c.initialize();
  for (const [index, source] of [
    'for i in 0 ..5 do\nprint(i)\nend',
    'for i in 0..2 ..10 do\nprint(i)\nend',
    'let t=1\nprint("#{t:d}")',
  ].entries()) {
    const uri = c.open(source, `file:///current-syntax-${index}.rv`);
    const edits = (await c.format(uri)).result;
    assert.deepEqual(edits, [], source);
    assert.equal(apply(source, edits), source);
  }
});
test('whole-document edit ends at UTF-16 code units for astral text', async t => {
  const source = 'let text=\"😀\"'; const c = client(t); await c.initialize(); c.open(source);
  const result = (await c.format()).result; assert.equal(result[0].range.end.character, source.length); assert.equal(result[0].range.end.line, 0); assert.equal(apply(source, result), 'let text = \"😀\"\n');
});
