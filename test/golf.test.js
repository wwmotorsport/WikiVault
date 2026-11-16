'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GolfGame, makeHole, articleLinks, canonical, pathOf, isArticleUrl, scoreName, strokeLimit, cleanNames } = require('../src/core/golf');

const ORIGIN = 'http://127.0.0.1:9999';
const BASE = `${ORIGIN}/content/wiki_en`;
const u = (name) => `${BASE}/${name}`;

/** A small library as a link graph. Every page gets filler links that lead nowhere useful. */
function library(graph) {
  const html = (name) => `<html><head><title>${name.replace(/_/g, ' ')}</title></head><body><div id="mw-content-text">
    <table class="infobox"><tr><td><a href="Infobox_only">Infobox only</a></td></tr></table>
    <p>${name} lead text that is long enough to read. ${(graph[name] || []).map((l) => `<a href="${l}" title="${l.replace(/_/g, ' ')}">${l}</a>`).join(' and ')}
    <a href="#cite">[1]</a> <a href="https://example.org/x">outside</a> <a href="File:Photo.jpg">photo</a> <a href="I/pic.png">pic</a></p>
    <div class="navbox"><a href="Navbox_only">Navbox only</a></div></div></body></html>`;
  const seen = [];
  let r = 0;
  const names = Object.keys(graph);
  return {
    seen,
    getPage: async (url) => {
      if (url.startsWith(`${ORIGIN}/random`)) { const name = names[r++ % names.length]; return { url: u(name), text: html(name) }; }
      const name = pathOf(url, BASE);
      seen.push(name);
      if (!(name in graph)) throw new Error('404');
      return { url: u(name), text: html(name) };
    },
  };
}

test('links are read from the running text only, once each, as full addresses', () => {
  const lib = library({ A: ['B', 'C', 'B', 'D'] });
  return lib.getPage(u('A')).then((page) => {
    const links = articleLinks(page.text, page.url, BASE);
    assert.deepEqual(links.map((l) => l.url), [u('B'), u('C'), u('D')]);
    assert.equal(links[0].title, 'B');
  });
});

test('addresses are compared without fragments, queries or escapes', () => {
  assert.equal(canonical(`${BASE}/Saturn%20V?x=1#History`), `${BASE}/Saturn%20V`);
  assert.equal(canonical(`${BASE}/Mercury_%28planet%29`), canonical(`${BASE}/Mercury_(planet)`), 'however the brackets are written');
  assert.equal(canonical(`${BASE}/Pok%C3%A9mon`), canonical(`${BASE}/Pokémon`));
  // A question mark or a hash that belongs to the title stays part of the page, and the address still works.
  assert.equal(canonical(`${BASE}/What_is_life%3F`), `${BASE}/What_is_life%3F`);
  assert.notEqual(canonical(`${BASE}/What_is_life%3F`), canonical(`${BASE}/What_is_life`));
  assert.equal(pathOf(`${BASE}/Physics/What_is_light%3F`, BASE), 'Physics/What_is_light?');
  assert.ok(!isArticleUrl(`${BASE}/Category%3APhysics/Essays`, BASE), 'a category with a subpage is still a category');
  assert.ok(isArticleUrl(`${BASE}/Star_Trek:_Voyager`, BASE));
  assert.ok(!isArticleUrl(`${BASE}/File:Photo.jpg`, BASE));
  assert.ok(!isArticleUrl(`${BASE}/I/pic.png`, BASE));
  assert.ok(!isArticleUrl(`${ORIGIN}/content/other/Page`, BASE));
});

test('a hole is laid out by walking links, never doubling back, and its par is one more than the walk', async () => {
  const lib = library({ A: ['B', 'List_of_things', '1969'], B: ['A', 'C'], C: ['B', 'D'], D: ['C', 'E'], E: ['D'] });
  const hole = await makeHole({ getPage: lib.getPage, randomUrl: `${ORIGIN}/random?content=wiki_en`, contentBase: BASE, steps: 3, rng: () => 0.5 });
  assert.deepEqual(hole.route, ['A', 'B', 'C', 'D']);
  assert.equal(hole.start.url, u('A'));
  assert.equal(hole.target.url, u('D'));
  assert.equal(hole.steps, 3);
  assert.equal(hole.par, 4);
  assert.match(hole.target.lead, /D lead text/);
  assert.ok(!lib.seen.includes('List_of_things') && !lib.seen.includes('1969'), 'lists and bare years are not walked to');
});

test('a small library gives a shorter hole instead of none, and a dead end is an error', async () => {
  const lib = library({ A: ['B'], B: [] });
  const hole = await makeHole({ getPage: lib.getPage, randomUrl: `${ORIGIN}/random`, contentBase: BASE, steps: 4, rng: () => 0 });
  assert.deepEqual(hole.route, ['A', 'B']);
  assert.equal(hole.par, 2);
  const none = library({ A: [], B: [] });
  await assert.rejects(makeHole({ getPage: none.getPage, randomUrl: `${ORIGIN}/random`, contentBase: BASE, steps: 2, attempts: 3 }), /Could not lay out a hole/);
});

