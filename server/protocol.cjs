'use strict';
const MAX_PAYLOAD = 2097152;
const MAX_HEADER = 8192;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Both the unread frame and the queued responses have fixed byte budgets.
class Transport {
  constructor(input, output, receive, fail) {
    this.input = input; this.output = output; this.receive = receive; this.fail = fail;
    this.buffer = Buffer.alloc(0); this.length = null; this.queue = []; this.queued = 0; this.blocked = false; this.closed = false;
    input.on('data', chunk => this.read(chunk));
    input.on('error', () => fail());
    output.on('error', () => fail());
    output.on('drain', () => { this.blocked = false; this.flush(); });
  }
  read(chunk) {
    if (this.closed) return;
    // Node pipe chunks are bounded; consume each one before accepting another.
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.length === null) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (this.buffer.length > MAX_HEADER) this.fail(); return; }
        if (end + 4 > MAX_HEADER) { this.fail(); return; }
        const bytes = this.buffer.subarray(0, end);
        if (bytes.some(byte => byte < 32 && byte !== 13 && byte !== 10 || byte > 126)) { this.fail(); return; }
        const headers = bytes.toString('ascii').split('\r\n');
        const lengths = [];
        for (const header of headers) {
          const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(header);
          if (!match) { this.fail(); return; }
          if (match[1].toLowerCase() === 'content-length') lengths.push(match[2]);
        }
        if (lengths.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(lengths[0])) { this.fail(); return; }
        this.length = Number(lengths[0]);
        if (!Number.isSafeInteger(this.length) || this.length > MAX_PAYLOAD) { this.fail(); return; }
        this.buffer = this.buffer.subarray(end + 4);
      }
      if (this.buffer.length < this.length) return;
      const payload = this.buffer.subarray(0, this.length);
      this.buffer = this.buffer.subarray(this.length); this.length = null;
      let message;
      try { message = JSON.parse(decoder.decode(payload)); }
      catch { this.send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON or UTF-8' } }); continue; }
      this.receive(message);
      if (this.closed) return;
    }
  }
  send(message) {
    if (this.closed) return;
    const body = Buffer.from(JSON.stringify(message));
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
    if (body.length > MAX_PAYLOAD || this.queued + this.output.writableLength + frame.length > MAX_PAYLOAD) { this.fail(); return; }
    this.queue.push(frame); this.queued += frame.length; this.flush();
  }
  flush() {
    while (!this.blocked && this.queue.length && !this.closed) {
      const frame = this.queue.shift(); this.queued -= frame.length;
      this.blocked = !this.output.write(frame);
    }
  }
  close() {
    this.closed = true; this.buffer = Buffer.alloc(0); this.queue.length = 0; this.queued = 0;
  }
}
module.exports = { Transport };
