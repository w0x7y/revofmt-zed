'use strict';
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
class Client {
  constructor(formatter) {
    this.child = spawn(process.execPath, [path.resolve(__dirname, '../../server/main.cjs'), '--formatter', formatter], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => {});
    this.nextId = 1; this.pending = new Map(); this.messages = []; this.buffer = Buffer.alloc(0); this.stderr = '';
    this.exited = once(this.child, 'exit');
    this.child.stderr.on('data', chunk => { this.stderr += chunk; });
    this.child.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) break;
        const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, end).toString())[1]);
        if (this.buffer.length < end + 4 + length) break;
        const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length));
        this.buffer = this.buffer.subarray(end + 4 + length); this.messages.push(message);
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message); }
      }
    });
    this.child.on('exit', () => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`Server exited: ${this.stderr}`)); } this.pending.clear(); });
  }
  send(message) { this.child.stdin.write(frame(message)); }
  waitFor(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Response timed out: ${id}`)); }, 4000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  request(method, params) {
    const id = this.nextId++;
    const promise = this.waitFor(id);
    promise.id = id; this.send({ jsonrpc: '2.0', id, method, params }); return promise;
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  async initialize(options = {}) { return this.request('initialize', { capabilities: {}, initializationOptions: options }); }
  open(text, uri = 'file:///unsaved.revo', version = 1) { this.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'revo', version, text } }); return uri; }
  format(uri = 'file:///unsaved.revo') { return this.request('textDocument/formatting', { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } }); }
  async stop() { if (this.child.exitCode !== null || this.child.signalCode !== null) return; this.child.stdin.end(); await Promise.race([this.exited, new Promise(resolve => { const timer = setTimeout(() => { this.child.kill('SIGKILL'); resolve(); }, 1000); timer.unref(); })]); }
}
module.exports = { Client, frame };
