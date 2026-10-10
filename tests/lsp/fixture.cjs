#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { source += chunk; });
process.stdin.on('end', () => {
  const [mode, marker] = source.split('\n', 1)[0].split(' ');
  if ((mode === 'wait' || mode === 'args') && marker && path.isAbsolute(marker)) {
    fs.writeFileSync(marker, String(process.pid));
  }
  switch (mode) {
    case 'wait': setInterval(() => {}, 1000); break;
    case 'delayed': setTimeout(() => process.stdout.write('let completed = 1\n'), 250); break;
    case 'overflow-out': process.stdout.write('x'.repeat(262145)); break;
    case 'overflow-error': process.stderr.write('x'.repeat(65537)); process.stdout.write('let changed = 1\n'); break;
    case 'invalid-error': process.stderr.write(Buffer.from([0xc3, 0x28])); process.stdout.write('let changed = 1\n'); break;
    case 'exact-out': process.stdout.write('x'.repeat(262144)); break;
    case 'exact-error': process.stderr.write('x'.repeat(65536)); process.stdout.write('let changed = 1\n'); break;
    case 'invalid-utf8': process.stdout.write(Buffer.from([0xc3, 0x28])); break;
    case 'carriage-return': process.stdout.write('let changed = 1\r\n'); break;
    case 'nul': process.stdout.write('let changed = 1\0\n'); break;
    case 'bom': process.stdout.write('\ufefflet changed = 1\n'); break;
    case 'nonzero': process.stdout.write('let changed = 1\n'); process.exitCode = 2; break;
    case 'config-error': process.stderr.write('bad revofmt.toml\n'); process.exitCode = 2; break;
    case 'blank-error': process.stderr.write(' \n\t\n'); process.exitCode = 2; break;
    case 'other-code-error': process.stderr.write('bad revofmt.toml\n'); process.exitCode = 1; break;
    case 'signal': process.kill(process.pid, 'SIGTERM'); break;
    case 'nonzero-inherited':
    case 'config-error-inherited':
    case 'inherited': {
      const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { stdio: ['ignore', process.stdout, process.stderr] });
      descendant.unref(); process.stdout.write('let changed = 1\n');
      if (mode === 'config-error-inherited') process.stderr.write('bad revofmt.toml\n');
      if (mode === 'nonzero-inherited' || mode === 'config-error-inherited') process.exitCode = 2;
      break;
    }
    case 'args': process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\n'); break;
    default: process.stdout.write(source); break;
  }
});
