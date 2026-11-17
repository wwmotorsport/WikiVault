'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const school = require('../src/core/school');
const { SchoolLibrary } = require('../src/core/school-library');
const { extractPages } = require('../src/core/pdf-text');
const { makePdf } = require('./helpers-pdf');

const G5 = school.loadManifest(path.join(school.MANIFEST_DIR, 'grade5.json'));

test('the Grade 5 registry is whole: four subjects, every file a PDF on the publisher\'s site, no name used twice', () => {
  assert.deepEqual(G5.subjects.map((s) => s.id), ['ela', 'math', 'hist', 'sci']);
  const files = school.allFiles(G5);
  assert.equal(files.length, 105);
  for (const f of files) {
    assert.match(f.url, /^https:\/\/www\.coreknowledge\.org\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/]+\.pdf$/, f.url);
    assert.match(f.id, /^[a-z0-9-]+$/);
  }
  assert.equal(new Set(files.map((f) => f.id)).size, files.length);
  // A name with an accent in it still gets a plain id, and its address is sent percent-encoded.
  const guero = files.find((f) => /Güero/.test(f.name));
  assert.equal(guero.id, 'ckla-g5-u1-they-call-me-guero-activity-book-2r');
  assert.match(new URL(guero.url).href, /G%C3%BCero/);
  // Books shared by several units are one file.
  assert.deepEqual(files.find((f) => f.id === 'ckhg-g5-b1-renaissanceage-tg-online').units, ['hist-u4', 'hist-u5', 'hist-u6']);
  for (const s of G5.subjects) for (const u of s.units) {
    assert.ok(u.files.some((f) => f.role === 'teacher'), `${u.id} has a teacher file`);
    assert.ok(u.focus && u.page.startsWith('https://www.coreknowledge.org/free-resource/'), u.id);
    for (const id of u.buy || []) assert.ok(G5.shopping.some((b) => b.id === id), `${u.id} needs ${id}`);
  }
});

test('a year is 36 weeks of 5 days; every lesson is placed once, in order, spread through the year', () => {
  const y = school.buildYear(G5);
  assert.equal(y.weeks.length, 36);
  assert.equal(y.slots, 180);
  assert.deepEqual(y.totals.map((t) => [t.subject, t.sessions]), [['ela', 152], ['math', 156], ['hist', 130], ['sci', 131]]);
  const all = y.weeks.flatMap((w) => w.days.flat());
  assert.equal(all.length, 152 + 156 + 130 + 131);
  assert.equal(new Set(all.map((x) => x.id)).size, all.length, 'no day twice');
  for (const s of G5.subjects) {
    const mine = all.filter((x) => x.subject === s.id);
    const expected = s.units.flatMap((u) => school.unitSessions(s, u)).map((x) => x.id);
    assert.deepEqual(mine.map((x) => x.id), expected, `${s.id} keeps the publisher's order`);
  }
  // No subject is taught more than once on a day when it has fewer days than the year.
  for (const w of y.weeks) for (const d of w.days) assert.ok(d.length <= 4);
  assert.deepEqual(y.weeks[0].days[0].map((x) => `${x.subject} ${x.label}`), ['ela Beginning-of-year assessment (day 1 of 2)', 'math Lesson 1', 'hist Chapter 1', 'sci Day 1 of 20']);
  assert.equal(y.weeks[0].semester, 1);
  assert.equal(y.weeks[18].semester, 2);
  assert.deepEqual(y.weeks[0].summary.map((s) => `${s.name}: ${s.units.map((u) => `Unit ${u.n} ${u.covers}`).join('; ')}`), [
    'Language Arts: Unit 1 Beginning-of-year assessment, Lessons 1 to 3', 'Mathematics: Unit 1 Lessons 1 to 5',
    'History and Geography: Unit 1 Chapters 1 to 4', 'Science: Unit 1 Days 1 to 4']);
  // The last language arts days of the year are the end-of-year assessment and the novel study.
  assert.match(all.filter((x) => x.subject === 'ela').at(-1).id, /^ela-u9:day:15$/);
});

test('skipping a unit takes its days out and closes the gap', () => {
  const y = school.buildYear(G5, { skip: ['ela-u7', 'sci-u6'] });
  assert.deepEqual(y.totals.map((t) => t.sessions), [152 - 14, 156, 130, 131 - 7]);
  assert.ok(!y.weeks.flatMap((w) => w.days.flat()).some((x) => x.unitId === 'ela-u7' || x.unitId === 'sci-u6'));
});

