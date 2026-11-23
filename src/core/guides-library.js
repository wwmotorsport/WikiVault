'use strict';
// The Survival Guides library: collections of PDF guides that the Kiwix project publishes as .zim files, fetched
// and converted on this computer into articles (text that can be searched and read by Ask, with the pictures of each
// page beside it). This module fetches a collection, takes the PDFs out of it, has each converted, and keeps the
// result; src/core/guides-engine.js serves it to the reader.

const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { fetchText } = require('./httpx');
const { downloadFile } = require('./downloader');
const { sha256File } = require('./verify');
const catalog = require('./catalog');
const { Engine } = require('./engine');
const { GuidesEngine } = require('./guides-engine');
const { build, readCatalog } = require('./guide-build');

const MADE = 2; // the version of the conversion (2: scanned pages are read for their words); a collection made by an older one can be brought up to date
const OWN = 'mine'; // the collection of the user's own books

// The collections offered. `prefix` is how the file is named on the Kiwix server, before its date.
const COLLECTIONS = [
  { id: 'water', prefix: 'zimgit-water_en_', name: 'Water', about: 'Finding water, making it safe to drink, and storing it.', approxBytes: 16e6 },
  { id: 'medicine', prefix: 'zimgit-medicine_en_', name: 'First aid and medicine', about: 'First aid, field medicine and care when no doctor can be reached.', approxBytes: 65e6, caution: true },
  { id: 'food', prefix: 'zimgit-food-preparation_en_', name: 'Food', about: 'Preparing, cooking and preserving food, with and without power.', approxBytes: 93e6 },
  { id: 'knots', prefix: 'zimgit-knots_en_', name: 'Knots', about: 'Knots, hitches and lashings, and what each is for.', approxBytes: 23e6 },
  { id: 'disaster', prefix: 'zimgit-post-disaster_en_', name: 'After a disaster', about: 'Shelter, sanitation, power, repairs and getting by after a disaster. The largest collection.', approxBytes: 615e6, caution: true },
];

/** A guide made before scanned pages were read, most of whose pages have no words: worth converting afresh. */
const needsReading = (g) => g.read == null && g.pages > 0 && g.words < g.pages * 25;

async function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(p);
    else { try { total += (await fsp.stat(p)).size; } catch { /* gone */ } }
  }
  return total;
}

/** Open a collection file with the reader engine and hand back its list of documents and a way to save each. */
async function readZimWithEngine(zimPath, { binPath, log }) {
  const engine = new Engine({ binPath, log });
  await engine.start(zimPath, { threads: 2, readyTimeoutMs: 90000 });
  const base = engine.contentBase();
  const { text } = await fetchText(`${base}/database.js`, { timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 });
  return {
    catalog: readCatalog(text),
    save: (file, dest, signal) => downloadFile({ url: `${base}/files/${encodeURIComponent(file)}`, dest, signal, stallMs: 30000, maxStalledAttempts: 2 }),
    close: () => engine.stop(),
  };
}

