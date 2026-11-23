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
  return async (pdf, o) => {
    const { onPage, signal } = o;
    log.push(path.basename(path.dirname(pdf)));
    const name = fs.readFileSync(pdf, 'utf8');
    if (/broken/.test(name)) throw new Error('not a PDF');
    if (/scan/.test(name)) { // a scanned book: every page a picture, with no words behind it
      for (const n of [1, 2]) await onPage({ n, total: 2, w: 400, h: 600, whole: true, scan: true, words: 0, paras: [], figs: [], img: { name: `p000${n}.webp`, w: 680, h: 1020 }, images: [{ name: `p000${n}.webp`, bytes: new Uint8Array([82, 73, 70, 70]) }], ...(o.ocr ? { ocr: new Uint8Array([n]) } : {}) });
      return { pages: 2, outline: [] };
    }
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
    assert.deepStrictEqual(lib.status().collections.map((c) => c.id), ['water', 'medicine', 'food', 'knots', 'milmed', 'disaster']);
    assert.deepStrictEqual(await lib.info('water'), { file: 'zimgit-water_en_2024-08.zim', date: '2024-08', bytes: 34, url: `${server.base}/zim/other/zimgit-water_en_2024-08.zim` });
    assert.strictEqual(lib.add('water'), true);
    assert.strictEqual(lib.add('water'), false); // already under way
    await lib.queue;
    const s = lib.status();
    const water = s.collections.find((c) => c.id === 'water');
    assert.strictEqual(water.error, null);
    assert.deepStrictEqual({ ...water.have, bytes: 0 }, { date: '2024-08', guides: 2, articles: 2, bytes: 0, skipped: 1, old: false });
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

test('scanned pages are read for their words; your own books are added and removed; an older collection is brought up to date', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-'));
  const seen = [];
  const recognise = async (bytes) => { seen.push(bytes[0]); return bytes[0] === 1 ? ['The bowline is the king of knots.', 'It makes a loop that will not slip.'] : []; };
  const lib = new GuidesLibrary({ dir, engineBin: async () => 'kiwix-serve', convert: fakeConvert([]), recognise, readZim, log: () => {} });
  const books = path.join(dir, 'from');
  try {
    await fsp.mkdir(books);
    await fsp.writeFile(path.join(books, 'Old_Knot_Book.pdf'), 'scan of a knot book');
    await fsp.writeFile(path.join(books, 'notes.pdf'), 'my notes');
    await fsp.writeFile(path.join(books, 'bad.pdf'), 'broken');
    await lib.init();
    assert.strictEqual(lib.addOwn([{ file: path.join(books, 'Old_Knot_Book.pdf') }, { file: path.join(books, 'bad.pdf') }]), true);
    assert.strictEqual(lib.addOwn([{ file: path.join(books, 'notes.pdf'), title: 'Camp notes', temp: true }]), true); // joins the run under way
    await lib.queue;
    const own = lib.status().own;
    assert.deepStrictEqual(own.books.map((b) => [b.id, b.title, b.pages, b.articles]), [['g001', 'Old Knot Book', 2, 1], ['g002', 'Camp notes', 2, 1]]);
    assert.match(own.error, /^One book could not be added: "bad" \(not a PDF\)$/);
    assert.deepStrictEqual(seen, [1, 2]);
    assert.ok(fs.existsSync(path.join(books, 'Old_Knot_Book.pdf')) && !fs.existsSync(path.join(books, 'notes.pdf'))); // the user's file stays; one made for the purpose goes
    assert.ok(fs.existsSync(path.join(dir, 'mine', 'g001', 'original.pdf')));
    // The words read from the scan are found by search, and the page is still shown as its picture.
    const hit = await lib.engine.search('bowline loop');
    assert.deepStrictEqual(hit.items.map((i) => [i.title, i.path]), [['Old Knot Book', 'mine/g001/1']]);
    const page = await fetchText(lib.engine.urlForPath('mine/g001/1'));
    assert.match(page.text, /<figure class="whole">.*p0001\.webp/s);
    assert.match(page.text, /<details class="words"><summary>The words on page 1, as read from the scan<\/summary><p>The bowline is the king of knots\.<\/p>/);
    assert.match((await fetchText(lib.engine.homeUrl())).text, /<h2 id="mine">My books<\/h2>/);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'mine', 'g001', 'guide.json'), 'utf8'));
    assert.deepStrictEqual([meta.read, meta.blank], [1, 1]);

    assert.strictEqual(await lib.removeOwn('g002'), true);
    assert.deepStrictEqual(lib.status().own.books.map((b) => b.id), ['g001']);
    await assert.rejects(lib.removeOwn('../x'), /Unknown book/);

    // A collection made before scans were read: marked as old, and brought up to date from its own PDFs.
    const file = path.join(dir, 'mine', 'collection.json');
    const col = JSON.parse(fs.readFileSync(file, 'utf8'));
    col.made = 1; delete col.guides[0].read; col.guides[0].words = 0;
    fs.writeFileSync(file, JSON.stringify(col));
    fs.writeFileSync(path.join(dir, 'mine', 'g001', 'text.json'), '[""]');
    await lib.engine.reload();
    assert.strictEqual((await lib.engine.search('bowline')).total, 0);
    seen.length = 0;
    assert.strictEqual(lib.improve('mine'), true);
    await lib.queue;
    assert.deepStrictEqual(seen, [1, 2]);
    assert.strictEqual((await lib.engine.search('bowline')).total, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).made, 2);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'mine')).sort(), ['collection.json', 'g001']);

    await lib.removeOwn('g001');
    assert.ok(!fs.existsSync(path.join(dir, 'mine')));
    assert.strictEqual(lib.status().ready, false);
  } finally { await lib.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('the words the reader is unsure of are left out: a drawing read as letters does not become text', () => {
  const { fromBlocks, tidy } = require('../src/core/ocr');
  const w = (text, confidence) => ({ text, confidence });
  const blocks = [{ paragraphs: [
    { lines: [{ words: [w('SQUARE', 96), w('KNOT:', 93), w('The', 95), w('basic', 91), w('tie', 90), w('for', 94), w('join-', 88)] }, { words: [w('ing', 90), w('two', 95), w('ropes.', 92)] }] },
    { lines: [{ words: [w('RIESE,', 21), w('SOD', 30), w('ED', 18), w('N', 12), w('Ag', 25)] }] },
    { lines: [{ words: [w('==', 80), w('|', 75)] }] },
  ] }];
  assert.deepStrictEqual(fromBlocks(blocks), ['SQUARE KNOT: The basic tie for joining two ropes.']);
  assert.deepStrictEqual(tidy('One line\nand the next.\n\n. , . _ -\n\nA second para-\ngraph.'), ['One line and the next.', 'A second paragraph.']);
});

test('a copy of a web site gives up its PDF documents, each titled by the link that leads to it', { skip: !require('./helpers').kiwixServePath() }, async () => {
  const { readWebZimWithEngine, nameFromFile } = require('../src/core/guides-library');
  const { listZim } = require('../src/core/zim-list');
  const { FIXTURES, kiwixServePath } = require('./helpers');
  const zim = path.join(FIXTURES, 'site.test_en_manuals_2026-10.zim');
  const inside = await listZim(zim, (m) => m === 'application/pdf');
  assert.deepStrictEqual(inside.map((e) => [e.path, e.ns]), [['site.test/manuals/bandage.pdf', 'C'], ['site.test/manuals/field-hygiene_2.pdf', 'C']]);
  await assert.rejects(listZim(__filename), /Not a \.zim file/);
  assert.strictEqual(nameFromFile('site.test/manuals/field-hygiene_2.pdf'), 'Field hygiene 2');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-'));
  const source = await readWebZimWithEngine(zim, { binPath: kiwixServePath(), log: () => {} });
  try {
    // One document is linked from the site's page under a real name; the other is known only by its file name
    // ("weak"), and takes the title written inside the PDF when it is converted.
    assert.deepStrictEqual(source.catalog.map((r) => [r.title, r.weak, r.files]), [['Bandaging and Splinting', false, ['site.test/manuals/bandage.pdf']], ['Field hygiene 2', true, ['site.test/manuals/field-hygiene_2.pdf']]]);
    await source.save('site.test/manuals/bandage.pdf', path.join(dir, 'one.pdf'));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'one.pdf')).subarray(0, 5).toString(), '%PDF-');
  } finally { await source.close(); await fsp.rm(dir, { recursive: true, force: true }); }
  // In the library: the collection is fetched from the folder it is kept in, and the weak title is replaced.
  const lib = new GuidesLibrary({ dir: await fsp.mkdtemp(path.join(os.tmpdir(), 'wv-guides-')), engineBin: async () => 'kiwix-serve', log: () => {},
    readWeb: async () => ({ catalog: [{ title: 'Field hygiene 2', weak: true, about: '', author: '', files: ['x/field-hygiene_2.pdf'] }], save: async (f, dest) => fsp.writeFile(dest, 'pdf'), close: async () => {} }),
    convert: async (pdf, o) => ({ ...(await fakeConvert([])(pdf, o)), title: 'Field Hygiene and Sanitation' }),
    download: async ({ dest }) => { await fsp.mkdir(path.dirname(dest), { recursive: true }); await fsp.writeFile(dest, 'zim'); return { size: 3 }; } });
  try {
    const asked = [];
    lib.info = async (id) => { asked.push(id); lib.latest[id] = { file: 'irp.fas.org_en_military-medicine_2026-10.zim', date: '2026-10', bytes: 3, url: 'http://127.0.0.1:9/x.zim' }; return lib.latest[id]; };
    await lib.init();
    lib.add('milmed');
    await lib.queue;
    const c = lib.status().collections.find((x) => x.id === 'milmed');
    assert.deepStrictEqual([c.error, c.have && c.have.guides, c.caution], [null, 1, true]);
    assert.deepStrictEqual(lib.engine.cols[0].guides.map((g) => g.title), ['Field Hygiene and Sanitation']);
  } finally { await lib.close(); await fsp.rm(lib.dir, { recursive: true, force: true }); }
});