// Page texts shaped like the publisher's books: a contents page, running heads, an answer key.
const teacherGuide = [
  'Finding Volume\nTeacher Guide',
  'Table of Contents\nSection A: Lessons 1-5 Unit Cubes . . . . . . . 14\nSection B: Lessons 6-11 Expressions . . . . . 70\nAssessments . . . . . . . . . . 170\nLesson 1 Lesson 2 Lesson 3 Lesson 4',
  'Unit Overview\nIn Lesson 1 students build. In Lesson 2 they count. Lesson 3 and Lesson 4 follow. Pacing Guide for the unit',
  'Grade 5 Unit 1 Lesson 1\nLesson 1: What Is Volume?\nWarm-up',
  'Grade 5 Unit 1 Lesson 1\nActivity 2\nStudents recall Lesson 2 of grade 4.',
  'Grade 5 Unit 1 Lesson 2\nLesson 2: Measure Volume\nWarm-up',
  'Grade 5 Unit 1 Lesson 12\nLesson 12: Lots of cubes',
  'Grade 5 Unit 1 Lesson 3\nLesson 3: Volume of Prisms',
  'Assessments\nEnd-of-Unit Assessment\n1. Find the volume.',
  'Answer Key\nLesson 1: 24 cubes\nLesson 2: 30 cubes',
];

test('a lesson is found by the heading of its first page, not by the contents page or a passing mention', () => {
  assert.equal(school.isChart(teacherGuide[1], 'Lesson'), true);
  assert.equal(school.isChart(teacherGuide[3], 'Lesson'), false);
  assert.equal(school.findLesson(teacherGuide, 'Lesson', 1), 3);
  assert.equal(school.findLesson(teacherGuide, 'Lesson', 2), 5, 'the mention of "Lesson 2" inside lesson 1 is not its start');
  assert.equal(school.findLesson(teacherGuide, 'Lesson', 3), 7);
  assert.equal(school.findLesson(teacherGuide, 'Lesson', 12), 6, '"Lesson 1" does not match "Lesson 12"');
  assert.equal(school.findLesson(teacherGuide, 'Lesson', 9), null);
  assert.equal(school.findHeading(teacherGuide, ['end-of-unit assessment', 'assessments'], { from: 3 }), 8);
  assert.equal(school.findHeading(teacherGuide, ['answer key'], { from: 4 }), 9);
  assert.equal(school.findHeading(teacherGuide, ['pacing guide']), null, 'only in the heading of a page, and not on a chart page');
});

test('in a book that holds several units, each unit\'s chapters are found in its own part', () => {
  const filler = (n, text) => Array.from({ length: n }, () => text);
  const book = [
    'From the Renaissance to England\'s Golden Age', 'Contents\nChapter 1 . . 2 Chapter 2 . . 10 Chapter 3 Chapter 4',
    'CHAPTER 1\nA New Dawn', ...filler(14, 'The Renaissance\nmore text'), 'CHAPTER 2\nFrom Artisan to Artist', ...filler(14, 'text'),
    'CHAPTER 1\nAn Age of Change', ...filler(14, 'The Reformation\ntext about chapter 1 of the earlier part'), 'CHAPTER 2\nThe Birth of Protestantism',
  ];
  assert.equal(school.findLesson(book, 'Chapter', 1, 1), 2);
  assert.equal(school.findLesson(book, 'Chapter', 2, 1), 17);
  assert.equal(school.findLesson(book, 'Chapter', 1, 2), 32);
  assert.equal(school.findLesson(book, 'Chapter', 2, 2), 47);
  assert.equal(school.findLesson(book, 'Chapter', 1, 3), null, 'no third part in this book');
});

