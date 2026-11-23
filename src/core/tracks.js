'use strict';
// Breadcrumbs: where the GPS receiver has been, kept as trips.
//
// Kept only when the user has switched it on, and only on this computer: a folder in the app's own data, a small
// index of the trips and one plain file of points for each. Nothing here is sent anywhere, and nothing about a
// position is written to the log.
//
// A trip is a run of positions with no gap longer than GAP between them. Standing still makes no positions (the
// window only sends one when the receiver has moved), so a stop of five minutes ends a trip and the next movement
// begins another. A trip too short to be a journey (a receiver wandering in a car park) is not kept.
// No Electron, no network.
const fs = require('fs');
const path = require('path');

const GAP_MS = 5 * 60 * 1000; // a pause this long ends a trip
const MIN_METRES = 150; // a trip shorter than this is the receiver wandering, not a journey
const MIN_POINTS = 4;
const VIA_EVERY_M = 4000; // how often along a trip the nearest town is asked for
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Metres between two positions. */
function metres(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A line with fewer points that stays within `tol` metres of the original (Douglas and Peucker's way, without
 * recursion). `pts` is [[lon, lat], ...]. A straight road becomes its two ends; a bend keeps its shape.
 */
function simplify(pts, tol = 6) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const k = Math.cos(rad(pts[0][1])) * 111320; const ky = 110540;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][0] * k; const ay = pts[a][1] * ky; const dx = pts[b][0] * k - ax; const dy = pts[b][1] * ky - ay; const len = dx * dx + dy * dy;
    let worst = 0; let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const px = pts[i][0] * k - ax; const py = pts[i][1] * ky - ay;
      const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const idOf = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`; };
const r5 = (n) => Math.round(n * 1e5) / 1e5;

class TrackStore {
  /**
   * @param {string} dir the folder the trips are kept in
   * @param {object} [o]
   * @param {function} [o.describe] (lat, lon) => the name of the nearest town, or '' (from the downloaded map data)
   * @param {function} [o.log]
   */
  constructor(dir, { describe = () => '', log = () => {} } = {}) {
    this.dir = dir; this.describe = describe; this.log = log;
    this.trips = []; // finished trips, oldest first: { id, start, end, meters, count, box: [w, s, e, n], from, to, via: [] }
    this.now = null; // the trip being recorded: the same, with the last point and the line so far
    this.lineCache = new Map();
  }

  file(id, ext = 'csv') { return path.join(this.dir, `${id}.${ext}`); }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.dir, 'index.json'), 'utf8'));
      this.trips = (Array.isArray(j.trips) ? j.trips : []).filter((t) => t && /^[0-9T]+$/.test(String(t.id)) && fs.existsSync(this.file(t.id)));
    } catch { this.trips = []; }
    // A trip that was being recorded when the app last stopped is finished now, from its points.
    try {
      for (const f of fs.readdirSync(this.dir)) {
        const m = /^([0-9T]+)\.csv$/.exec(f);
        if (m && !this.trips.some((t) => t.id === m[1])) this.adopt(m[1]);
      }
    } catch { /* no folder yet: nothing has been recorded */ }
    this.trips.sort((a, b) => a.start - b.start);
    return this;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, 'index.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, trips: this.trips }));
    fs.renameSync(tmp, path.join(this.dir, 'index.json'));
  }

  /** The points of a trip as they were recorded: [[lon, lat, t, speed], ...]. */
  points(id) {
    if (!/^[0-9T]+$/.test(String(id))) return [];
    let text = '';
    try { text = fs.readFileSync(this.file(id), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      const c = line.split(',');
      if (c.length < 3) continue;
      const t = Number(c[0]); const lat = Number(c[1]); const lon = Number(c[2]);
      if (Number.isFinite(t) && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lon, lat, t, c[3] === '' || c[3] == null ? null : Number(c[3])]);
    }
    return out;
  }

  /** What is known of a trip from its points alone. */
  measure(id, pts) {
    let m = 0; const box = [180, 90, -180, -90];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      if (i) m += metres(pts[i - 1][1], pts[i - 1][0], p[1], p[0]);
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
    }
    return { id, start: pts[0][2], end: pts[pts.length - 1][2], meters: Math.round(m), count: pts.length, box: box.map(r5) };
  }

  /** The towns at the ends of a trip and along it, from the downloaded map data. */
  name(trip, pts) {
    const say = (p) => { try { return String(this.describe(p[1], p[0]) || ''); } catch { return ''; } };
    trip.from = say(pts[0]); trip.to = say(pts[pts.length - 1]);
    const via = []; let since = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      since += metres(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
      if (since < VIA_EVERY_M) continue;
      since = 0;
      const n = say(pts[i]);
      if (n && n !== trip.from && n !== trip.to && !via.includes(n)) via.push(n);
      if (via.length >= 20) break;
    }
    trip.via = via;
    return trip;
  }

  /** Finish a trip from its file: measured, named and listed, or thrown away when it was no journey. */
  adopt(id) {
    const pts = this.points(id);
    const trip = pts.length ? this.measure(id, pts) : null;
    if (!trip || trip.count < MIN_POINTS || trip.meters < MIN_METRES) { this.drop(id); return null; }
    this.name(trip, pts);
    try { fs.writeFileSync(this.file(id, 'line.json'), JSON.stringify(simplify(pts.map((p) => [r5(p[0]), r5(p[1])])))); } catch { /* drawn from the points instead */ }
    this.trips.push(trip);
    return trip;
  }

  drop(id) { for (const ext of ['csv', 'line.json']) { try { fs.unlinkSync(this.file(id, ext)); } catch { /* not there */ } } this.lineCache.delete(id); }

  /**
   * Positions from the receiver: [{ t, lat, lon, speed }], in order. They join the trip being recorded, or begin a
   * new one when the last position is more than GAP old. Returns { id, started } for the trip they went to.
   */
  add(points) {
    let started = false;
    const lines = [];
    for (const p of Array.isArray(points) ? points : []) {
      if (!p || typeof p !== 'object' || p.t == null || p.lat == null || p.lon == null) continue;
      const t = Number(p.t); const lat = Number(p.lat); const lon = Number(p.lon);
      if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      if (this.now && (t - this.now.end > GAP_MS || t < this.now.end)) { if (lines.length) { fs.appendFileSync(this.file(this.now.id), lines.join('')); lines.length = 0; } this.close(); }
      if (!this.now) {
        let id = idOf(t); while (fs.existsSync(this.file(id)) || this.trips.some((x) => x.id === id)) id = idOf(Date.parse(`${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}Z`) + 1000);
        fs.mkdirSync(this.dir, { recursive: true });
        this.now = { id, start: t, end: t, meters: 0, count: 0, last: null, line: [] };
        started = true;
      }
      const n = this.now;
      if (n.last) n.meters += metres(n.last[1], n.last[0], lat, lon);
      n.last = [lon, lat]; n.end = t; n.count += 1; n.line.push([r5(lon), r5(lat)]);
      const v = Number(p.speed);
      lines.push(`${Math.round(t)},${lat.toFixed(6)},${lon.toFixed(6)},${Number.isFinite(v) ? v.toFixed(1) : ''}\n`);
    }
    if (lines.length && this.now) fs.appendFileSync(this.file(this.now.id), lines.join(''));
    return this.now ? { id: this.now.id, started } : null;
  }

  /** End the trip being recorded, if there is one. Returns it as listed, or null when it was too short to keep. */
  close() {
    if (!this.now) return null;
    const id = this.now.id; this.now = null;
    const trip = this.adopt(id);
    this.trips.sort((a, b) => a.start - b.start);
    this.save();
    return trip;
  }

  /** End the trip being recorded when nothing has come from the receiver for GAP. Called from a timer. */
  idle(now = Date.now()) { return this.now && now - this.now.end > GAP_MS ? this.close() : null; }

  /**
   * The trips, newest first, that match: `text` (every word in it found in the towns the trip began at, ended at
   * or passed), and a time span { after, before } in ms that the trip falls in at least partly.
   */
  list({ text = '', after = null, before = null } = {}) {
    const words = String(text || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const out = [];
    for (const t of this.trips) {
      if (after != null && t.end < after) continue;
      if (before != null && t.start > before) continue;
      if (words.length) { const hay = [t.from, t.to, ...(t.via || [])].join(' | ').toLowerCase(); if (!words.every((w) => hay.includes(w))) continue; }
      out.push(t);
    }
    return out.reverse();
  }

  /** A trip's line for drawing: few points, the same shape. */
  line(id) {
    if (this.lineCache.has(id)) return this.lineCache.get(id);
    let line = null;
    try { line = JSON.parse(fs.readFileSync(this.file(id, 'line.json'), 'utf8')); } catch { /* made below */ }
    if (!Array.isArray(line)) line = simplify(this.points(id).map((p) => [r5(p[0]), r5(p[1])]));
    this.lineCache.set(id, line);
    return line;
  }

  /** Every trip's line, and the one being recorded: [{ id, c: [[lon, lat], ...], live? }]. */
  lines(ids = null) {
    const out = [];
    for (const t of this.trips) if (!ids || ids.includes(t.id)) out.push({ id: t.id, c: this.line(t.id) });
    if (this.now && this.now.line.length > 1 && (!ids || ids.includes(this.now.id))) out.push({ id: this.now.id, c: simplify(this.now.line, 4), live: true });
    return out;
  }

  /** The recorded positions themselves, newest trips first, up to `limit` of them: [[lon, lat], ...]. */
  dots(limit = 250000, ids = null) {
    const out = [];
    const take = (pts) => { for (const p of pts) { if (out.length >= limit) return false; out.push([r5(p[0]), r5(p[1])]); } return true; };
    if (this.now && (!ids || ids.includes(this.now.id)) && !take(this.now.line)) return out;
    for (let i = this.trips.length - 1; i >= 0; i -= 1) { if (ids && !ids.includes(this.trips[i].id)) continue; if (!take(this.points(this.trips[i].id))) break; }
    return out;
  }

  remove(id) {
    const before = this.trips.length;
    this.trips = this.trips.filter((t) => t.id !== id);
    if (this.now && this.now.id === id) this.now = null;
    this.drop(id); this.save();
    return this.trips.length < before;
  }

  clear() {
    for (const t of this.trips) this.drop(t.id);
    if (this.now) { this.drop(this.now.id); this.now = null; }
    this.trips = []; this.lineCache.clear(); this.save();
    return true;
  }

  summary() {
    let meters = 0; for (const t of this.trips) meters += t.meters;
    return { count: this.trips.length, meters, first: this.trips.length ? this.trips[0].start : null, last: this.trips.length ? this.trips[this.trips.length - 1].end : null, recording: this.now ? { id: this.now.id, start: this.now.start, meters: Math.round(this.now.meters), count: this.now.count } : null };
  }
}

module.exports = { TrackStore, metres, simplify, GAP_MS, MIN_METRES };
