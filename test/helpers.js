'use strict';
// Test doubles: a stand-in for the Kiwix download server (directory listings,
// Range downloads, checksums, optional flakiness) and a stand-in for a local
// OpenAI-compatible model server.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const FIXTURES = path.join(__dirname, 'fixtures');

function kiwixServePath() {
  if (process.env.WIKIVAULT_KIWIX_SERVE) return process.env.WIKIVAULT_KIWIX_SERVE;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(cmd, ['kiwix-serve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null;
  } catch { return null; }
}

async function tmpDir(prefix = 'wikivault-test-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/**
 * Fake download server.
 *   server.files: Map<name, Buffer> served under /zim/wikipedia/
 *   server.opts.dropAfter: close the connection after this many body bytes (per request)
 *   server.opts.ignoreRange: answer 200 with the whole file even when Range is sent
 *   server.opts.badChecksum: publish a wrong SHA-256
 *   server.opts.noChecksum: publish no checksum at all
 *   server.opts.redirect: bounce file downloads through /mirror/ first
 */
async function startDownloadServer() {
  const files = new Map();
  const releases = new Map();
  const opts = {};
  // name -> { bps, dropAfter, ignoreRange, missing, corrupt }: extra copies of every file under /mirrors/<name>/
  const mirrors = {};
  const served = {};
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push(`${req.method} ${url.pathname} ${req.headers.range || ''}`.trim());
    const dir = '/zim/wikipedia/';
    // Every Kiwix project has its own folder; here they share one set of files, told apart by name.
    const project = (/^\/zim\/([a-z]+)\/$/.exec(url.pathname) || [])[1];
    if (!project) url.pathname = url.pathname.replace(/\/zim\/[a-z]+\//, dir);

    if (project) {
      const rows = [...files.keys()].filter((n) => n.startsWith(`${project}_`)).map((n) => `<a href="${n}">${n}</a>  2026-11-01 10:00  ${files.get(n).length}`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><body><pre><a href="../">../</a>\n${rows}\n</pre></body></html>`);
    }
    if (url.pathname === '/release/kiwix-tools/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(['kiwix-tools_win-i686-3.7.0-2.zip', 'kiwix-tools_win-x86_64-3.7.0-2.zip', 'kiwix-tools_win-i686-3.6.0.zip', 'kiwix-tools_linux-x86_64-3.7.0-2.tar.gz', 'kiwix-tools_win-i686.zip']
        .map((n) => `<a href="${n}">${n}</a>`).join('\n'));
    }

    if (url.pathname.startsWith('/release/kiwix-tools/')) {
      const name = url.pathname.slice('/release/kiwix-tools/'.length);
      if (name.endsWith('.sha256') && releases.has(name.slice(0, -7))) {
        res.writeHead(200); return res.end(`${sha256(releases.get(name.slice(0, -7)))}  ${name.slice(0, -7)}\n`);
      }
      if (!releases.has(name)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Length': releases.get(name).length });
      return res.end(releases.get(name));
    }

    let mirror = null;
    const mm = /^\/mirrors\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (mm) { mirror = mirrors[mm[1]] || { missing: true }; mirror.name = mm[1]; url.pathname = mm[2]; }
    const cfg = { ...opts, ...(mirror || {}) };

    let p = url.pathname;
    if (!mirror && opts.redirect && p.startsWith(dir) && !p.endsWith('.sha256')) {
      res.writeHead(302, { Location: `/mirror${p}` });
      return res.end();
    }
    if (p.startsWith('/mirror/')) p = p.slice('/mirror'.length);
    if (!p.startsWith(dir)) { res.writeHead(404); return res.end('not found'); }
    const name = decodeURIComponent(p.slice(dir.length));

    if (name.endsWith('.sha256')) {
      const base = name.slice(0, -'.sha256'.length);
      if (!files.has(base) || opts.noChecksum) { res.writeHead(404); return res.end(); }
      const sum = opts.badChecksum ? 'f'.repeat(64) : sha256(files.get(base));
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`${sum}  ${base}\n`);
    }
    if (name.endsWith('.meta4')) {
      const base = name.slice(0, -'.meta4'.length);
      const names = Object.keys(mirrors);
      if (!files.has(base) || !names.length) { res.writeHead(404); return res.end(); }
      // Mirrors live on other hosts in real life; "localhost" stands in for a different host here.
      const origin = `http://localhost:${server.address().port}`;
      res.writeHead(200, { 'Content-Type': 'application/metalink4+xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<metalink xmlns="urn:ietf:params:xml:ns:metalink">\n<file name="${base}">\n<size>${files.get(base).length}</size>\n<hash type="sha-256">${sha256(files.get(base))}</hash>\n${names.map((n, i) => `<url location="us" priority="${i + 1}">${origin}/mirrors/${n}/zim/wikipedia/${base}</url>`).join('\n')}\n</file>\n</metalink>`);
    }
    if (name.endsWith('.mirrorlist')) { res.writeHead(404); return res.end(); }

    let data = files.get(name);
    if (!data || cfg.missing) { res.writeHead(404); return res.end('gone'); }
    if (cfg.corrupt) { data = Buffer.from(data); data[data.length >> 1] ^= 0xff; }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
      return res.end();
    }

    let start = 0;
    let status = 200;
    const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' };
    let end = data.length - 1;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m && !cfg.ignoreRange) {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(end, Number(m[2]));
      if (start >= data.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
    }
    const body = data.subarray(start, end + 1);
    const who = mirror ? mirror.name : 'main';
    const count = (n) => { served[who] = (served[who] || 0) + n; };
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    if (cfg.dropAfter != null && body.length > cfg.dropAfter) {
      count(cfg.dropAfter);
      res.write(body.subarray(0, cfg.dropAfter), () => res.destroy());
      return undefined;
    }
    if (cfg.bps) {
      // A mirror with a speed limit: send in small slices at the configured rate.
      let sent = 0;
      const slice = Math.max(1024, Math.floor(cfg.bps / 20));
      const t = setInterval(() => {
        if (res.destroyed) return clearInterval(t);
        const part = body.subarray(sent, sent + slice);
        res.write(part); count(part.length);
        sent += slice;
        if (sent >= body.length) { clearInterval(t); res.end(); }
      }, 50);
      return undefined;
    }
    count(body.length);
    if (opts.slowMs) {
      // Dribble the body so tests can pause mid-transfer.
      let sent = 0;
      const step = Math.max(1, Math.floor(body.length / 20));
      const t = setInterval(() => {
        if (res.destroyed) return clearInterval(t);
        res.write(body.subarray(sent, sent + step));
        sent += step;
        if (sent >= body.length) { clearInterval(t); res.end(); }
      }, opts.slowMs);
      return undefined;
    }
    return res.end(body);
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    files, releases, opts, log, mirrors, served,
    addFixture(name) { files.set(name, fs.readFileSync(path.join(FIXTURES, name))); },
    /** Publish a fixture under another file name, for example as a different flavour or project. */
    addCopy(name, fixture) { files.set(name, fs.readFileSync(path.join(FIXTURES, fixture))); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/**
 * Fake local model server speaking the OpenAI chat-completions protocol, plus
 * the few Foundry Local management routes the app uses.
 */
async function startModelServer({ reply = (messages) => 'ok', loaded = [] } = {}) {
  const state = { loaded: [...loaded], requests: [], failNext: 0, catalog: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const engine = () => (state.engineFile ? JSON.parse(fs.readFileSync(state.engineFile, 'utf8')) : state.engine || []);
    const setEngine = (arr) => { if (state.engineFile) fs.writeFileSync(state.engineFile, JSON.stringify(arr)); else state.engine = arr; };
    if (state.api === 'v2') {
      // Foundry Local 0.14, as observed on a real install: the /openai/* and /foundry/* routes are
      // gone, /v1/models is the whole catalog, and loading lives under /models/.
      const noMap = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end(`server=oatpp/1.3.0\ncode=404\ndescription=Not Found\nmessage=No mapping for HTTP-method: '${req.method}', URL: '${req.url}'\n`); };
      const cli = () => (state.cliStateFile ? JSON.parse(fs.readFileSync(state.cliStateFile, 'utf8')) : { catalog: {}, cached: [] });
      if (url.pathname.startsWith('/openai/') || url.pathname.startsWith('/foundry/') || url.pathname === '/models') return noMap();
      if (url.pathname === '/status') return json(200, { endpoints: [`http://127.0.0.1:${server.address().port}`], pid: state.pid || 0 });
      if (url.pathname === '/v1/models') return json(200, { data: (state.catalogIds || []).map((id) => ({ id, object: 'model', owned_by: 'Microsoft' })) });
      if (url.pathname === '/models/loaded') return json(200, engine());
      if (url.pathname.startsWith('/models/load/')) {
        const name = decodeURIComponent(url.pathname.slice('/models/load/'.length));
        state.loadRequests = [...(state.loadRequests || []), url.pathname + url.search];
        const c = cli();
        const id = c.catalog[name] || (Object.values(c.catalog).includes(name) ? name : null);
        if (!id) return json(404, { error: { message: `Model not found: No model matching '${name}'` } });
        if (!(c.cached || []).includes(id)) return json(400, { error: { message: `Model '${id}' is not in the local cache` } });
        const was = engine().includes(id);
        setEngine([...new Set([...engine(), id])]);
        return json(200, { context_length: 131072, model_id: id, status: was ? 'already_loaded' : 'loaded' });
      }
      if (url.pathname.startsWith('/models/unload/')) {
        const id = decodeURIComponent(url.pathname.slice('/models/unload/'.length));
        state.unloads = (state.unloads || 0) + 1;
        setEngine(engine().filter((x) => x !== id));
        return json(200, { status: 'unloaded' });
      }
    }
    if (url.pathname === '/openai/status') return json(200, { Endpoints: [`http://127.0.0.1:${server.address().port}`] });
    // Strict mode behaves like the real service: inference only works for models that are really in
    // memory (state.engine), whatever the "loaded" list claims.
    if (url.pathname === '/openai/loadedmodels') return state.noLoadedList ? json(404, {}) : json(200, state.loaded);
    if (url.pathname.startsWith('/openai/unload/')) {
      const gone = decodeURIComponent(url.pathname.slice('/openai/unload/'.length));
      state.unloads = (state.unloads || 0) + 1;
      state.loaded = state.loaded.filter((x) => x !== gone);
      if (state.strict) setEngine(engine().filter((x) => x !== gone));
      res.writeHead(200); return res.end();
    }
    if (url.pathname === '/v1/models' || url.pathname === '/models') return json(200, { data: state.loaded.map((id) => ({ id })) });
    if (url.pathname === '/foundry/list') return json(200, { models: state.catalog });
    if (url.pathname.startsWith('/openai/load/')) {
      const id = decodeURIComponent(url.pathname.slice('/openai/load/'.length));
      state.loadRequests = [...(state.loadRequests || []), url.pathname + url.search];
      if (state.restLoad === false) return json(404, { error: 'load is not available' });
      if (state.known?.includes(id) && !state.loaded.includes(id)) state.loaded = [...state.loaded, id];
      if (state.strict && state.known?.includes(id)) setEngine([...new Set([...engine(), id])]);
      res.writeHead(200); return res.end();
    }
    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const payload = JSON.parse(body);
        state.requests.push(payload);
        if (state.failNext > 0) { state.failNext -= 1; return json(400, { error: { message: 'model not loaded' } }); }
        if ((state.strict || state.api === 'v2') && !engine().includes(payload.model)) return json(400, { error: { message: `Model not loaded: Model '${payload.model}' must be loaded before inference` } });
        const text = reply(payload.messages, payload);
        if (!payload.stream) return json(200, { choices: [{ message: { role: 'assistant', content: text } }] });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const parts = text.match(/\S+\s*/g) || [];
        const gap = state.delays?.[payload.model] || 0; // per-model pause between words, to give builds different speeds
        (async () => {
          for (const piece of parts) {
            if (gap) await new Promise((r) => setTimeout(r, gap));
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
          }
          res.end('data: [DONE]\n\n');
        })();
      });
      return undefined;
    }
    res.writeHead(404); return res.end();
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`, port, state,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

module.exports = { FIXTURES, kiwixServePath, tmpDir, sha256, startDownloadServer, startModelServer };
