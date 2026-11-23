'use strict';
// Turns the pages of one PDF, as read by the converter (src/renderer/guide-layout.js), into a guide: running heads
// and page numbers taken out, headings told from body text, and the whole divided into articles of readable length.

const norm = (s) => String(s).toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
const PAGE_NO = /^(?:page\s*)?(?:#|[ivxlc]{1,7})(?:\s*(?:of|\/)\s*#)?$|^[-–—\s]*#[-–—\s]*$/;
const isCaps = (s) => { const letters = s.replace(/[^A-Za-z]/g, ''); return letters.length >= 4 && letters === letters.toUpperCase(); };
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
/** A heading printed in capitals, as a title: "WATER PURIFICATION" becomes "Water purification". */
function calm(s) {
  const t = tidy(s).replace(/^[\d.\s]*(?=\D)/, (m) => m); // numbering stays
  return isCaps(t) ? t.charAt(0) + t.slice(1).toLowerCase().replace(/\b(i{1,3}|iv|vi{0,3}|ix|x)\b/g, (m) => m.toUpperCase()) : t;
}

/**
 * @param {{title:string}} meta
 * @param {Array<{n:number,w:number,h:number,whole:boolean,paras:Array,figs:Array,img?:object}>} pages
 *   each page as planned, with the names of the pictures saved for it: `img` for a page shown whole, `figs[i].img` for a picture
 * @param {Array<{title:string,page:number}>} [outline]  the PDF's own table of contents, when it has one
 * @returns {{sections:Array<{title:string,from:number,to:number,blocks:Array,text:string,words:number}>, words:number, body:number}}
 */
function build(meta, pages, outline = []) {
  // 1. Lines at the head and foot of the page that repeat from page to page, and page numbers.
  const edge = (p, b) => !p.whole && b.fig == null && b.lines <= 2 && (b.y1 < p.h * 0.09 || b.y0 > p.h * 0.905);
  const seen = new Map();
  for (const p of pages) for (const b of p.paras) if (edge(p, b)) seen.set(norm(b.text), (seen.get(norm(b.text)) || 0) + 1);
  const repeats = pages.length <= 4 ? 2 : 3; // a line in the margin that comes back this often is a running head
  const drop = (p, b) => edge(p, b) && (PAGE_NO.test(norm(b.text)) || (seen.get(norm(b.text)) >= repeats) || /^https?:\/\/\S+(?: #\/#\/#)?$|\bpage # of #$/.test(norm(b.text)));

  // 2. The size of ordinary text.
  const sizes = new Map();
  for (const p of pages) if (!p.whole) for (const b of p.paras) if (b.fig == null) sizes.set(b.size, (sizes.get(b.size) || 0) + b.text.length);
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;

  // 3. One run of blocks for the whole guide, each knowing its page.
  const blocks = [];
  for (const p of pages) {
    blocks.push({ t: 'pb', page: p.n });
    if (p.whole) {
      const text = p.paras.filter((b) => b.fig == null).map((b) => tidy(b.text)).filter(Boolean).join('\n');
      if (p.img) blocks.push({ t: 'page', page: p.n, src: p.img.name, w: p.img.w, h: p.img.h, x: text });
      else if (text) for (const line of text.split('\n')) blocks.push({ t: 'p', page: p.n, x: line });
      continue;
    }
    for (const b of p.paras) {
      if (b.fig != null) { const f = p.figs[b.fig]; if (f && f.img) blocks.push({ t: 'fig', page: p.n, src: f.img.name, w: f.img.w, h: f.img.h, x: tidy(f.text || '') }); continue; }
      if (drop(p, b)) continue;
      const text = tidy(b.text);
      if (!text) continue;
      const big = b.size >= body * 1.15;
      const heading = b.lines <= 2 && text.length <= 120 && text.length >= 3 && !/[.,;]$/.test(text) && /[A-Za-z]{3}/.test(text) && !b.li && (big || (isCaps(text) && b.size >= body * 0.95 && text.length <= 80));
      if (heading) { blocks.push({ t: 'h', l: b.size >= body * 1.45 ? 2 : 3, page: p.n, x: calm(text), size: b.size }); continue; }
      const last = blocks[blocks.length - 1]; const before = blocks[blocks.length - 2];
      // A paragraph that runs over the foot of a page is joined to its other half.
      if (!b.li && last && last.t === 'pb' && before && before.t === 'p' && !/[.!?:]["')\]]?$/.test(before.x) && /^[a-z]/.test(text)) {
        before.x = /[A-Za-z]-$/.test(before.x) ? before.x.slice(0, -1) + text : `${before.x} ${text}`;
        continue;
      }
      blocks.push({ t: b.li ? 'li' : 'p', page: p.n, x: text });
    }
  }

  // 4. Where the articles begin: the PDF's own contents when it has them, else its large headings, else every so many pages.
  const last = pages.length ? pages[pages.length - 1].n : 0;
  const MAX = 16; const MIN = 2;
  let starts = [];
  if (last > 14) {
    const own = (outline || []).filter((o) => o && o.title && o.page >= 1 && o.page <= last).map((o) => ({ page: o.page, title: calm(o.title) }));
    const distinct = own.filter((o, i) => i === 0 || o.page !== own[i - 1].page);
    if (distinct.length >= 3) starts = distinct;
    else {
      const heads = blocks.filter((b) => b.t === 'h' && b.l === 2 && b.x.length >= 4);
      const firstOnPage = heads.filter((hd, i) => i === 0 || hd.page !== heads[i - 1].page).map((hd) => ({ page: hd.page, title: hd.x }));
      if (firstOnPage.length >= 3 && firstOnPage.length <= last / 2) starts = firstOnPage;
    }
    // Too close together: the later one is not a new article. Too far apart: divided by pages.
    const spaced = [];
    for (const s of starts) { if (!spaced.length || s.page - spaced[spaced.length - 1].page >= MIN) spaced.push(s); }
    if (!spaced.length || spaced[0].page > 1) spaced.unshift({ page: 1, title: spaced.length ? 'Opening pages' : '' });
    starts = [];
    for (let i = 0; i < spaced.length; i += 1) {
      const end = i + 1 < spaced.length ? spaced[i + 1].page - 1 : last;
      const span = end - spaced[i].page + 1;
      if (span <= MAX) { starts.push(spaced[i]); continue; }
      const parts = Math.ceil(span / 10); const each = Math.ceil(span / parts);
      for (let k = 0; k < parts; k += 1) starts.push({ page: spaced[i].page + k * each, title: spaced[i].title, part: k + 1, parts });
    }
  } else starts = [{ page: 1, title: '' }];

  const sections = [];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].page; const to = i + 1 < starts.length ? starts[i + 1].page - 1 : last;
    const own = blocks.filter((b) => b.page >= from && b.page <= to);
    if (!own.some((b) => b.t !== 'pb')) continue;
    let title = starts[i].title;
    if (starts[i].parts > 1) title = `${title || 'Pages'}${title ? ', ' : ' '}${title ? `part ${starts[i].part}` : `${from} to ${to}`}`;
    if (!title) title = starts.length > 1 ? `Pages ${from} to ${to}` : '';
    const text = own.filter((b) => b.x).map((b) => b.x).join('\n');
    sections.push({ title, from, to, blocks: own.map(({ size, ...b }) => b), text, words: text ? text.split(/\s+/).length : 0 });
  }
  return { sections, words: sections.reduce((n, s) => n + s.words, 0), body };
}

/**
 * The catalog a Kiwix file collection carries (database.js), read as data. It is written the way Python prints
 * lists and dicts, with either kind of quote, so it is read by hand: nothing in it is ever run.
 * @returns {Array<{title:string,about:string,author:string,files:string[]}>}
 */
function readCatalog(text) {
  const src = String(text);
  let i = src.indexOf('[');
  if (i < 0) return [];
  const ws = () => { while (i < src.length && /[\s,]/.test(src[i])) i += 1; };
  const str = () => {
    const q = src[i]; i += 1; let out = '';
    while (i < src.length && src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[i + 1]; i += 2;
        if (c === 'n') out += '\n'; else if (c === 't') out += '\t';
        else if (c === 'x') { out += String.fromCharCode(parseInt(src.substr(i, 2), 16) || 32); i += 2; }
        else if (c === 'u') { out += String.fromCharCode(parseInt(src.substr(i, 4), 16) || 32); i += 4; }
        else out += c;
      } else { out += src[i]; i += 1; }
    }
    i += 1;
    return out;
  };
  const value = (depth) => {
    ws();
    if (depth > 6 || i >= src.length) throw new Error('not a catalog');
    const c = src[i];
    if (c === '"' || c === "'") return str();
    if (c === '[') { i += 1; const a = []; for (;;) { ws(); if (i >= src.length) throw new Error('not a catalog'); if (src[i] === ']') { i += 1; return a; } a.push(value(depth + 1)); } }
    if (c === '{') { i += 1; const o = {}; for (;;) { ws(); if (i >= src.length) throw new Error('not a catalog'); if (src[i] === '}') { i += 1; return o; } const k = value(depth + 1); ws(); if (src[i] !== ':') throw new Error('not a catalog'); i += 1; o[String(k)] = value(depth + 1); } }
    const m = /^[A-Za-z0-9_.+-]+/.exec(src.slice(i, i + 40));
    if (!m) throw new Error('not a catalog');
    i += m[0].length;
    return m[0];
  };
  let rows;
  try { rows = value(0); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && typeof r === 'object' && Array.isArray(r.fp)).map((r) => ({
    title: tidy(r.ti || ''), about: tidy(r.dsc || ''), author: tidy(r.aut || ''),
    files: r.fp.map(String).filter((f) => /\.pdf$/i.test(f) && !/[\\]|\.\.|^\//.test(f)),
  })).filter((r) => r.files.length);
}

module.exports = { build, readCatalog, calm };
