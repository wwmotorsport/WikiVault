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
  return { Guide, metres, onSegment, said };
});
