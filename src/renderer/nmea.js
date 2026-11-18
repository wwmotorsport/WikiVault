'use strict';
// NMEA 0183: the lines of text a GPS receiver sends. This reads them into positions.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultNmea = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** True when a line is a whole sentence whose checksum is right. */
  function valid(line) {
    const m = /^\$([^*]{5,100})\*([0-9A-Fa-f]{2})$/.exec(line);
    if (!m) return false;
    let sum = 0;
    for (let i = 0; i < m[1].length; i++) sum ^= m[1].charCodeAt(i);
    return sum === parseInt(m[2], 16);
  }
  // "3515.1234,N" is 35 degrees 15.1234 minutes north.
  function angle(value, hemi) {
    const m = /^(\d{2,3})(\d{2}(?:\.\d+)?)$/.exec(value || '');
    if (!m) return null;
    const deg = Number(m[1]) + Number(m[2]) / 60;
    return hemi === 'S' || hemi === 'W' ? -deg : deg;
  }
  const num = (s) => (s === '' || s == null || !Number.isFinite(Number(s)) ? null : Number(s));
  function timeOf(hms, dmy) {
    const t = /^(\d\d)(\d\d)(\d\d(?:\.\d+)?)$/.exec(hms || ''); const d = /^(\d\d)(\d\d)(\d\d)$/.exec(dmy || '');
    if (!t || !d) return null;
    const ms = Date.UTC(2000 + Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(t[1]), Number(t[2]), Math.floor(Number(t[3])));
    return Number.isFinite(ms) ? ms : null;
  }

  /** One sentence as { type, ...fields }, or null for a kind that is not used or a damaged line. */
  function parse(line) {
    line = String(line).trim();
    if (!valid(line)) return null;
    const f = line.slice(1, line.indexOf('*')).split(',');
    const type = f[0].slice(-3);
    if (type === 'GGA') return { type, lat: angle(f[2], f[3]), lon: angle(f[4], f[5]), quality: num(f[6]) || 0, sats: num(f[7]), hdop: num(f[8]), alt: num(f[9]) };
    if (type === 'RMC') return { type, ok: f[2] === 'A', lat: angle(f[3], f[4]), lon: angle(f[5], f[6]), speed: num(f[7]) == null ? null : num(f[7]) * 0.514444, course: num(f[8]), time: timeOf(f[1], f[9]) };
    if (type === 'GSA') return { type, fix: num(f[2]) || 1, hdop: num(f[16]) };
    return { type };
  }

  /**
   * Takes the receiver's text as it arrives, in pieces of any size, and keeps the latest position.
   * `onFix(fix)` is called for each position: { lat, lon, speed (m/s), course (degrees), sats, hdop,
   * accuracy (m, rough), time (ms, the receiver's clock), has (true when the receiver has a fix) }.
   */
  class Reader {
    constructor(onFix = () => {}) { this.onFix = onFix; this.buf = ''; this.sentences = 0; this.bad = 0; this.last = { has: false, sats: null, hdop: null, speed: null, course: null, time: null }; }
    push(chunk) {
      this.buf += chunk;
      if (this.buf.length > 8192) this.buf = this.buf.slice(-2048); // noise at the wrong speed: do not keep it
      let at;
      while ((at = this.buf.search(/[\r\n]/)) >= 0) {
        const line = this.buf.slice(0, at); this.buf = this.buf.slice(at + 1);
        if (!line) continue;
        const s = parse(line.slice(Math.max(0, line.lastIndexOf('$'))));
        if (!s) { if (line.length > 5) this.bad += 1; continue; }
        this.sentences += 1;
        this.take(s);
      }
    }
    take(s) {
      const l = this.last;
      if (s.type === 'GGA') { l.sats = s.sats; if (s.hdop != null) l.hdop = s.hdop; l.alt = s.alt; if (s.quality === 0) this.emit(null, null, false); else if (s.lat != null && s.lon != null) this.gga = { lat: s.lat, lon: s.lon }; }
      if (s.type === 'GSA' && s.hdop != null) l.hdop = s.hdop;
      if (s.type === 'RMC') {
        if (s.time != null) l.time = s.time;
        if (!s.ok || s.lat == null || s.lon == null) { this.emit(null, null, false); return; }
        l.speed = s.speed; if (s.course != null && (s.speed == null || s.speed > 0.8)) l.course = s.course; // standing still, the heading is noise
        this.emit(s.lat, s.lon, true);
      }
    }
    emit(lat, lon, has) {
      const l = this.last;
      l.has = has;
      if (has) { l.lat = lat; l.lon = lon; l.accuracy = Math.max(3, Math.round((l.hdop || 2) * 5)); }
      this.onFix({ ...l });
    }
  }
  return { valid, parse, Reader };
});
