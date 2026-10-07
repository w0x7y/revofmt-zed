'use strict';
const { spawn } = require('node:child_process');
const { textSize } = require('./documents.cjs');
const MAX_STDOUT = 262144;
const MAX_STDERR = 65536;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function format(source, options, done) {
  let child; let settled = false; let timer;
  const errors = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const output = []; let outputBytes = 0; let errorBytes = 0;
  function finish(result) {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (child) {
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    done(result);
  }
  try {
    child = spawn(options.executable, ['--indent-width', String(options.indentWidth), '--line-width', String(options.lineWidth), '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch { queueMicrotask(() => finish(null)); return () => finish(null); }
  timer = setTimeout(() => finish(null), options.timeoutMs);
  child.on('error', () => finish(null));
  child.stdin.on('error', () => finish(null));
  child.stdout.on('error', () => finish(null));
  child.stderr.on('error', () => finish(null));
  child.stdout.on('data', chunk => {
    if (settled) return;
    outputBytes += chunk.length;
    if (outputBytes > MAX_STDOUT) finish(null); else output.push(chunk);
  });
  child.stderr.on('data', chunk => {
    if (settled) return;
    errorBytes += chunk.length;
    if (errorBytes > MAX_STDERR) { finish(null); return; }
    try { errors.decode(chunk, { stream: true }); } catch { finish(null); }
  });
  child.on('exit', (code, signal) => { if (code !== 0 || signal) finish(null); });
  // Successful close waits for inherited pipes too; the deadline remains active.
  child.on('close', (code, signal) => {
    if (settled) return;
    if (code !== 0 || signal) { finish(null); return; }
    let text;
    try { errors.decode(); text = decoder.decode(Buffer.concat(output, outputBytes)); } catch { finish(null); return; }
    finish(textSize(text) === null ? null : text);
  });
  child.stdin.end(Buffer.from(source));
  return () => finish(null);
}
module.exports = { format };
