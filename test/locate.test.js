'use strict';
// Putting a contact's address on the map: the address itself when the data has it, else the middle of its
// ZIP code or town, else a reason. The towns and ZIP codes come from the address data itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/core/addresses');
const { MapsLibrary } = require('../src/core/maps-library');
const { AddressBook } = require('../src/core/address-book');

function dataIn(dir, rows, date = '2026-11-18T00:00:00Z') {
  fs.mkdirSync(dir, { recursive: true });
  const b = new A.AddressBuilder(path.join(dir, 'addresses.work'), 16);
  for (const r of rows) b.add(...r);
  const meta = b.finish(path.join(dir, 'addresses.dat'));
  fs.rmSync(path.join(dir, 'addresses.work'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'addresses.json'), JSON.stringify({ ...meta, release: '2026-10-21.0', regions: ['us48'], date, read: rows.length }));
}
const rows = () => {
  const out = [];
  for (let n = 100; n <= 198; n += 2) out.push(['North Main Street', n, -80.85 + (n - 100) * 0.0001, 35.23, 'Charlotte', 'NC', '28202']);
  for (let n = 1; n <= 40; n++) out.push(['Tryon Street', 400 + n, -80.84 + n * 0.0001, 35.225, '', 'NC', '']);
  for (let n = 1; n <= 40; n++) out.push(['Tryon Street', 400 + n, -78.64 + n * 0.0001, 35.78, '', 'NC', '']);
  for (let n = 1; n <= 30; n++) out.push(['Fayetteville Street', n * 10, -78.64, 35.77 + n * 0.0001, 'Raleigh', 'NC', '27601']);
  for (let n = 1; n <= 30; n++) out.push(['Peachtree Street', n * 10, -84.38, 33.77 + n * 0.0001, 'Charlotte', 'GA', '30309']); // a Charlotte in another state
  return out;
};

