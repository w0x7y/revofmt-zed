#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { Transport } = require('./protocol.cjs');
const { Documents, validUri, edits } = require('./documents.cjs');
const { format, filePathFor } = require('./formatter.cjs');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--formatter' || !path.isAbsolute(args[1])) {
  process.stderr.write('Usage: node server/main.cjs --formatter /absolute/path/to/revofmt\n'); process.exitCode = 2;
} else {
  run(args[1]);
}
function run(executable) {
  const documents = new Documents(); const jobs = new Map(); const requests = new Map();
  let options = { executable, indentWidth: 2, lineWidth: 80, indentStyle: 'space', maxBlankLines: 1, timeoutMs: 5000 };
  let initialized = false; let shutdown = false; let stopping = false;
  const transport = new Transport(process.stdin, process.stdout, receive, () => stop(1));
  process.stdin.on('end', () => stop(0));
  process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
  function respond(id, result) { transport.send({ jsonrpc: '2.0', id, result }); }
  function error(id, code, message) { transport.send({ jsonrpc: '2.0', id, error: { code, message } }); }
  function abort(uri) { jobs.get(uri)?.cancel(); }
  function stop(code) {
    if (stopping) return; stopping = true;
    for (const job of [...jobs.values()]) job.cancel();
    process.exitCode = code; process.stdin.destroy(); transport.close(); process.stdout.end();
    // A client that stopped reading stdout must not keep the server alive indefinitely.
    const timer = setTimeout(() => process.exit(code), 1000); timer.unref();
  }
  function receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || Number.isSafeInteger(message.id))) {
      if (!message || typeof message.method !== 'string' || Object.hasOwn(message, 'id')) error(null, -32600, 'Invalid request');
      return;
    }
    const request = Object.hasOwn(message, 'id'); const { id, method, params } = message;
    if (request && requests.has(id)) { error(id, -32600, 'Request ID is already active'); return; }
    if (method === 'exit' && !request) { stop(shutdown ? 0 : 1); return; }
    if (method === 'initialize') {
      if (!request) return;
      if (initialized || shutdown) { error(id, -32600, 'Already initialized'); return; }
      const supplied = params?.initializationOptions ?? {};
      if (!params || typeof params !== 'object' || Array.isArray(params) || !supplied || typeof supplied !== 'object' || Array.isArray(supplied)) { error(id, -32602, 'Invalid initialization options'); return; }
      const candidate = { ...options };
      for (const [name, low, high] of [['indentWidth', 1, 8], ['lineWidth', 20, 240], ['maxBlankLines', 0, 8], ['timeoutMs', 1, 60000]]) {
        if (Object.hasOwn(supplied, name)) {
          if (!Number.isInteger(supplied[name]) || supplied[name] < low || supplied[name] > high) { error(id, -32602, `Invalid ${name}`); return; }
          candidate[name] = supplied[name];
        }
      }
      if (Object.hasOwn(supplied, 'indentStyle')) {
        if (supplied.indentStyle !== 'space' && supplied.indentStyle !== 'tab') { error(id, -32602, 'Invalid indentStyle'); return; }
        candidate.indentStyle = supplied.indentStyle;
      }
      if (Object.hasOwn(supplied, 'executable')) {
        if (typeof supplied.executable !== 'string' || !path.isAbsolute(supplied.executable) || supplied.executable.includes('\0')) { error(id, -32602, 'Invalid executable'); return; }
        candidate.executable = supplied.executable;
      }
      options = candidate; initialized = true;
      respond(id, { capabilities: { positionEncoding: 'utf-16', textDocumentSync: { openClose: true, change: 1 }, documentFormattingProvider: true }, serverInfo: { name: 'revofmt-lsp', version: '0.3.0' } }); return;
    }
    if (!initialized) { if (request) error(id, -32002, 'Server not initialized'); return; }
    if (shutdown) { if (request) error(id, -32600, 'Server is shut down'); return; }
    if (method === 'shutdown' && request) {
      shutdown = true; for (const job of [...jobs.values()]) job.cancel(); respond(id, null); return;
    }
    if (method === '$/cancelRequest' && !request) { requests.get(params?.id)?.cancel(); return; }
    if (method === 'initialized' && !request) return;
    if (method === 'textDocument/didOpen' && !request) { abort(params?.textDocument?.uri); documents.open(params?.textDocument); return; }
    if (method === 'textDocument/didChange' && !request) { abort(params?.textDocument?.uri); documents.change(params?.textDocument, params?.contentChanges); return; }
    if (method === 'textDocument/didClose' && !request) { abort(params?.textDocument?.uri); documents.remove(params?.textDocument?.uri); return; }
    if (method !== 'textDocument/formatting' || !request) { if (request) error(id, -32601, 'Method not found'); return; }
    const uri = params?.textDocument?.uri;
    if (!validUri(uri) || !params.options || typeof params.options !== 'object' || Array.isArray(params.options) || !Number.isInteger(params.options.tabSize) || params.options.tabSize <= 0 || typeof params.options.insertSpaces !== 'boolean') { error(id, -32602, 'Invalid formatting parameters'); return; }
    abort(uri);
    const document = documents.items.get(uri);
    if (!document || jobs.size >= 8) { respond(id, []); return; }
    const job = { cancel: null }; jobs.set(uri, job); requests.set(id, job);
    job.cancel = format(document.text, { ...options, filePath: filePathFor(uri) }, (output, diagnostic) => {
      jobs.delete(uri); requests.delete(id);
      const current = documents.items.get(uri) === document && !shutdown;
      // Zed has no other way to show why the CLI refused, for example a malformed revofmt.toml.
      if (diagnostic !== undefined && current) transport.send({ jsonrpc: '2.0', method: 'window/showMessage', params: { type: 1, message: 'revofmt: ' + diagnostic } });
      respond(id, output !== null && current ? edits(document.text, output) : []);
    });
  }
}
