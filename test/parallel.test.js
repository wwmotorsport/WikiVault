'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadParallel, partialBytes, chunkMetaPath } = require('../src/core/downloader');
const { parseMirrorUrls, listMirrors, rankMirrors } = require('../src/core/mirrors');
const { sha256File } = require('../src/core/verify');
const { startDownloadServer, tmpDir, sha256 } = require('./helpers');

const KB = 1024;
const NAME = 'big.zim';
const FAST = { chunkSize: 64 * KB, saveEveryMs: 40, baseDelayMs: 5, stallMs: 5000 };

async function setup(size = 2 * 1024 * KB) {
  const srv = await startDownloadServer();
  const dir = await tmpDir('wikivault-par-');
  const data = crypto.randomBytes(size);
  srv.files.set(NAME, data);
  const url = `${srv.baseUrl}/zim/wikipedia/${NAME}`;
  const dest = path.join(dir, `${NAME}.part`);
  const done = async () => { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); };
  const ranges = () => srv.log.filter((l) => l.startsWith('GET') && /bytes=\d+-\d+/.test(l)).map((l) => /bytes=(\d+)-(\d+)/.exec(l).slice(1).map(Number));
  return { srv, dir, data, url, dest, done, ranges };
}

test('mirror lists: URLs are pulled from Metalink and HTML lists alike', () => {
  const meta4 = `<?xml version="1.0" encoding="UTF-8"?>
<metalink xmlns="urn:ietf:params:xml:ns:metalink"><file name="wikipedia_en_all_maxi_2026-08.zim">
<size>119185379328</size><hash type="sha-256">${'ab'.repeat(32)}</hash>
<url location="us" priority="1">https://mirror.accum.se/mirror/kiwix.org/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim</url>
<url location="de" priority="2">http://ftp.fau.de/kiwix/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim</url>
<url location="de" priority="3">https://ftp.fau.de/kiwix/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim</url>
<url location="fr" priority="4">https://download.kiwix.org/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim</url>
<url location="nl" priority="5">https://ftp.nluug.nl/pub/kiwix/zim/wikipedia/wikipedia_en_all_maxi_2026-07.zim</url>
</file></metalink>`;
  assert.deepEqual(parseMirrorUrls(meta4, 'wikipedia_en_all_maxi_2026-08.zim', 'download.kiwix.org'), [
    'https://mirror.accum.se/mirror/kiwix.org/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim',
    'https://ftp.fau.de/kiwix/zim/wikipedia/wikipedia_en_all_maxi_2026-08.zim',
  ], 'one URL per mirror, https preferred, the main server and other files left out');
  const html = '<table><tr><td><a href="https://ftp.nluug.nl/pub/kiwix/zim/wikipedia/a_b.zim">ftp.nluug.nl</a></td></tr><tr><td><a href="https://ftp.nluug.nl/pub/kiwix/zim/wikipedia/a_b.zim.sha256">x</a></td></tr></table>';
  assert.deepEqual(parseMirrorUrls(html, 'a_b.zim'), ['https://ftp.nluug.nl/pub/kiwix/zim/wikipedia/a_b.zim']);
  assert.deepEqual(parseMirrorUrls('nothing here', 'a_b.zim'), []);
});

test('several connections fetch different parts at once and the file is identical', async () => {
  const t = await setup();
  try {
    const seen = [];
    const r = await downloadParallel({ url: t.url, dest: t.dest, expectedSize: t.data.length, connections: 6, ...FAST, onProgress: (p) => seen.push(p) });
    assert.equal(r.size, t.data.length);
    assert.equal(await sha256File(t.dest), sha256(t.data));
    const ranges = t.ranges();
    assert.equal(ranges.length, 32, 'one request per 64 KB chunk');
    assert.equal(new Set(ranges.map((x) => x[0])).size, 32, 'no chunk fetched twice');
    assert.ok(ranges.every(([a, b]) => b - a + 1 <= 64 * KB));
    assert.ok(!fs.existsSync(chunkMetaPath(t.dest)), 'progress record removed once complete');
    assert.equal(seen.at(-1).downloaded, t.data.length);
  } finally { await t.done(); }
});

