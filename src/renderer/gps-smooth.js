'use strict';
// GPS: moving the mark on the map smoothly between one reading and the next.
//
// A receiver reports once a second, and a mark drawn only then hops along the road. Here each new reading becomes
// a place to glide to: the mark sets off from wherever it is showing now and arrives after about as long as the
// readings are apart. It therefore runs a little under a second behind the receiver, steadily, which reads as
// motion and not as lag. The way the map is turned glides in the same manner, the short way round.
// A reading far from the last one (the receiver was unplugged, or has just found itself) is jumped to.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultGpsSmooth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const rad = (d) => (d * Math.PI) / 180;
  const metres = (a, b) => { const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2)); const y = rad(b.lat - a.lat); return Math.hypot(x, y) * 6371008.8; };
  const norm = (d) => ((d % 360) + 360) % 360;
  /** From one heading to another the short way round: -180..180. */
  const turn = (from, to) => { const d = norm(to - from); return d > 180 ? d - 360 : d; };

  class Glide {
    /** `jumpMetres` and `jumpMs`: a reading further or later than this from the last is jumped to, not glided to. */
    constructor({ jumpMetres = 400, jumpMs = 6000, minMs = 250, maxMs = 1600, movingSpeed = 1.5 } = {}) {
      Object.assign(this, { jumpMetres, jumpMs, minMs, maxMs, movingSpeed });
      this.from = null; this.goal = null; this.t0 = 0; this.ms = 0; this.lastAt = 0;
      this.bearFrom = 0; this.bearGoal = 0; this.hasBearing = false;
    }

    /** A new reading { lat, lon, course, speed } taken at `now` (ms, any steady clock). */
    to(fix, now) {
      const here = this.goal ? this.at(now) : null;
      const far = !this.goal || metres(this.goal, fix) > this.jumpMetres || now - this.lastAt > this.jumpMs;
      // Only a receiver that is moving knows which way it is heading: standing still, the course it reports is noise.
      const steer = fix.course != null && fix.speed != null && fix.speed >= this.movingSpeed;
      if (far) {
        this.from = { lat: fix.lat, lon: fix.lon }; this.ms = 0;
        if (steer) { this.bearFrom = norm(fix.course); this.bearGoal = this.bearFrom; this.hasBearing = true; }
      } else {
        this.from = { lat: here.lat, lon: here.lon };
        this.ms = Math.max(this.minMs, Math.min(this.maxMs, now - this.lastAt));
        if (steer) { this.bearFrom = this.hasBearing ? here.bearing : norm(fix.course); this.bearGoal = norm(fix.course); this.hasBearing = true; } else this.bearFrom = this.bearGoal = here.bearing;
      }
      this.goal = { lat: fix.lat, lon: fix.lon }; this.t0 = now; this.lastAt = now;
    }

    /** Where to show the mark at `now`: { lat, lon, bearing, moving }. `bearing` is null until a heading is known. */
    at(now) {
      if (!this.goal) return null;
      const k = this.ms > 0 ? Math.max(0, Math.min(1, (now - this.t0) / this.ms)) : 1;
      const bearing = this.hasBearing ? norm(this.bearFrom + turn(this.bearFrom, this.bearGoal) * k) : null;
      return { lat: this.from.lat + (this.goal.lat - this.from.lat) * k, lon: this.from.lon + (this.goal.lon - this.from.lon) * k, bearing, moving: k < 1 };
    }

    reset() { this.from = null; this.goal = null; this.hasBearing = false; }
  }

  return { Glide, metres, turn };
});