test('a target one click from the tee is not accepted for a longer hole when a better one exists', async () => {
  // From A the walk A > B > C ends on a page A links to directly. From D it does not.
  const lib = library({ A: ['B', 'C'], B: ['C'], C: [], D: ['E'], E: ['F'], F: [] });
  const hole = await makeHole({ getPage: lib.getPage, randomUrl: `${ORIGIN}/random`, contentBase: BASE, steps: 2, rng: () => 0 });
  assert.deepEqual(hole.route, ['D', 'E', 'F']);
});

test('score names', () => {
  assert.equal(scoreName(1, 4), 'Hole in one');
  assert.equal(scoreName(2, 5), 'Albatross');
  assert.equal(scoreName(2, 4), 'Eagle');
  assert.equal(scoreName(3, 4), 'Birdie');
  assert.equal(scoreName(4, 4), 'Par');
  assert.equal(scoreName(5, 4), 'Bogey');
  assert.equal(scoreName(6, 4), 'Double bogey');
  assert.equal(scoreName(9, 4), '5 over par');
  assert.equal(strokeLimit(4), 12);
});

test('player names are tidied, made unique and limited to six', () => {
  assert.deepEqual(cleanNames(['  Ada ', '', 'Ada', 'x'.repeat(40)]), ['Ada', 'Player 2', 'Ada 2', 'x'.repeat(24)]);
  assert.equal(cleanNames(new Array(9).fill('P')).length, 6);
  assert.deepEqual(cleanNames([]), ['Player 1']);
});

const HOLE = (from, to, par = 3) => ({ start: { url: u(from), title: from }, target: { url: u(to), title: to, lead: `${to} lead` }, steps: par - 1, par, route: [from, 'Mid', to] });

test('a two-player round: strokes, hidden routes, rotation of the tee, and the scorecard', () => {
  const g = new GolfGame({ players: ['Ada', 'Ben'], holes: 3, length: 'mixed' });
  assert.equal(g.phase, 'layout');
  assert.equal(g.stepsForNext(), 3);
  g.setHole(HOLE('A', 'D'));
  let s = g.snapshot();
  assert.equal(s.phase, 'tee');
  assert.equal(s.player, 'Ada');
  assert.equal(s.canRelay, true);
  assert.equal(s.hole.route, null, 'the route is not given away');

  assert.equal(g.teeOff(), u('A'));
  assert.equal(g.visit(u('Somewhere_else')), null, 'nothing counts before the start page has opened');
  assert.equal(g.visit(`${u('A')}?x=1`), 'start');
  assert.equal(g.visit(`${u('A')}#History`), null, 'a jump within the page is free');
  assert.equal(g.visit(u('B')), 'stroke');
  assert.equal(g.visit(`${BASE}/I/photo.jpg`), null, 'opening a picture is free');
  assert.equal(g.visit(u('A')), 'stroke', 'going back costs a stroke');
  assert.equal(g.snapshot().live.strokes, 2);
  assert.equal(g.visit(u('D')), 'holed');
  s = g.snapshot();
  assert.equal(s.phase, 'done');
  assert.equal(s.last.strokes, 3);
  assert.equal(s.last.name, 'Par');
  assert.equal(s.last.path, null, 'the next player does not see the route');
  assert.equal(s.nextPlayer, 'Ben');
  assert.equal(g.visit(u('E')), null, 'clicks after the hole is finished do not count');

  assert.equal(g.next(), 'tee');
  assert.equal(g.snapshot().canRelay, false);
  assert.throws(() => g.relay(), /already been started/);
  g.teeOff();
  g.visit(u('A'));
  g.giveUp();
  s = g.snapshot();
  assert.equal(s.last.strokes, 9);
  assert.equal(s.last.name, 'Picked up');
  assert.equal(s.nextPlayer, null);

  assert.equal(g.next(), 'summary');
  s = g.snapshot();
  assert.deepEqual(s.cards.map((c) => [c.player, c.strokes]), [['Ada', 3], ['Ben', 9]]);
  assert.deepEqual(s.cards[0].path, ['A', 'B', 'A', 'D']);
  assert.deepEqual(s.hole.route, ['A', 'Mid', 'D']);

  assert.equal(g.next(), 'layout');
  assert.equal(g.stepsForNext(), 2);
  g.setHole(HOLE('E', 'F', 2));
  assert.equal(g.snapshot().player, 'Ben', 'the other player tees off first on the second hole');
  g.teeOff(); g.visit(u('E')); assert.equal(g.visit(u('F')), 'holed');
  assert.equal(g.snapshot().last.name, 'Hole in one');
  g.next();
  g.teeOff(); g.visit(u('E'));
  for (let i = 0; i < 5; i++) assert.equal(g.visit(u(`X${i}`)), 'stroke');
  assert.equal(g.visit(u('X5')), 'limit', 'the hole ends at three times par');
  assert.equal(g.snapshot().last.name, 'Out of strokes');
  g.next();
  g.next();
  g.setHole(HOLE('G', 'H'));
  for (const strokes of [2, 2]) { g.teeOff(); g.visit(u('G')); if (strokes === 2) g.visit(u('Mid')); g.visit(u('H')); g.next(); }
  assert.equal(g.next(), 'finished');
  s = g.snapshot();
  assert.equal(s.standings.par, 8);
  assert.deepEqual(s.standings.rows.map((r) => [r.name, r.strokes, r.toPar, r.place]), [['Ada', 11, 3, 1], ['Ben', 12, 4, 2]]);
  assert.deepEqual(s.scorecard.map((h) => h.strokes), [[3, 9], [6, 1], [2, 2]]);
  assert.throws(() => g.next(), /Nothing to move on/);
});

