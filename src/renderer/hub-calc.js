'use strict';
// The sums behind the Options and Setup page: how a drive's room is shared out, and how fast a download is going.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultHubCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * How one drive's room is shared out, for the bar on the Options and Setup page.
   * `disk` is { total, free } in bytes; `app` is what Wikivault keeps there now; `need` is what is still to come.
   * Returns { total, other, app, add, short, freeAfter, parts }: `add` is the part of `need` that fits, `short`
   * the part that does not. `parts` are the pieces of the bar, left to right, each with its share of the drive.
   */
  function driveParts(disk, app = 0, need = 0) {
    if (!disk || !(disk.total > 0)) return null;
    const total = disk.total;
    const free = Math.max(0, Math.min(total, disk.free || 0));
    const mine = Math.max(0, Math.min(total - free, app || 0));
    const other = Math.max(0, total - free - mine);
    const want = Math.max(0, need || 0);
    const add = Math.min(want, free);
    const short = want - add;
    const freeAfter = free - add;
    const parts = [
      { key: 'other', bytes: other },
      { key: 'app', bytes: mine },
      { key: short ? 'over' : 'add', bytes: add },
      { key: 'free', bytes: freeAfter },
    ].filter((p) => p.bytes > 0).map((p) => ({ ...p, share: p.bytes / total }));
    return { total, free, other, app: mine, add, short, freeAfter, parts };
  }

  /** A running speed, from byte counts seen over the last few seconds. */
  class Rate {
    constructor(windowMs = 12000) { this.windowMs = windowMs; this.seen = []; }
    /** Note that `bytes` have arrived by time `t` (milliseconds). A count that goes down starts afresh. */
    push(bytes, t = Date.now()) {
      if (!Number.isFinite(bytes)) return this;
      const last = this.seen[this.seen.length - 1];
      if (last && bytes < last.b) this.seen = [];
      if (last && t - last.t < 250 && bytes >= last.b) { last.b = bytes; return this; } // too soon to count as a new reading
      this.seen.push({ t, b: bytes });
      while (this.seen.length > 2 && t - this.seen[0].t > this.windowMs) this.seen.shift();
      return this;
    }
    /** Bytes a second, or null until two readings a second apart are in. Nothing new for a while reads as 0. */
    get(now = Date.now()) {
      if (this.seen.length < 2) return null;
      const a = this.seen[0]; const z = this.seen[this.seen.length - 1];
      const span = Math.max(z.t, Math.min(now, z.t + this.windowMs)) - a.t;
      if (span < 1000) return null;
      return Math.max(0, (z.b - a.b) / (span / 1000));
    }
  }

  /** How long what is left will take at this speed, in words, or '' when it cannot be told. */
  function timeLeft(remaining, rate) {
    if (!(remaining > 0) || !(rate > 0)) return '';
    const s = remaining / rate;
    if (s < 50) return 'under a minute left';
    if (s < 3300) { const m = Math.max(1, Math.round(s / 60)); return `about ${m} minute${m === 1 ? '' : 's'} left`; }
    if (s < 48 * 3600) { const h = Math.round(s / 360) / 10; return `about ${h >= 10 ? Math.round(h) : h} hour${h === 1 ? '' : 's'} left`; }
    return `about ${Math.round(s / 86400)} days left`;
  }

  return { driveParts, Rate, timeLeft };
});
