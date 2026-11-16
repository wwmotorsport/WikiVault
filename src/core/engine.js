'use strict';
// The "engine" is kiwix-serve, the Kiwix project's reader for .zim files. It
// runs as a child process bound to 127.0.0.1 and gives us article pages,
// title suggestions and full-text search over the edition on disk.

const { spawn, execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { fetchText } = require('./httpx');
const { downloadFile, sleep } = require('./downloader');
const { sha256File } = require('./verify');
const catalog = require('./catalog');

const EXE = process.platform === 'win32' ? 'kiwix-serve.exe' : 'kiwix-serve';

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function findFile(dir, name, depth = 4) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = await findFile(path.join(dir, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** Locate kiwix-serve: explicit setting, then our own engine folder, then PATH. */
async function locateEngine({ configuredPath, engineDir } = {}) {
  const candidates = [process.env.WIKIVAULT_KIWIX_SERVE, configuredPath].filter(Boolean);
  for (const c of candidates) {
    try { if ((await fsp.stat(c)).isFile()) return c; } catch { /* keep looking */ }
  }
  if (engineDir) {
    const hit = await findFile(engineDir, EXE);
    if (hit) return hit;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [EXE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  } catch { /* not on PATH */ }
  return null;
}

/**
 * Download and unpack the Windows build of kiwix-tools into engineDir.
 * Returns the path to kiwix-serve.exe.
 */
async function installEngine({ engineDir, baseUrl, signal, onProgress = () => {} }) {
  const AdmZip = require('adm-zip');
  onProgress({ step: 'Finding the reader engine' });
  const build = await catalog.findEngineDownload({ baseUrl, signal });
  await fsp.mkdir(engineDir, { recursive: true });
  const zipPath = path.join(engineDir, build.file);
  await fsp.rm(zipPath, { force: true });

  await downloadFile({
    url: build.url, dest: zipPath, signal,
    onProgress: (p) => onProgress({ step: `Downloading the reader engine ${build.version}`, ...p }),
  });

  const published = await catalog.fetchPublishedSha256(build.url, { signal });
  if (published) {
    const actual = await sha256File(zipPath, { signal });
    if (actual !== published) {
      await fsp.rm(zipPath, { force: true });
      throw new Error('The reader engine download did not match its published checksum. Try again.');
    }
  }

  onProgress({ step: 'Unpacking the reader engine' });
  const target = path.join(engineDir, build.file.replace(/\.zip$/i, ''));
  await fsp.rm(target, { recursive: true, force: true });
  new AdmZip(zipPath).extractAllTo(target, true);
  await fsp.rm(zipPath, { force: true });

  const exe = await findFile(target, 'kiwix-serve.exe');
  if (!exe) throw new Error('kiwix-serve.exe was not in the downloaded package.');
  return { path: exe, version: build.version, verified: Boolean(published) };
}

/** kiwix-serve derives the URL name of a book from its file name. */
function zimNameFromFile(file) {
  return path.basename(file).replace(/\.zim$/i, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ /g, '_').replace(/\+/g, 'plus');
}

function parseSearchXml(xml) {
  // The engine writes large counts with separators ("84,809"), which differ by locale.
  const count = (text) => Number(String(text || '').replace(/[^\d]/g, '')) || 0;
  const total = count((/<opensearch:totalResults>([^<]*)</.exec(xml) || [])[1]);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = decodeEntities((/<title>([\s\S]*?)<\/title>/.exec(block) || [])[1] || '').trim();
    const link = decodeEntities((/<link>([\s\S]*?)<\/link>/.exec(block) || [])[1] || '').trim();
    const rawDesc = ((/<description>([\s\S]*?)<\/description>/.exec(block) || [])[1] || '').trim();
    const words = count((/<wordCount>([^<]*)</.exec(block) || [])[1]);
    // The snippet marks matches with <b>…</b>. Turn it into safe plain segments.
    const snippet = [];
    for (const part of rawDesc.split(/(<b>[\s\S]*?<\/b>)/)) {
      if (!part) continue;
      const hit = /^<b>/.test(part);
      const text = decodeEntities(part.replace(/<\/?[^>]+>/g, ''));
      if (text) snippet.push({ text, hit });
    }
    if (link) items.push({ title, link, snippet, words });
  }
  return { total, items };
}

class Engine extends EventEmitter {
  constructor({ binPath, log = () => {} }) {
    super();
    this.binPath = binPath;
    this.log = log;
    this.proc = null;
    this.port = null;
    this.zimPath = null;
    this.zimName = null;
    this.info = {};
    this.stopping = false;
  }

  get running() { return Boolean(this.proc && this.port); }
  get origin() { return `http://127.0.0.1:${this.port}`; }

  async start(zimPath, { port, readyTimeoutMs = 120000, threads = 8 } = {}) {
    if (this.proc) await this.stop();
    this.stopping = false;
    this.zimPath = zimPath;
    this.port = port || await freePort();
    const args = ['--address=127.0.0.1', `--port=${this.port}`, `--threads=${threads}`, zimPath];
    this.log(`engine: ${this.binPath} ${args.join(' ')}`);

    let output = '';
    const proc = spawn(this.binPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const capture = (d) => { output = (output + d.toString()).slice(-4000); };
    proc.stdout.on('data', capture);
    proc.stderr.on('data', capture);

    let exited = null;
    proc.on('error', (err) => { exited = err; });
    proc.on('exit', (code, sig) => {
      exited = exited || new Error(`The reader engine stopped (code ${code ?? sig}). ${output.trim().split('\n').slice(-3).join(' ')}`);
      if (this.proc === proc) {
        this.proc = null;
        if (!this.stopping) this.emit('crash', exited);
      }
    });

    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (exited) { this.proc = null; throw exited; }
      try {
        const { text } = await fetchText(`${this.origin}/catalog/v2/entries`, { timeoutMs: 5000 });
        this._readCatalog(text);
        break;
      } catch (err) {
        if (Date.now() > deadline) {
          await this.stop();
          throw new Error(`The reader engine did not become ready: ${err.message}`);
        }
        await sleep(200);
      }
    }
    return this;
  }

  _readCatalog(xml) {
    const name = (/href="\/content\/([^"/]+)"/.exec(xml) || [])[1];
    this.zimName = name ? decodeEntities(name) : zimNameFromFile(this.zimPath);
    const pick = (tag) => decodeEntities((new RegExp(`<entry>[\\s\\S]*?<${tag}>([^<]*)</${tag}>`).exec(xml) || [])[1] || '');
    this.info = {
      title: pick('title'),
      articleCount: Number(pick('articleCount')) || null,
      issued: pick('dc:issued') || pick('updated') || null,
      language: pick('language') || null,
    };
  }

  async stop() {
    const proc = this.proc;
    if (!proc) return;
    this.stopping = true;
    this.proc = null;
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
      try { proc.kill(); } catch { clearTimeout(t); resolve(); }
    });
  }

  contentBase() { return `${this.origin}/content/${encodeURIComponent(this.zimName)}`; }

  /** Absolute URL for an article path as stored in the file, e.g. "Apollo_11" or "A/Apollo_11". */
  urlForPath(p) {
    return `${this.contentBase()}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Inverse of urlForPath for URLs served by this engine; null for anything else. */
  pathForUrl(url) {
    try {
      const u = new URL(url, this.origin);
      const prefix = `/content/${encodeURIComponent(this.zimName)}/`;
      if (u.origin !== this.origin || !u.pathname.startsWith(prefix)) return null;
      return decodeURIComponent(u.pathname.slice(prefix.length));
    } catch { return null; }
  }

  async suggest(term, count = 8, { signal } = {}) {
    const q = String(term || '').trim();
    if (!q) return [];
    const url = `${this.origin}/suggest?content=${encodeURIComponent(this.zimName)}&term=${encodeURIComponent(q)}&count=${count}`;
    const { text } = await fetchText(url, { signal, timeoutMs: 15000 });
    let rows;
    try { rows = JSON.parse(text); } catch { return []; }
    return rows
      .filter((r) => r && r.kind === 'path' && r.path)
      .map((r) => ({ title: decodeEntities(r.value || ''), path: r.path, url: this.urlForPath(r.path) }));
  }

  async search(pattern, { start = 0, pageLength = 20, signal } = {}) {
    const q = String(pattern || '').trim();
    if (!q) return { total: 0, items: [] };
    const url = `${this.origin}/search?books.name=${encodeURIComponent(this.zimName)}`
      + `&pattern=${encodeURIComponent(q)}&format=xml&start=${start}&pageLength=${pageLength}`;
    const { text, status } = await fetchText(url, { signal, timeoutMs: 60000, allowError: true });
    if (status >= 400) return { total: 0, items: [] };
    const parsed = parseSearchXml(text);
    for (const it of parsed.items) {
      it.url = new URL(it.link, this.origin).toString();
      it.path = this.pathForUrl(it.url);
    }
    return parsed;
  }

  async fetchHtml(url, { signal } = {}) {
    const abs = new URL(url, this.origin).toString();
    if (!abs.startsWith(this.origin + '/')) throw new Error('Not a page in the offline copy');
    return fetchText(abs, { signal, timeoutMs: 30000, maxBytes: 24 * 1024 * 1024 });
  }

  randomUrl() { return `${this.origin}/random?content=${encodeURIComponent(this.zimName)}`; }
  homeUrl() { return this.contentBase(); }
}

/**
 * Start a throwaway engine on the file and make sure it can actually serve a
 * page. Used to check a freshly downloaded edition before the old one is removed.
 */
async function probeZim(binPath, zimPath, { log } = {}) {
  const engine = new Engine({ binPath, log });
  try {
    await engine.start(zimPath, { readyTimeoutMs: 90000, threads: 2 });
    const { status } = await fetchText(engine.homeUrl(), { timeoutMs: 20000, allowError: true });
    if (status >= 400) return { ok: false, error: `The engine opened the file but its main page returned HTTP ${status}.` };
    return { ok: true, info: engine.info, zimName: engine.zimName };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await engine.stop();
  }
}

module.exports = {
  Engine, probeZim, locateEngine, installEngine, zimNameFromFile, parseSearchXml, decodeEntities, freePort,
};
