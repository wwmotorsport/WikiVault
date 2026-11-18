'use strict';
// A reader for Mapbox Vector Tiles, just enough to find the road under a point and its name.
// (https://github.com/mapbox/vector-tile-spec, version 2.) Plain data work.

class Reader {
  constructor(buf, at = 0, end = buf.length) { this.buf = buf; this.at = at; this.end = end; }
  varint() { let v = 0; let mul = 1; for (;;) { const b = this.buf[this.at++]; v += (b & 0x7f) * mul; if (b < 0x80) return v; mul *= 128; } }
  /** Calls `onField(number, wireType)` for each field; the callback reads the value or returns false to have it skipped. */
  fields(onField) {
    while (this.at < this.end) {
      const key = this.varint();
      const type = key & 7;
      const before = this.at;
      if (onField(key >>> 3, type) !== false) continue;
      this.at = before;
      if (type === 0) this.varint(); else if (type === 1) this.at += 8; else if (type === 5) this.at += 4; else if (type === 2) { const n = this.varint(); this.at += n; } else throw new Error('This map tile cannot be read.');
    }
  }
  sub() { const n = this.varint(); const r = new Reader(this.buf, this.at, this.at + n); this.at += n; return r; }
  string() { const n = this.varint(); const s = this.buf.toString('utf8', this.at, this.at + n); this.at += n; return s; }
}

function readValue(r) {
  let v = null;
  r.fields((n, t) => {
    if (n === 1) v = r.string();
    else if (n === 2) { v = r.buf.readFloatLE(r.at); r.at += 4; } else if (n === 3) { v = r.buf.readDoubleLE(r.at); r.at += 8; } else if (n === 4 || n === 5) v = r.varint();
    else if (n === 6) { const z = r.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; } else if (n === 7) v = r.varint() !== 0;
    else return false;
    return t;
  });
  return v;
}

/**
 * The line features of one layer of a tile: [{ properties, lines: [[[x, y], ...], ...] }], with the
 * layer's extent (the tile is extent by extent units). Returns { extent, features } or null when
 * the tile has no such layer.
 */
function linesOf(tile, layerName) {
  let found = null;
  const top = new Reader(tile);
  top.fields((n) => {
    if (n !== 3 || found) return false;
    const r = top.sub();
    let name = ''; let extent = 4096; const keys = []; const values = []; const feats = [];
    r.fields((f) => {
      if (f === 1) name = r.string(); else if (f === 2) feats.push(r.sub()); else if (f === 3) keys.push(r.string()); else if (f === 4) values.push(readValue(r.sub())); else if (f === 5) extent = r.varint(); else return false;
      return true;
    });
    if (name !== layerName) return true;
    const features = [];
    for (const fr of feats) {
      let tags = []; let type = 0; let geom = [];
      fr.fields((f) => {
        const packed = () => { const p = fr.sub(); const out = []; while (p.at < p.end) out.push(p.varint()); return out; };
        if (f === 2) tags = packed(); else if (f === 3) type = fr.varint(); else if (f === 4) geom = packed(); else return false;
        return true;
      });
      if (type !== 2) continue;
      const properties = {};
      for (let i = 0; i + 1 < tags.length; i += 2) properties[keys[tags[i]]] = values[tags[i + 1]];
      const lines = []; let line = null; let x = 0; let y = 0;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i] & 7; let count = geom[i] >>> 3; i += 1;
        if (cmd === 7) continue;
        for (; count > 0 && i + 1 < geom.length; count--) {
          const dx = geom[i]; const dy = geom[i + 1]; i += 2;
          x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (cmd === 1) { line = [[x, y]]; lines.push(line); } else if (line) line.push([x, y]);
        }
      }
      features.push({ properties, lines });
    }
    found = { extent, features };
    return true;
  });
  return found;
}

/** Distance from a point to a line segment, and how far along the segment the nearest point is. */
function toSegment(px, py, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** The feature whose line passes nearest a point (in tile units), within `reach` units; null when none does. */
function nearestLine(features, px, py, reach, wanted = () => true) {
  let best = null; let bestD = reach;
  for (const f of features) {
    if (!wanted(f)) continue;
    for (const line of f.lines) for (let i = 1; i < line.length; i++) {
      const d = toSegment(px, py, line[i - 1], line[i]);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  return best ? { feature: best, distance: bestD } : null;
}

module.exports = { linesOf, nearestLine };
