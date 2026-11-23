'use strict';
// Every library on the computer, asked as if it were one. It answers the questions Ask puts to a reader engine
// (suggest a title, search the text, fetch a page) by putting them to each library's own engine and laying the
// answers side by side, so that the passages for a question are chosen from all the libraries together.

const SEP = '::';

/** Lists from several libraries made into one: the first of each, then the second of each, and so on. */
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

class AllLibraries {
  /**
   * @param {Array<{id:string,name:string,engine:object}>} libs  the open library first
   * @param {{timeoutMs?:number}} [o]  how long one library is waited for before the others go on without it
   */
  constructor(libs, { timeoutMs = 5000 } = {}) {
    this.libs = libs.filter((l) => l && l.engine && l.engine.running);
    this.timeoutMs = timeoutMs;
    this.many = this.libs.length > 1;
  }

  get running() { return this.libs.length > 0; }
  get origin() { return this.libs[0].engine.origin; }

  /** The library a page address belongs to, or null. */
  libOf(url) {
    try { const { origin } = new URL(url, this.origin); return this.libs.find((l) => l.engine.origin === origin) || null; } catch { return null; }
  }

  pathForUrl(url) { const l = this.libOf(url); const p = l && l.engine.pathForUrl(url); return p ? `${l.id}${SEP}${p}` : null; }
  urlForPath(p) {
    const i = String(p).indexOf(SEP);
    const l = i > 0 ? this.libs.find((x) => x.id === String(p).slice(0, i)) : null;
    return l ? l.engine.urlForPath(String(p).slice(i + SEP.length)) : this.libs[0].engine.urlForPath(p);
  }

  /** Put one question to every library, each given only so long; a library that fails or is slow gives nothing. */
  async each(fn, signal) {
    return Promise.all(this.libs.map(async (l) => {
      const ac = new AbortController();
      const stop = () => ac.abort();
      if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', stop, { once: true }); }
      const timer = setTimeout(stop, this.timeoutMs);
      try { return await fn(l, ac.signal); } catch { return null; } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', stop); }
    }));
  }

  async suggest(term, count = 8, { signal } = {}) {
    const per = await this.each(async (l, s) => (await l.engine.suggest(term, count, { signal: s })).map((h) => ({ ...h, path: `${l.id}${SEP}${h.path}`, lib: l.id })), signal);
    return interleave(per.map((x) => x || [])).slice(0, count);
  }

  async search(pattern, { start = 0, pageLength = 20, signal } = {}) {
    const per = await this.each(async (l, s) => {
      const r = await l.engine.search(pattern, { start, pageLength, signal: s });
      return { total: r.total, items: r.items.map((it) => ({ ...it, path: it.path ? `${l.id}${SEP}${it.path}` : it.path, lib: l.id })) };
    }, signal);
    const got = per.map((x) => x || { total: 0, items: [] });
    return { total: got.reduce((n, r) => n + r.total, 0), items: interleave(got.map((r) => r.items)).slice(0, pageLength) };
  }

  async fetchHtml(url, o = {}) {
    const l = this.libOf(url);
    if (!l) throw new Error('Not a page in the offline copy');
    return l.engine.fetchHtml(url, o);
  }
}

module.exports = { AllLibraries, interleave, SEP };
