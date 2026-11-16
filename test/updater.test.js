'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EditionManager, copyLibrary, removeLibraryFiles } = require('../src/core/updater');
const { probeZim } = require('../src/core/engine');
const { partialBytes } = require('../src/core/downloader');
const { startDownloadServer, tmpDir, sha256, kiwixServePath, FIXTURES } = require('./helpers');

const OCT = 'wikipedia_en_all_maxi_2026-10.zim';
const NOV = 'wikipedia_en_all_maxi_2026-11.zim';
const bin = kiwixServePath();

async function setup(extra = {}) {
  const srv = await startDownloadServer();
  const dataDir = await tmpDir();
  const activated = [];
  const settings = { baseUrl: srv.baseUrl, language: 'en', flavour: 'maxi', autoUpdate: true, checkIntervalHours: 24 };
  const mgr = new EditionManager({
    dataDir,
    getSettings: () => settings,
    // Use the real reader engine when it is installed, so "can the engine open it" is tested for real.
    probe: extra.probe || (bin ? (file) => probeZim(bin, file) : async () => ({ ok: true })),
    activate: async (file) => { activated.push(file); },
  });
  await mgr.init();
  const done = async () => { await srv.close(); await fsp.rm(dataDir, { recursive: true, force: true }); };
  return { srv, dataDir, mgr, activated, settings, done };
}

const zims = async (dataDir) => (await fsp.readdir(path.join(dataDir, 'zim'))).sort();
const parts = async (dataDir) => (await fsp.readdir(path.join(dataDir, 'downloads'))).sort();

test('first download: verified, opened by the engine, then made active', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.check();
    assert.equal(t.mgr.snapshot().updateAvailable, true);
    await t.mgr.update();
    const s = t.mgr.snapshot();
    assert.equal(s.phase, 'idle');
    assert.equal(s.error, null);
    assert.equal(s.active.file, OCT);
    assert.equal(s.active.date, '2026-10');
    assert.equal(s.active.sha256, sha256(t.srv.files.get(OCT)));
    assert.deepEqual(await zims(t.dataDir), [OCT]);
    assert.deepEqual(await parts(t.dataDir), []);
    assert.equal(t.activated.length, 1);
    assert.equal(s.updateAvailable, false);
  } finally { await t.done(); }
});

test('a newer edition replaces the old one only after it verifies', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    await t.mgr.check();
    assert.equal(t.mgr.snapshot().updateAvailable, true);
    assert.equal(t.mgr.snapshot().active.file, OCT, 'old edition still active while the new one is only known about');
    await t.mgr.update();
    const s = t.mgr.snapshot();
    assert.equal(s.active.file, NOV);
    assert.deepEqual(await zims(t.dataDir), [NOV], 'old edition removed, new one in place');
    assert.equal(t.activated.at(-1), path.join(t.dataDir, 'zim', NOV));
    // state survives a restart
    const again = new EditionManager({ dataDir: t.dataDir, getSettings: () => t.settings, probe: async () => ({ ok: true }), activate: async () => {} });
    assert.equal((await again.init()).active.file, NOV);
  } finally { await t.done(); }
});

test('a download that fails its checksum is discarded and the old edition stays', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    t.srv.opts.badChecksum = true;
    await t.mgr.check();
    await t.mgr.update();
    const s = t.mgr.snapshot();
    assert.equal(s.phase, 'error');
    assert.match(s.error, /did not match its published checksum/);
    assert.equal(s.active.file, OCT);
    assert.deepEqual(await zims(t.dataDir), [OCT]);
    assert.deepEqual(await parts(t.dataDir), []);
    assert.equal(t.activated.length, 1, 'never switched to the bad file');
  } finally { await t.done(); }
});

test('refuses to install an edition that has no published checksum', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    t.srv.opts.noChecksum = true;
    await t.mgr.update();
    const s = t.mgr.snapshot();
    assert.equal(s.active, null);
    assert.match(s.error, /did not publish a checksum/);
    assert.deepEqual(await zims(t.dataDir), []);
  } finally { await t.done(); }
});

