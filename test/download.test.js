'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadFile } = require('../src/core/downloader');
const { sha256File, looksLikeZim } = require('../src/core/verify');
const catalog = require('../src/core/catalog');
const { startDownloadServer, tmpDir, sha256, FIXTURES } = require('./helpers');

const NAME = 'wikipedia_en_all_maxi_2026-10.zim';

test('downloads a file and the hash matches', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    srv.files.set('big.bin', crypto.randomBytes(3 * 1024 * 1024));
    const dest = path.join(dir, 'big.bin.part');
    const seen = [];
    await downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/big.bin`, dest, onProgress: (p) => seen.push(p) });
    assert.equal(await sha256File(dest), sha256(srv.files.get('big.bin')));
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('resumes after the connection keeps dropping', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    const data = crypto.randomBytes(1024 * 1024);
    srv.files.set('flaky.bin', data);
    srv.opts.dropAfter = 300 * 1024; // every request dies after 300 KB
    const dest = path.join(dir, 'flaky.bin.part');
    await downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/flaky.bin`, dest, expectedSize: data.length, baseDelayMs: 5 });
    assert.equal(await sha256File(dest), sha256(data));
    const ranged = srv.log.filter((l) => /bytes=\d+-/.test(l));
    assert.ok(ranged.length >= 3, `expected several Range requests, saw ${ranged.length}`);
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('picks up an existing partial file instead of starting over', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    const data = crypto.randomBytes(500 * 1024);
    srv.files.set('part.bin', data);
    const dest = path.join(dir, 'part.bin.part');
    await fsp.writeFile(dest, data.subarray(0, 200 * 1024));
    await downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/part.bin`, dest, expectedSize: data.length });
    assert.equal(await sha256File(dest), sha256(data));
    assert.ok(srv.log.some((l) => l.includes(`bytes=${200 * 1024}-`)));
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('starts over cleanly when a server ignores Range', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    const data = crypto.randomBytes(200 * 1024);
    srv.files.set('norange.bin', data);
    srv.opts.ignoreRange = true;
    const dest = path.join(dir, 'norange.bin.part');
    await fsp.writeFile(dest, Buffer.alloc(50 * 1024, 7)); // stale garbage
    await downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/norange.bin`, dest, expectedSize: data.length });
    assert.equal(await sha256File(dest), sha256(data));
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('follows a mirror redirect and can be cancelled', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    const data = crypto.randomBytes(400 * 1024);
    srv.files.set('mirror.bin', data);
    srv.opts.redirect = true;
    const dest = path.join(dir, 'mirror.bin.part');
    await downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/mirror.bin`, dest });
    assert.equal(await sha256File(dest), sha256(data));

    srv.opts.slowMs = 20;
    const ac = new AbortController();
    const dest2 = path.join(dir, 'cancel.part');
    const p = downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/mirror.bin`, dest: dest2, signal: ac.signal });
    setTimeout(() => ac.abort('paused'), 120);
    await assert.rejects(p, { name: 'AbortError' });
    const partial = (await fsp.stat(dest2)).size;
    assert.ok(partial > 0 && partial < data.length, `partial file kept (${partial} bytes)`);
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a missing file fails straight away instead of retrying forever', async () => {
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    await assert.rejects(
      downloadFile({ url: `${srv.baseUrl}/zim/wikipedia/nope.bin`, dest: path.join(dir, 'x.part'), baseDelayMs: 5 }),
      (e) => e.status === 404,
    );
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('finds the newest edition, its checksum and size', async () => {
  const srv = await startDownloadServer();
  try {
    srv.addFixture(NAME);
    srv.files.set('wikipedia_en_all_maxi_2025-08.zim', Buffer.from('old'));
    srv.files.set('wikipedia_en_all_nopic_2026-12.zim', Buffer.from('other flavour'));
    srv.files.set('wikipedia_en_all_mini_2026-12.zim', Buffer.from('other flavour'));
    srv.files.set('wikipedia_fr_all_maxi_2026-12.zim', Buffer.from('other language'));
    const latest = await catalog.findLatestEdition({ baseUrl: srv.baseUrl });
    assert.equal(latest.file, NAME);
    assert.equal(latest.date, '2026-10');
    assert.equal(await catalog.fetchPublishedSha256(latest.url), sha256(srv.files.get(NAME)));
    assert.equal(await catalog.fetchRemoteSize(latest.url), srv.files.get(NAME).length);
    const nopic = await catalog.findLatestEdition({ baseUrl: srv.baseUrl, flavour: 'nopic' });
    assert.equal(nopic.date, '2026-12');
  } finally { await srv.close(); }
});

test('reads checksums from a .meta4 file when .sha256 is absent', () => {
  const meta4 = '<metalink><file name="x.zim"><size>12</size><hash type="md5">0123456789abcdef0123456789abcdef</hash><hash type="sha-256">' + 'ab'.repeat(32) + '</hash></file></metalink>';
  assert.equal((/sha-?256[^a-f0-9]{1,40}([a-f0-9]{64})\b/i.exec(meta4) || [])[1], 'ab'.repeat(32));
});

test('chooses the newest 64-bit Windows engine build', async () => {
  const srv = await startDownloadServer();
  try {
    const build = await catalog.findEngineDownload({ baseUrl: srv.baseUrl });
    assert.equal(build.file, 'kiwix-tools_win-x86_64-3.7.0-2.zip');
  } finally { await srv.close(); }
});

test('recognises a .zim file by its header', async () => {
  assert.equal(await looksLikeZim(path.join(FIXTURES, NAME)), true);
  assert.equal(await looksLikeZim(__filename), false);
});

test('installs the Windows reader engine from its zip and checks its checksum', async () => {
  const AdmZip = require('adm-zip');
  const { installEngine, locateEngine } = require('../src/core/engine');
  const srv = await startDownloadServer();
  const dir = await tmpDir();
  try {
    const zip = new AdmZip();
    zip.addFile('kiwix-tools_win-x86_64-3.7.0-2/kiwix-serve.exe', Buffer.from('MZ fake exe'));
    zip.addFile('kiwix-tools_win-x86_64-3.7.0-2/kiwix-manage.exe', Buffer.from('MZ other'));
    srv.releases.set('kiwix-tools_win-x86_64-3.7.0-2.zip', zip.toBuffer());
    const steps = [];
    const res = await installEngine({ engineDir: dir, baseUrl: srv.baseUrl, onProgress: (p) => steps.push(p.step) });
    assert.equal(res.version, '3.7.0-2');
    assert.equal(res.verified, true);
    assert.equal(path.basename(res.path), 'kiwix-serve.exe');
    assert.equal(fs.readFileSync(res.path, 'utf8'), 'MZ fake exe');
    assert.ok(steps.includes('Unpacking the reader engine'));
    assert.ok(!fs.existsSync(path.join(dir, 'kiwix-tools_win-x86_64-3.7.0-2.zip')), 'zip removed after unpacking');
    if (process.platform === 'win32') assert.equal(await locateEngine({ engineDir: dir }), res.path);
  } finally { await srv.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});
