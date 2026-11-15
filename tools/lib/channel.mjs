import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { EventEmitter } from 'node:events';

export async function channel({ origin, cookie, fileId }) {
  const sessionId = randomUUID(), messages = [], events = new EventEmitter();
  const url = new URL(`/ws/notifications?session-id=${sessionId}`, origin);
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { headers: { cookie, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') } });
  let socket, buffered = Buffer.alloc(0);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { request.destroy(); reject(new Error('WebSocket handshake timed out.')); }, 15_000);
    request.once('error', error => { clearTimeout(timer); reject(error); });
    request.once('response', response => { clearTimeout(timer); response.resume(); reject(new Error(`WebSocket HTTP ${response.statusCode}`)); });
    request.once('upgrade', (response, stream, head) => {
      clearTimeout(timer); assert.equal(response.statusCode, 101); socket = stream;
      socket.on('error', error => events.emit('failure', error));
      socket.on('data', receive); if (head.length) receive(head); resolve();
    });
  });
  function frame(opcode, content) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), mask = randomBytes(4);
    const header = Buffer.alloc(bytes.length < 126 ? 2 : 4); header[0] = 0x80 | opcode;
    if (bytes.length < 126) header[1] = 0x80 | bytes.length;
    else { header[1] = 0x80 | 126; header.writeUInt16BE(bytes.length, 2); }
    const masked = Buffer.from(bytes); for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    socket.write(Buffer.concat([header, mask, masked]));
  }
  function receive(chunk) {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 15, masked = !!(buffered[1] & 128);
      let length = buffered[1] & 127, offset = 2;
      if (length === 126) { if (buffered.length < 4) return; length = buffered.readUInt16BE(2); offset = 4; }
      if (length === 127) { if (buffered.length < 10) return; length = Number(buffered.readBigUInt64BE(2)); offset = 10; }
      if (length > 10_000_000) { socket.destroy(); events.emit('failure', new Error('WebSocket message exceeded limit.')); return; }
      const mask = masked ? buffered.subarray(offset, offset + 4) : null; if (masked) offset += 4;
      if (buffered.length < offset + length) return;
      const payload = Buffer.from(buffered.subarray(offset, offset + length)); buffered = buffered.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      if (opcode === 9) frame(10, payload);
      if (opcode === 1) { const text = payload.toString(); messages.push(text); events.emit('message', text); }
    }
  }
  request.end(); await ready;
  return {
    sessionId, close: () => socket.destroy(), count: () => messages.length,
    subscribe: () => frame(1, JSON.stringify({ '~:type': '~:subscribe-file', '~:file-id': `~u${fileId}` })),
    wait: (predicate, label) => new Promise((resolve, reject) => {
      const existing = messages.find(predicate); if (existing) return resolve(existing);
      const timer = setTimeout(() => { cleanup(); reject(new Error(`${label} timed out`)); }, 15_000);
      const check = value => { if (predicate(value)) { cleanup(); resolve(value); } };
      const fail = error => { cleanup(); reject(error); };
      function cleanup() { clearTimeout(timer); events.off('message', check); events.off('failure', fail); }
      events.on('message', check); events.on('failure', fail);
    }),
  };
}
