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

// The places a stand-in map holds, and the nearby search the app gives the request reader.
const PLACES = [
  { c: 'hospital', i: 'n1', n: 'Mercy General', a: 35.20, o: -80.80, d: '2001 Vale Avenue', p: '+1 555 0100', x: { emergency: 'yes' } },
  { c: 'hospital', i: 'w1', n: 'Mercy General', a: 35.2005, o: -80.8003, d: '2001 Vale Avenue' }, // the same building, drawn as an outline too
  { c: 'hospital', i: 'n2', n: 'County Hospital', a: 35.41, o: -80.60, d: '' },
  { c: 'hospital', i: 'n3', n: 'Far Away General', a: 31.0, o: -89.0, d: '' },
  { c: 'clinic', i: 'n4', n: 'Elm Urgent Care', a: 35.23, o: -80.85, d: '' },
  { c: 'pharmacy', i: 'n5', n: 'Corner Pharmacy', a: 35.23, o: -80.84, d: '' },
  { c: 'pharmacy', i: 'n6', n: 'Mill Pharmacy', a: 35.40, o: -80.58, d: '' },
  { c: 'fuel', i: 'n7', n: 'Corner Fuel', a: 35.30, o: -80.90, d: '' },
  { c: 'supermarket', i: 'n8', n: 'Walmart Supercenter', a: 35.25, o: -80.80, d: '' },
  { c: 'town', i: 'n9', n: 'Concord', a: 35.41, o: -80.58, d: 'NC' },
];
const KM = (a, o, b, p) => { const r = Math.PI / 180; const x = (p - o) * r * Math.cos(((a + b) / 2) * r); const y = (b - a) * r; return Math.sqrt(x * x + y * y) * 6371; };
const nearby = ({ cats, q = '', near, limit = 50 }) => PLACES.filter((r) => (!cats || cats.includes(r.c)) && (!q || r.n.toLowerCase().includes(q.toLowerCase()))).map((r) => ({ ...r, kind: r.c, km: Math.round(KM(near[1], near[0], r.a, r.o) * 10) / 10 })).sort((a, b) => a.km - b.km).slice(0, limit);
const kinds = { hospital: 'Hospitals', clinic: 'Clinics and urgent care', pharmacy: 'Pharmacies', fuel: 'Fuel stations', supermarket: 'Supermarkets and grocery', town: 'Cities, towns and villages', propane: 'Bottled gas and propane' };
const town = (q) => { const r = PLACES.find((x) => x.c === 'town' && x.n.toLowerCase() === String(q).toLowerCase()); return r ? { ...r, kind: 'town' } : null; };