test('a file the engine cannot open is rejected even if its checksum matches', async () => {
  const t = await setup({ probe: async (file) => (file.includes('2026-11') ? { ok: false, error: 'bad cluster' } : { ok: true }) });
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    await t.mgr.check();
    await t.mgr.update();
    const s = t.mgr.snapshot();
    assert.equal(s.active.file, OCT);
    assert.match(s.error, /reader could not open it/);
    assert.deepEqual(await zims(t.dataDir), [OCT]);
  } finally { await t.done(); }
});

test('pause keeps the partial file; resume finishes from where it stopped', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    t.srv.opts.slowMs = 25;
    const running = t.mgr.update();
    await new Promise((r) => setTimeout(r, 200));
    await t.mgr.pause();
    await running;
    let s = t.mgr.snapshot();
    assert.equal(s.phase, 'paused');
    assert.equal(s.active, null);
    const part = (await parts(t.dataDir)).find((n) => n.endsWith('.zim.part'));
    const partial = await partialBytes(path.join(t.dataDir, 'downloads', part));
    assert.ok(partial > 0 && partial < t.srv.files.get(OCT).length);

    // "Restart the app": a fresh manager sees the pending download and can resume it.
    const mgr2 = new EditionManager({ dataDir: t.dataDir, getSettings: () => t.settings, probe: async () => ({ ok: true }), activate: async () => {} });
    s = await mgr2.init();
    assert.equal(s.phase, 'paused');
    assert.equal(s.pending.file, OCT);
    t.srv.opts.slowMs = 0;
    t.srv.log.length = 0;
    await mgr2.update();
    assert.equal(mgr2.snapshot().active.file, OCT);
    assert.ok(t.srv.log.some((l) => l.includes(`bytes=${partial}-`)), 'resumed with a Range request');
  } finally { await t.done(); }
});

test('cancel removes the partial download', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    t.srv.opts.slowMs = 25;
    t.mgr.update();
    await new Promise((r) => setTimeout(r, 150));
    await t.mgr.cancel();
    assert.equal(t.mgr.snapshot().phase, 'idle');
    assert.deepEqual(await parts(t.dataDir), []);
  } finally { await t.done(); }
});

test('a dropped connection mid-download still ends in a verified edition', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    t.srv.opts.dropAfter = 20 * 1024;
    t.srv.opts.redirect = true;
    await t.mgr.update();
    assert.equal(t.mgr.snapshot().active?.file, OCT, t.mgr.snapshot().error || '');
    assert.ok(t.srv.log.filter((l) => /bytes=\d+-/.test(l)).length >= 2, 'resumed rather than restarted');
  } finally { await t.done(); }
});

test('being offline during a check leaves an existing library alone', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.settings.baseUrl = 'http://127.0.0.1:9'; // nothing listens here
    const s = await t.mgr.check();
    assert.equal(s.phase, 'idle');
    assert.equal(s.error, null);
    assert.equal(s.active.file, OCT);
  } finally { await t.done(); }
});

test('an existing .zim file can be adopted and is never deleted by an update', async () => {
  const t = await setup();
  const elsewhere = await tmpDir();
  try {
    const mine = path.join(elsewhere, OCT);
    await fsp.copyFile(path.join(FIXTURES, OCT), mine);
    await t.mgr.useLocalFile(mine);
    assert.equal(t.mgr.snapshot().active.path, mine);
    t.srv.addFixture(NOV);
    await t.mgr.check();
    await t.mgr.update();
    assert.equal(t.mgr.snapshot().active.file, NOV);
    assert.ok(fs.existsSync(mine), "the user's own file is left where it was");
    await assert.rejects(t.mgr.useLocalFile(__filename), /not a \.zim archive/);
  } finally { await t.done(); await fsp.rm(elsewhere, { recursive: true, force: true }); }
});

// ---- staged updates: download and verify on another drive, then move into a small library partition ----