test('a text reader that cannot start is tried once, not once a page; and the engine files Node loads are the ones packed', async () => {
  const { Reader } = require('../src/core/ocr');
  let tries = 0; const said = [];
  const r = new Reader({ log: (m) => said.push(m), create: async () => { tries += 1; throw new Error("Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'\nRequire stack:\n- a\n- b"); } });
  for (let i = 0; i < 5; i += 1) await assert.rejects(r.read(Buffer.from([1])), /could not be started \(Cannot find module 'tesseract\.js-core\/tesseract-core-relaxedsimd'\)$/);
  assert.strictEqual(tries, 1);
  assert.strictEqual(said.length, 1);
  assert.match(said[0], /scanned pages are kept as pictures without their words/);
  await r.close();
  // Under Node the library asks for one of these three, by what the processor can do (see its getCore.js). The
  // installer's list of what to leave out must not touch them, nor the English data the reader is pointed at.
  const build = require('../package.json').build;
  const left = build.files.filter((f) => f.startsWith('!')).map((f) => new RegExp(`^${f.slice(1).replace(/[.+^$()|{}]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`));
  for (const need of ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-relaxedsimd'].flatMap((n) => [`node_modules/tesseract.js-core/${n}.js`, `node_modules/tesseract.js-core/${n}.wasm`]).concat(['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'node_modules/tesseract.js/src/worker-script/node/index.js'])) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', need)), `${need} is not installed`);
    assert.ok(!left.some((re) => re.test(need)), `${need} is left out of the installer`);
    assert.ok(build.asarUnpack.some((u) => need.startsWith(u.replace(/\*\*$/, ''))), `${need} is not kept beside the archive`);
  }
  const getCore = fs.readFileSync(path.join(__dirname, '..', 'node_modules/tesseract.js/src/worker-script/node/getCore.js'), 'utf8');
  const asked = [...getCore.matchAll(/require\('tesseract\.js-core\/([a-z-]+)'\)/g)].map((m) => m[1]);
  assert.deepStrictEqual(asked.filter((n) => !n.endsWith('-lstm')).sort(), ['tesseract-core', 'tesseract-core-relaxedsimd', 'tesseract-core-simd']);
});
