'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { smartSearch, titleScore, relaxations, markHits } = require('../src/core/search');

/** A stand-in engine: full-text results per query, a title index, and article openings. */
function fakeEngine({ fullText = {}, titles = [], leads = {} }) {
  const item = (title) => ({ title, path: title.replace(/ /g, '_'), url: `http://x/content/z/${title.replace(/ /g, '_')}`, snippet: [{ text: `…${title} body…`, hit: false }], words: 1000 });
  const calls = [];
  return {
    calls,
    async search(q, { start = 0, pageLength = 20 } = {}) {
      calls.push(`search:${q}:${start}`);
      const all = (fullText[q.toLowerCase()] || []).map(item);
      return { total: all.length, items: all.slice(start, start + pageLength) };
    },
    async suggest(q, count) {
      calls.push(`suggest:${q}`);
      return titles.filter((t) => t.toLowerCase().includes(q.toLowerCase())).slice(0, count).map((t) => ({ title: t, path: t.replace(/ /g, '_'), url: item(t).url }));
    },
    async fetchHtml(url) {
      const title = decodeURIComponent(url.split('/').pop()).replace(/_/g, ' ');
      return { text: `<html><body><h1>${title}</h1><div id="mw-content-text"><p>${leads[title] || `${title} is a thing.`}</p></div></body></html>` };
    },
  };
}

test('the case from the real edition: "differential" leads with the articles of that name', async () => {
  // What the engine returned on the full English edition: body-frequency order, no article called "Differential".
  const engine = fakeEngine({
    fullText: { differential: ['Differential equation', 'Partial differential equation', 'List of differential geometry topics', 'Ordinary differential equation', 'Differential geometry'] },
    titles: ['Differential', 'Differential (automobile)', 'Differential (calculus)', 'Differential Analyzer', 'Differential equation'],
    leads: { Differential: 'Differential may refer to several things in mathematics and engineering.' },
  });
  const r = await smartSearch(engine, 'differential');
  const titles = r.items.map((i) => i.title);
  assert.deepEqual(titles.slice(0, 4), ['Differential', 'Differential (automobile)', 'Differential (calculus)', 'Differential equation']);
  assert.equal(titles.at(-1), 'List of differential geometry topics', 'lists sink unless asked for');
  assert.equal(new Set(titles).size, titles.length, 'an article found both ways appears once');
  assert.ok(r.items[0].snippet.some((p) => p.hit && /Differential/.test(p.text)), 'a title-only result gets its opening lines, with the word marked');
  assert.equal(r.nextStart, 5);
  assert.equal(r.total, 9);
});

test('title scoring: exact, parenthetical, plural, starts-with, partial, lists', () => {
  const s = (t, q) => titleScore(t, q);
  assert.ok(s('Moon landing', 'moon landing') > s('Moon landing conspiracy theories', 'moon landing'));
  assert.ok(s('Mercury (planet)', 'mercury') > s('Mercury poisoning', 'mercury'));
  assert.ok(s('Differential', 'differentials') > s('Differential equation', 'differentials'));
  assert.ok(s('Apollo 11', 'apollo 11') > s('Apollo 11 in popular culture', 'apollo 11'));
  assert.ok(s('History of the bicycle', 'bicycle history') > s('Bicycle', 'bicycle history') * 0.9);
  assert.equal(s('Photosynthesis', 'saturn rocket'), 0);
  assert.ok(s('List of rivers of France', 'rivers france') < s('Rivers of France', 'rivers france'));
  assert.ok(s('List of rivers of France', 'list of rivers france') >= s('Rivers of France', 'list of rivers france'), 'a list is not marked down when a list was asked for');
  assert.ok(s('Café', 'cafe') === 100, 'accents do not matter');
});

test('when no article has every word, filler words go first, then one word at a time, and the result says which', async () => {
  const engine = fakeEngine({ fullText: { 'saturn rocket': ['Saturn V', 'Saturn I'], 'engine saturn': ['F-1 (rocket engine)'] }, titles: [] });
  const filler = await smartSearch(engine, 'what is the saturn rocket');
  assert.equal(filler.usedQuery, 'saturn rocket');
  assert.deepEqual(filler.dropped, []);
  const typo = await smartSearch(engine, 'saturn rocket xqzv');
  assert.equal(typo.usedQuery, 'saturn rocket');
  assert.deepEqual(typo.dropped, ['xqzv']);
  assert.deepEqual(typo.items.map((i) => i.title), ['Saturn V', 'Saturn I']);
  const none = await smartSearch(engine, 'zzzz qqqq');
  assert.equal(none.total, 0);
  assert.deepEqual(relaxations('one'), [], 'a single word has nothing to drop');
});

test('later pages are the engine\'s own, continuing after the fifty already ordered', async () => {
  const many = Array.from({ length: 120 }, (_, i) => `Article ${i}`);
  const engine = fakeEngine({ fullText: { article: many }, titles: [] });
  const first = await smartSearch(engine, 'article');
  assert.equal(first.items.length, 50);
  assert.equal(first.nextStart, 50);
  const second = await smartSearch(engine, first.usedQuery, { start: first.nextStart });
  assert.deepEqual([second.items[0].title, second.items.length, second.nextStart], ['Article 50', 20, 70]);
  assert.ok(!engine.calls.includes('suggest:article:50'));
});

test('marking query words in an excerpt keeps the text intact', () => {
  const parts = markHits('The differentials of a car, and a differential equation.', 'differential');
  assert.equal(parts.map((p) => p.text).join(''), 'The differentials of a car, and a differential equation.');
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['differentials', 'differential']);
});