async function setupStaged(extra = {}) {
  const srv = await startDownloadServer();
  const dataDir = await tmpDir('wikivault-vault-');
  const stagingDir = await tmpDir('wikivault-staging-');
  const settings = { baseUrl: srv.baseUrl, language: 'en', flavour: 'maxi', autoUpdate: true, checkIntervalHours: 24, stagingDir };
  const events = [];
  const vault = () => fs.readdirSync(path.join(dataDir, 'zim')).sort();
  const make = (over = {}) => new EditionManager({
    dataDir,
    getSettings: () => settings,
    probe: async (file) => { events.push({ step: 'probe', file, vault: vault() }); return (over.probe || (async () => ({ ok: true })))(file); },
    activate: async (file) => { events.push({ step: 'activate', file, vault: vault(), exists: fs.existsSync(file) }); },
    freeBytes: over.freeBytes,
  });
  const mgr = make(extra);
  await mgr.init();
  const staging = () => fs.readdirSync(stagingDir).sort();
  const done = async () => { await srv.close(); await fsp.rm(dataDir, { recursive: true, force: true }); await fsp.rm(stagingDir, { recursive: true, force: true }); };
  return { srv, dataDir, stagingDir, settings, mgr, make, events, vault, staging, done };
}

test('staged: the first download goes straight into the library', async () => {
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    assert.deepEqual(t.vault(), [OCT]);
    assert.deepEqual(t.staging(), [], 'nothing to protect yet, so nothing is staged');
    assert.equal(t.mgr.snapshot().active.path, path.join(t.dataDir, 'zim', OCT));
  } finally { await t.done(); }
});

test('staged: an update is verified on the other drive, used from there, then moved in', async () => {
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.events.length = 0;
    t.srv.addFixture(NOV);
    await t.mgr.check();
    const phases = [];
    t.mgr.on('change', (s) => { if (phases.at(-1) !== s.phase) phases.push(s.phase); });
    await t.mgr.update();

    const staged = path.join(t.stagingDir, NOV);
    const final = path.join(t.dataDir, 'zim', NOV);
    assert.deepEqual(t.events.map((e) => [e.step, e.file]), [['probe', staged], ['activate', staged], ['activate', final]]);
    assert.deepEqual(t.events[0].vault, [OCT], 'old edition still in the library while the new one is trial-opened');
    assert.deepEqual(t.events[1].vault, [OCT], 'and still there when the app switches to the staged copy');
    assert.equal(t.events[1].exists, true);
    assert.deepEqual(t.events[2].vault, [NOV], 'old edition gone and new one in place before the final switch');
    assert.deepEqual(phases, ['checking', 'downloading', 'verifying', 'switching', 'moving', 'verifying', 'switching', 'idle']);

    const s = t.mgr.snapshot();
    assert.equal(s.active.path, final);
    assert.equal(s.active.staged, false);
    assert.equal(s.relocating, false);
    assert.equal(s.error, null);
    assert.deepEqual(t.staging(), [], 'staging copy removed');
    assert.equal(sha256(fs.readFileSync(final)), sha256(t.srv.files.get(NOV)));
    assert.ok(t.srv.log.some((l) => l.includes(NOV)));
  } finally { await t.done(); }
});

test('staged: a bad download never touches the library', async () => {
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    t.srv.opts.badChecksum = true;
    await t.mgr.check();
    await t.mgr.update();
    assert.match(t.mgr.snapshot().error, /did not match its published checksum/);
    assert.equal(t.mgr.snapshot().active.file, OCT);
    assert.deepEqual(t.vault(), [OCT]);
    assert.deepEqual(t.staging(), []);
  } finally { await t.done(); }
});

test('staged: an interrupted move resumes after a restart, and Wikipedia stays usable meanwhile', async () => {
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    await t.mgr.check();
    // "Close the app" at the moment the move into the library begins.
    t.mgr.on('change', (s) => { if (s.phase === 'moving') t.mgr.abort.abort('quit'); });
    await t.mgr.update();
    const staged = path.join(t.stagingDir, NOV);
    assert.deepEqual(t.staging(), [NOV]);
    assert.deepEqual(t.vault().filter((n) => n.endsWith('.zim')), [], 'old edition removed, copy not finished yet');

    const mgr2 = t.make();
    const s = await mgr2.init();
    assert.equal(s.active.path, staged, 'the verified staged copy is the edition in use');
    assert.equal(s.relocating, true);
    // A half-written copy from before the interruption is continued rather than restarted.
    const whole = fs.readFileSync(staged);
    fs.writeFileSync(path.join(t.dataDir, 'zim', `${NOV}.copying`), whole.subarray(0, 20000));
    await mgr2.update();
    assert.equal(mgr2.snapshot().active.path, path.join(t.dataDir, 'zim', NOV));
    assert.deepEqual(t.vault(), [NOV]);
    assert.deepEqual(t.staging(), []);
    assert.equal(sha256(fs.readFileSync(path.join(t.dataDir, 'zim', NOV))), sha256(whole));
  } finally { await t.done(); }
});

