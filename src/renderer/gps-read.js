'use strict';
// GPS: reading a serial port that is already open.
//
// A serial line makes small mistakes: a character cut in half because the port was opened in the middle of it, a
// buffer that filled while the computer was busy. The browser reports each as an error on the stream it was
// reading, and then offers a NEW stream on the same port: the port is fine. Only when the device is gone is there
// no stream to be had. A receiver that never pauses (many satellites, 4800 baud) makes the first kind of mistake
// on most openings, so a reader that gives up at the first error finds it only by luck. These readers take the
// next stream and carry on.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultGpsRead = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const free = (reader) => { try { reader.releaseLock(); } catch { /* already let go */ } };

  /**
   * Listen to an open port for up to `ms`, feeding `probe` (a reader of GPS sentences), until it has heard `need`
   * of them. Returns { reader, bytes, errors }: `reader` is the stream reader, still held, when enough was heard
   * (the caller carries on reading with it), and null otherwise (nothing is held; the caller closes the port).
   */
  async function sample(port, probe, { ms = 2600, need = 2, decoder = new TextDecoder('latin1') } = {}) {
    const until = Date.now() + ms;
    let bytes = 0; let errors = 0;
    while (Date.now() < until && port.readable) {
      const reader = port.readable.getReader();
      try {
        for (;;) {
          const left = until - Date.now();
          const r = left > 0 ? await Promise.race([reader.read(), wait(left).then(() => null)]) : null;
          if (!r) { try { await reader.cancel(); } catch { /* already closed */ } free(reader); return { reader: null, bytes, errors }; } // time is up
          if (r.done) { free(reader); return { reader: null, bytes, errors }; }
          bytes += r.value.length;
          probe.push(decoder.decode(r.value, { stream: true }));
          if (probe.sentences >= need) return { reader, bytes, errors };
        }
      } catch {
        // A mistake on the line. This stream is finished, the port is not: the next one is taken.
        errors += 1; free(reader);
        if (errors > 400) break;
        await wait(8);
      }
    }
    return { reader: null, bytes, errors };
  }

  /**
   * Keep reading an open port, handing its text to `onText`, until `stopping()` says to stop, the stream is closed,
   * or the device is gone. Mistakes on the line are counted and read past; a port that makes nothing but mistakes
   * (`limit` of them in ten seconds) is given up on. `onReader(reader)` is told of each new stream reader, so that
   * the caller can cancel the one in use. Returns { why: 'closed' | 'gone' | 'errors' | 'stopped', errors }.
   */
  async function follow(port, reader, { onText, stopping = () => false, onReader = () => {}, decoder = new TextDecoder('latin1'), limit = 120 } = {}) {
    let errors = 0; let recent = 0; let since = Date.now();
    for (;;) {
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) { free(reader); return { why: 'closed', errors }; }
          onText(decoder.decode(r.value, { stream: true }));
        }
      } catch {
        free(reader);
        errors += 1;
        if (Date.now() - since > 10000) { recent = 0; since = Date.now(); }
        recent += 1;
        await wait(10);
        if (stopping()) return { why: 'stopped', errors };
        if (!port.readable) return { why: 'gone', errors };
        if (recent > limit) return { why: 'errors', errors };
        reader = port.readable.getReader();
        onReader(reader);
      }
    }
  }

  return { sample, follow };
});