test('activity pages are found by their number, and a day gets the right buttons', () => {
  const activity = ['Activity Book', 'NAME:\n1.1 ACTIVITY PAGE\nDefine', 'NAME:\n1.2 TAKE-HOME', 'NAME:\n11.1 ACTIVITY PAGE', 'NAME:\n2.1 ACTIVITY PAGE'];
  assert.equal(school.findActivity(activity, 1), 1);
  assert.equal(school.findActivity(activity, 2), 4);
  assert.equal(school.findActivity(activity, 11), 3);
  assert.equal(school.findActivity(activity, 7), null);

  const math = G5.subjects.find((s) => s.id === 'math');
  const unit = math.units[0];
  const [lesson2] = school.unitSessions(math, unit).filter((x) => x.kind === 'lesson' && x.n === 2);
  const texts = { [unit.files[0].id]: teacherGuide };
  const links = school.linksFor(lesson2, unit, math, (id) => texts[id] || null);
  assert.deepEqual(links.map((l) => [l.label, l.ready, l.page]), [['Lesson plan', true, 6], ['Student pages', false, null], ['Answer key', true, 10]]);
  const test_ = school.unitSessions(math, unit).at(-1);
  assert.equal(test_.kind, 'assessment');
  assert.deepEqual(school.linksFor(test_, unit, math, (id) => texts[id] || null).map((l) => [l.label, l.page]), [['The test', 9], ['Answer key', 10]]);
  // Before anything is read a science day points at the teacher guide; history chapters open the reader at the chapter.
  const sci = G5.subjects.find((s) => s.id === 'sci');
  assert.deepEqual(school.linksFor(school.unitSessions(sci, sci.units[0])[0], sci.units[0], sci, () => null).map((l) => l.label), ['Teacher guide', 'Reader', 'Answer key']);
  const hist = G5.subjects.find((s) => s.id === 'hist');
  assert.deepEqual(school.linksFor(school.unitSessions(hist, hist.units[0])[0], hist.units[0], hist, () => null).map((l) => l.label), ['Lesson plan', 'Reading', 'Answer key']);
});

test('search finds pages with every word, best first, with a snippet', () => {
  const books = [{ id: 'a', pages: ['Volume of prisms\nA prism has layers of cubes.', 'Fractions', 'The volume of a cube and the prism. Prism again.'] }, { id: 'b', pages: ['Prisms bend light', ''] }];
  const hits = school.searchPages(books, 'prism volume');
  assert.deepEqual(hits.map((h) => [h.fileId, h.page]), [['a', 1], ['a', 3]]);
  assert.match(hits[0].snippet, /Volume of prisms/);
  assert.deepEqual(school.searchPages(books, 'light').map((h) => h.fileId), ['b']);
  assert.deepEqual(school.searchPages(books, ''), []);
  assert.deepEqual(school.searchPages(books, 'zebra'), []);
});