test('ask: the nearest of a kind is understood however it is put, and questions for the articles are left alone', () => {
  const near = (q) => { const p = ask.parse(q); return p && p.kind === 'near' ? [p.cats ? p.cats.join('+') : null, p.at, p.radiusKm ? Math.round(p.radiusKm) : null, p.count, p.how, p.sure] : p; };
  // The three that did not work, and their kin.
  assert.deepEqual(near('what is the nearest hospital to home'), ['hospital', 'home', null, null, 'list', true]);
  assert.deepEqual(near('where is the nearest hospital to there'), ['hospital', 'there', null, null, 'list', true]);
  assert.deepEqual(near('Where are the nearest gas stations to 350 5th Ave, New York NY?'), ['fuel', '350 5th ave, new york ny', null, null, 'list', true]);
  assert.deepEqual(near('which hospital is closest to my mother in law\'s house'), ['hospital', "my mother in law's house", null, null, 'list', true]);
  assert.deepEqual(near('please tell me where the closest emergency room to my house is'), ['hospital', 'my house', null, null, 'list', true]);
  assert.deepEqual(near('is there a pharmacy near work?'), ['pharmacy', 'work', null, null, 'list', true]);
  assert.deepEqual(near('where can I get gas near work'), ['fuel', 'work', null, null, 'list', true]);
  assert.deepEqual(near('is there anywhere to get propane around here'), ['propane', null, null, null, 'list', true]);
  // With no place named: here, or home.
  for (const q of ['nearest hospital', 'closest ER', 'hospitals near me', 'any hospitals nearby', 'hospital close by', 'show me the hospitals around here']) assert.deepEqual(near(q).slice(0, 2), ['hospital', null], q);
  // A distance, in miles or kilometres, in figures or words, with a place or without.
  assert.deepEqual(near('list the hospitals within a 10 mile radius of home'), ['hospital', 'home', 16, null, 'list', true]);
  assert.deepEqual(near('list all pharmacies inside a radius of 15 km around work'), ['pharmacy', 'work', 15, null, 'list', true]);
  assert.deepEqual(near('hospitals within twenty miles'), ['hospital', null, 32, null, 'list', true]);
  assert.deepEqual(near('hospitals near me within 10 miles'), ['hospital', null, 16, null, 'list', true]);
  assert.deepEqual(near('find water sources less than 5 miles from the cabin'), ['drinking_water+spring', 'the cabin', 8, null, 'list', true]);
  assert.deepEqual(near('what towns are within 30 miles of home'), ['town', 'home', 48, null, 'list', true]);
  // How many, how far, and a number wanted.
  assert.deepEqual(near('how many fire stations are within twenty miles of work'), ['fire', 'work', 32, null, 'count', true]);
  assert.deepEqual(near('how far is the nearest hospital from home'), ['hospital', 'home', null, null, 'far', true]);
  assert.deepEqual(near('5 closest pharmacies to home'), ['pharmacy', 'home', null, 5, 'list', true]);
  assert.deepEqual(near("show me the three nearest grocery stores to my mom's house"), ['supermarket', "my mom's house", null, 3, 'list', true]);
  // A kind in a town.
  assert.deepEqual(near('hospitals in Concord'), ['hospital', 'concord', null, null, 'list', true]);
  // Several kinds under one word.
  assert.deepEqual(ask.kindsOf('medical help').cats, ['hospital', 'clinic']);
  assert.deepEqual(ask.kindsOf('the open drug stores').cats, ['pharmacy']);
  assert.equal(ask.kindsOf('star'), null);
  // Not sure, so they count only around a place of the user's own: a shop by its name, and things that are no places at all.
  assert.deepEqual(near('nearest walmart to home'), [null, 'home', null, null, 'list', false]);
  assert.deepEqual(near('what is the nearest star to the sun'), [null, 'the sun', null, null, 'list', false]);
  // And these are not this kind of request at all.
  assert.equal(ask.parse('what is a hospital'), null);
  assert.equal(ask.parse('how do hospitals work'), null);
  assert.deepEqual(ask.parse('where is the hospital'), { kind: 'where', what: 'the hospital', sure: false });
  assert.deepEqual(ask.parse('directions to the nearest hospital'), { kind: 'route', from: null, to: 'the nearest hospital', mode: null, sure: true });
  for (const q of ['nearest hospital to home', 'pharmacies within 10 miles', 'gas near me', 'is there a clinic close to home']) assert.equal(ask.hint(q), true, q);
});

