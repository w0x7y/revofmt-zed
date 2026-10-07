'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fixture = path.resolve(__dirname, 'lsp/fixture.cjs');

test('fixture treats ordinary source and relative marker text as source without disk writes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-fixture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const source of ['new text', 'args relative']) {
    const result = spawnSync(process.execPath, [fixture], { cwd: directory, input: source, encoding: 'utf8', timeout: 1000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(directory), []);
  }
});
