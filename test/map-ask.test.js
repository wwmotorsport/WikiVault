'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AddressBook } = require('../src/core/address-book');
const rel = require('../src/core/relations');
const ask = require('../src/core/map-ask');

function bookOf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-ask-'));
  const spots = { '120 N Main St, Charlotte, NC': [35.2281, -80.8421], '9 Mill Rd, Concord, NC': [35.41, -80.58], '30 Elm Avenue, Concord, NC': [35.4, -80.6], '500 Tryon St, Charlotte, NC': [35.22, -80.85], '77 Oak Ln, Gastonia, NC': [35.26, -81.18] };
  const book = new AddressBook(path.join(dir, 'book.json'), { locate: (a) => (spots[a] ? { lat: spots[a][0], lon: spots[a][1], how: a.startsWith('9 Mill') ? 'nearest' : 'exact', why: a.startsWith('9 Mill') ? 'The nearest known number on Mill Rd.' : '' } : null) });
  book.put({ name: 'Our house', address: '120 N Main St, Charlotte, NC', pin: 'home' });
  book.put({ name: 'The plant', address: '500 Tryon St, Charlotte, NC', pin: 'work' });
  book.put({ name: 'Old oak', lat: 35.3, lon: -80.7, pin: 'other', pinName: 'Fishing spot' });
  book.importContacts([
    { uid: 'g1', name: 'Rosa Diaz', addresses: [{ label: 'home', text: '9 Mill Rd, Concord, NC' }], phones: [{ value: '704-555-0100', label: 'mobile' }] },
    { uid: 'g2', name: 'Dave Park', addresses: [{ label: 'home', text: '30 Elm Avenue, Concord, NC' }, { label: 'work', text: '77 Oak Ln, Gastonia, NC' }] },
    { uid: 'g3', name: 'Jordan Lee', phones: [{ value: '555-0111' }] },
    { uid: 'g4', name: 'Pat Kim', addresses: [{ label: '', text: '1 Lost Trail, Nowhere' }] },
  ], 'google');
  const id = (name, label = null) => book.list().find((e) => e.name === name && (label === null || e.label === label)).id;
  book.put({ id: id('Rosa Diaz'), tie: 'Mother in law' });
  book.put({ id: id('Dave Park', 'home'), group: 'friends' });
  book.put({ id: id('Pat Kim'), tie: 'brother' });
  return { book, dir, id };
}

test('relationships: everyday words mean the tie, and a known tie brings its group', () => {
  assert.equal(rel.tieOf("my Mother in Law's"), 'mother-in-law');
  assert.equal(rel.tieOf('mother in laws'), 'mother-in-law');
  assert.deepEqual(rel.tiesMeant('mom'), ['mother']);
  assert.deepEqual(rel.tiesMeant('mom in law'), ['mother-in-law']);
  assert.deepEqual(rel.tiesMeant('brothers'), ['brother']);
  assert.deepEqual(rel.tiesMeant('parents'), ['mother', 'father']);
  assert.deepEqual(rel.tiesMeant('Dave'), []);
  assert.equal(rel.groupOfTie('grandma'), 'family');
  assert.equal(rel.groupOfTie('landlord'), '');
  assert.equal(rel.groupMeant('neighbours'), 'neighbors');
});