class GuidesLibrary extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir                 the folder the library keeps everything in
   * @param {() => object} o.getSettings   { baseUrl }
   * @param {() => Promise<string|null>} o.engineBin  where the reader engine (kiwix-serve) is, or null
   * @param {(pdf:string, o:{onPage:Function, signal:AbortSignal}) => Promise<{pages:number, outline:Array}>} o.convert
   */
  constructor({ dir, getSettings = () => ({}), engineBin = async () => null, convert, recognise = null, readZim = readZimWithEngine, download = downloadFile, log = () => {} }) {
    super();
    this.recognise = recognise; // (picture bytes) => paragraphs of text, for scanned pages; null when there is no reader
    this.dir = dir; this.getSettings = getSettings; this.engineBin = engineBin; this.convert = convert; this.readZim = readZim; this.download = download; this.log = log;
    this.engine = new GuidesEngine({ dir, log });
    this.jobs = new Map();   // id -> { phase, progress, error, abort }
    this.latest = {};        // id -> { file, date, bytes, url }
    this.queue = Promise.resolve();
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    await this.engine.start();
    return this;
  }

  async close() { for (const j of this.jobs.values()) j.abort?.abort(); await this.engine.stop(); }

  status() {
    const have = new Map(this.engine.cols.map((c) => [c.id, c]));
    return {
      ready: this.engine.running,
      articles: this.engine.docs.length,
      bytes: this.engine.cols.reduce((n, c) => n + (c.bytes || 0), 0),
      busy: [...this.jobs.values()].some((j) => j.phase !== 'idle'),
      own: (() => { const h = have.get(OWN); const j = this.jobs.get(OWN); return { books: h ? h.guides.map((g) => ({ id: g.id, title: g.title, pages: g.pages, articles: g.sections.length, words: g.words })) : [], bytes: h ? h.bytes || 0 : 0, phase: j ? j.phase : 'idle', progress: j ? j.progress : null, error: j ? j.error : null }; })(),
      collections: COLLECTIONS.map((c) => {
        const h = have.get(c.id); const j = this.jobs.get(c.id);
        return {
          id: c.id, name: c.name, about: c.about, caution: Boolean(c.caution), approxBytes: c.approxBytes,
          have: h ? { date: h.date, guides: h.guides.length, articles: h.guides.reduce((n, g) => n + g.sections.length, 0), bytes: h.bytes || 0, skipped: h.skipped || 0, old: (h.made || 1) < MADE && h.guides.some(needsReading) } : null,
          phase: j ? j.phase : 'idle', progress: j ? j.progress : null, error: j ? j.error : null,
          latest: this.latest[c.id] || null,
        };
      }),
    };
  }

  /** The newest file of a collection on the Kiwix server, and its size. */
  async info(id, { signal } = {}) {
    const c = COLLECTIONS.find((x) => x.id === id);
    if (!c) throw new Error('Unknown collection.');
    const base = String(this.getSettings().baseUrl || 'https://download.kiwix.org').replace(/\/+$/, '');
    const dirUrl = `${base}/zim/other/`;
    const { text } = await fetchText(dirUrl, { signal, timeoutMs: 45000 });
    const found = catalog.parseEditions(text, c.prefix);
    if (!found.length) throw new Error(`The collection "${c.name}" was not found on the Kiwix server.`);
    const url = dirUrl + found[0].file;
    const bytes = await catalog.fetchRemoteSize(url, { signal }).catch(() => null);
    this.latest[id] = { file: found[0].file, date: found[0].date, bytes: bytes || null, url };
    return this.latest[id];
  }

  /** Fetch a collection and convert it. Collections are done one at a time; the call returns when this one is queued. */
  add(id) {
    const c = COLLECTIONS.find((x) => x.id === id);
    if (!c) throw new Error('Unknown collection.');
    const now = this.jobs.get(id);
    if (now && now.phase !== 'idle') return false;
    const job = { phase: 'waiting', progress: null, error: null, abort: new AbortController() };
    this.jobs.set(id, job);
    this.emit('change');
    this.queue = this.queue.then(() => this.run(c, job)).catch(() => {});
    return true;
  }

  cancel(id) { const j = this.jobs.get(id); if (j && j.phase !== 'idle') { j.cancelled = true; j.abort.abort(); } return true; }

  async remove(id) {
    if (!COLLECTIONS.some((x) => x.id === id)) throw new Error('Unknown collection.');
    this.cancel(id);
    await this.queue;
    await fsp.rm(path.join(this.dir, id), { recursive: true, force: true });
    this.jobs.delete(id);
    await this.engine.reload();
    this.log(`guides: ${id} removed`);
    this.emit('change');
    return true;
  }

  /** Start a job of another kind (bringing a collection up to date, adding the user's own books) in the same queue. */
  start(id, work) {
    const now = this.jobs.get(id);
    if (now && now.phase !== 'idle') return false;
    const job = { phase: 'waiting', progress: null, error: null, abort: new AbortController() };
    this.jobs.set(id, job);
    this.emit('change');
    this.queue = this.queue.then(async () => {
      try { await work(job); job.error = null; } catch (err) {
        const cancelled = err.name === 'AbortError' || job.abort.signal.aborted;
        job.error = cancelled ? null : err.message;
        this.log(`guides: ${id}: ${cancelled ? 'cancelled' : `failed: ${err.message}`}`);
      }
      job.phase = 'idle'; job.progress = null;
      await this.engine.reload().catch(() => {});
      this.emit('change');
    }).catch(() => {});
    return true;
  }

  async saveCollection(colDir, col) {
    col.bytes = await dirBytes(colDir);
    await fsp.writeFile(path.join(colDir, 'collection.json'), JSON.stringify(col));
  }

  /**
   * Bring a collection made by an older version up to date without fetching it again: the guides whose scanned
   * pages have no words are converted afresh from the PDFs that were kept, this time with their words read.
   */
  improve(id) {
    if (!COLLECTIONS.some((x) => x.id === id) && id !== OWN) throw new Error('Unknown collection.');
    return this.start(id, async (job) => {
      const colDir = path.join(this.dir, id);
      const col = JSON.parse(await fsp.readFile(path.join(colDir, 'collection.json'), 'utf8'));
      const todo = col.guides.filter(needsReading);
      for (const [i, g] of todo.entries()) {
        if (job.abort.signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
        job.phase = 'converting'; job.progress = { done: i, total: todo.length, title: g.title, page: 0, pages: g.pages }; this.emit('change');
        const fresh = path.join(colDir, `${g.id}.new`);
        const from = { save: (_file, dest) => fsp.copyFile(path.join(colDir, g.id, 'original.pdf'), dest) };
        try {
          const meta = await this.convertGuide(g.id, fresh, { file: 'original.pdf', title: g.title, about: g.about, author: g.author }, from, job.abort.signal, (page, pages) => { job.progress = { done: i, total: todo.length, title: g.title, page, pages }; this.emit('progress'); });
          await fsp.rm(path.join(colDir, g.id), { recursive: true, force: true });
          await fsp.rename(fresh, path.join(colDir, g.id));
          col.guides[col.guides.indexOf(g)] = meta;
        } catch (err) {
          await fsp.rm(fresh, { recursive: true, force: true }).catch(() => {});
          if (err.name === 'AbortError' || job.abort.signal.aborted) throw err;
          this.log(`guides: ${id}: "${g.title}" was left as it was: ${err.message}`);
        }
      }
      col.made = MADE;
      await this.saveCollection(colDir, col);
      this.log(`guides: ${id}: brought up to date, ${todo.length} guides converted afresh`);
    });
  }

  /**
   * Add the user's own books: PDF files (scanned or not) that become guides of the collection "My books".
   * @param {Array<{file:string,title:string,temp?:boolean}>} books  `temp`: the file was made for this and is removed after
   */
  addOwn(books) {
    const list = (books || []).filter((b) => b && b.file);
    if (!list.length) return false;
    const colDir = path.join(this.dir, OWN);
    const now = this.jobs.get(OWN);
    // Books chosen while others are being converted join the same run.
    if (now && now.phase !== 'idle' && now.more) { now.more.push(...list); return true; }
    const more = list.slice();
    const started = this.start(OWN, async (job) => {
      job.more = more;
      await fsp.mkdir(colDir, { recursive: true });
      let col = null;
      try { col = JSON.parse(await fsp.readFile(path.join(colDir, 'collection.json'), 'utf8')); } catch { col = null; }
      if (!col) col = { id: OWN, name: 'My books', about: 'Books and documents you added yourself.', caution: false, own: true, made: MADE, date: null, guides: [], bytes: 0 };
      let done = 0; const failed = [];
      while (job.more.length) {
        const b = job.more.shift();
        if (job.abort.signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
        const next = Math.max(0, ...col.guides.map((g) => Number(g.id.slice(1)) || 0), ...(await fsp.readdir(colDir).catch(() => [])).map((n) => Number((/^g(\d+)/.exec(n) || [])[1]) || 0)) + 1;
        const gid = `g${String(next).padStart(3, '0')}`;
        const title = String(b.title || path.basename(b.file).replace(/\.pdf$/i, '')).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Untitled';
        job.phase = 'converting'; job.progress = { done, total: done + 1 + job.more.length, title, page: 0, pages: 0 }; this.emit('change');
        try {
          const meta = await this.convertGuide(gid, path.join(colDir, gid), { file: b.file, title, about: '', author: '' }, { save: (file, dest) => fsp.copyFile(file, dest) }, job.abort.signal, (page, pages) => { job.progress = { done, total: done + 1 + job.more.length, title, page, pages }; this.emit('progress'); });
          col.guides.push(meta);
          await this.saveCollection(colDir, col);
          await this.engine.reload();
          this.log(`guides: a book was added: ${meta.pages} pages, ${meta.sections.length} articles${meta.read ? `, ${meta.read} pages read from scans` : ''}`);
        } catch (err) {
          await fsp.rm(path.join(colDir, gid), { recursive: true, force: true }).catch(() => {});
          if (err.name === 'AbortError' || job.abort.signal.aborted) { if (b.temp) await fsp.rm(b.file, { force: true }).catch(() => {}); throw err; }
          failed.push(`"${title}" (${err.message})`);
        }
        if (b.temp) await fsp.rm(b.file, { force: true }).catch(() => {});
        done += 1; this.emit('change');
      }
      if (!col.guides.length) await fsp.rm(colDir, { recursive: true, force: true }).catch(() => {});
      if (failed.length) throw new Error(`${failed.length === 1 ? 'One book' : `${failed.length} books`} could not be added: ${failed.join('; ')}`);
    });
    if (started) this.jobs.get(OWN).more = more; // so that books chosen before the run begins join it too
    return started;
  }

  /** Remove one of the user's own books. */
  async removeOwn(gid) {
    if (!/^g\d{3,5}$/.test(String(gid))) throw new Error('Unknown book.');
    await this.queue;
    const colDir = path.join(this.dir, OWN);
    let col = null;
    try { col = JSON.parse(await fsp.readFile(path.join(colDir, 'collection.json'), 'utf8')); } catch { return false; }
    col.guides = col.guides.filter((g) => g.id !== gid);
    await fsp.rm(path.join(colDir, gid), { recursive: true, force: true });
    if (col.guides.length) await this.saveCollection(colDir, col); else await fsp.rm(colDir, { recursive: true, force: true });
    await this.engine.reload();
    this.emit('change');
    return true;
  }

  async run(c, job) {
    const signal = job.abort.signal;
    const set = (phase, progress = null) => { job.phase = phase; job.progress = progress; this.emit('change'); };
    const stopIf = () => { if (signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; } };
    const colDir = path.join(this.dir, c.id);
    const zimDir = path.join(this.dir, 'incoming');
    let zim = null; let source = null;
    try {
      stopIf();
      set('checking');
      const bin = await this.engineBin();
      if (!bin) throw new Error('The reader engine is not installed yet. Set up Wikipedia first; the guides are read with the same engine.');
      const latest = await this.info(c.id, { signal });
      zim = path.join(zimDir, latest.file);
      set('downloading', { received: 0, total: latest.bytes });
      await this.download({ url: latest.url, dest: zim, expectedSize: latest.bytes, signal, onProgress: (p) => { job.progress = { received: p.downloaded, total: p.total || latest.bytes, bytesPerSec: p.bytesPerSec }; this.emit('progress'); } });
      stopIf();
      const want = await catalog.fetchPublishedSha256(latest.url, { signal }).catch(() => null);
      if (want) {
        set('verifying');
        const got = await sha256File(zim, { signal });
        if (got !== want) { await fsp.rm(zim, { force: true }); throw new Error('The download did not match its published checksum. It was removed; try again.'); }
      }
      this.log(`guides: ${c.id}: ${latest.file} fetched${want ? ' and checked' : ' (no checksum was published)'}`);

      set('reading');
      source = await this.readZim(zim, { binPath: bin, log: this.log });
      const docs = [];
      for (const row of source.catalog) row.files.forEach((file, k) => docs.push({ file, title: row.files.length > 1 ? `${row.title || file}, part ${k + 1}` : (row.title || file.replace(/\.pdf$/i, '')), about: row.about, author: row.author }));
      if (!docs.length) throw new Error('The collection has no documents that can be read.');
      // A collection begun before (the app was closed, or it was cancelled) is carried on from where it stopped,
      // when it is the same file; otherwise it is begun afresh.
      let begun = null;
      try { begun = JSON.parse(await fsp.readFile(path.join(colDir, 'begun.json'), 'utf8')); } catch { begun = null; }
      if (!begun || begun.file !== latest.file || begun.made !== MADE) await fsp.rm(colDir, { recursive: true, force: true });
      await fsp.mkdir(colDir, { recursive: true });
      await fsp.rm(path.join(colDir, 'collection.json'), { force: true });
      await fsp.writeFile(path.join(colDir, 'begun.json'), JSON.stringify({ file: latest.file, made: MADE }));

      const guides = []; let skipped = 0;
      for (const [i, d] of docs.entries()) {
        stopIf();
        const gid = `g${String(i + 1).padStart(3, '0')}`;
        const gDir = path.join(colDir, gid);
        set('converting', { done: i, total: docs.length, title: d.title, page: 0, pages: 0 });
        let meta = null;
        try { meta = JSON.parse(await fsp.readFile(path.join(gDir, 'guide.json'), 'utf8')); } catch { meta = null; }
        if (!meta) {
          try { meta = await this.convertGuide(gid, gDir, d, source, signal, (page, pages) => { job.progress = { done: i, total: docs.length, title: d.title, page, pages }; this.emit('progress'); }); }
          catch (err) {
            if (err.name === 'AbortError' || signal.aborted) throw err;
            skipped += 1;
            this.log(`guides: ${c.id}: "${d.title}" could not be converted and was left out: ${err.message}`);
            await fsp.rm(gDir, { recursive: true, force: true });
            continue;
          }
        }
        guides.push(meta);
      }
      if (!guides.length) throw new Error('None of the documents in the collection could be converted.');
      await source.close(); source = null;
      await fsp.rm(zim, { force: true });
      const col = { id: c.id, name: c.name, about: c.about, caution: Boolean(c.caution), file: latest.file, date: latest.date, made: MADE, skipped, guides, bytes: 0 };
      col.bytes = await dirBytes(colDir);
      await fsp.writeFile(path.join(colDir, 'collection.json'), JSON.stringify(col));
      await fsp.rm(path.join(colDir, 'begun.json'), { force: true });
      await this.engine.reload();
      this.log(`guides: ${c.id}: ${guides.length} guides, ${guides.reduce((n, g) => n + g.sections.length, 0)} articles${skipped ? `, ${skipped} left out` : ''}, ${Math.round(col.bytes / 1e6)} MB`);
      job.phase = 'idle'; job.progress = null; job.error = null;
    } catch (err) {
      job.phase = 'idle'; job.progress = null;
      const cancelled = err.name === 'AbortError' || signal.aborted;
      job.error = cancelled ? null : err.message;
      this.log(`guides: ${c.id}: ${cancelled ? 'cancelled' : `failed: ${err.message}`}`);
      if (job.cancelled) { await fsp.rm(colDir, { recursive: true, force: true }).catch(() => {}); if (zim) await fsp.rm(zim, { force: true }).catch(() => {}); }
    } finally {
      if (source) await source.close().catch(() => {});
      this.emit('change');
    }
  }

  /** One document: its PDF taken out of the collection, read page by page, and written as articles and pictures. */
  async convertGuide(gid, gDir, d, source, signal, onProgress) {
    await fsp.rm(gDir, { recursive: true, force: true });
    await fsp.mkdir(path.join(gDir, 'i'), { recursive: true });
    const pdf = path.join(gDir, 'original.pdf');
    await source.save(d.file, pdf, signal);
    const pages = [];
    const notes = [];
    let readPages = 0; let blank = 0;
    const result = await this.convert(pdf, {
      signal, ocr: Boolean(this.recognise),
      onPage: async (p) => {
        for (const img of p.images || []) {
          if (!/^p\d{4}(?:-\d{1,3})?\.webp$/.test(img.name)) continue;
          await fsp.writeFile(path.join(gDir, 'i', img.name), Buffer.from(img.bytes));
        }
        if (p.note) notes.push(p.note);
        let paras = p.paras || [];
        // A scanned page with no words behind it: its picture is read for them.
        if (p.ocr && this.recognise) {
          try { const read = await this.recognise(p.ocr); if (read.length) { paras = read.map((text) => ({ text })); readPages += 1; } }
          catch (err) { notes.push(`page ${p.n} could not be read for its words (${err.message})`); }
        }
        if (p.whole && !paras.some((b) => b.text)) blank += 1;
        pages.push({ n: p.n, w: p.w, h: p.h, whole: Boolean(p.whole), paras, figs: p.figs || [], img: p.img || null });
        onProgress(p.n, p.total);
      },
    });
    if (!pages.length) throw new Error(result && result.error ? result.error : 'it has no pages that could be read');
    pages.sort((a, b) => a.n - b.n);
    const made = build({ title: d.title }, pages, (result && result.outline) || []);
    if (!made.sections.length) throw new Error('nothing readable was found in it');
    for (const [i, s] of made.sections.entries()) await fsp.writeFile(path.join(gDir, `s${i + 1}.json`), JSON.stringify({ title: s.title, from: s.from, to: s.to, blocks: s.blocks }));
    await fsp.writeFile(path.join(gDir, 'text.json'), JSON.stringify(made.sections.map((s) => s.text)));
    const meta = { id: gid, title: d.title, about: d.about || '', author: d.author || '', pages: pages.length, words: made.words, read: readPages, blank, sections: made.sections.map((s) => ({ title: s.title, from: s.from, to: s.to, words: s.words })) };
    await fsp.writeFile(path.join(gDir, 'guide.json'), JSON.stringify(meta));
    if (notes.length) this.log(`guides: "${d.title}": ${notes.length} pages with trouble (${notes[0]})`);
    if (readPages) this.log(`guides: "${d.title}": the words of ${readPages} scanned pages were read`);
    return meta;
  }
}

module.exports = { GuidesLibrary, COLLECTIONS, MADE, OWN, readZimWithEngine };
