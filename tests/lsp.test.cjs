'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
test('real CLI syntax failure produces no edits', async t => {
  const c = client(t); await c.initialize(); c.open('fn broken('); assert.deepEqual((await c.format()).result, []);
});
test('whole-document edit ends at UTF-16 code units for astral text', async t => {
  const source = 'let text=\"😀\"'; const c = client(t); await c.initialize(); c.open(source);
  const result = (await c.format()).result; assert.equal(result[0].range.end.character, source.length); assert.equal(result[0].range.end.line, 0); assert.equal(apply(source, result), 'let text = \"😀\"\n');
});
