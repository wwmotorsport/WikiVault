'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GolfStore, handicapOf, CHARACTERS, COLOURS } = require('../src/core/golf-store');

async function store() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wikivault-golf-'));
  const file = path.join(dir, 'golf.json');
  return { file, s: new GolfStore(file), done: () => fsp.rm(dir, { recursive: true, force: true }) };
}
const round = (holes, par, strokes) => ({ holes, par, strokes });

test('a handicap needs three rounds and comes from the better half of the last ten', () => {
  assert.equal(handicapOf([]), null);
  assert.equal(handicapOf([round(9, 36, 45), round(9, 36, 45)]), null);
  // Nine over, nine over, eighteen over: the better two of three average nine.
  assert.equal(handicapOf([round(9, 36, 45), round(9, 36, 45), round(9, 36, 54)]), 9);
  // A three-hole round two over par counts as six over nine holes.
  assert.equal(handicapOf([round(3, 12, 14), round(3, 12, 14), round(3, 12, 14)]), 6);
  assert.equal(handicapOf([round(9, 36, 30), round(9, 36, 33), round(9, 36, 36)]), 0, 'under par is scratch, not a negative handicap');
  // Only the last ten count: ten level-par rounds push the early bad ones out.
  const many = [...new Array(5).fill(round(9, 36, 60)), ...new Array(10).fill(round(9, 36, 36))];
  assert.equal(handicapOf(many), 0);
});

test('players are saved with a character and a colour, and survive a restart', async () => {
  const t = await store();
  try {
    const id = await t.s.savePlayer({ name: '  Ada   Lovelace ', character: 'owl', colour: COLOURS[3] }, 1000);
    await assert.rejects(t.s.savePlayer({ name: 'ada lovelace', character: 'cap', colour: COLOURS[0] }), /already a player called Ada Lovelace/);
    await assert.rejects(t.s.savePlayer({ name: '   ' }), /Give the player a name/);
    const other = await t.s.savePlayer({ name: 'Ben', character: 'dragon', colour: 'pink' }, 2000);
    const again = new GolfStore(t.file);
    const list = again.list();
    assert.deepEqual(list.map((p) => [p.name, p.character, p.colour]), [['Ada Lovelace', 'owl', COLOURS[3]], ['Ben', CHARACTERS[0], COLOURS[0]]], 'an unknown look falls back to the first');
    assert.equal(list[0].handicap, null);
    await again.savePlayer({ id, name: 'Ada', character: 'fox', colour: COLOURS[1] });
    assert.deepEqual(new GolfStore(t.file).get(id).character, 'fox');
    await again.deletePlayer(other);
    assert.deepEqual(new GolfStore(t.file).list().map((p) => p.name), ['Ada']);
    await assert.rejects(again.savePlayer({ id: 'gone', name: 'X' }), /no longer saved/);
  } finally { await t.done(); }
});

test('finished rounds build the record: wins and losses, score names, best round, handicap', async () => {
  const t = await store();
  try {
    const ada = await t.s.savePlayer({ name: 'Ada', character: 'owl', colour: COLOURS[0] }, 1);
    const ben = await t.s.savePlayer({ name: 'Ben', character: 'fox', colour: COLOURS[1] }, 2);
    const card = (par, strokes, holed = true) => ({ par, strokes, holed });
    const result = (at, a, b) => ({
      at, library: 'Wikipedia', holes: 3, par: 12, useHandicaps: false,
      players: [
        { id: ada, name: 'Ada', strokes: a.reduce((n, c) => n + c.strokes, 0), net: 0, place: a.place, cards: a },
        { id: ben, name: 'Ben', strokes: b.reduce((n, c) => n + c.strokes, 0), net: 0, place: b.place, cards: b },
        { id: null, name: 'Guest', strokes: 20, net: 20, place: 3, cards: [card(4, 8), card(4, 6), card(4, 6)] },
      ],
    });
    const cardsA = Object.assign([card(4, 1), card(4, 2), card(4, 3)], { place: 1 });      // ace, eagle, birdie: 6
    const cardsB = Object.assign([card(4, 4), card(4, 5), card(4, 12, false)], { place: 2 }); // par, bogey, picked up: 21
    await t.s.recordRound(result(100, cardsA, cardsB));
    const tieA = Object.assign([card(4, 4), card(4, 4), card(4, 6)], { place: 1 });
    const tieB = Object.assign([card(4, 4), card(4, 4), card(4, 6)], { place: 1 });
    await t.s.recordRound(result(200, tieA, tieB));
    await t.s.recordRound(result(300, tieA, Object.assign([card(4, 3), card(4, 4), card(4, 4)], { place: 1 })));

    const list = new GolfStore(t.file).list();
    const A = list.find((p) => p.name === 'Ada'); const B = list.find((p) => p.name === 'Ben');
    assert.deepEqual([A.stats.rounds, A.stats.wins, A.stats.losses, A.stats.ties], [3, 1, 0, 2]);
    assert.deepEqual([B.stats.rounds, B.stats.wins, B.stats.losses, B.stats.ties], [3, 0, 1, 2]);
    assert.deepEqual([A.stats.aces, A.stats.eagles, A.stats.birdies, A.stats.pars, A.stats.worse], [1, 1, 1, 4, 2]);
    assert.deepEqual([B.stats.pars, B.stats.bogeys, B.stats.pickups, B.stats.birdies], [5, 1, 1, 1]);
    assert.equal(A.stats.best.toPar, -6);
    assert.equal(A.stats.holes, 9);
    assert.equal(A.stats.perHole, (6 + 14 + 14 - 36) / 9);
    assert.equal(A.rounds.length, 3);
    assert.deepEqual([A.rounds[0].at, A.rounds[0].place, A.rounds[0].field], [300, 1, 3], 'most recent first');
    // Ada: -6, +2, +2 over three holes is -18, +6, +6 over nine; better two average -6, shown as scratch.
    assert.equal(A.handicap, 0);
    // Ben: +9, +2, -1 over three holes is +27, +6, -3 over nine; better two average 1.5, rounded to 2.
    assert.equal(B.handicap, 2);
    assert.equal(list[0].lastPlayed, 300);
  } finally { await t.done(); }
});

test('a damaged records file does not stop the game', async () => {
  const t = await store();
  try {
    fs.writeFileSync(t.file, '{ not json');
    const s = new GolfStore(t.file);
    assert.deepEqual(s.list(), []);
    await s.savePlayer({ name: 'Ada', character: 'cap', colour: COLOURS[0] });
    assert.equal(new GolfStore(t.file).list().length, 1);
  } finally { await t.done(); }
});
