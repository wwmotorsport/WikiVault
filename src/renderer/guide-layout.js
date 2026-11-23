'use strict';
// Reads the layout of one PDF page for the Survival Guides: which parts are pictures (photographs, drawings,
// tables), and the text in reading order as paragraphs. Nothing here draws or reads a file: it is given what the
// PDF reader found on the page (pieces of text with their places, and what was painted where) and returns a plan.
// Shared by the converter window and the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WikivaultGuideLayout = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const boxOf = (m, x0, y0, x1, y1) => {
    const p = [at(m, x0, y0), at(m, x1, y0), at(m, x0, y1), at(m, x1, y1)];
    return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  };

  /**
   * What was painted on a page and where, from the PDF reader's list of drawing steps: pictures, and lines and
   * shapes that were really drawn (not ones used only to clip, and not white ones laid down as a background).
   * `view` is the page's own transform, so the boxes come out in the page's points with the top left as 0,0.
   */
  function marks(fnArray, argsArray, OPS, view) {
    const out = [];
    let m = view.slice();
    const stack = [];
    let fillWhite = false;
    const whiteStack = [];
    const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const FILL_ONLY = new Set([OPS.fill, OPS.eoFill]);
    for (let i = 0; i < fnArray.length; i += 1) {
      const fn = fnArray[i]; const a = argsArray[i];
      if (fn === OPS.save) { stack.push(m); whiteStack.push(fillWhite); }
      else if (fn === OPS.restore) { if (stack.length) { m = stack.pop(); fillWhite = whiteStack.pop(); } }
      else if (fn === OPS.transform) m = mul(m, a);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(m); whiteStack.push(fillWhite); if (a && Array.isArray(a[0])) m = mul(m, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) { m = stack.pop(); fillWhite = whiteStack.pop(); } }
      else if (fn === OPS.setFillRGBColor) fillWhite = a[0] >= 248 && a[1] >= 248 && a[2] >= 248;
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintSolidColorImageMask || fn === OPS.paintInlineImageXObjectGroup || fn === OPS.paintImageMaskXObjectGroup || fn === OPS.paintImageMaskXObjectRepeat) {
        out.push({ k: 'img', box: boxOf(m, 0, 0, 1, 1) });
      } else if (fn === OPS.shadingFill) out.push({ k: 'path', box: null });
      else if (fn === OPS.constructPath) {
        const mm = a && a[2];
        if (!mm || !Number.isFinite(mm[0] + mm[1] + mm[2] + mm[3])) continue;
        // What is done with the path is said by the steps that follow it.
        let painted = false; let fillOnly = false;
        for (let j = i + 1; j < fnArray.length && j <= i + 4; j += 1) {
          if (PAINT.has(fnArray[j])) { painted = true; fillOnly = FILL_ONLY.has(fnArray[j]); break; }
          if (fnArray[j] === OPS.endPath || fnArray[j] === OPS.constructPath) break;
        }
        if (!painted || (fillOnly && fillWhite)) continue;
        out.push({ k: 'path', box: boxOf(m, mm[0], mm[2], mm[1], mm[3]) });
      }
    }
    return out.filter((x) => x.box);
  }

  const CELL = 6; // points: the grain at which painted areas are joined into pictures

  /** The pictures of a page: painted areas that touch or nearly touch, joined, and kept when they are large enough. */
  function figures(w, h, all) {
    const cols = Math.ceil(w / CELL) + 2; const rows = Math.ceil(h / CELL) + 2;
    const grid = new Uint8Array(cols * rows);
    const pageArea = w * h;
    let scanArea = 0;
    const kept = [];
    for (const mk of all) {
      const b = [Math.max(0, mk.box[0]), Math.max(0, mk.box[1]), Math.min(w, mk.box[2]), Math.min(h, mk.box[3])];
      const bw = b[2] - b[0]; const bh = b[3] - b[1];
      if (bw <= 0 || bh <= 0) { if (mk.k !== 'path' || (bw < 0 || bh < 0)) continue; }
      if (mk.k === 'img' && bw * bh >= pageArea * 0.72) scanArea = Math.max(scanArea, bw * bh);
      if (bw >= w * 0.9 && bh >= h * 0.9) continue; // a background, a border round the whole page, or the page itself as one picture
      kept.push({ k: mk.k, b });
      const c0 = Math.floor(b[0] / CELL); const c1 = Math.floor(b[2] / CELL); const r0 = Math.floor(b[1] / CELL); const r1 = Math.floor(b[3] / CELL);
      for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) grid[r * cols + c] = 1;
    }
    // Connected areas, counting cells that touch at a corner and those one empty cell apart.
    const label = new Int32Array(cols * rows);
    const comps = [];
    const queue = [];
    for (let s = 0; s < grid.length; s += 1) {
      if (!grid[s] || label[s]) continue;
      const id = comps.length + 1;
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      label[s] = id; queue.length = 0; queue.push(s);
      while (queue.length) {
        const q = queue.pop(); const r = Math.floor(q / cols); const c = q % cols;
        if (c < box[0]) box[0] = c; if (r < box[1]) box[1] = r; if (c > box[2]) box[2] = c; if (r > box[3]) box[3] = r;
        for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
          const rr = r + dr; const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const n = rr * cols + cc;
          if (grid[n] && !label[n]) { label[n] = id; queue.push(n); }
        }
      }
      comps.push({ id, box: [box[0] * CELL, box[1] * CELL, (box[2] + 1) * CELL, (box[3] + 1) * CELL], imgs: 0, paths: 0 });
    }
    for (const k of kept) {
      const id = label[Math.floor(Math.min(h - 0.01, Math.max(0, (k.b[1] + k.b[3]) / 2)) / CELL) * cols + Math.floor(Math.min(w - 0.01, Math.max(0, (k.b[0] + k.b[2]) / 2)) / CELL)];
      const comp = id ? comps[id - 1] : null;
      if (comp) { if (k.k === 'img') comp.imgs += 1; else comp.paths += 1; }
    }
    const figs = comps.filter((c) => {
      const bw = c.box[2] - c.box[0]; const bh = c.box[3] - c.box[1];
      if (bw < 36 || bh < 30 || bw * bh < 2600) return false; // rules, bullets, small ornaments
      return c.imgs > 0 || c.paths >= 3;
    }).map((c) => ({ box: [Math.max(0, c.box[0] - 3), Math.max(0, c.box[1] - 3), Math.min(w, c.box[2] + 3), Math.min(h, c.box[3] + 3)], imgs: c.imgs, paths: c.paths }));
    return { figs, scan: scanArea > 0 };
  }

  /** Pieces of text on one baseline, joined into runs: a wide gap (a gutter between columns, a tab) starts a new run. */
  function runs(items) {
    const rows = [];
    const sorted = items.filter((it) => it.s && it.s.trim()).sort((a, b) => a.base - b.base || a.x - b.x);
    for (const it of sorted) {
      const row = rows.length ? rows[rows.length - 1] : null;
      if (row && Math.abs(row.base - it.base) <= Math.max(2, Math.min(row.size, it.size) * 0.35)) row.items.push(it);
      else rows.push({ base: it.base, size: it.size, items: [it] });
    }
    const out = [];
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const it of row.items) {
        const gap = cur ? it.x - cur.x1 : 0;
        if (cur && gap < Math.max(11, cur.size * 1.6)) {
          const space = gap > cur.size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.s) ? ' ' : '';
          cur.text += space + it.s; cur.x1 = Math.max(cur.x1, it.x + it.w); cur.y0 = Math.min(cur.y0, it.base - it.size); cur.y1 = Math.max(cur.y1, it.base + it.size * 0.25);
          cur.size = Math.max(cur.size, it.size); cur.chars += it.s.length;
        } else {
          cur = { text: it.s, x0: it.x, x1: it.x + it.w, y0: it.base - it.size, y1: it.base + it.size * 0.25, base: it.base, size: it.size, chars: it.s.length };
          out.push(cur);
        }
      }
    }
    for (const r of out) r.text = r.text.replace(/\s+/g, ' ').trim();
    // A footnote mark (a small raised figure beside larger text) is not a line of its own: it is left out.
    const mark = (s) => s.chars <= 4 && /^[\d*†‡§,]+$/.test(s.text) && out.some((r) => r !== s && r.size > s.size * 1.2 && s.base >= r.y0 - 2 && s.base <= r.y1 + 2 && s.x0 >= r.x0 - 4 && s.x0 <= r.x1 + 10);
    return out.filter((r) => r.text && !mark(r));
  }

  /** Reading order: columns are read one after the other, and whatever runs across them is read where it stands. */
  function order(list, depth = 0) {
    if (list.length < 2 || depth > 12) return list.slice().sort((a, b) => a.base - b.base || a.x0 - b.x0);
    const x0 = Math.min(...list.map((r) => r.x0)); const x1 = Math.max(...list.map((r) => r.x1));
    const y0 = Math.min(...list.map((r) => r.y0)); const y1 = Math.max(...list.map((r) => r.y1));
    // A gutter: an upright strip no text crosses, with real columns of text on both sides.
    if (list.length >= 6 && x1 - x0 > 200) {
      const edges = list.map((r) => [r.x0, r.x1]).sort((a, b) => a[0] - b[0]);
      let reach = edges[0][1]; let best = null;
      for (const [a, b] of edges) {
        if (a - reach >= 12) {
          const mid = (a + reach) / 2;
          if (mid > x0 + (x1 - x0) * 0.22 && mid < x0 + (x1 - x0) * 0.78 && (!best || a - reach > best.gap)) best = { gap: a - reach, at: mid, left: reach };
        }
        reach = Math.max(reach, b);
      }
      if (best) {
        const left = list.filter((r) => r.x1 <= best.at); const right = list.filter((r) => r.x0 >= best.at);
        const rowsOf = (part) => new Set(part.map((r) => Math.round(r.base / 4))).size;
        // Prose in columns fills its lines; a narrow column of short labels beside a wide one is a table or a list, read across.
        const widths = left.map((r) => r.x1 - r.x0).sort((a, b) => a - b);
        const full = widths[Math.floor(widths.length / 2)] >= (best.left - x0) * 0.55;
        if (rowsOf(left) >= 3 && rowsOf(right) >= 3 && full && left.length + right.length === list.length) return [...order(left, depth + 1), ...order(right, depth + 1)];
      }
    }
    // Otherwise the widest clear band across splits what is above from what is below.
    const bands = list.map((r) => [r.y0, r.y1]).sort((a, b) => a[0] - b[0]);
    let reach = bands[0][1]; let cut = null;
    for (const [a, b] of bands) {
      if (a - reach >= 5 && (!cut || a - reach > cut.gap)) cut = { gap: a - reach, at: (a + reach) / 2 };
      reach = Math.max(reach, b);
    }
    if (cut && y1 - y0 > 40) {
      const top = list.filter((r) => (r.y0 + r.y1) / 2 < cut.at); const bottom = list.filter((r) => (r.y0 + r.y1) / 2 >= cut.at);
      if (top.length && bottom.length) return [...order(top, depth + 1), ...order(bottom, depth + 1)];
    }
    return list.slice().sort((a, b) => a.base - b.base || a.x0 - b.x0);
  }

  const BULLET = /^(?:[•●▪■◦○∙·▶►➢➤✓✔❖\-–—*]|o(?=\s)|\(?\d{1,2}[.)]|\(?[a-zA-Z][.)])\s+\S/;

  /** Runs in reading order, joined into paragraphs. Runs on one line that follow one another are one line of text. */
  function paragraphs(seq) {
    const lines = [];
    for (const r of seq) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.base - r.base) <= Math.max(2, last.size * 0.35) && r.x0 >= last.x1 - 2) { last.text += `  ${r.text}`; last.x1 = r.x1; last.chars += r.chars; }
      else lines.push({ ...r });
    }
    // How far the lines of each column reach, so that a line which stops well short of that is known to end something.
    for (const ln of lines) ln.reach = Math.max(...lines.filter((o) => Math.abs(o.x0 - ln.x0) < 40 && Math.abs(o.base - ln.base) < 260).map((o) => o.x1));
    const out = [];
    let cur = null;
    for (const ln of lines) {
      let join = false;
      if (cur) {
        const prev = cur.last;
        const gap = ln.y0 - prev.y1;
        const sameSize = Math.abs(ln.size - prev.size) <= Math.max(0.8, prev.size * 0.12);
        const below = ln.base > prev.base && gap < prev.size * 0.75;
        const width = Math.max(prev.reach, cur.x1max) - cur.x0min;
        const shortBefore = prev.x1 < Math.max(prev.reach, cur.x1max) - Math.max(30, width * 0.22);
        const veryShort = prev.x1 < Math.max(prev.reach, cur.x1max) - Math.max(60, width * 0.4);
        const ended = /[.!?:]["')\]]?$/.test(prev.text);
        const starts = /^["'(\[]?[A-Z0-9]/.test(ln.text);
        join = sameSize && below && Math.abs(ln.x0 - cur.x0min) < 60 && !BULLET.test(ln.text) && !(starts && ((shortBefore && ended) || (veryShort && !/[,;]$|\b(?:a|an|the|of|and|or|to|in|for|with|by)$/i.test(prev.text))));
      }
      if (join) {
        if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(ln.text)) cur.text = cur.text.slice(0, -1) + ln.text; else cur.text += ` ${ln.text}`;
        cur.last = ln; cur.lines += 1; cur.x1max = Math.max(cur.x1max, ln.x1); cur.x0min = Math.min(cur.x0min, ln.x0); cur.y1 = ln.y1; cur.chars += ln.chars;
      } else {
        cur = { text: ln.text, size: ln.size, lines: 1, last: ln, x0min: ln.x0, x1max: ln.x1, y0: ln.y0, y1: ln.y1, chars: ln.chars };
        out.push(cur);
      }
    }
    return out.map((p) => ({ text: p.text, size: Math.round(p.size * 10) / 10, lines: p.lines, x0: Math.round(p.x0min), x1: Math.round(p.x1max), y0: Math.round(p.y0), y1: Math.round(p.y1), li: BULLET.test(p.text) }));
  }

  /**
   * The plan for one page.
   * @param {{w:number,h:number,items:Array<{s:string,x:number,base:number,w:number,size:number}>,marks:Array}} page
   * @returns {{whole:boolean, scan:boolean, figs:Array<{box:number[],text:string}>, paras:Array, words:number}}
   *   `whole`: the page is best shown as one picture of itself (a scan, or more picture than text).
   */
  function plan(page) {
    const { w, h } = page;
    const { figs, scan } = figures(w, h, page.marks || []);
    const all = runs(page.items || []);
    const words = all.reduce((n, r) => n + r.text.split(/\s+/).length, 0);
    const inside = (r, b) => { const cx = (r.x0 + r.x1) / 2; const cy = (r.y0 + r.y1) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; };
    // A frame round a block of text is not a picture: its words are kept as words.
    const real = figs.filter((f) => {
      const area = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      const text = all.filter((r) => inside(r, f.box)).reduce((n, r) => n + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
      return !(f.imgs === 0 && f.paths <= 14 && text > area * 0.3);
    });
    // A picture's edge is not drawn through a line of text that only pokes into it: the edge is moved clear of the line.
    for (const f of real) {
      const height = f.box[3] - f.box[1];
      for (const r of all) {
        if (inside(r, f.box) || r.x1 < f.box[0] || r.x0 > f.box[2] || r.y1 <= f.box[1] || r.y0 >= f.box[3]) continue;
        if ((r.y0 + r.y1) / 2 < (f.box[1] + f.box[3]) / 2) { if (r.y1 + 1 - f.box[1] < height * 0.2) f.box[1] = Math.max(f.box[1], r.y1 + 1); }
        else if (f.box[3] - (r.y0 - 1) < height * 0.2) f.box[3] = Math.min(f.box[3], r.y0 - 1);
      }
      // Text that runs round a picture pokes in from the side: the same, sideways.
      const width = f.box[2] - f.box[0];
      for (const r of all) {
        const cy = (r.y0 + r.y1) / 2; const cx = (r.x0 + r.x1) / 2;
        if (cy < f.box[1] || cy > f.box[3] || inside(r, f.box)) continue;
        if (cx < f.box[0] && r.x1 > f.box[0] && r.x1 + 2 - f.box[0] < width * 0.3) f.box[0] = r.x1 + 2;
        else if (cx > f.box[2] && r.x0 < f.box[2] && f.box[2] - (r.x0 - 2) < width * 0.3) f.box[2] = r.x0 - 2;
      }
    }
    const figArea = real.reduce((n, f) => n + (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]), 0);
    const whole = scan || figArea > w * h * 0.62 || real.length > 9;
    if (whole) {
      return { whole: true, scan, figs: [], paras: paragraphs(order(all)), words };
    }
    const flow = all.filter((r) => !real.some((f) => inside(r, f.box)));
    const outFigs = real.map((f) => ({ box: f.box.map((v) => Math.round(v * 10) / 10), text: order(all.filter((r) => inside(r, f.box))).map((r) => r.text).join(' ').slice(0, 4000) }));
    // Pictures go into the text where they stand on the page: each as a "paragraph" at its own height, then ordered with the rest.
    const paras = paragraphs(order(flow));
    const blocks = paras.map((p) => ({ ...p }));
    for (const [i, f] of outFigs.entries()) {
      const mid = (f.box[1] + f.box[3]) / 2;
      // After the last paragraph that starts above the picture's middle and lies in its column (or runs across it).
      let after = -1;
      for (let k = 0; k < blocks.length; k += 1) {
        const b = blocks[k];
        if (b.fig != null) { if ((outFigs[b.fig].box[1] + outFigs[b.fig].box[3]) / 2 < mid) after = k; continue; }
        const overlaps = b.x1 > f.box[0] - 20 && b.x0 < f.box[2] + 20;
        if (b.y0 < mid && (overlaps || b.y1 < f.box[1])) after = k;
      }
      blocks.splice(after + 1, 0, { fig: i, y0: f.box[1], y1: f.box[3], x0: f.box[0], x1: f.box[2] });
    }
    return { whole: false, scan: false, figs: outFigs, paras: blocks, words };
  }

  return { marks, figures, runs, order, paragraphs, plan, BULLET };
}));
