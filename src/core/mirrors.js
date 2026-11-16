'use strict';
// Kiwix publishes each file on many volunteer mirrors and redirects a plain
// download to one of them. That one is not always the quickest from where you
// are. This module reads the published mirror list for a file and measures a
// short sample from each so the downloader can use the fastest ones.

const { fetchText, open, abortError } = require('./httpx');

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Pull every mirror URL for `fileName` out of a mirror list. Works on both the
 * Metalink (.meta4) and the HTML (.mirrorlist) forms, since all that matters
 * is a full URL ending in the file's name. Order of appearance is kept: the
 * server lists nearer mirrors first.
 */
function parseMirrorUrls(text, fileName, excludeHost) {
  const re = new RegExp(`https?://[^\\s"'<>]+/${escapeRe(fileName)}(?=["'<\\s]|$)`, 'g');
  const byPlace = new Map(); // one URL per mirror, in the order the server listed them, https where offered
  for (const m of String(text).match(re) || []) {
    let u;
    try { u = new URL(m); } catch { continue; }
    if (excludeHost && u.host === excludeHost) continue;
    const key = u.host + u.pathname;
    const had = byPlace.get(key);
    if (!had || (had.startsWith('http:') && m.startsWith('https:'))) byPlace.set(key, m);
  }
  return [...byPlace.values()];
}

/** Mirror URLs for a file on the Kiwix download server; [] if no list could be read. */
async function listMirrors(fileUrl, { signal } = {}) {
  const u = new URL(fileUrl);
  const fileName = decodeURIComponent(u.pathname.split('/').pop());
  for (const suffix of ['.meta4', '.mirrorlist']) {
    try {
      const { text } = await fetchText(fileUrl + suffix, { signal, timeoutMs: 20000, maxBytes: 8 * 1024 * 1024 });
      const urls = parseMirrorUrls(text, fileName, u.host);
      if (urls.length) return urls;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  return [];
}

/**
 * Download a short sample from a mirror and report its speed. A mirror that
 * does not have the file, or does not honour Range requests, is reported as
 * not usable.
 */
async function probeMirror(url, { signal, sampleBytes = 3 * 1024 * 1024, maxMs = 4000, timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const onAbort = () => ac.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort('probe finished'), maxMs + timeoutMs);
  try {
    const { res } = await open(url, { headers: { Range: `bytes=0-${sampleBytes - 1}` }, signal: ac.signal, timeoutMs });
    if (res.statusCode !== 206) { res.destroy(); return { url, ok: false, reason: `HTTP ${res.statusCode}` }; }
    let bytes = 0;
    const started = Date.now();
    await new Promise((resolve) => {
      const stop = setTimeout(() => { res.destroy(); resolve(); }, maxMs);
      res.on('data', (c) => { bytes += c.length; });
      const end = () => { clearTimeout(stop); resolve(); };
      res.on('end', end); res.on('error', end); res.on('close', end);
    });
    const secs = Math.max(0.05, (Date.now() - started) / 1000);
    if (!bytes) return { url, ok: false, reason: 'no data' };
    return { url, ok: true, bytesPerSec: bytes / secs };
  } catch (err) {
    if (signal?.aborted) throw abortError(signal);
    return { url, ok: false, reason: err.message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Probe up to `limit` mirrors at once and return the usable ones, fastest first. */
async function rankMirrors(urls, { signal, limit = 10, probe = probeMirror, ...probeOpts } = {}) {
  const results = await Promise.all(urls.slice(0, limit).map((u) => probe(u, { signal, ...probeOpts })));
  return results.filter((r) => r.ok).sort((a, b) => b.bytesPerSec - a.bytesPerSec);
}

module.exports = { parseMirrorUrls, listMirrors, probeMirror, rankMirrors };