test('a contact address is put on the map as well as it can be told, and a miss says why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-loc-'));
  try {
    const none = new MapsLibrary({ dir: path.join(dir, 'empty') });
    await none.init();
    assert.deepEqual(none.locateAddress('120 N Main St, Charlotte, NC'), { why: 'The street addresses have not been fetched yet. They are on the Setup page.' });

    dataIn(path.join(dir, 'maps'), rows());
    const logged = [];
    const lib = new MapsLibrary({ dir: path.join(dir, 'maps'), log: (m) => logged.push(m) });
    await lib.init();
    assert.equal(lib.status().addressTowns, null, 'the list of towns is not there until it has been worked out');
    // Before the list: what the data names is found; what needs the list is not, and says it will be tried again.
    assert.equal(lib.locateAddress('120 N Main St, Charlotte, NC 28202').how, 'exact');
    assert.match(lib.locateAddress('420 Tryon St, Charlotte, NC').why, /still being worked out/);
    assert.equal(lib.locateAddress('420 Tryon St, Charlotte, NC').lat, undefined);

    assert.equal(await lib.buildGazetteer(), true);
    assert.equal(await lib.buildGazetteer(), false, 'once is enough');
    assert.deepEqual(lib.status().addressTowns, { towns: 3, zips: 3, rows: 190, noTown: 80, noZip: 80, neither: 80 });
    assert.match(logged.join('\n'), /3 towns and 3 ZIP codes placed from the address data in [\d.]+ s\. Of 190 addresses, 42\.1% name no town, 42\.1% no ZIP code, 42\.1% neither\./);

    const at = (text) => { const r = lib.locateAddress(text); return [r.how || null, r.lon == null ? null : Math.round(r.lon * 100) / 100, r.why]; };
    // A row that names no town, found through the town and state asked for.
    assert.deepEqual(at('420 Tryon St\nCharlotte, NC 28202\nUS'), ['exact', -80.84, '']);
    assert.deepEqual(at('420 Tryon Street, Raleigh, North Carolina'), ['exact', -78.64, '']);
    // The same town name in two states: the state decides.
    assert.deepEqual(at('Charlotte, GA'), ['town', -84.38, 'This is not a street address the data can place, so it points at the middle of the town.']);
    // Not a street address at all: the town, or the ZIP code when there is one.
    assert.deepEqual(at('Charlotte, NC'), ['town', -80.85, 'This is not a street address the data can place, so it points at the middle of the town.']);
    assert.deepEqual(at('P.O. Box 12, Raleigh NC 27601'), ['town', -78.64, 'This is not a street address the data can place, so it points at the middle of its ZIP code.']);
    // A street the data does not have, in a place it does.
    assert.deepEqual(at('77 Nowhere Lane, Charlotte, NC 28202'), ['town', -80.85, 'Approximate. That street is not in the address data, so this points at the middle of the ZIP code.']);
    assert.deepEqual(at('Acme Widgets\n77 Nowhere Lane\nSuite 4\nRaleigh, NC'), ['town', -78.64, 'Approximate. That street is not in the address data, so this points at the middle of the town.']);
    // Nothing to go by, and an area the data does not have: no place, and the reason.
    const tail = ' is in the address data, which does not cover every state and county. Fetching the places (towns, water, power and services) on the Setup page adds the towns of every state, which would at least place it at its town. It can also be placed by hand, on the map.';
    assert.deepEqual(at('77 Nowhere Lane, Smalltown, NC 28999'), [null, null, `Neither the street nor ZIP code 28999 nor Smalltown, NC${tail}`]);
    // The reason names the town as the address was read, with or without a house number, a ZIP code or commas.
    assert.deepEqual(at('418 E Marlow, Savannah, GA'), [null, null, `Neither the street nor Savannah, GA${tail}`]);
    assert.deepEqual(at('Franklin Delano Roosevelt Blvd, California, MD, USA'), [null, null, `Neither the street nor California, MD${tail}`]);
    // And a street the data lacks still falls back on its town: no house number, or no commas at all.
    assert.deepEqual(at('Nowhere Boulevard, Raleigh, NC'), ['town', -78.64, 'The street is not in the address data, so this points at the middle of the town.']);
    assert.deepEqual(at('77 Nowhere Lane Raleigh NC'), ['town', -78.64, 'The street is not in the address data, so this points at the middle of the town.']);
    assert.deepEqual(at('Savannah, GA'), [null, null, `Neither the street nor Savannah, GA${tail}`]);
    assert.deepEqual(at('the blue house'), [null, null, 'No town or ZIP code that the address data knows could be read from this address.']);
    // The search box gains the same fall-back for a street it cannot find.
    const hit = lib.findAddress('77 Nowhere Lane, Charlotte, NC 28202').hits[0];
    assert.deepEqual([hit.how, hit.n, hit.approx], ['town', 'ZIP code 28202 (Charlotte, NC)', true]);

    // The list is kept: the next start reads it, and new address data makes it be worked out again.
    assert.ok(fs.existsSync(path.join(dir, 'maps', 'address-towns.json')));
    const next = new MapsLibrary({ dir: path.join(dir, 'maps') });
    await next.init();
    assert.equal(next.status().addressTowns.towns, 3);
    assert.equal(await next.buildGazetteer(), false);
    dataIn(path.join(dir, 'maps'), rows().slice(0, 50), '2026-12-01T00:00:00Z');
    const later = new MapsLibrary({ dir: path.join(dir, 'maps') });
    await later.init();
    assert.equal(later.status().addressTowns, null, 'the old list is not used for new data');
    assert.equal(await later.buildGazetteer(), true);
    assert.equal(later.status().addressTowns.towns, 1);

    // The address book keeps the reason with an entry it could not place, and places it once it can.
    const found = [];
    const book = new AddressBook(path.join(dir, 'book.json'), { locate: (a) => { found.push(a); return lib.locateAddress(a); } });
    book.importContacts([
      { uid: '1', name: 'Ann', addresses: [{ label: 'home', text: '420 Tryon St\nCharlotte, NC 28202' }] },
      { uid: '2', name: 'Bo', addresses: [{ label: '', text: 'Charlotte, NC' }] },
      { uid: '3', name: 'Cy', addresses: [{ label: '', text: '5 Far Rd, Savannah, GA 31401' }] },
    ], 'google');
    const by = (n) => book.list().find((e) => e.name === n);
    assert.deepEqual([by('Ann').how, by('Bo').how, by('Cy').how, by('Cy').lat], ['exact', 'town', null, null]);
    assert.match(by('Cy').why, /^Neither the street nor ZIP code 31401 nor Savannah, GA is in the address data/);
    assert.deepEqual(found[0], '420 Tryon St, Charlotte, NC 28202');
    assert.equal(book.summary().located, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
