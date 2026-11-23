'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { GuidesLibrary } = require('../src/core/guides-library');
const { terms } = require('../src/core/guides-engine');
const { extractArticle } = require('../src/core/extract');
const { fetchText } = require('../src/core/httpx');

// A stand-in for the Kiwix server: the listing of its "other" folder, and a file with its checksum.
function kiwix(body) {
  const crypto = require('node:crypto');
  const sum = crypto.createHash('sha256').update(body).digest('hex');
  const server = http.createServer((req, res) => {
    if (req.url === '/zim/other/') res.end('<a href="zimgit-water_en_2024-06.zim">x</a> <a href="zimgit-water_en_2024-08.zim">y</a> <a href="zimgit-knots_en_2024-08.zim">z</a>');
    else if (req.url === '/zim/other/zimgit-water_en_2024-08.zim.sha256') res.end(`${sum}  zimgit-water_en_2024-08.zim\n`);
    else if (req.url.endsWith('.zim')) { res.writeHead(200, { 'content-length': body.length }); res.end(req.method === 'HEAD' ? undefined : body); }
    else { res.writeHead(404); res.end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

// A stand-in for the converter window: every "PDF" is two pages of text, the first with a picture.
const para = (text, o = {}) => ({ text, size: 10, lines: 3, x0: 60, x1: 500, y0: 300, y1: 340, li: false, ...o });
function fakeConvert(log) {
  return async (pdf, { onPage, signal }) => {
    log.push(path.basename(path.dirname(pdf)));
    const name = fs.readFileSync(pdf, 'utf8');
    if (/broken/.test(name)) throw new Error('not a PDF');
    await onPage({ n: 1, total: 2, w: 612, h: 792, whole: false, words: 9, paras: [para('BOILING WATER', { size: 18, lines: 1 }), para(`Boil the water from ${name} for one minute to make it safe.`), { fig: 0, y0: 400, y1: 500, x0: 60, x1: 300 }], figs: [{ box: [60, 400, 300, 500], text: 'pot lid steam', img: { name: 'p0001-1.webp', w: 480, h: 200 } }], images: [{ name: 'p0001-1.webp', bytes: new Uint8Array([82, 73, 70, 70]) }, { name: '../evil.webp', bytes: new Uint8Array([1]) }] });
    if (signal.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; }
    await onPage({ n: 2, total: 2, w: 612, h: 792, whole: false, words: 7, paras: [para('Filters made of sand and charcoal clear cloudy water.')], figs: [], images: [] });
    return { pages: 2, outline: [] };
  };
}
const readZim = async () => ({
  catalog: [{ title: 'Purifying Water', about: 'In an emergency', author: 'Dept of Health', files: ['Water (1).pdf'] }, { title: 'A broken one', about: '', author: '', files: ['Water (2).pdf'] }, { title: 'Finding Springs', about: '', author: '', files: ['Water (3).pdf'] }],
  save: async (file, dest) => fsp.writeFile(dest, file === 'Water (2).pdf' ? 'broken' : file),
  close: async () => {},
});

test('a collection is fetched, checked, converted and served: pages, pictures, search, suggestions and passages for Ask', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-'));
  const server = await kiwix(Buffer.from('ZIM\x04 a stand-in for the collection'));
  const converted = []; const lines = [];
  const lib = new GuidesLibrary({ dir, getSettings: () => ({ baseUrl: server.base }), engineBin: async () => 'kiwix-serve', convert: fakeConvert(converted), readZim, log: (m) => lines.push(m) });
  try {
    await lib.init();
    assert.strictEqual(lib.status().ready, false);
    assert.deepStrictEqual(lib.status().collections.map((c) => c.id), ['water', 'medicine', 'food', 'knots', 'disaster']);
    assert.deepStrictEqual(await lib.info('water'), { file: 'zimgit-water_en_2024-08.zim', date: '2024-08', bytes: 34, url: `${server.base}/zim/other/zimgit-water_en_2024-08.zim` });
    assert.strictEqual(lib.add('water'), true);
    assert.strictEqual(lib.add('water'), false); // already under way
    await lib.queue;
    const s = lib.status();
    const water = s.collections.find((c) => c.id === 'water');
    assert.strictEqual(water.error, null);
    assert.deepStrictEqual({ ...water.have, bytes: 0 }, { date: '2024-08', guides: 2, articles: 2, bytes: 0, skipped: 1 });
    assert.ok(water.have.bytes > 0 && s.ready && s.articles === 2 && !s.busy);
    assert.deepStrictEqual(converted, ['g001', 'g002', 'g003']);
    assert.ok(lines.some((l) => /"A broken one" could not be converted and was left out: not a PDF/.test(l)));
    assert.ok(lines.some((l) => /fetched and checked/.test(l)));
    // The collection file is gone, the PDFs and pictures are kept, and nothing was written outside the guide's folder.
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'incoming')), []);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'water')).sort(), ['collection.json', 'g001', 'g003']);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'water', 'g001', 'i')), ['p0001-1.webp']);
    assert.ok(!fs.existsSync(path.join(dir, 'water', 'g001', 'evil.webp')) && !fs.existsSync(path.join(dir, 'water', 'evil.webp')));

    const e = lib.engine;
    const found = await e.search('boiling water safe');
    assert.strictEqual(found.total, 2);
    assert.deepStrictEqual(found.items.map((i) => i.path).sort(), ['water/g001/1', 'water/g003/1']);
    assert.ok(found.items[0].snippet.some((p) => p.hit && /^boil/i.test(p.text)));
    assert.strictEqual((await e.search('charcoal bicycle')).total, 0); // every word has to be there
    assert.deepStrictEqual((await e.suggest('purif')).map((x) => x.title), ['Purifying Water']);
    assert.strictEqual(e.pathForUrl(e.urlForPath('water/g001/1')), 'water/g001/1');
    assert.deepStrictEqual(terms('How do I filter the water?'), ['filter', 'water']);

    const page = await fetchText(e.urlForPath('water/g001/1'));
    assert.match(page.text, /<h1>Purifying Water<\/h1>/);
    assert.match(page.text, /<h2>Boiling water<\/h2>/);
    assert.match(page.text, /<img loading="lazy" src="[^"]+\/water\/g001\/i\/p0001-1\.webp" width="480" height="200"/);
    assert.match(page.text, /original\.pdf#page=1/);
    const passages = extractArticle(page.text);
    const all = JSON.stringify(passages);
    assert.match(all, /Boil the water from Water \(1\)\.pdf for one minute/);
    assert.doesNotMatch(all, /Open the original|Survival Guides ›|not professional advice/); // navigation and notices are not passages
    // Ask finds its passages here the way it does in Wikipedia.
    const { retrieve } = require('../src/core/rag');
    const got = await retrieve(e, 'How long should I boil water to make it safe?');
    assert.ok(got.passages.length >= 1);
    assert.ok(got.passages.some((x) => /for one minute to make it safe/.test(x.text) && /\/content\/guides\/water\/g00[13]\/1/.test(x.url)), JSON.stringify(got.passages).slice(0, 400));
    const home = await fetchText(e.homeUrl());
    assert.match(home.text, /<h2 id="water">Water<\/h2>/);
    assert.match(home.text, /Finding Springs/);
    const img = await fetchText(`${e.contentBase()}/water/g001/i/p0001-1.webp`);
    assert.strictEqual(img.text, 'RIFF');
    for (const bad of ['water/g001/i/..%2F..%2Fcollection.json', 'water/g002/1', 'water/g001/9', '../x']) {
      const r = await fetchText(`${e.contentBase()}/${bad}`, { allowError: true });
      assert.strictEqual(r.status, 404, bad);
    }

    assert.strictEqual(await lib.remove('water'), true);
    assert.ok(!fs.existsSync(path.join(dir, 'water')));
    assert.strictEqual(lib.status().ready, false);
  } finally { await lib.close(); await server.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a download that does not match its checksum is thrown away, and a cancelled collection leaves nothing behind', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-'));
  const server = await kiwix(Buffer.from('ZIM\x04 a stand-in for the collection'));
  let slow = null;
  const lib = new GuidesLibrary({ dir, getSettings: () => ({ baseUrl: server.base }), engineBin: async () => 'kiwix-serve', readZim, log: () => {},
    convert: async (pdf, o) => { if (slow) await slow(o.signal); return fakeConvert([])(pdf, o); },
    download: async ({ dest }) => { await fsp.mkdir(path.dirname(dest), { recursive: true }); await fsp.writeFile(dest, 'something else'); return { size: 14 }; } });
  try {
    await lib.init();
    lib.add('water');
    await lib.queue;
    assert.match(lib.status().collections[0].error, /did not match its published checksum/);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'incoming')), []);

    lib.download = async ({ dest }) => { await fsp.mkdir(path.dirname(dest), { recursive: true }); await fsp.writeFile(dest, 'ZIM\x04 a stand-in for the collection'); return { size: 34 }; };
    slow = (signal) => new Promise((ok) => { signal.addEventListener('abort', ok); setTimeout(ok, 5000); });
    lib.add('water');
    const converting = new Promise((ok) => { const t = setInterval(() => { if (lib.status().collections[0].phase === 'converting') { clearInterval(t); ok(); } }, 10); });
    await converting;
    assert.strictEqual(lib.status().busy, true);
    lib.cancel('water');
    await lib.queue;
    const water = lib.status().collections[0];
    assert.deepStrictEqual([water.phase, water.error, water.have], ['idle', null, null]);
    assert.ok(!fs.existsSync(path.join(dir, 'water')));
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'incoming')), []);
    // Without the reader engine there is nothing to open a collection with, and that is said.
    lib.engineBin = async () => null;
    lib.add('knots');
    await lib.queue;
    assert.match(lib.status().collections.find((c) => c.id === 'knots').error, /reader engine is not installed/);
  } finally { await lib.close(); await server.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('a real collection file is opened with the reader engine: its catalog is read and its PDFs are taken out', { skip: !require('./helpers').kiwixServePath() }, async () => {
  const { readZimWithEngine } = require('../src/core/guides-library');
  const { FIXTURES, kiwixServePath } = require('./helpers');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-'));
  const source = await readZimWithEngine(path.join(FIXTURES, 'zimgit-water_en_2024-08.zim'), { binPath: kiwixServePath(), log: () => {} });
  try {
    assert.deepStrictEqual(source.catalog.map((r) => [r.title, r.files]), [['Sand Filters and Boiling', ['Water (1).pdf']], ['Storing Water', ['Water (2).pdf']]]);
    await source.save('Water (1).pdf', path.join(dir, 'one.pdf'));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'one.pdf')).subarray(0, 5).toString(), '%PDF-');
  } finally { await source.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});
