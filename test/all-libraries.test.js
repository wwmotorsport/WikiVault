'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { AllLibraries, interleave } = require('../src/core/all-libraries');

// A stand-in reader engine: a few pages, found by a word in their title or text.
function lib(port, pages, { slow = 0, broken = false } = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const wait = (signal) => new Promise((ok, no) => { const t = setTimeout(ok, slow); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); });
  return {
    running: true, origin,
    urlForPath: (p) => `${origin}/content/x/${p}`,
    pathForUrl: (u) => (String(u).startsWith(`${origin}/content/x/`) ? String(u).slice(`${origin}/content/x/`.length) : null),
    suggest: async (term, n, { signal } = {}) => { await wait(signal); if (broken) throw new Error('down'); return pages.filter((p) => p.title.toLowerCase().includes(term.toLowerCase())).slice(0, n).map((p) => ({ title: p.title, path: p.path, url: `${origin}/content/x/${p.path}` })); },
    search: async (q, { pageLength = 20, signal } = {}) => { await wait(signal); if (broken) throw new Error('down'); const hits = pages.filter((p) => q.toLowerCase().split(' ').every((w) => (p.title + ' ' + p.text).toLowerCase().includes(w))); return { total: hits.length, items: hits.slice(0, pageLength).map((p) => ({ title: p.title, path: p.path, url: `${origin}/content/x/${p.path}`, link: `/content/x/${p.path}`, snippet: [], words: 100 })) }; },
    fetchHtml: async (url) => ({ text: `<html><head><title>${pages.find((p) => url.endsWith(p.path)).title}</title></head><body><p>${pages.find((p) => url.endsWith(p.path)).text}</p></body></html>`, status: 200, url }),
  };
}

test('libraries are asked together: results side by side, each page knowing its library, pages fetched from the right one', async () => {
  const wiki = lib(1001, [{ path: 'Water', title: 'Water', text: 'Water is a compound. Boiling water kills germs.' }, { path: 'Boiling', title: 'Boiling', text: 'Boiling is a phase change of water.' }]);
  const guides = lib(1002, [{ path: 'water/g001/1', title: 'Purifying Water', text: 'Boil water for one minute to make it safe.' }]);
  const all = new AllLibraries([{ id: 'wikipedia', name: 'Wikipedia', engine: wiki }, { id: 'guides', name: 'Survival Guides', engine: guides }, { id: 'off', name: 'Not running', engine: { running: false } }]);
  assert.strictEqual(all.many, true);
  assert.deepStrictEqual(all.libs.map((l) => l.id), ['wikipedia', 'guides']);
  const found = await all.search('water');
  assert.strictEqual(found.total, 3);
  assert.deepStrictEqual(found.items.map((i) => [i.lib, i.path]), [['wikipedia', 'wikipedia::Water'], ['guides', 'guides::water/g001/1'], ['wikipedia', 'wikipedia::Boiling']]);
  assert.deepStrictEqual((await all.suggest('water')).map((h) => h.path), ['wikipedia::Water', 'guides::water/g001/1']);
  assert.strictEqual(all.urlForPath('guides::water/g001/1'), 'http://127.0.0.1:1002/content/x/water/g001/1');
  assert.strictEqual(all.pathForUrl('http://127.0.0.1:1002/content/x/water/g001/1'), 'guides::water/g001/1');
  assert.strictEqual(all.pathForUrl('http://127.0.0.1:9/content/x/y'), null);
  assert.match((await all.fetchHtml('http://127.0.0.1:1002/content/x/water/g001/1')).text, /Purifying Water/);
  await assert.rejects(all.fetchHtml('http://example.com/x'), /Not a page in the offline copy/);
  assert.deepStrictEqual(interleave([[1, 2, 3], [], ['a']]), [1, 'a', 2, 3]);
});

test('a library that is down or slow is left out, and the others answer; Ask finds its passages across them', async () => {
  const wiki = lib(1001, [{ path: 'Apollo_11', title: 'Apollo 11', text: 'Apollo 11 was the first crewed landing on the Moon.' }]);
  const guides = lib(1002, [{ path: 'water/g001/1', title: 'Purifying Water', text: 'Boil the water for one minute to make it safe to drink.' }]);
  const down = lib(1003, [{ path: 'x', title: 'Water towers', text: 'water' }], { broken: true });
  const slow = lib(1004, [{ path: 'y', title: 'Water slow', text: 'water' }], { slow: 400 });
  const all = new AllLibraries([{ id: 'wikipedia', name: 'Wikipedia', engine: wiki }, { id: 'guides', name: 'Survival Guides', engine: guides }, { id: 'down', name: 'Down', engine: down }, { id: 'slow', name: 'Slow', engine: slow }], { timeoutMs: 80 });
  const found = await all.search('water');
  assert.deepStrictEqual(found.items.map((i) => i.path), ['guides::water/g001/1']);
  // The open library is Wikipedia, which has nothing on the question; the passage comes from the guides all the same.
  const { retrieve } = require('../src/core/rag');
  const got = await retrieve(all, 'How long should I boil water to make it safe to drink?');
  assert.ok(got.passages.length >= 1);
  assert.ok(got.passages.every((p) => all.libOf(p.url).id === 'guides'), JSON.stringify(got.passages.map((p) => p.url)));
  assert.match(got.passages[0].text, /for one minute to make it safe/);
});
