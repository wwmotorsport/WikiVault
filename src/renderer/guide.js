'use strict';
// Following a route: where a position is along it, which turn comes next, and whether it has been left.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultGuide = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const R = 6371008.8; const RAD = Math.PI / 180;
  function metres(a, b) {
    const h = Math.sin(((b[1] - a[1]) * RAD) / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(((b[0] - a[0]) * RAD) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /** The nearest point to p on the piece of road from a to b: { t (0 at a, 1 at b), dist (metres from p) }. Flat-earth, which is right at this scale. */
  function onSegment(p, a, b) {
    const k = Math.cos(p[1] * RAD);
    const ax = (a[0] - p[0]) * k; const ay = a[1] - p[1]; const bx = (b[0] - p[0]) * k; const by = b[1] - p[1];
    const dx = bx - ax; const dy = by - ay; const len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
    const x = ax + dx * t; const y = ay + dy * t;
    return { t, dist: Math.sqrt(x * x + y * y) * RAD * R };
  }

  /**
   * Keeps track of a journey along one route. `route` is { coords: [[lon, lat]...], steps: [{ at: [lon, lat], text }] }, where `at` is the point of the line the step happens at,
   * as the directions give it. Call update() with each position.
   */
  class Guide {
    constructor(route, { offAfter = 3, offMetres = 50, arriveMetres = 35 } = {}) {
      this.route = route; this.offAfter = offAfter; this.offMetres = offMetres; this.arriveMetres = arriveMetres;
      this.along = [0];
      for (let i = 1; i < route.coords.length; i++) this.along.push(this.along[i - 1] + metres(route.coords[i - 1], route.coords[i]));
      this.total = this.along[this.along.length - 1];
      this.seg = 0; this.strays = 0; this.arrived = false;
      // Which point of the line each step happens at. The directions give the point itself; it is found on the line, looking onward from the step before.
      let from = 0;
      this.stepAt = (route.steps || []).map((s) => {
        if (typeof s.index === 'number') return s.index;
        let best = from; let bestD = Infinity;
        if (Array.isArray(s.at)) for (let i = from; i < route.coords.length; i++) { const d = Math.abs(route.coords[i][0] - s.at[0]) + Math.abs(route.coords[i][1] - s.at[1]); if (d < bestD) { bestD = d; best = i; if (d === 0) break; } }
        from = best;
        return best;
      });
    }
    /**
     * Where the position is: { along, remaining (m), dist (m from the route), off (true once it has clearly been left),
     * arrived, step (index of the instruction being followed), next: { index, text, meters } | null }.
     * `accuracy` is how far out the position may be, in metres. `slack` widens what counts as on the route, for a journey
     * that begins away from any road (a car park, a field): the route starts at the nearest road, not under the wheels.
     */
    update(pos, accuracy = 10, slack = 0) {
      const c = this.route.coords;
      // Look near where we were first: a route can pass the same place twice. Fall back to the whole route.
      let best = null;
      const scan = (from, to) => { for (let i = Math.max(0, from); i < Math.min(c.length - 1, to); i++) { const s = onSegment(pos, c[i], c[i + 1]); if (!best || s.dist < best.dist) best = { ...s, i }; } };
      scan(this.seg - 3, this.seg + 60);
      const limit = Math.max(this.offMetres, 2.5 * accuracy, slack);
      if (!best || best.dist > limit) { best = null; scan(0, c.length - 1); }
      if (!best) return { along: 0, remaining: this.total, dist: 0, off: false, arrived: false, step: 0, next: null };
      const strayed = best.dist > limit;
      this.strays = strayed ? this.strays + 1 : 0;
      if (!strayed) this.seg = best.i;
      const along = this.along[best.i] + (this.along[best.i + 1] - this.along[best.i]) * best.t;
      const remaining = Math.max(0, this.total - along);
      if (!strayed && remaining <= this.arriveMetres) this.arrived = true;
      const steps = this.route.steps || [];
      let next = null; let step = 0;
      for (let i = 0; i < steps.length; i++) {
        const at = this.along[Math.min(this.stepAt[i], this.along.length - 1)];
        if (at > along + 8) { next = { index: i, text: steps[i].text, meters: at - along }; break; }
        step = i;
      }
      return { along, remaining, dist: best.dist, off: this.strays >= this.offAfter, arrived: this.arrived, step, next: this.arrived ? null : next };
    }
  }

  /** A distance the way a driver in the United States hears it: "500 feet", "0.3 miles", "12 miles". */
  function said(m) {
    const ft = m * 3.28084; const mi = m / 1609.344;
    if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} feet`;
    if (mi < 10) return `${mi.toFixed(1).replace(/\.0$/, '')} ${mi.toFixed(1) === '1.0' ? 'mile' : 'miles'}`;
    return `${Math.round(mi)} miles`;
  }
  const MILE = 1609.344;
  const lower = (t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  /**
   * How far ahead a turn is spoken of, for the speed being travelled: the faster, the sooner. A quarter of a mile
   * in town, rising in step with the speed to a mile at 60 miles an hour and above. `near` is the last word, at the
   * turn itself; `mid` a reminder in between, when the first word comes early enough to want one.
   */
  function notice(speed) {
    const v = Math.max(0, Number(speed) || 0); // metres a second
    const far = Math.min(MILE, Math.max(400, MILE * (v / 26.8224)));
    const near = Math.min(250, Math.max(60, v * 5));
    const mid = far >= 800 ? Math.max(near + 150, far / 4) : 0;
    return { far, mid, near };
  }
  /**
   * What, if anything, is to be said now about the turn that comes next. `heard` records what has been said already
   * (it is written to). Just after a turn, when the next is more than a mile off, the driver is told what it is and
   * how far; then it is spoken of at the distance the speed calls for, once more nearer when that was far off, and
   * at the turn.
   * @param {{index:number,text:string,meters:number}|null} next
   * @returns {string|null} the words to say
   */
  function announce(next, speed, heard) {
    if (!next) return null;
    const n = notice(speed); const k = (s) => `${next.index}:${s}`;
    const mark = (...keys) => { for (const s of keys) heard[k(s)] = true; };
    if (next.meters <= n.near) { if (heard[k('near')]) return null; mark('near', 'mid', 'far', 'ahead'); return `${next.text}.`; }
    if (n.mid && next.meters <= n.mid) { if (heard[k('mid')]) return null; mark('mid', 'far', 'ahead'); return `In ${said(next.meters)}, ${lower(next.text)}.`; }
    if (next.meters <= n.far) { if (heard[k('far')]) return null; mark('far', 'ahead'); return `In ${said(next.meters)}, ${lower(next.text)}.`; }
    if (next.meters > MILE && !heard[k('ahead')]) { mark('ahead'); return `Continue for ${said(next.meters)}, then ${lower(next.text)}.`; }
    return null;
  }
  /**
   * The zoom at which the next turn is in view ahead of the position: `ahead` is how many pixels of map lie between
   * the mark and the edge it is heading for. Close in for a turn that is near, out for one that is miles off, and
   * never so close at speed that the map rushes by.
   */
  function zoomFor(meters, lat, ahead, speed = 0, { min = 9.5, max = 17 } = {}) {
    const span = Math.max(120, meters) * 1.25; // the turn sits four fifths of the way to the edge
    const perPixel = span / Math.max(80, ahead);
    const z = Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180)) / perPixel);
    const cap = Math.min(max, 17.5 - Math.max(0, Number(speed) || 0) / 18); // 17 at a walk, about 16 at 60 miles an hour
    return Math.round(Math.max(min, Math.min(cap, z)) * 100) / 100;
  }
  return { Guide, metres, onSegment, said, notice, announce, zoomFor };
});
