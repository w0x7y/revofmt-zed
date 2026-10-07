'use strict';
const MAX_SOURCE = 262144;
const MAX_DOCUMENTS = 64;
const MAX_STORED = 2097152;
function textSize(text) {
  if (typeof text !== 'string' || /[\r\0]/.test(text)) return null;
  // Reject UTF-16 code units that Buffer.from would silently replace.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return null;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null;
  }
  const bytes = Buffer.byteLength(text);
  return bytes <= MAX_SOURCE ? bytes : null;
}
function validUri(uri) { return typeof uri === 'string' && uri.length > 0 && Buffer.byteLength(uri) <= 8192; }
class Documents {
  constructor() { this.items = new Map(); this.bytes = 0; }
  remove(uri) { const old = this.items.get(uri); if (old) { this.bytes -= old.bytes; this.items.delete(uri); } }
  open(document) {
    if (!document || !validUri(document.uri)) return;
    this.remove(document.uri);
    this.store(document.uri, document.version, document.text, document.languageId === 'revo');
  }
  change(document, changes) {
    if (!document || !validUri(document.uri)) return;
    const old = this.items.get(document.uri);
    this.remove(document.uri);
    if (!old || !Number.isSafeInteger(document.version) || document.version <= old.version || !Array.isArray(changes) || changes.length === 0) return;
    for (const change of changes) {
      if (!change || typeof change !== 'object' || Object.hasOwn(change, 'range') || Object.hasOwn(change, 'rangeLength') || textSize(change.text) === null) return;
    }
    this.store(document.uri, document.version, changes.at(-1).text, true);
  }
  store(uri, version, text, languageValid) {
    const bytes = textSize(text);
    if (!languageValid || !Number.isSafeInteger(version) || bytes === null || this.items.size >= MAX_DOCUMENTS || this.bytes + bytes > MAX_STORED) return;
    this.items.set(uri, { text, version, bytes }); this.bytes += bytes;
  }
}
function edits(source, output) {
  if (source === output) return [];
  const lines = source.split('\n');
  return [{ range: { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines.at(-1).length } }, newText: output }];
}
module.exports = { Documents, textSize, validUri, edits };