test('the fastest mirrors are found and carry the download; a mirror without the file is skipped', async () => {
  const t = await setup();
  try {
    t.srv.mirrors.quick = {};
    t.srv.mirrors.slow = { bps: 60 * KB };
    t.srv.mirrors.absent = { missing: true };
    const urls = await listMirrors(t.url);
    assert.equal(urls.length, 3);
    const ranked = await rankMirrors(urls, { sampleBytes: 256 * KB, maxMs: 500 });
    assert.deepEqual(ranked.map((m) => new URL(m.url).pathname.split('/')[2]), ['quick', 'slow']);
    assert.ok(ranked[0].bytesPerSec > ranked[1].bytesPerSec * 3);
    for (const k of Object.keys(t.srv.served)) delete t.srv.served[k];
    await downloadParallel({ url: t.url, mirrors: ranked, dest: t.dest, expectedSize: t.data.length, connections: 6, maxPerSource: 4, ...FAST });
    assert.equal(await sha256File(t.dest), sha256(t.data));
    const quick = t.srv.served.quick || 0;
    assert.ok(quick > t.data.length * 0.6, `most of the file came from the quick mirror (${quick} of ${t.data.length})`);
    assert.ok((t.srv.served.slow || 0) < t.data.length * 0.25, `little came from the slow one (${t.srv.served.slow || 0})`);
  } finally { await t.done(); }
});

test('an interrupted download carries on from its progress record', async () => {
  const t = await setup();
  try {
    t.srv.mirrors.steady = { bps: 200 * KB };
    t.srv.opts.bps = 200 * KB; // the main server is just as slow
    const mirrors = [{ url: `${t.srv.baseUrl}/mirrors/steady/zim/wikipedia/${NAME}` }];
    const ac = new AbortController();
    setTimeout(() => ac.abort('paused'), 450);
    await assert.rejects(downloadParallel({ url: t.url, mirrors, dest: t.dest, expectedSize: t.data.length, connections: 4, signal: ac.signal, ...FAST }), { name: 'AbortError' });
    const had = await partialBytes(t.dest);
    assert.ok(had > 100 * KB && had < t.data.length, `some of it arrived (${had})`);
    assert.ok(fs.existsSync(chunkMetaPath(t.dest)));

    t.srv.mirrors.steady = {};
    delete t.srv.opts.bps;
    for (const k of Object.keys(t.srv.served)) delete t.srv.served[k];
    await downloadParallel({ url: t.url, mirrors, dest: t.dest, expectedSize: t.data.length, connections: 4, ...FAST });
    assert.equal(await sha256File(t.dest), sha256(t.data));
    const again = Object.values(t.srv.served).reduce((a, b) => a + b, 0);
    assert.ok(again <= t.data.length - had + 8 * KB, `only the missing part was fetched (${again} bytes for ${t.data.length - had} missing)`);
  } finally { await t.done(); }
});

test('a download started by the older one-connection method is continued, not restarted', async () => {
  const t = await setup();
  try {
    const have = 700 * KB + 123;
    await fsp.writeFile(t.dest, t.data.subarray(0, have));
    await downloadParallel({ url: t.url, dest: t.dest, expectedSize: t.data.length, connections: 4, ...FAST });
    assert.equal(await sha256File(t.dest), sha256(t.data));
    const lowest = Math.min(...t.ranges().map((r) => r[0]));
    assert.equal(lowest, have, 'nothing before the old download\'s end was fetched again');
  } finally { await t.done(); }
});

test('a mirror that keeps dropping connections is set aside and the rest finish the job', async () => {
  const t = await setup();
  try {
    t.srv.mirrors.flaky = { dropAfter: 10 * KB };
    t.srv.mirrors.solid = {};
    const mirrors = ['flaky', 'solid'].map((n) => ({ url: `${t.srv.baseUrl}/mirrors/${n}/zim/wikipedia/${NAME}`, bytesPerSec: n === 'flaky' ? 9e9 : 1 }));
    const notes = [];
    await downloadParallel({ url: t.url, mirrors, dest: t.dest, expectedSize: t.data.length, connections: 4, log: (m) => notes.push(m), ...FAST });
    assert.equal(await sha256File(t.dest), sha256(t.data));
    assert.ok(notes.some((n) => /setting aside 127\.0\.0\.1/.test(n)), notes.join(' | '));
  } finally { await t.done(); }
});

test('a server that cannot serve byte ranges still works, on one connection', async () => {
  const t = await setup(300 * KB);
  try {
    t.srv.opts.ignoreRange = true;
    await downloadParallel({ url: t.url, dest: t.dest, expectedSize: t.data.length, connections: 4, ...FAST });
    assert.equal(await sha256File(t.dest), sha256(t.data));
    assert.ok(!fs.existsSync(chunkMetaPath(t.dest)));
  } finally { await t.done(); }
});

test('gives up with "try later" when nothing arrives at all', async () => {
  const t = await setup(300 * KB);
  try {
    t.srv.opts.dropAfter = 0;
    await assert.rejects(
      downloadParallel({ url: t.url, dest: t.dest, expectedSize: t.data.length, connections: 3, maxIdleMs: 150, ...FAST }),
      (e) => e.retryLater === true && /kept failing without progress/.test(e.message),
    );
  } finally { await t.done(); }
});