test('address book: pins and relationships are the user\'s marks; they leave an account\'s entry in step with the account and survive a changed address', () => {
  const { book, dir, id } = bookOf();
  const by = (name, label = null) => book.list().find((e) => e.name === name && (label === null || e.label === label));
  // marking does not make the entry the user's own; the relationship is the person's, on both of Dave's addresses
  assert.deepEqual([by('Rosa Diaz').src, by('Rosa Diaz').tie, by('Rosa Diaz').group], ['google', 'mother-in-law', 'family']);
  assert.deepEqual(book.list().filter((e) => e.name === 'Dave Park').map((e) => `${e.label}:${e.group}`), ['home:friends', 'work:friends']);
  book.put({ id: id('Dave Park', 'work'), pin: 'other', pinName: 'Dave\'s shop' });
  assert.deepEqual([by('Dave Park', 'work').pin, by('Dave Park', 'home').pin || ''], ['other', '']);
  assert.deepEqual(book.summary().pinned, 4);
  // the account changes Rosa's and Dave's work address: marks carry over, and the entries are still the account's
  const again = [
    { uid: 'g1', name: 'Rosa Diaz', addresses: [{ label: 'home', text: '30 Elm Avenue, Concord, NC' }], phones: [{ value: '704-555-0100', label: 'mobile' }] },
    { uid: 'g2', name: 'Dave Park', addresses: [{ label: 'home', text: '30 Elm Avenue, Concord, NC' }, { label: 'work', text: '500 Tryon St, Charlotte, NC' }] },
    { uid: 'g3', name: 'Jordan Lee', phones: [{ value: '555-0111' }] },
  ];
  const r = book.importContacts(again, 'google');
  assert.deepEqual([r.entries, r.added, r.removed], [4, 2, 3]);
  assert.deepEqual([by('Rosa Diaz').address, by('Rosa Diaz').tie, by('Rosa Diaz').src], ['30 Elm Avenue, Concord, NC', 'mother-in-law', 'google']);
  assert.deepEqual([by('Dave Park', 'work').address, by('Dave Park', 'work').pin, by('Dave Park', 'work').pinName, by('Dave Park', 'work').group], ['500 Tryon St, Charlotte, NC', 'other', 'Dave\'s shop', 'friends']);
  // kept on disk, and found by relationship, group and pin
  const back = new AddressBook(path.join(dir, 'book.json')).load();
  assert.deepEqual(back.search('mom in law').map((e) => e.name), ['Rosa Diaz']);
  assert.deepEqual(back.search('friends').map((e) => e.name), ['Dave Park', 'Dave Park']);
  assert.deepEqual(back.search('fishing').map((e) => e.name), ['Old oak']);
  assert.deepEqual(back.pinned('home').map((e) => e.name), ['Our house']);
  // changing what an entry says does make it the user's own, and keeps what was not sent
  const e = book.put({ id: id('Jordan Lee'), note: 'Plumber' });
  assert.deepEqual([e.src, e.phones, e.note], ['own', '555-0111', 'Plumber']);
  // a mark can be taken off again
  book.put({ id: id('Our house'), pin: '' });
  assert.equal(book.pinned('home').length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ask: requests about the map are told from questions for the articles', () => {
  const p = (q) => ask.parse(q);
  assert.deepEqual(p('please give me directions from my house to my mother in laws house'), { kind: 'route', from: 'my house', to: 'my mother in laws house', mode: null, sure: true });
  assert.deepEqual(p('Can you show me directions to my wife\'s work from here please?'), { kind: 'route', from: 'here', to: 'my wife\'s work', mode: null, sure: true });
  assert.deepEqual(p('take me home'), { kind: 'route', from: null, to: 'home', mode: null, sure: true });
  assert.deepEqual(p('walk me to the meeting point'), { kind: 'route', from: null, to: 'the meeting point', mode: 'foot', sure: true });
  assert.deepEqual(p('route from 120 N Main St, Charlotte NC to 30 Elm Avenue, Concord by bike'), { kind: 'route', from: '120 N Main St, Charlotte NC', to: '30 Elm Avenue, Concord', mode: 'bike', sure: true });
  assert.equal(p('How far is it from the earth to the moon?').sure, false);
  assert.equal(p('how do I get to Dave\'s place?').sure, false);
  assert.deepEqual(p('show me Aunt May on the map'), { kind: 'where', what: 'Aunt May', sure: true });
  assert.deepEqual(p('where does my mom live'), { kind: 'where', what: 'my mom', sure: false });
  assert.deepEqual(p('where is the Eiffel Tower'), { kind: 'where', what: 'the Eiffel Tower', sure: false });
  for (const q of ['why is the sky blue', 'What caused the Chernobyl disaster?', 'How does a differential work in a car?', 'who was the first person to walk on the moon', 'what is on the map of the world']) assert.equal(p(q), null, q);
});

test('ask: places are found among pins, relationships and contacts before the map data, and a request is carried out or explained', async () => {
  const { book, dir } = bookOf();
  const searched = [];
  const search = (q) => { searched.push(q); return /main st/i.test(q) ? { c: 'address', a: 35.2281, o: -80.8421, n: '120 N Main St, Charlotte', d: '' } : /concord/i.test(q) ? { c: 'town', a: 35.41, o: -80.58, n: 'Concord', d: 'North Carolina' } : /eiffel|moon|earth/i.test(q) ? { c: 'cafe', a: 35.1, o: -80.1, n: 'Eiffel Cafe', d: 'Charlotte' } : null; };
  const ctx = { book, search, here: null };
  const go = (q, more = {}) => ask.understand(q, { ...ctx, ...more });

  // the request this was built for
  let r = await go('please give me directions from my house to my mother in laws house');
  assert.deepEqual([r.kind, r.from.label, r.to.label, r.said], ['route', 'Our house', 'Rosa Diaz (home)', 'Directions from Home: Our house to mother-in-law: Rosa Diaz (home)']);
  assert.match(r.to.approx, /nearest known number/);
  assert.deepEqual(searched, []);
  // no start: from home, and said so; with a receiver, from the position
  r = await go('take me to work');
  assert.deepEqual([r.from.label, r.to.label], ['Our house', 'The plant']);
  assert.match(r.notes[0], /starts from Our house, which is pinned as Home/);
  r = await go('directions to Dave\'s work', { here: { lon: -80.9, lat: 35.2, label: 'My position' } });
  assert.deepEqual([r.from.label, r.to.label], ['My position', 'Dave Park (work)']);
  r = await go('directions from here to my mom in law');
  assert.match(r.error, /GPS receiver has no position/);
  // a contact's name, a pin's own name, an address, a town, coordinates
  r = await go('how do I get from Dave\'s place to the fishing spot on foot?');
  assert.deepEqual([r.from.label, r.to.label, r.mode], ['Dave Park (home)', 'Old oak', 'foot']);
  r = await go('route from 120 N Main St, Charlotte NC to Concord');
  assert.deepEqual([r.from.label, r.to.label], ['120 N Main St, Charlotte', 'Concord, North Carolina']);
  r = await go('navigate to 35.25, -80.75');
  assert.deepEqual([r.to.lat, r.to.lon, r.to.label], [35.25, -80.75, '35.25000, -80.75000']);
  // where someone lives
  r = await go('where does my mother-in-law live?');
  assert.deepEqual([r.kind, r.to.label, r.hit.d, r.hit.p], ['where', 'Rosa Diaz (home)', '9 Mill Rd, Concord, NC', '704-555-0100 (mobile)']);
  r = await go('show me Dave Park on the map');
  assert.equal(r.to.label, 'Dave Park (home)');
  // known to the book but with nowhere to go, and not known at all
  r = await go('directions to my brother\'s house');
  assert.match(r.error, /Pat Kim is in the address book, but the address \(1 Lost Trail, Nowhere\) has no place on the map yet/);
  r = await go('directions to Jordan Lee');
  assert.match(r.error, /Jordan Lee is in the address book, but with no address/);
  r = await go('directions to my sister\'s house');
  assert.match(r.error, /Nobody in the address book is marked as your sister yet/);
  r = await go('take me to school');
  assert.match(r.error, /"school" was not found/);
  r = await go('directions to Mars Base');
  assert.match(r.error, /"Mars Base" was not found among your saved places/);
  // questions for the articles are left alone, even when the map data has something of that name
  for (const q of ['where is the Eiffel Tower', 'How far is it from the earth to the moon?', 'why is the sky blue', 'how do i get to sleep faster']) assert.equal(await go(q), null, q);

  // wording the rules do not settle goes to the model, only when it hints at the map
  const asked = [];
  const model = (answer) => async () => ({ chat: async ({ messages }) => { asked.push(messages[1].content); return answer; } });
  r = await go('I need to be driving over to see Rosa Diaz, what is the way to go?', { model: model('Sure! {"intent":"route","from":"","to":"Rosa Diaz"}') });
  assert.deepEqual([r.kind, r.from.label, r.to.label, asked.length], ['route', 'Our house', 'Rosa Diaz (home)', 1]);
  assert.equal(await go('What is the way to enlightenment in Buddhism?', { model: model('{"intent":"none","from":"","to":""}') }), null);
  assert.equal(asked.length, 2);
  // "how far" and "where is" questions are not put to the model at all: they are too often for the articles
  assert.equal(await go('How far is it from the earth to the moon?', { model: model('{"intent":"route","from":"earth","to":"moon"}') }), null);
  assert.equal(asked.length, 2);
  assert.equal(await go('why is the sky blue', { model: model('{"intent":"route","to":"work"}') }), null);
  assert.equal(asked.length, 2);
  assert.equal(await go('what is the way to the plant', { model: async () => null }), null);
  assert.equal(await go('what is the way to the plant', { model: model('not json') }), null);
  assert.deepEqual(ask.readModel('{"intent":"where","to":"my mom"}'), { kind: 'where', what: 'my mom', sure: false, byModel: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