test('staged: a corrupted copy is caught by the checksum and made again', async () => {
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    await t.mgr.check();
    t.mgr.on('change', (s) => { if (s.phase === 'moving' && !t.poisoned) { t.poisoned = true; t.mgr.abort.abort('quit'); } });
    await t.mgr.update();
    const size = fs.statSync(path.join(t.stagingDir, NOV)).size;
    fs.writeFileSync(path.join(t.dataDir, 'zim', `${NOV}.copying`), Buffer.alloc(size, 1)); // right size, wrong bytes
    const mgr2 = t.make();
    await mgr2.init();
    await mgr2.update();
    assert.equal(mgr2.snapshot().error, null);
    assert.equal(sha256(fs.readFileSync(path.join(t.dataDir, 'zim', NOV))), sha256(t.srv.files.get(NOV)));
    assert.deepEqual(t.staging(), []);
  } finally { await t.done(); }
});

test('staged: no room on the staging drive, or an edition too big for the partition, leaves everything as it was', async () => {
  const GBY = 1024 ** 3;
  let stagingFree = 1 * GBY;
  let vaultFree = 500 * GBY;
  const t = await setupStaged();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    const mgr = t.make({ freeBytes: async (dir) => (dir.startsWith(t.stagingDir) ? stagingFree : vaultFree) });
    await mgr.init();
    t.srv.addFixture(NOV);
    await mgr.check();
    await mgr.update();
    assert.match(mgr.snapshot().error, /needs 10 GB free in .*staging.* Your current edition is untouched/);
    assert.equal(mgr.snapshot().active.file, OCT);
    assert.deepEqual(t.vault(), [OCT]);

    stagingFree = 500 * GBY;
    vaultFree = 0;
    await mgr.update();
    assert.match(mgr.snapshot().error, /no longer fits in the library's partition/);
    assert.deepEqual(t.vault(), [OCT]);
    assert.equal(mgr.snapshot().active.file, OCT);

    vaultFree = 500 * GBY;
    await mgr.update();
    assert.equal(mgr.snapshot().active.file, NOV);
    assert.deepEqual(t.vault(), [NOV]);
  } finally { await t.done(); }
});

// ---- moving the library to another folder ----

test('move library: copied, verified, usable from the new folder, and only then removed from the old one', async () => {
  const t = await setup();
  const dest = path.join(await tmpDir('wikivault-newlib-'), 'Wikivault');
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    const oldFile = t.mgr.snapshot().active.path;
    const stages = [];
    const res = await copyLibrary({ manager: t.mgr, toDir: dest, onProgress: (p) => stages.push(p.stage) });
    assert.equal(res.activePath, path.join(dest, 'zim', OCT));
    assert.ok(fs.existsSync(oldFile), 'the original is still in place after the copy');
    assert.equal(sha256(fs.readFileSync(res.activePath)), t.mgr.snapshot().active.sha256);
    assert.ok(stages.includes('copy') && stages.includes('verify'));

    // The new folder is a complete library on its own.
    const moved = new EditionManager({ dataDir: dest, getSettings: () => t.settings, probe: async () => ({ ok: true }), activate: async () => {} });
    const s = await moved.init();
    assert.equal(s.active.path, res.activePath);
    assert.equal(s.active.date, '2026-10');
    assert.equal(s.active.managed, true);

    fs.writeFileSync(path.join(t.dataDir, 'my-notes.txt'), 'keep me');
    await removeLibraryFiles(t.dataDir);
    assert.ok(!fs.existsSync(oldFile));
    assert.ok(!fs.existsSync(path.join(t.dataDir, 'state.json')));
    assert.deepEqual(fs.readdirSync(t.dataDir), ['my-notes.txt'], 'only the library\'s own files are removed');

    // And it keeps updating from there.
    t.srv.addFixture(NOV);
    await moved.check();
    await moved.update();
    assert.equal(moved.snapshot().active.file, NOV);
    assert.deepEqual(fs.readdirSync(path.join(dest, 'zim')), [NOV]);
  } finally { await t.done(); await fsp.rm(path.dirname(dest), { recursive: true, force: true }); }
});