test('a different hole can be asked for before the first tee shot, and ties share a place', () => {
  const g = new GolfGame({ players: ['Ada', 'Ben', 'Cy'], holes: 1 });
  g.setHole(HOLE('A', 'D'));
  g.relay();
  assert.equal(g.phase, 'layout');
  g.setHole(HOLE('B', 'C'));
  for (const n of [2, 1, 2]) { g.teeOff(); g.visit(u('B')); if (n === 2) g.visit(u('Mid')); g.visit(u('C')); g.next(); }
  g.next();
  assert.deepEqual(g.snapshot().standings.rows.map((r) => [r.name, r.place]), [['Ben', 1], ['Ada', 2], ['Cy', 2]]);
});

test('the start and the target are also recognised by title when their address is spelled another way', () => {
  const g = new GolfGame({ players: ['Ada'], holes: 1 });
  g.setHole({ ...HOLE('A', 'D'), base: BASE });
  g.teeOff();
  // The reader reports the start under an address the hole did not record.
  assert.equal(g.visit(`${BASE}/a_(alias)`), null);
  assert.equal(g.titled(`${BASE}/a_(alias)`, 'a'), 'start', 'titles are compared without regard to case');
  assert.equal(g.visit(u('B')), 'stroke');
  assert.equal(g.titled(u('B'), 'B'), null, 'an ordinary page changes nothing');
  assert.equal(g.visit(`${BASE}/D_(alias)`), 'stroke', 'the address alone did not look like the target');
  assert.equal(g.titled(u('B'), 'D'), null, 'a title for a page the reader has already left is ignored');
  assert.equal(g.titled(`${BASE}/D_(alias)`, 'D'), 'holed');
  const s = g.snapshot();
  assert.equal(s.phase, 'done');
  assert.equal(s.last.strokes, 2);
  assert.equal(g.titled(`${BASE}/D_(alias)`, 'D'), null, 'only once');
  g.next();
  assert.deepEqual(g.snapshot().cards[0].path, ['A', 'B', 'D']);
});

test('saved players carry their character and handicap; with handicaps on, net scores decide the places', () => {
  const players = [{ id: 'p1', name: 'Ada', character: 'owl', colour: '#3fae5a', handicap: 0 }, { id: 'p2', name: 'Ben', character: 'fox', colour: '#e4433b', handicap: 9 }, 'Guest'];
  const play = (useHandicaps) => {
    const g = new GolfGame({ players, holes: 1, useHandicaps });
    g.setHole(HOLE('A', 'D'));
    // Hole 1 tee order: Ada, Ben, Guest. Ada takes 2, Ben 3, the guest 2.
    for (const n of [2, 3, 2]) { g.teeOff(); g.visit(u('A')); for (let i = 1; i < n; i++) g.visit(u(`M${i}`)); g.visit(u('D')); g.next(); }
    g.next();
    return g;
  };
  const gross = play(false);
  assert.deepEqual(gross.snapshot().profiles.map((p) => [p.id, p.character, p.handicap]), [['p1', 'owl', 0], ['p2', 'fox', 9], [null, null, null]]);
  assert.deepEqual(gross.standings().rows.map((r) => [r.name, r.net, r.place]), [['Ada', 2, 1], ['Guest', 2, 1], ['Ben', 3, 3]]);
  const net = play(true);
  // Ben's handicap of 9 is one stroke over a single hole.
  assert.deepEqual(net.standings().rows.map((r) => [r.name, r.strokes, r.shots, r.net, r.place]), [['Ada', 2, 0, 2, 1], ['Guest', 2, 0, 2, 1], ['Ben', 3, 1, 2, 1]]);
  const result = net.result(1700000000000);
  assert.equal(result.holes, 1);
  assert.equal(result.par, 3);
  assert.deepEqual(result.players.map((p) => [p.id, p.strokes, p.net, p.place, p.cards[0].holed]), [['p1', 2, 2, 1, true], [null, 2, 2, 1, true], ['p2', 3, 2, 1, true]]);
  assert.equal(new GolfGame({ players: ['x'] }).result(), null, 'no result until the round is finished');
});
