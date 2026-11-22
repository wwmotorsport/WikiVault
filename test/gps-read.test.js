'use strict';
// Reading a GPS receiver's port: mistakes on the line (a character cut in half as the port is opened, a full
// buffer) end the stream that was being read but not the port, and are read past. A receiver that never pauses
// makes such a mistake on most openings; taking it for silence found the receiver only by luck.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/renderer/gps-read');
const N = require('../src/renderer/nmea');

const sum = (s) => { let c = 0; for (const ch of s) c ^= ch.charCodeAt(0); return `$${s}*${c.toString(16).toUpperCase().padStart(2, '0')}\r\n`; };
const GGA = sum('GNGGA,123519,4042.7680,N,07400.3600,W,1,12,0.8,10.0,M,-34.0,M,,');
const RMC = sum('GNRMC,123519,A,4042.7680,N,07400.3600,W,0.0,0.0,221126,,,A');
const bytes = (s) => new TextEncoder().encode(s);
const lineError = (name) => { const e = new Error(`${name}: the line made a mistake`); e.name = name; return e; };

/**
 * A port as the browser gives it. `streams` says what each stream in turn does: chunks of bytes, an Error (the
 * stream ends with it and the next is offered), a number (a pause in ms), 'end' (closed). When they run out the
 * device is gone and there is no stream to be had.
 */
function fakePort(streams) {
  const port = { made: 0, closed: false, close: async () => { port.closed = true; } };
  let current = null;
  Object.defineProperty(port, 'readable', {
    get() {
      if (current) return current;
      const items = streams.shift();
      if (!items) return null;
      port.made += 1;
      current = new ReadableStream({
        async pull(c) {
          for (;;) {
            if (!items.length) return new Promise(() => {}); // nothing more comes, and nothing ends
            const it = items.shift();
            if (typeof it === 'number') { await new Promise((r) => setTimeout(r, it)); continue; }
            if (it instanceof Error) { current = null; c.error(it); return undefined; }
            if (it === 'end') { current = null; c.close(); return undefined; }
            c.enqueue(it); return undefined;
          }
        },
      });
      return current;
    },
  });
  return port;
}

test('the receiver is found although the port was opened in the middle of a character', async () => {
  // The first stream ends at once with a framing error, the second with a full buffer after some noise, and the third speaks.
  const port = fakePort([[lineError('FramingError')], [bytes('ÿþ7,N,0'), lineError('BufferOverrunError')], [bytes(GGA.slice(0, 20)), bytes(GGA.slice(20) + RMC), bytes(GGA)]]);
  const probe = new N.Reader();
  const s = await R.sample(port, probe, { ms: 2000 });
  assert.ok(s.reader, 'a reader is handed on');
  assert.deepEqual([s.errors, probe.sentences, port.made], [2, 2, 3]);
  // The reader handed on is the one in use: the next sentence comes through it.
  const next = await s.reader.read();
  assert.equal(new TextDecoder().decode(next.value), GGA);
});

test('a port that is silent, one that only makes mistakes, and one that is gone are told apart, in the time given', async () => {
  const started = Date.now();
  const silent = await R.sample(fakePort([[]]), new N.Reader(), { ms: 250 });
  assert.deepEqual([silent.reader, silent.bytes, silent.errors], [null, 0, 0]);
  assert.ok(Date.now() - started >= 240 && Date.now() - started < 1500, 'a silent port is listened to for the whole time, and no longer');
  // The wrong speed: every stream ends in a framing error. That is "something is there", not silence.
  const noisy = await R.sample(fakePort(Array.from({ length: 1000 }, () => [bytes('\u0000\u0080'), lineError('FramingError')])), new N.Reader(), { ms: 300 });
  assert.equal(noisy.reader, null);
  assert.ok(noisy.errors >= 5 && noisy.bytes >= 10, `mistakes are counted (${noisy.errors}) and so are bytes (${noisy.bytes})`);
  // Unplugged: one mistake and then no stream at all. It ends at once instead of waiting.
  const t = Date.now();
  const gone = await R.sample(fakePort([[lineError('NetworkError')]]), new N.Reader(), { ms: 5000 });
  assert.deepEqual([gone.reader, gone.errors], [null, 1]);
  assert.ok(Date.now() - t < 1000);
  // Closed by the other side.
  assert.equal((await R.sample(fakePort([[bytes('abc'), 'end']]), new N.Reader(), { ms: 5000 })).bytes, 3);
});

test('while connected, mistakes on the line are read past and the positions keep coming', async () => {
  const port = fakePort([[bytes(GGA), bytes(RMC), lineError('BufferOverrunError')], [lineError('FramingError')], [bytes(GGA + RMC), 30, lineError('BreakError')], [bytes(RMC), 'end']]);
  const fixes = []; const readers = [];
  const nmea = new N.Reader((f) => fixes.push(f));
  const first = port.readable.getReader();
  const end = await R.follow(port, first, { onText: (t) => nmea.push(t), onReader: (r) => readers.push(r) });
  assert.deepEqual([end.why, end.errors, nmea.sentences, readers.length], ['closed', 3, 5, 3]);
  assert.equal(fixes.filter((f) => f.has).length, 3);

  // Unplugged: a mistake, and then no stream.
  const gone = fakePort([[bytes(GGA), lineError('NetworkError')]]);
  assert.deepEqual(await R.follow(gone, gone.readable.getReader(), { onText: () => {} }), { why: 'gone', errors: 1 });
  // Asked to stop while a mistake was being read past.
  const stop = fakePort([[lineError('FramingError')], [bytes(GGA)]]);
  assert.equal((await R.follow(stop, stop.readable.getReader(), { onText: () => {}, stopping: () => true })).why, 'stopped');
  // Nothing but mistakes: given up on, not spun on for ever.
  const bad = fakePort(Array.from({ length: 500 }, () => [lineError('FramingError')]));
  const out = await R.follow(bad, bad.readable.getReader(), { onText: () => {}, limit: 20 });
  assert.deepEqual([out.why, out.errors], ['errors', 21]);
  // Cancelled by the caller (Disconnect): it ends as closed.
  const live = fakePort([[bytes(GGA)]]);
  const r = live.readable.getReader();
  const going = R.follow(live, r, { onText: () => {} });
  await new Promise((res) => setTimeout(res, 30));
  await r.cancel();
  assert.equal((await going).why, 'closed');
});
