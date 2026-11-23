'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { build, readCatalog, calm } = require('../src/core/guide-build');

const p = (text, o = {}) => ({ text, size: 10, lines: 3, x0: 60, x1: 500, y0: 300, y1: 340, li: false, ...o });
const pageOf = (n, paras, o = {}) => ({ n, w: 612, h: 792, whole: false, figs: [], paras, ...o });

test('running heads and page numbers are taken out, headings are told from text, and a paragraph over a page break is joined', () => {
  const head = (n) => p(`Field Water Manual   ${n}`, { lines: 1, y0: 30, y1: 42 });
  const pages = [
    pageOf(1, [head(1), p('PURIFYING WATER', { size: 18, lines: 1 }), p('Water from a stream must be treated before it is drunk, and the surest way is to')]),
    pageOf(2, [head(2), p('boil it for one full minute.'), p('Boiling', { size: 12.5, lines: 1 }), p('• Bring to a rolling boil', { li: true, lines: 1 }), p('- 3 -', { lines: 1, y0: 760, y1: 770 })]),
    pageOf(3, [head(3), p('Let it cool before drinking.')]),
  ];
  const out = build({ title: 'Field Water Manual' }, pages);
  assert.strictEqual(out.sections.length, 1);
  assert.deepStrictEqual(out.sections[0].blocks.filter((b) => b.t !== 'pb').map((b) => [b.t, b.x]), [
    ['h', 'Purifying water'],
    ['p', 'Water from a stream must be treated before it is drunk, and the surest way is to boil it for one full minute.'],
    ['h', 'Boiling'], ['li', '• Bring to a rolling boil'], ['p', 'Let it cool before drinking.'],
  ]);
  assert.deepStrictEqual(out.sections[0].blocks.filter((b) => b.t === 'h').map((b) => b.l), [2, 3]);
  assert.doesNotMatch(out.sections[0].text, /Field Water Manual|- 3 -/);
  assert.strictEqual(out.body, 10);
});

test('a long guide is divided into articles by its own contents, and a long chapter into parts', () => {
  const pages = Array.from({ length: 40 }, (_, i) => pageOf(i + 1, [p(`Words of page ${i + 1} about wells.`)]));
  const out = build({ title: 'Wells' }, pages, [{ title: 'INTRODUCTION', page: 1 }, { title: 'Digging', page: 5 }, { title: 'Lining', page: 6 }, { title: 'Upkeep', page: 30 }]);
  // "Lining" begins a page after "Digging": too close to be its own article. "Digging" runs 25 pages: three parts.
  assert.deepStrictEqual(out.sections.map((s) => [s.title, s.from, s.to]), [['Introduction', 1, 4], ['Digging, part 1', 5, 13], ['Digging, part 2', 14, 22], ['Digging, part 3', 23, 29], ['Upkeep', 30, 40]]);
  const none = build({ title: 'Wells' }, pages);
  assert.deepStrictEqual(none.sections.map((s) => [s.title, s.from, s.to]), [['Pages 1 to 10', 1, 10], ['Pages 11 to 20', 11, 20], ['Pages 21 to 30', 21, 30], ['Pages 31 to 40', 31, 40]]);
});

test('pictures and pages shown whole keep their place and their words', () => {
  const pages = [
    pageOf(1, [p('How to tie it.'), { fig: 0, y0: 400, y1: 500, x0: 60, x1: 300 }], { figs: [{ box: [60, 400, 300, 500], text: 'standing end  working end', img: { name: 'p0001-1.webp', w: 480, h: 200 } }] }),
    pageOf(2, [p('the bowline is the king of knots')], { whole: true, img: { name: 'p0002.webp', w: 1000, h: 1400 } }),
  ];
  const out = build({ title: 'Knots' }, pages);
  const blocks = out.sections[0].blocks.filter((b) => b.t !== 'pb');
  assert.deepStrictEqual(blocks.map((b) => [b.t, b.src || null, b.page]), [['p', null, 1], ['fig', 'p0001-1.webp', 1], ['page', 'p0002.webp', 2]]);
  assert.strictEqual(blocks[1].x, 'standing end working end');
  assert.match(out.sections[0].text, /king of knots/);
});

test('the catalog of a collection is read as data, with either kind of quote, and nothing in it is run', () => {
  const text = "var DATABASE = [\n{'_id': '00000', 'ti': 'Distillation', 'dsc': \"It's old\", 'aut': 'MSU', 'fp': ['Water (1).pdf']},\n{'_id': '00001', 'ti': 'Two files', 'dsc': '', 'aut': '', 'fp': ['a.pdf', '../b.pdf', 'c.exe']},\n];";
  assert.deepStrictEqual(readCatalog(text), [
    { title: 'Distillation', about: "It's old", author: 'MSU', files: ['Water (1).pdf'] },
    { title: 'Two files', about: '', author: '', files: ['a.pdf'] },
  ]);
  assert.deepStrictEqual(readCatalog('var DATABASE = [process.exit(1)];'), []);
  assert.deepStrictEqual(readCatalog('nothing here'), []);
  assert.strictEqual(calm('CHAPTER II WATER'), 'Chapter II water');
});