test('text comes out of a PDF page by page, top of the page first', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wikivault-pdf-'));
  try {
    const file = path.join(dir, 't.pdf');
    await fsp.writeFile(file, makePdf([['Grade 5 Unit 7 Lesson 1', 'Lesson 1: Explore (the) Grid', '12'], ['Answer Key']]));
    assert.deepEqual(await extractPages(file), ['Grade 5 Unit 7 Lesson 1\nLesson 1: Explore (the) Grid\n12', 'Answer Key']);
    await fsp.writeFile(file, 'not a pdf at all');
    await assert.rejects(extractPages(file));
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

/** A stand-in for the publisher's site: any .pdf path gets a small book whose text depends on its name. */
function fakePublisher({ fail = [] } = {}) {
  const asked = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('/').pop());
    asked.push(name);
    if (fail.some((f) => name.includes(f))) { res.writeHead(404).end('gone'); return; }
    if (name.includes('NotAPdf')) { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>blocked</html>'); return; }
    const body = makePdf([[name, 'Teacher Guide'], ['Contents', 'Lesson 1 Lesson 2 Lesson 3 Lesson 4'], ['Lesson 1', `Opening of ${name}`], ['Lesson 2', 'photosynthesis and volume'], ['Answer Key', 'Lesson 1: yes']]);
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': body.length, 'accept-ranges': 'bytes' }).end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ asked, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

test('the library downloads every file, reads it, plans the year, searches, and keeps progress', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wikivault-school-'));
  const site = await fakePublisher({ fail: ['CKSci_G5Astronomy_SR'] });
  const make = () => new SchoolLibrary({ dir, manifest: G5, extract: (f) => extractPages(f), rewrite: (u) => u.replace('https://www.coreknowledge.org', site.base), log: () => {} });
  try {
    const lib = make();
    let st = await lib.init();
    assert.deepEqual([st.files, st.have, st.indexed, st.sessions, st.sessionsDone, st.currentWeek], [105, 0, 0, 569, 0, 1]);
    let w = lib.week(1);
    assert.equal(w.days[0][1].links[0].ready, false, 'nothing to open before the download');

    const ticks = [];
    lib.on('change', (s) => ticks.push(s.job ? `${s.job.kind}:${s.job.done}/${s.job.total}` : 'idle'));
    const r = await lib.downloadAll();
    assert.deepEqual(r.failed, ['CKSci_G5Astronomy_SR.pdf']);
    st = lib.status();
    assert.deepEqual([st.have, st.indexed, st.job], [104, 104, null]);
    assert.match(st.error, /1 file could not be downloaded \(CKSci_G5Astronomy_SR\.pdf\)/);
    assert.ok(ticks.includes('download:104/105') || ticks.includes('download:105/105'));
    assert.ok(ticks.some((t) => t.startsWith('index:')));
    assert.ok(site.asked.some((n) => /G.ero/.test(n)), 'the accented file name was asked for');
    assert.ok(fs.existsSync(path.join(dir, 'g5', 'math', 'CKMath_G5U1_FindingVolume_TG_W2.pdf')));
    assert.ok(!fs.readdirSync(path.join(dir, 'g5', 'sci')).some((n) => n.endsWith('.part')), 'no half file is left behind');

    w = lib.week(1);
    const mathDay1 = w.days[0].find((x) => x.subject === 'math');
    assert.deepEqual(mathDay1.links.map((l) => [l.label, l.here, l.page]), [['Lesson plan', true, 3], ['Student pages', true, 3], ['Answer key', true, 5]]);
    assert.deepEqual(w.summary[1].units[0].focus.slice(0, 6), 'Volume');

    const hits = lib.search('photosynthesis volume');
    assert.equal(hits.length, 40, 'capped');
    assert.deepEqual([hits[0].page, typeof hits[0].label, typeof hits[0].where], [4, 'string', 'string']);

    await lib.setDone(w.days.flat().map((x) => x.id), true);
    assert.equal(lib.status().currentWeek, 2);
    await lib.setSkip('sci-u6', true);
    assert.equal(lib.overview().subjects[3].units[5].skipped, true);
    assert.equal(lib.overview().subjects[3].units[5].weeks, null);
    await lib.setHave('quixote', true);

    // A book of the user's own.
    const mine = path.join(dir, 'Math_Mammoth_5A.pdf');
    await fsp.writeFile(mine, makePdf([['Math Mammoth', 'long division practice']]));
    assert.equal(await lib.addBooks([mine]), 1);
    assert.deepEqual(lib.search('long division').map((h) => [h.subjectName, h.label]), [['Books I have added', 'Math Mammoth 5A']]);
    await assert.rejects(lib.addBooks([path.join(dir, 'progress-g5.json').replace('.json', '.pdf')]));

    // Everything is still there after a restart, and a second download fetches only what is missing.
    const again = make();
    st = await again.init();
    assert.deepEqual([st.have, st.indexed, st.added, st.currentWeek], [104, 105, 1, 2]);
    assert.equal(again.overview().shopping.find((b) => b.id === 'quixote').have, true);
    assert.equal(again.status().sessions, 569 - 7);
    const before = site.asked.length;
    await again.downloadAll();
    assert.equal(site.asked.length - before, 1, 'only the missing file is tried again');
    await again.removeBook('added-math-mammoth-5a');
    assert.deepEqual(again.search('long division'), []);
  } finally { await site.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});

test('something that is not a PDF is not kept, and a download can be stopped', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wikivault-school-'));
  const site = await fakePublisher();
  try {
    const small = { ...G5, subjects: [{ ...G5.subjects[1], units: [{ ...G5.subjects[1].units[0], files: [{ role: 'teacher', label: 'Teacher Guide', url: 'https://www.coreknowledge.org/wp-content/uploads/2023/09/NotAPdf.pdf', id: 'notapdf', name: 'NotAPdf.pdf' }] }], extras: [] }] };
    const lib = new SchoolLibrary({ dir, manifest: small, extract: (f) => extractPages(f), rewrite: (u) => u.replace('https://www.coreknowledge.org', site.base) });
    await lib.init();
    const r = await lib.downloadAll();
    assert.deepEqual(r.failed, ['NotAPdf.pdf']);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'g5', 'math')), []);

    const slow = new SchoolLibrary({ dir, manifest: G5, extract: (f) => extractPages(f), rewrite: (u) => u, download: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    await slow.init();
    const p = slow.downloadAll();
    await assert.rejects(slow.downloadAll(), /already being worked on/);
    slow.cancel();
    assert.equal((await p).stopped, true);
    assert.equal(slow.status().job, null);
    assert.equal(slow.status().error, null);
  } finally { await site.close(); await fsp.rm(dir, { recursive: true, force: true }); }
});