test('ask: the nearest of a kind is found around home, a person, a town or "there", with distances, and what cannot be done is said', async () => {
  const { book, dir } = bookOf();
  try {
    const ctx = { book, search: town, nearby, kinds, here: null, last: null, model: null };
    const names = (p) => p.hits.map((h) => h.n);
    // What was asked: the nearest hospital to home.
    let p = await ask.understand('what is the nearest hospital to home', ctx);
    assert.equal(p.kind, 'near');
    assert.deepEqual([p.at.label, p.names, p.one, p.said], ['Our house', 'Hospitals', true, 'Hospitals nearest to Home: Our house']);
    assert.deepEqual(names(p), ['Mercy General', 'County Hospital', 'Far Away General'], 'nearest first, and the building that is in the data twice is listed once');
    assert.deepEqual([p.hits[0].miles, p.hits[0].wind, p.hits[0].far], [3, 'south-east', '3 miles']);
    assert.equal(p.total, 3);
    // "there": the place the last request was about.
    assert.match((await ask.understand('where is the nearest hospital to there', ctx)).error, /Say which place you mean/);
    p = await ask.understand('where is the nearest hospital to there', { ...ctx, last: { lon: -80.58, lat: 35.41, label: 'Rosa Diaz (home)' } });
    assert.deepEqual([p.at.label, names(p)[0]], ['Rosa Diaz (home)', 'County Hospital']);
    // A person by their tie, a number wanted, and a distance.
    p = await ask.understand("the 1 closest pharmacy to my mother in law's house", ctx);
    assert.deepEqual([names(p), p.at.label], [['Mill Pharmacy'], 'Rosa Diaz (home)']);
    assert.ok(p.notes.some((n) => /approximate, so the distances are too/.test(n)), 'an approximate starting place is said to be one');
    p = await ask.understand('list the hospitals within a 10 mile radius of home', ctx);
    assert.deepEqual([names(p), p.radius, p.total, p.said], [['Mercy General'], '10 miles', 1, 'Hospitals within 10 miles of Home: Our house']);
    p = await ask.understand('how many hospitals are within 20 miles of home', ctx);
    assert.deepEqual([p.how, p.total, names(p)], ['count', 2, ['Mercy General', 'County Hospital']]);
    assert.match((await ask.understand('hospitals within 1 mile of home', ctx)).error, /No hospitals are within 1 mile of Our house/);
    // Several kinds under one word, each named in the list.
    p = await ask.understand('where can I get medical help near work', ctx);
    assert.deepEqual([p.names, names(p).slice(0, 2), p.hits[0].kind], ['Hospitals, Clinics and urgent care', ['Elm Urgent Care', 'Mercy General'], 'clinic']);
    // No place named: from the GPS position when there is one, else from home, and which is said.
    p = await ask.understand('nearest gas station', ctx);
    assert.deepEqual([names(p), p.at.label], [['Corner Fuel'], 'Our house']);
    assert.match(p.notes[0], /no GPS receiver is connected, so this is measured from Our house, which is pinned as Home/);
    p = await ask.understand('nearest gas station', { ...ctx, here: { lon: -80.9, lat: 35.3, label: 'My position' } });
    assert.deepEqual([p.at.label, p.hits[0].far, p.notes[0]], ['My position', 'under a tenth of a mile', 'No place was named, so this is measured from your GPS position.']);
    assert.match((await ask.understand('nearest hospital', { ...ctx, book: null })).error, /Say near where/);
    // A town from the map data.
    p = await ask.understand('pharmacies in Concord', ctx);
    assert.deepEqual([p.at.label, names(p)[0]], ['Concord, NC', 'Mill Pharmacy']);
    // A shop by its name, around a place of the user's own.
    p = await ask.understand('nearest walmart to home', ctx);
    assert.deepEqual([names(p), p.names, p.cats], [['Walmart Supercenter'], 'Places named "walmart"', null]);
    // Things that are no places are left to the articles; a kind that is not on this computer is said to be missing.
    assert.equal(await ask.understand('what is the nearest star to the sun', ctx), null);
    assert.equal(await ask.understand('nearest neighbor search to home', ctx), null);
    assert.match((await ask.understand('nearest propane to home', ctx)).error, /No bottled gas and propane are in the places on this computer/);
    assert.match((await ask.understand('nearest hospital to my brother', ctx)).error, /has no place on the map yet/);
    assert.match((await ask.understand('nearest hospital to Zzyzx Qwerty', ctx)).error, /"zzyzx qwerty" was not found/);
    // In directions, "the nearest hospital" is a place like any other.
    p = await ask.understand('directions to the nearest hospital', ctx);
    assert.deepEqual([p.kind, p.to.label, p.from.label], ['route', 'Mercy General, 2001 Vale Avenue', 'Our house']);
    p = await ask.understand('directions from work to the closest pharmacy to work', ctx);
    assert.deepEqual([p.kind, p.from.label, p.to.label], ['route', 'The plant', 'Corner Pharmacy']);
    p = await ask.understand('how do I get there', { ...ctx, last: { lon: -80.8, lat: 35.2, label: 'Mercy General' } });
    assert.deepEqual([p.kind, p.to.label], ['route', 'Mercy General']);
    // The model's reading of looser wording is carried out the same way.
    const said = (json) => ({ model: async () => ({ chat: async () => json }) });
    p = await ask.understand('I cut my hand badly, who can stitch it', { ...ctx, ...said('{"intent":"near","what":"hospital","to":"home","miles":0}') });
    assert.equal(p, null, 'wording with no hint of the map in it is not put to the model');
    p = await ask.understand('I need the closest place to home that can stitch a cut', { ...ctx, ...said('{"intent":"near","what":"hospital","to":"home","miles":15}') });
    assert.deepEqual([p.kind, names(p), p.radius], ['near', ['Mercy General'], '15 miles']);
    assert.equal(ask.windOf({ lat: 35, lon: -80 }, { lat: 36, lon: -80 }), 'north');
    assert.equal(ask.windOf({ lat: 35, lon: -80 }, { lat: 35, lon: -81 }), 'west');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('near: large and small are asked of the kind, by the ground a place covers', () => {
  const p = (t) => { const a = ask.parseNear(t); return a && [a.cats && a.cats.join(), a.size || null, Boolean(a.bySize), a.at]; };
  assert.deepEqual(p('nearest large army base'), ['military', 'large', false, null]);
  assert.deepEqual(p('what is the nearest small airfield to home'), ['airfield', 'small', false, 'home']);
  assert.deepEqual(p('large hospitals within 20 miles of home'), ['hospital', 'large', false, 'home']);
  assert.deepEqual(p('the biggest military base within 100 miles'), ['military', 'large', true, null]);
  assert.deepEqual(p('hospitals near Little Rock'), ['hospital', null, false, 'little rock'], 'a word of the place is not a size');
  assert.equal(ask.parseNear('Big Lots near me').size, undefined, 'nor is a word of a name');
  assert.deepEqual([ask.areaText(900), ask.areaText(45000), ask.areaText(650000000)], ['9,700 square feet', '11 acres', '251 square miles']);
  const home = { lat: 35.2, lon: -80.8, label: 'Home', own: true };
  const base = (i, n, km, m) => ({ i, n, a: 35.2 + km / 111, o: -80.8, km, c: 'military', kind: 'Military sites', ...(m ? { m } : {}) });
  const all = [base('a', 'Reserve Lot', 3, 4000), base('b', 'Unsized Post', 5), base('c', 'Camp Middling', 20, 900000), base('d', 'Fort Vast', 60, 400000000), base('e', 'Fort Far', 300, 900000000)];
  const ctx = { saved: (q) => (/^home$/i.test(q) ? [home] : []), contacts: () => [], search: () => [], gps: () => null, kinds: { military: 'Military sites' }, nearby: ({ limit }) => all.slice(0, limit), sizes: () => ({ small: 10000, large: 800000 }) };
  const large = ask.plan(ask.parseNear('nearest large army base to home'), ctx);
  assert.deepEqual(large.hits.map((h) => [h.n, h.area]), [['Camp Middling', '222 acres'], ['Fort Vast', '154 square miles'], ['Fort Far', '347 square miles']]);
  assert.match(large.notes.join(' '), /Large means 198 acres or more of ground, which is the largest third of this kind\. 1 nearby place is drawn as a point, with no size, and is not counted\./);
  assert.deepEqual(ask.plan(ask.parseNear('small military sites near home'), ctx).hits.map((h) => h.n), ['Reserve Lot']);
  assert.deepEqual(ask.plan(ask.parseNear('the biggest military base within 100 miles of home'), ctx).hits.map((h) => h.n), ['Fort Vast', 'Camp Middling'], 'largest first, within the distance');
  const none = ask.plan(ask.parseNear('nearest large army base to home'), { ...ctx, sizes: () => null });
  assert.equal(none.hits.length, 5); assert.match(none.notes.join(' '), /do not carry sizes/);
});
