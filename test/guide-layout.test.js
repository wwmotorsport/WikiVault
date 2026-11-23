'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/renderer/guide-layout');

// Lines of text as the PDF reader gives them: a string, where it starts, its baseline, its width and its size.
const line = (s, x, base, size = 10, w = s.length * size * 0.5) => ({ s, x, base, w, size });
const para = (x, top, lines, width = 220) => lines.map((s, i) => line(s, x, top + i * 12, 10, i === lines.length - 1 ? width * 0.5 : width));

test('two columns are read one after the other, and a title across them first', () => {
  const items = [
    line('Finding water', 60, 60, 20, 300),
    ...para(60, 100, ['left one', 'left two', 'left three', 'left four.']),
    ...para(320, 100, ['right one', 'right two', 'right three', 'right four.']),
  ];
  const plan = L.plan({ w: 612, h: 792, items, marks: [] });
  assert.deepStrictEqual(plan.paras.map((p) => p.text), ['Finding water', 'left one left two left three left four.', 'right one right two right three right four.']);
  assert.strictEqual(plan.whole, false);
  assert.strictEqual(plan.paras[0].size, 20);
});

test('a short line that ends a paragraph starts a new one, bullets are their own, and a word broken by a hyphen is mended', () => {
  const items = [
    line('Water that is cloudy should be fil-', 60, 100, 10, 400), line('tered through a clean cloth first.', 60, 112, 10, 200),
    line('Then boil it for one minute.', 60, 124, 10, 180),
    line('• Rainwater', 60, 150, 10, 60), line('• Rivers and streams', 60, 162, 10, 110),
  ];
  const plan = L.plan({ w: 612, h: 792, items, marks: [] });
  assert.deepStrictEqual(plan.paras.map((p) => [p.text, p.li]), [
    ['Water that is cloudy should be filtered through a clean cloth first.', false],
    ['Then boil it for one minute.', false], ['• Rainwater', true], ['• Rivers and streams', true],
  ]);
});

test('a drawing becomes a picture where it stands, its labels go with it, and small marks do not', () => {
  const marks = [
    { k: 'img', box: [100, 200, 400, 420] },                      // a photograph
    { k: 'path', box: [60, 96, 500, 97] },                        // a rule under a heading
    { k: 'img', box: [60, 500, 68, 508] },                        // a bullet drawn as a tiny image
    { k: 'path', box: [0, 0, 612, 792] },                         // the page's background
  ];
  const items = [line('Building a filter', 60, 90, 16, 200), ...para(60, 120, ['Layer sand and gravel', 'in a clean bucket.']), line('gravel', 200, 300, 8, 30), line('Fig. 1. A sand filter', 100, 440, 10, 150)];
  const plan = L.plan({ w: 612, h: 792, items, marks });
  assert.strictEqual(plan.figs.length, 1);
  assert.strictEqual(plan.figs[0].text, 'gravel');
  assert.ok(plan.figs[0].box[0] <= 100 && plan.figs[0].box[2] >= 400);
  assert.deepStrictEqual(plan.paras.map((p) => (p.fig != null ? '[picture]' : p.text)), ['Building a filter', 'Layer sand and gravel in a clean bucket.', '[picture]', 'Fig. 1. A sand filter']);
});

test('a page that is one scanned image is shown whole, with the words read from it kept', () => {
  const plan = L.plan({ w: 400, h: 600, items: para(40, 80, ['plants as indicators', 'of ground water']), marks: [{ k: 'img', box: [0, 0, 400, 600] }] });
  assert.strictEqual(plan.whole, true);
  assert.strictEqual(plan.scan, true);
  assert.strictEqual(plan.figs.length, 0);
  assert.match(plan.paras[0].text, /plants as indicators/);
});

test('a frame round a block of text is not a picture, and a footnote mark is not a line', () => {
  const items = [...para(70, 110, ['Boil water for one minute', 'before drinking it or', 'cooking with it.'], 240), line('5', 250, 105, 6, 4)];
  const plan = L.plan({ w: 612, h: 792, items, marks: [{ k: 'path', box: [60, 95, 330, 150] }] });
  assert.strictEqual(plan.figs.length, 0);
  assert.deepStrictEqual(plan.paras.map((p) => p.text), ['Boil water for one minute before drinking it or cooking with it.']);
});

test('what was painted is found through the transforms around it; clips and white fills are not drawings', () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, constructPath: 5, stroke: 6, fill: 7, endPath: 8, clip: 9, setFillRGBColor: 10, paintFormXObjectBegin: 11, paintFormXObjectEnd: 12 };
  const view = [1, 0, 0, -1, 0, 792]; // PDF pages count upward from the bottom; the page counts down from the top
  const fn = [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.constructPath, OPS.clip, OPS.endPath, OPS.constructPath, OPS.stroke, OPS.setFillRGBColor, OPS.constructPath, OPS.fill];
  const args = [null, [200, 0, 0, 100, 50, 600], ['img1', 10, 10], null, [[], [], [0, 612, 0, 792]], null, null, [[], [], [10, 110, 20, 60]], null, [255, 255, 255], [[], [], [0, 300, 0, 300]], null];
  const marks = L.marks(fn, args, OPS, view);
  assert.deepStrictEqual(marks, [{ k: 'img', box: [50, 92, 250, 192] }, { k: 'path', box: [10, 732, 110, 772] }]);
});
