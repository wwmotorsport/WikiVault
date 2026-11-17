'use strict';
// The curriculum files on disk: downloading them from the publisher, reading their text into a
// search index, remembering what has been done, and holding books the user adds themselves.
//
//   <dir>/g5/<subject>/<file name>      the publisher's files, as downloaded
//   <dir>/g5/added/<file name>          PDFs the user added (bought or made)
//   <dir>/index/g5/<file id>.json       the text of each page, plain, for search and for finding pages
//   <dir>/progress-g5.json              days ticked off, units skipped, books owned

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { downloadFile } = require('./downloader');
const school = require('./school');

const INDEX_VERSION = 1;
const exists = (f) => fsp.access(f).then(() => true, () => false);
const slug = (name) => name.replace(/\.[a-z0-9]+$/i, '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

class SchoolLibrary extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir                      the school folder inside the library
   * @param {object} o.manifest                 from school.loadManifest
   * @param {(file:string, onPage:Function)=>Promise<string[]>} o.extract  reads a PDF's pages
   * @param {(url:string)=>string} [o.rewrite]  lets tests fetch from a stand-in server
   * @param {Function} [o.download]
   * @param {(m:string)=>void} [o.log]
   */
  constructor({ dir, manifest, extract, rewrite = (u) => u, download = downloadFile, log = () => {} }) {
    super();
    Object.assign(this, { dir, manifest, extract, rewrite, download, log });
    this.grade = `g${manifest.grade}`;
    this.files = school.allFiles(manifest);
    this.byId = new Map(this.files.map((f) => [f.id, f]));
    this.cache = new Map();     // file id -> page texts
    this.job = null;            // { kind: 'download'|'index', done, total, bytes, current, controller }
    this.error = null;
    this.progress = { done: {}, skip: [], have: [] };
    this.added = [];
    this.have = new Map();      // file id -> bytes on disk
    this.indexed = new Set();
    this.year = null;
  }

  pathOf(f) { return path.join(this.dir, this.grade, f.added ? 'added' : f.subject, f.name); }
  indexPath(id) { return path.join(this.dir, 'index', this.grade, `${id}.json`); }
  get progressFile() { return path.join(this.dir, `progress-${this.grade}.json`); }
  everyFile() { return [...this.files, ...this.added]; }
  fileById(id) { return this.byId.get(id) || this.added.find((f) => f.id === id) || null; }

  /** Look at the disk: which files are here, which are indexed, what has been ticked off. */
  async init() {
    try { this.progress = { done: {}, skip: [], have: [], ...JSON.parse(await fsp.readFile(this.progressFile, 'utf8')) }; } catch { /* nothing saved yet */ }
    this.added = [];
    const addedDir = path.join(this.dir, this.grade, 'added');
    for (const name of await fsp.readdir(addedDir).catch(() => [])) {
      if (!/\.pdf$/i.test(name)) continue;
      this.added.push({ id: `added-${slug(name)}`, name, label: name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '), role: 'added', subject: 'added', subjectName: 'Books I have added', where: 'Added by you', units: [], added: true });
    }
    this.have.clear();
    this.indexed.clear();
    for (const f of this.everyFile()) {
      const st = await fsp.stat(this.pathOf(f)).catch(() => null);
      if (st?.isFile() && st.size > 0) this.have.set(f.id, st.size);
      if (this.have.has(f.id) && await exists(this.indexPath(f.id))) this.indexed.add(f.id);
    }
    this.year = school.buildYear(this.manifest, { skip: this.progress.skip });
    return this.status();
  }

  status() {
    const j = this.job;
    const total = this.year ? this.year.totals.reduce((n, t) => n + t.sessions, 0) : 0;
    const done = this.year ? this.year.weeks.reduce((n, w) => n + w.days.flat().filter((x) => this.progress.done[x.id]).length, 0) : 0;
    return {
      grade: this.manifest.grade, title: this.manifest.title, publisher: this.manifest.publisher, credit: this.manifest.credit,
      files: this.files.length, have: this.files.filter((f) => this.have.has(f.id)).length,
      bytes: [...this.have.values()].reduce((n, b) => n + b, 0),
      indexed: this.everyFile().filter((f) => this.indexed.has(f.id)).length, added: this.added.length,
      job: j ? { kind: j.kind, done: j.done, total: j.total, bytes: j.bytes, current: j.current } : null,
      error: this.error, sessions: total, sessionsDone: done, currentWeek: this.currentWeek(),
    };
  }

  /** The week of the first day not ticked off. */
  currentWeek() {
    if (!this.year) return 1;
    for (const w of this.year.weeks) if (w.days.flat().some((x) => !this.progress.done[x.id])) return w.number;
    return this.year.weeks.length;
  }

  _tick() { this.emit('change', this.status()); }

  // ---- downloading

  cancel() { this.job?.controller.abort(); }

  /** Fetch every file that is not here yet, two at a time, then read the new ones into the index. */
  async downloadAll() {
    if (this.job) throw new Error('The school files are already being worked on.');
    const todo = this.files.filter((f) => !this.have.has(f.id));
    const controller = new AbortController();
    this.job = { kind: 'download', done: 0, total: todo.length, bytes: 0, current: '', controller };
    this.error = null;
    this._tick();
    const failed = [];
    const queue = todo.slice();
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        if (controller.signal.aborted) return;
        const dest = this.pathOf(f);
        const part = `${dest}.part`;
        this.job.current = f.label === f.name ? f.name : `${f.subjectName}: ${f.where}, ${f.label}`;
        this._tick();
        try {
          let seen = 0;
          const get = (url) => this.download({
            url: this.rewrite(new URL(url).href), dest: part, signal: controller.signal, maxStalledAttempts: 4,
            onProgress: (p) => { this.job.bytes += Math.max(0, p.downloaded - seen); seen = p.downloaded; },
          });
          // A name with an accent can be stored two ways ("ü", or "u" and a mark). Try the other spelling before giving up.
          const other = f.url.normalize('NFD') !== f.url ? f.url.normalize('NFD') : f.url.normalize('NFC');
          try { await get(f.url); } catch (err) {
            if (controller.signal.aborted || other === f.url) throw err;
            await fsp.rm(part, { force: true }).catch(() => {});
            this.job.bytes -= seen; seen = 0;
            await get(other);
          }
          const fd = await fsp.open(part, 'r');
          const head = Buffer.alloc(5);
          await fd.read(head, 0, 5, 0);
          await fd.close();
          if (head.toString('latin1') !== '%PDF-') throw new Error('what arrived is not a PDF');
          await fsp.rename(part, dest);
          this.have.set(f.id, (await fsp.stat(dest)).size);
        } catch (err) {
          if (controller.signal.aborted) return;
          await fsp.rm(part, { force: true }).catch(() => {});
          failed.push(f.name);
          this.log(`school: ${f.name}: ${err.message}`);
        }
        this.job.done += 1;
        this._tick();
      }
    };
    await Promise.all([worker(), worker()]);
    const stopped = controller.signal.aborted;
    this.job = null;
    if (failed.length) this.error = `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be downloaded (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? ', …' : ''}). Press Download again to retry.`;
    this._tick();
    if (!stopped) await this.indexMissing();
    return { failed, stopped };
  }

  // ---- the text index

  async indexMissing() {
    if (this.job) return;
    const todo = this.everyFile().filter((f) => this.have.has(f.id) && !this.indexed.has(f.id));
    if (!todo.length) return;
    const controller = new AbortController();
    this.job = { kind: 'index', done: 0, total: todo.length, bytes: 0, current: '', controller };
    this._tick();
    for (const f of todo) {
      if (controller.signal.aborted) break;
      this.job.current = f.label === f.name ? f.name : `${f.subjectName}: ${f.where}, ${f.label}`;
      this._tick();
      let pages = [];
      try { pages = await this.extract(this.pathOf(f)); } catch (err) { this.log(`school: could not read ${f.name}: ${err.message}`); }
      if (controller.signal.aborted) break;
      await fsp.mkdir(path.dirname(this.indexPath(f.id)), { recursive: true });
      await fsp.writeFile(this.indexPath(f.id), JSON.stringify({ v: INDEX_VERSION, name: f.name, pages }));
      this.indexed.add(f.id);
      this.cache.set(f.id, pages);
      this.job.done += 1;
      this._tick();
    }
    this.job = null;
    this._tick();
  }

  /** The page texts of a file, or null when it is not here or not read yet. */
  pagesOf(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    if (!this.indexed.has(id)) return null;
    try {
      const pages = JSON.parse(fs.readFileSync(this.indexPath(id), 'utf8')).pages || [];
      this.cache.set(id, pages);
      return pages;
    } catch { return null; }
  }

  search(query) {
    const books = this.everyFile().filter((f) => this.indexed.has(f.id)).map((f) => ({ id: f.id, pages: this.pagesOf(f.id) || [] }));
    return school.searchPages(books, query).map((h) => {
      const f = this.fileById(h.fileId);
      return { ...h, label: f.label, where: f.where, subjectName: f.subjectName };
    });
  }

  // ---- the plan

  week(number) {
    const w = this.year.weeks[Math.max(1, Math.min(this.year.weeks.length, number)) - 1];
    const subjectOf = (id) => this.manifest.subjects.find((s) => s.id === id);
    return {
      number: w.number, of: this.year.weeks.length, semester: w.semester, summary: w.summary,
      days: w.days.map((sessions) => sessions.map((x) => {
        const subject = subjectOf(x.subject);
        const unit = subject.units.find((u) => u.id === x.unitId);
        const found = school.lessonOf(x, unit, subject, (id) => this.pagesOf(id));
        return { ...x, done: Boolean(this.progress.done[x.id]), caution: unit.caution || null, name: found ? found.lesson.title : '',
          links: school.linksFor(x, unit, subject, (id) => this.pagesOf(id)).map((l) => ({ ...l, here: this.have.has(l.fileId) })) };
      })),
    };
  }

  /** The whole year by subject and unit, for the overview and the skip switches. */
/** One day of the plan as steps to click through, and the lesson that follows it that day. */
  lesson(sessionId) {
    for (const w of this.year.weeks) {
      for (let d = 0; d < w.days.length; d++) {
        const at = w.days[d].findIndex((x) => x.id === sessionId);
        if (at < 0) continue;
        const x = w.days[d][at];
        const subject = this.manifest.subjects.find((s) => s.id === x.subject);
        const unit = subject.units.find((u) => u.id === x.unitId);
        const g = school.guideFor(x, unit, subject, (id) => this.pagesOf(id));
        const here = (l) => ({ ...l, here: Boolean(l.fileId) && this.have.has(l.fileId) });
        const next = w.days[d][at + 1] || null;
        return {
          id: x.id, subject: x.subject, subjectName: x.subjectName, unitN: x.unitN, unitTitle: x.unitTitle, label: x.label,
          week: w.number, day: d + 1, done: Boolean(this.progress.done[x.id]), caution: unit.caution || null,
          title: g.title, name: g.name, question: g.question, minutes: g.minutes, read: g.read,
          steps: g.steps.map(here), links: g.links.map(here),
          next: next ? { id: next.id, subjectName: next.subjectName, label: next.label } : null,
        };
      }
    }
    return null;
  }

  overview() {
    const firstWeek = new Map();
    for (const w of this.year.weeks) for (const x of w.days.flat()) if (!firstWeek.has(x.unitId)) firstWeek.set(x.unitId, w.number);
    const lastWeek = new Map();
    for (const w of this.year.weeks) for (const x of w.days.flat()) lastWeek.set(x.unitId, w.number);
    return {
      totals: this.year.totals,
      subjects: this.manifest.subjects.map((s) => ({
        id: s.id, name: s.name, series: s.series, minutes: s.minutes, licence: s.licence, roles: s.roles,
        units: s.units.map((u) => {
          const sessions = school.unitSessions(s, u);
          return { id: u.id, n: u.n, title: u.title, focus: u.focus, note: u.note || null, caution: u.caution || null, page: u.page,
            skipped: this.progress.skip.includes(u.id), days: sessions.length, done: sessions.filter((x) => this.progress.done[x.id]).length,
            weeks: firstWeek.has(u.id) ? [firstWeek.get(u.id), lastWeek.get(u.id)] : null,
            files: u.files.map((f) => ({ id: f.id, label: f.label, role: f.role, here: this.have.has(f.id), bytes: this.have.get(f.id) || 0 })) };
        }),
        extras: (s.extras || []).map((f) => ({ id: f.id, label: f.label, role: f.role, here: this.have.has(f.id), bytes: this.have.get(f.id) || 0 })),
      })),
      added: this.added.map((f) => ({ id: f.id, label: f.label, here: true, bytes: this.have.get(f.id) || 0 })),
      shopping: (this.manifest.shopping || []).map((b) => ({ ...b, have: this.progress.have.includes(b.id) })),
    };
  }

  async _saveProgress() {
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = `${this.progressFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.progress, null, 1));
    await fsp.rename(tmp, this.progressFile);
    this._tick();
  }
  async setDone(ids, done) {
    for (const id of [].concat(ids)) { if (done) this.progress.done[id] = true; else delete this.progress.done[id]; }
    await this._saveProgress();
  }
  async setSkip(unitId, skip) {
    this.progress.skip = this.progress.skip.filter((id) => id !== unitId);
    if (skip) this.progress.skip.push(unitId);
    this.year = school.buildYear(this.manifest, { skip: this.progress.skip });
    await this._saveProgress();
  }
  async setHave(itemId, have) {
    this.progress.have = this.progress.have.filter((id) => id !== itemId);
    if (have) this.progress.have.push(itemId);
    await this._saveProgress();
  }

  // ---- the user's own books

  /** Copy PDFs the user owns into the library and read them into the index. */
  async addBooks(paths) {
    const dir = path.join(this.dir, this.grade, 'added');
    await fsp.mkdir(dir, { recursive: true });
    let n = 0;
    for (const src of paths) {
      if (!/\.pdf$/i.test(src)) continue;
      const fd = await fsp.open(src, 'r');
      const head = Buffer.alloc(5);
      await fd.read(head, 0, 5, 0);
      await fd.close();
      if (head.toString('latin1') !== '%PDF-') throw new Error(`${path.basename(src)} is not a PDF.`);
      await fsp.copyFile(src, path.join(dir, path.basename(src)));
      n += 1;
    }
    await this.init();
    this._tick();
    await this.indexMissing();
    return n;
  }
  async removeBook(id) {
    const f = this.added.find((x) => x.id === id);
    if (!f) return;
    await fsp.rm(this.pathOf(f), { force: true });
    await fsp.rm(this.indexPath(id), { force: true });
    this.cache.delete(id);
    await this.init();
    this._tick();
  }
}

module.exports = { SchoolLibrary };
