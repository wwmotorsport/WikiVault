'use strict';
// The reader engine of the Survival Guides library. It stands where kiwix-serve stands for the other libraries and
// answers the same questions (a page, title suggestions, a search of the full text), so the reader, the search box,
// Ask and wiki golf treat it like any other library. The guides are files on disk, made by the converter.

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { fetchText } = require('./httpx');
const html = require('./guide-html');

const NAME = 'guides';
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'do', 'does', 'how', 'what', 'i', 'my', 'it', 'be', 'with', 'from', 'at', 'by', 'can', 'you']);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The words of a search, as the beginnings of words to look for: "filtering water" finds "filter", "filters", "filtered". */
function terms(query) {
  const all = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const kept = all.filter((w) => !STOP.has(w));
  return [...new Set(kept.length ? kept : all)].map((w) => (w.length > 5 ? w.replace(/(?:ing|ed|es|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w));
}

class GuidesEngine extends EventEmitter {
  constructor({ dir, log = () => {} }) {
    super();
    this.dir = dir; this.log = log;
    this.server = null; this.port = null;
    this.zimName = NAME;
    this.cols = [];   // collections as read from disk
    this.docs = [];   // every article: { path, title, lower, col, guide, n, words }
    this.info = { title: 'Survival Guides', articleCount: 0, issued: null, language: 'eng' };
    this.stopping = false;
  }

  get running() { return Boolean(this.server && this.port && this.docs.length); }
  get origin() { return `http://127.0.0.1:${this.port}`; }
  contentBase() { return `${this.origin}/content/${NAME}`; }
  homeUrl() { return `${this.contentBase()}/`; }
  randomUrl() { return `${this.origin}/random?content=${NAME}`; }
  urlForPath(p) { return `${this.contentBase()}/${String(p).split('/').map(encodeURIComponent).join('/')}`; }
  pathForUrl(url) {
    try {
      const u = new URL(url, this.origin);
      const prefix = `/content/${NAME}/`;
      if (u.origin !== this.origin || !u.pathname.startsWith(prefix)) return null;
      return decodeURIComponent(u.pathname.slice(prefix.length));
    } catch { return null; }
  }

  /** Read what is on disk: every collection that was converted in full, and the text of its articles. */
  async reload() {
    const cols = []; const docs = [];
    let names = [];
    try { names = (await fsp.readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory() && SAFE.test(e.name)).map((e) => e.name).sort(); } catch { names = []; }
    for (const id of names) {
      let col;
      try { col = JSON.parse(await fsp.readFile(path.join(this.dir, id, 'collection.json'), 'utf8')); } catch { continue; }
      if (!col || col.id !== id || !Array.isArray(col.guides)) continue;
      for (const g of col.guides) {
        let texts = [];
        try { texts = JSON.parse(await fsp.readFile(path.join(this.dir, id, g.id, 'text.json'), 'utf8')); } catch { texts = []; }
        g.sections.forEach((s, i) => {
          const title = html.articleTitle(g, s);
          docs.push({ path: `${id}/${g.id}/${i + 1}`, title, titleLower: title.toLowerCase(), text: texts[i] || '', lower: (texts[i] || '').toLowerCase(), col, guide: g, n: i + 1, words: s.words || 0 });
        });
      }
      cols.push(col);
    }
    this.cols = cols; this.docs = docs;
    this.info = { title: 'Survival Guides', articleCount: docs.length, issued: cols.map((c) => c.date).filter(Boolean).sort().pop() || null, language: 'eng' };
    return this;
  }

  async start() {
    await this.reload();
    if (this.server) return this;
    const server = http.createServer((req, res) => { this.answer(req, res).catch(() => { try { res.writeHead(500).end(); } catch { /* gone */ } }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    this.server = server; this.port = server.address().port;
    this.log(`guides: serving ${this.docs.length} articles from ${this.cols.length} collections on ${this.origin}`);
    return this;
  }

  async stop() {
    const s = this.server; this.server = null; this.port = null;
    if (s) await new Promise((r) => { s.close(() => r()); s.closeAllConnections?.(); });
  }

  find(colId, guideId) {
    const col = this.cols.find((c) => c.id === colId);
    const guide = col && col.guides.find((g) => g.id === guideId);
    return guide ? { col, guide } : null;
  }

  async answer(req, res) {
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...extra }); res.end(req.method === 'HEAD' ? undefined : body); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, 'text/plain', 'No'); return; }
    const u = new URL(req.url, 'http://x');
    let pathname;
    try { pathname = decodeURIComponent(u.pathname); } catch { send(400, 'text/plain', 'Bad address'); return; }
    const base = this.contentBase();
    const page = (body) => send(200, 'text/html; charset=utf-8', body, { 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-src 'self'" });
    if (pathname === '/random') {
      const d = this.docs[Math.floor(Math.random() * this.docs.length)];
      res.writeHead(302, { location: d ? this.urlForPath(d.path) : this.homeUrl() }).end(); return;
    }
    if (pathname === '/' || pathname === `/content/${NAME}`) { res.writeHead(302, { location: this.homeUrl() }).end(); return; }
    if (!pathname.startsWith(`/content/${NAME}/`)) { send(404, 'text/plain', 'Not here'); return; }
    const parts = pathname.slice(`/content/${NAME}/`.length).split('/');
    if (parts.length === 1 && parts[0] === '') { page(html.home({ base, cols: this.cols })); return; }
    if (!parts.every((p, i) => (i === parts.length - 1 && p === '') || SAFE.test(p))) { send(404, 'text/plain', 'Not here'); return; }
    const found = this.find(parts[0], parts[1]);
    if (!found) { send(404, 'text/html; charset=utf-8', '<!DOCTYPE html><title>Not found</title><p>That guide is not in the library.</p>'); return; }
    const { col, guide } = found;
    const dir = path.join(this.dir, col.id, guide.id);
    const rest = parts.slice(2);
    if (rest.length === 0 || (rest.length === 1 && rest[0] === '')) {
      if (rest.length === 0) { res.writeHead(302, { location: `${base}/${col.id}/${guide.id}/` }).end(); return; }
      if (guide.sections.length === 1) { res.writeHead(302, { location: `${base}/${col.id}/${guide.id}/1` }).end(); return; }
      page(html.contents({ base, col, guide })); return;
    }
    let file = null;
    if (rest.length === 1 && /^\d{1,4}$/.test(rest[0])) {
      const n = Number(rest[0]);
      if (n < 1 || n > guide.sections.length) { send(404, 'text/plain', 'Not here'); return; }
      const section = JSON.parse(await fsp.readFile(path.join(dir, `s${n}.json`), 'utf8'));
      page(html.article({ base, col, guide, n, section })); return;
    }
    if (rest.length === 1 && rest[0] === 'original.pdf') file = path.join(dir, 'original.pdf');
    else if (rest.length === 2 && rest[0] === 'i' && TYPES[path.extname(rest[1])]) file = path.join(dir, 'i', rest[1]);
    let size = 0;
    try { size = file ? (await fsp.stat(file)).size : 0; } catch { size = 0; }
    if (!size) { send(404, 'text/plain', 'Not here'); return; }
    const head = { 'content-type': TYPES[path.extname(file)], 'accept-ranges': 'bytes', 'cache-control': 'max-age=3600', 'x-content-type-options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0; let end = size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else start = Math.max(0, size - Number(range[2]));
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    } else res.writeHead(200, { ...head, 'content-length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  async suggest(term, count = 8) {
    const want = terms(term);
    if (!want.length) return [];
    const res = want.map((w) => new RegExp(`\\b${escRe(w)}`));
    const whole = String(term || '').trim().toLowerCase();
    return this.docs.filter((d) => res.every((r) => r.test(d.titleLower)))
      .map((d) => ({ d, rank: d.titleLower === whole ? 0 : d.titleLower.startsWith(whole) ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank || a.d.title.length - b.d.title.length).slice(0, count)
      .map(({ d }) => ({ title: d.title, path: d.path, url: this.urlForPath(d.path) }));
  }

  /** Every word of the search has to be in the article (in its title or its text); the best matches come first. */
  async search(pattern, { start = 0, pageLength = 20 } = {}) {
    const want = terms(pattern);
    if (!want.length) return { total: 0, items: [] };
    const res = want.map((w) => new RegExp(`\\b${escRe(w)}`, 'g'));
    const hits = [];
    for (const d of this.docs) {
      let score = 0; let ok = true;
      for (const r of res) {
        r.lastIndex = 0; let n = 0;
        while (n < 24 && r.exec(d.lower)) n += 1;
        r.lastIndex = 0; const inTitle = r.test(d.titleLower);
        if (!n && !inTitle) { ok = false; break; }
        // How much of the article is about the word, not how long the article is.
        score += Math.log(1 + n) / Math.log(2 + d.words / 600) + (inTitle ? 4 : 0);
      }
      if (ok) hits.push({ d, score });
    }
    hits.sort((a, b) => b.score - a.score);
    const items = hits.slice(start, start + pageLength).map(({ d }) => {
      const url = this.urlForPath(d.path);
      return { title: d.title, link: url, url, path: d.path, words: d.words, snippet: this.snippet(d, want) };
    });
    return { total: hits.length, items };
  }

  snippet(d, want) {
    const all = new RegExp(`\\b(?:${want.map(escRe).join('|')})[a-z0-9]*`, 'gi');
    const first = d.text.search(all);
    if (first < 0) return [{ text: d.text.slice(0, 220).replace(/\s+/g, ' '), hit: false }];
    const from = Math.max(0, first - 90);
    const piece = `${from > 0 ? '… ' : ''}${d.text.slice(from, first + 230).replace(/\s+/g, ' ')}${first + 230 < d.text.length ? ' …' : ''}`;
    const out = []; let at = 0; let m;
    all.lastIndex = 0;
    while ((m = all.exec(piece))) { if (m.index > at) out.push({ text: piece.slice(at, m.index), hit: false }); out.push({ text: m[0], hit: true }); at = m.index + m[0].length; }
    if (at < piece.length) out.push({ text: piece.slice(at), hit: false });
    return out;
  }

  async fetchHtml(url, { signal } = {}) {
    const abs = new URL(url, this.origin).toString();
    if (!abs.startsWith(`${this.origin}/`)) throw new Error('Not a page in the offline copy');
    return fetchText(abs, { signal, timeoutMs: 30000, maxBytes: 24 * 1024 * 1024 });
  }
}

module.exports = { GuidesEngine, terms, NAME };
