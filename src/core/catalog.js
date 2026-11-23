'use strict';
// Finds what to download from the Kiwix download server: the newest Wikipedia
// edition, its published SHA-256, and the Windows build of the Kiwix engine.

const { fetchText, head } = require('./httpx');

const DEFAULT_BASE = 'https://download.kiwix.org';

function trimBase(baseUrl) {
  return String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pull every "<prefix>YYYY-MM.zim" file name out of a directory listing or catalog feed. */
function parseEditions(text, prefix) {
  const re = new RegExp(`(${escapeRe(prefix)}(\\d{4}-\\d{2})\\.zim)(?![\\w.])`, 'g');
  const seen = new Map();
  let m;
  while ((m = re.exec(text))) seen.set(m[1], m[2]);
  return [...seen].map(([file, date]) => ({ file, date })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Newest published edition, e.g. wikipedia_en_all_maxi_2026-10.zim.
 * @returns {Promise<{file:string,url:string,date:string}>}
 */
async function findLatestEdition({ baseUrl, project = 'wikipedia', folder, language = 'en', flavour = 'maxi', signal } = {}) {
  const base = trimBase(baseUrl);
  const prefix = `${project}_${language}_all_${flavour}_`;
  const dirUrl = `${base}/zim/${folder || project}/`; // most projects have a folder of their own; a few share one
  const errors = [];

  try {
    const { text } = await fetchText(dirUrl, { signal, timeoutMs: 45000 });
    const found = parseEditions(text, prefix);
    if (found.length) return { ...found[0], url: dirUrl + found[0].file };
    errors.push(`no ${prefix}*.zim in the listing at ${dirUrl}`);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    errors.push(err.message);
  }

  // Fallback: the Kiwix library catalog (OPDS feed) links to the same files.
  try {
    const feed = `https://library.kiwix.org/catalog/v2/entries?count=-1&lang=${language === 'en' ? 'eng' : language}&name=${project}_${language}_all`;
    const { text } = await fetchText(feed, { signal, timeoutMs: 45000 });
    const found = parseEditions(text, prefix);
    if (found.length) return { ...found[0], url: dirUrl + found[0].file };
    errors.push('no matching edition in the library catalog');
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    errors.push(err.message);
  }

  const e = new Error(`Could not find the latest edition (${errors.join('; ')})`);
  e.retryLater = true;
  throw e;
}

/**
 * SHA-256 published by the download server for a file. The server answers
 * `<file>.sha256`; `.meta4` and `.mirrorlist` carry the same hash and are used as fallbacks.
 */
async function fetchPublishedSha256(fileUrl, { signal } = {}) {
  const attempts = [
    ['.sha256', /\b([a-f0-9]{64})\b/i],
    ['.meta4', /sha-?256[^a-f0-9]{1,40}([a-f0-9]{64})\b/i],
    ['.mirrorlist', /sha-?256[^a-f0-9]{1,80}([a-f0-9]{64})\b/i],
  ];
  for (const [suffix, re] of attempts) {
    try {
      const { text } = await fetchText(fileUrl + suffix, { signal, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 });
      const m = re.exec(text);
      if (m) return m[1].toLowerCase();
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  return null;
}

async function fetchRemoteSize(fileUrl, { signal } = {}) {
  try {
    const { status, headers } = await head(fileUrl, { signal, timeoutMs: 30000 });
    if (status === 200 && headers['content-length']) return Number(headers['content-length']);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
  }
  return null;
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Pick the newest Windows build of kiwix-tools from the release listing. */
function parseEngineBuilds(text) {
  const re = /kiwix-tools_win-(x86_64|i686)-(\d+(?:\.\d+)+(?:-\d+)?)\.zip(?![\w.])/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(text))) seen.set(m[0], { file: m[0], arch: m[1], version: m[2] });
  return [...seen.values()].sort((a, b) =>
    compareVersions(b.version, a.version) || (a.arch === 'x86_64' ? -1 : 1));
}

async function findEngineDownload({ baseUrl, signal } = {}) {
  const base = trimBase(baseUrl);
  const dirUrl = `${base}/release/kiwix-tools/`;
  const { text } = await fetchText(dirUrl, { signal, timeoutMs: 45000 });
  const builds = parseEngineBuilds(text);
  if (!builds.length) throw new Error(`No Windows build of kiwix-tools listed at ${dirUrl}`);
  return { ...builds[0], url: dirUrl + builds[0].file };
}

module.exports = {
  DEFAULT_BASE, findLatestEdition, fetchPublishedSha256, fetchRemoteSize,
  findEngineDownload, parseEditions, parseEngineBuilds, compareVersions,
};
