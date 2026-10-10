'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { textSize } = require('./documents.cjs');
const MAX_STDOUT = 262144;
const MAX_STDERR = 65536;
// revofmt exits with this status for usage, I/O, syntax and configuration errors.
const ERROR_STATUS = 2;
// Inherited pipes can keep stderr open after the CLI exits, so its tail is not awaited longer.
const STDERR_GRACE_MS = 100;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
// Order matters to the CLI contract: discovery first, layout flags, then stdin.
function argumentsFor(options) {
  const args = ['--prefer-config'];
  if (options.filePath !== undefined) args.push('--stdin-filepath', options.filePath);
  args.push('--indent-width', String(options.indentWidth), '--line-width', String(options.lineWidth), '--indent-style', options.indentStyle, '--max-blank-lines', String(options.maxBlankLines), '-');
  return args;
}
// Only file: URIs name a project location; the CLI never sees any other scheme.
function filePathFor(uri) {
  try {
    const file = fileURLToPath(uri);
    return path.isAbsolute(file) && !file.includes('\0') ? file : undefined;
  } catch { return undefined; }
}
// done(text) reports success. done(null, diagnostic) reports failure; diagnostic is
// the CLI's trimmed stderr after exit status 2, and undefined for every other failure.
function format(source, options, done) {
  let child; let settled = false; let timer; let graceTimer;
  let stderrEnded = false; let awaitingStderr = false; let stdinBroken = false; let stderrText = '';
  const errors = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const output = []; let outputBytes = 0; let errorBytes = 0;
  function finish(result, diagnostic) {
    if (settled) return;
    settled = true; clearTimeout(timer); clearTimeout(graceTimer);
    if (child) {
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    done(result, diagnostic);
  }
  function diagnose() {
    let text = '';
    try { text = (stderrText + errors.decode()).trim(); } catch { /* an unterminated sequence yields no diagnostic */ }
    finish(null, text === '' ? undefined : text);
  }
  function failed(code, signal) {
    if (code !== ERROR_STATUS || signal) { finish(null); return; }
    if (stderrEnded) { diagnose(); return; }
    awaitingStderr = true; graceTimer = setTimeout(diagnose, STDERR_GRACE_MS);
  }
  try {
    child = spawn(options.executable, argumentsFor(options), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch { queueMicrotask(() => finish(null)); return () => finish(null); }
  timer = setTimeout(() => finish(null), options.timeoutMs);
  child.on('error', () => finish(null));
  // A CLI that rejects its arguments or configuration may exit before reading stdin.
  // Its exit status and stderr decide the outcome, not the broken pipe.
  child.stdin.on('error', error => { if (error.code === 'EPIPE') stdinBroken = true; else finish(null); });
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
    try { stderrText += errors.decode(chunk, { stream: true }); } catch { finish(null); }
  });
  child.stderr.on('end', () => { stderrEnded = true; if (awaitingStderr) diagnose(); });
  child.on('exit', (code, signal) => { if (code !== 0 || signal) failed(code, signal); });
  // Successful close waits for inherited pipes too; the deadline remains active.
  child.on('close', (code, signal) => {
    if (settled) return;
    if (code !== 0 || signal) { if (code === ERROR_STATUS && !signal) diagnose(); else finish(null); return; }
    if (stdinBroken) { finish(null); return; }
    let text;
    try { errors.decode(); text = decoder.decode(Buffer.concat(output, outputBytes)); } catch { finish(null); return; }
    finish(textSize(text) === null ? null : text);
  });
  child.stdin.end(Buffer.from(source));
  return () => finish(null);
}
module.exports = { format, argumentsFor, filePathFor };