test('move library: refuses bad destinations and leaves the original alone', async () => {
  const t = await setup();
  const other = await tmpDir('wikivault-other-');
  try {
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: other }), /no edition to move/);
    t.srv.addFixture(OCT);
    await t.mgr.update();
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: path.join(t.dataDir, 'inside') }), /not inside the current library/);
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: t.dataDir }), /not inside the current library/);
    fs.writeFileSync(path.join(other, 'state.json'), '{}');
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: other }), /already holds a Wikivault library/);
    fs.rmSync(path.join(other, 'state.json'));
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: other, freeBytes: async () => 1024 }), /has 0 GB free/);
    assert.deepEqual(await zims(t.dataDir), [OCT]);
    assert.equal(t.mgr.snapshot().active.file, OCT);
  } finally { await t.done(); await fsp.rm(other, { recursive: true, force: true }); }
});

test('move library: a copy that does not match is discarded', async () => {
  const t = await setup();
  const dest = await tmpDir('wikivault-newlib-');
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    const size = fs.statSync(t.mgr.snapshot().active.path).size;
    fs.mkdirSync(path.join(dest, 'zim'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'zim', `${OCT}.copying`), Buffer.alloc(size, 9)); // a "finished" but wrong copy
    await assert.rejects(copyLibrary({ manager: t.mgr, toDir: dest }), /did not match the checksum.*original is untouched/);
    assert.deepEqual(fs.readdirSync(path.join(dest, 'zim')), []);
    assert.ok(!fs.existsSync(path.join(dest, 'state.json')));
    assert.deepEqual(await zims(t.dataDir), [OCT]);
  } finally { await t.done(); await fsp.rm(dest, { recursive: true, force: true }); }
});

// ---- parallel download with mirrors, as the app uses it ----

test('updates are fetched from the mirrors Kiwix lists, and still verified as a whole', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    t.srv.mirrors.one = {};
    t.srv.mirrors.two = {};
    t.srv.mirrors.gone = { missing: true };
    const notes = [];
    t.mgr.log = (m) => notes.push(m);
    await t.mgr.update();
    assert.equal(t.mgr.snapshot().active.file, OCT);
    assert.equal(t.mgr.snapshot().active.sha256, sha256(t.srv.files.get(OCT)));
    assert.ok(t.srv.log.some((l) => l.includes('.zim.meta4')), 'asked for the mirror list');
    assert.ok(notes.some((n) => /^mirrors, fastest first: localhost:\d+ [\d.]+ MB\/s, localhost:\d+/.test(n)), notes.join(' | '));
    assert.ok((t.srv.served.one || 0) + (t.srv.served.two || 0) > 0, 'data came from the mirrors');
    assert.deepEqual(await parts(t.dataDir), [], 'no partial files or progress records left behind');
  } finally { await t.done(); }
});

test('if a mirror serves bad data, the checksum catches it and the retry avoids the mirrors', async () => {
  const t = await setup();
  try {
    t.srv.addFixture(OCT);
    await t.mgr.update();
    t.srv.addFixture(NOV);
    t.srv.mirrors.rotten = { corrupt: true };
    await t.mgr.check();
    await t.mgr.update();
    assert.match(t.mgr.snapshot().error, /did not match its published checksum/);
    assert.equal(t.mgr.snapshot().active.file, OCT, 'current edition untouched');
    assert.deepEqual(await zims(t.dataDir), [OCT]);

    t.srv.log.length = 0;
    await t.mgr.update();
    assert.equal(t.mgr.snapshot().active.file, NOV, t.mgr.snapshot().error || '');
    assert.ok(!t.srv.log.some((l) => l.includes('/mirrors/') && l.includes('.zim ')), 'second attempt did not use the mirrors');
    assert.ok(!t.srv.log.some((l) => l.startsWith('GET /mirrors/')), 'second attempt did not use the mirrors');
  } finally { await t.done(); }
});
