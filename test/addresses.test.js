'use strict';
// The address index: how streets are named, how typed addresses are read, and how a number is placed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../src/core/addresses');

function build(rows, dir) {
  const b = new A.AddressBuilder(path.join(dir, 'work'), 16);
  for (const r of rows) b.add(...r);
  const meta = b.finish(path.join(dir, 'a.dat'));
  return { meta, index: new A.AddressIndex(path.join(dir, 'a.dat'), meta), builder: b };
}
const rows = () => {
  const out = [];
  for (let n = 100; n <= 198; n += 2) if (n < 150 || n > 160) out.push(['North Main Street', n, -80.85 + (n - 100) * 0.0001, 35.23, 'Charlotte', 'NC', '28202']);
  for (let n = 101; n <= 199; n += 2) out.push(['N. Main St', n, -80.85 + (n - 101) * 0.0001, 35.2302, 'Charlotte', 'North Carolina', '28202-1234']);
  for (let n = 1; n <= 40; n++) out.push(['Main St', n, -80.55 + n * 0.0001, 34.98, 'Monroe', 'NC', '28110']);
  for (let n = 500; n <= 520; n += 4) out.push(['Oak Hollow Road', n, -80.80 + (n - 500) * 0.0001, 35.30, '', 'NC', '']);
  out.push(['Saint Charles Avenue', '12B', -80.7, 35.3, 'Fort Mill', 'SC', '29715'], ['Main Street', 9000, -97.74, 30.27, 'Austin', 'TX', '78701']);
  return out;
};

test('street names are kept in one form, and reduced to a core that ignores direction and kind', () => {
  assert.equal(A.normStreet('North Main Street'), 'N MAIN ST');
  assert.equal(A.normStreet("N. Main St."), 'N MAIN ST');
  assert.equal(A.normStreet('Saint Charles Avenue'), 'ST CHARLES AVE');
  assert.equal(A.normStreet('Rue Sainte-Catherine Ouest'), 'RUE STE CATHERINE O');
  assert.deepEqual(['N MAIN ST', 'MAIN ST NW', 'MAIN', 'N ST', 'AVE B', 'CALLE 5 DE MAYO', 'HWY 49'].map(A.core), ['MAIN', 'MAIN', 'MAIN', 'N', 'B', '5 DE MAYO', 'HWY 49']);
  assert.deepEqual(['123', '123A', '123 1/2', '123-125', 'W180N7890', '', null, 'B'].map(A.numOf), [123, 123, 123, 123, 180, null, null, null]);
});

test('typed addresses are taken apart, with and without commas', () => {
  assert.deepEqual(A.parse('123 N. Main St, Charlotte, NC 28202'), { number: 123, street: ['N', 'MAIN', 'ST'], raw: ['N', 'MAIN', 'ST'], loc: { city: 'CHARLOTTE', state: 'NC', zip: '28202' } });
  assert.deepEqual(A.parse('100 W 5th St Apt 4B, Charlotte').street, ['W', '5TH', 'ST']);
  assert.deepEqual(A.parse('77 Elm Rd #12, Fort Mill, South Carolina, USA').loc, { city: 'FT MILL', state: 'SC', zip: '' });
  assert.deepEqual(A.parse('12 Rue Sainte-Catherine Ouest, Montréal, QC H3B 1A7').loc, { city: 'MONTREAL', state: 'QC', zip: 'H3B1A7' });
  assert.deepEqual([A.parse('Calle Juárez 45, Monterrey').number, A.parse('Calle Juárez 45, Monterrey').street], [45, ['CALLE', 'JUAREZ']]);
  assert.equal(A.parse('Main St, Monroe NC').number, null);
  assert.deepEqual(A.locOf(['CHARLOTTE', 'NORTH', 'CAROLINA', '28202', '1234']), { city: 'CHARLOTTE', state: 'NC', zip: '28202' });
  assert.equal(A.parse(' , '), null);
  assert.ok(A.looksLikeAddress(A.parse('123 Anything')) && A.looksLikeAddress(A.parse('Main Street')) && !A.looksLikeAddress(A.parse('Walmart')));
});

test('a known address is exact; an unknown number is placed between its neighbours, or at the nearest one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-addr-'));
  try {
    const { meta, index } = build(rows(), dir);
    assert.equal(meta.addresses, rows().length);
    assert.equal(meta.offsets.length, 16);
    const one = (text, o) => index.find(text, o).hits[0];

    const exact = one('120 North Main Street, Charlotte, NC');
    assert.deepEqual([exact.how, exact.lon, exact.lat, exact.label, exact.note], ['exact', -80.848, 35.23, '120 N Main St, Charlotte, NC 28202', '']);
    // The same street however it is written, and the town found by ZIP code alone.
    assert.equal(one('120 n main st 28202').how, 'exact');
    assert.equal(one('121 N. Main St., Charlotte').lat, 35.2302);
    assert.equal(one('120 N Main St Charlotte NC').how, 'exact', 'no commas: the index says where the street ends');
    assert.equal(one('120 N Main St Charlotte North Carolina 28202').how, 'exact');

    // 154 is missing. Its even neighbours are 148 and 162, on the same side of the street.
    const mid = one('154 N Main St, Charlotte, NC');
    assert.equal(mid.how, 'between');
    assert.ok(Math.abs(mid.lon - (-80.85 + 54 * 0.0001)) < 2e-6 && mid.lat === 35.23, `${mid.lon},${mid.lat}`);
    assert.match(mid.note, /^Approximate\. .* between 148 and 162 /);
    // Past the end of the street there is only one side to go by.
    const past = one('260 N Main St, Charlotte, NC');
    assert.deepEqual([past.how, past.lon], ['nearest', -80.8402]);
    assert.match(past.note, /nearest known number on the street is 198/);
    // No number: the street itself.
    const street = one('N Main St, Charlotte');
    assert.equal(street.how, 'street');

    // "Main St" without the direction: Charlotte only has N Main St, and the result says so.
    const loose = one('120 Main St, Charlotte, NC');
    assert.deepEqual([loose.how, loose.sure, loose.label], ['exact', false, '120 N Main St, Charlotte, NC 28202']);
    assert.match(loose.note, /in the data as N Main St/);
    // The town decides between streets of the same name; with no town, the nearer one comes first.
    assert.equal(one('20 Main St, Monroe, NC').label, '20 Main St, Monroe, NC 28110');
    assert.equal(one('20 Main St, Monroe, NC').sure, true);
    const both = index.find('20 Main St', { near: [-80.55, 34.98] }).hits;
    assert.equal(both[0].label, '20 Main St, Monroe, NC 28110');
    assert.equal(index.find('9000 Main St', { near: [-80.5, 35] }).hits[0].label, '9000 Main St, Austin, TX 78701', 'exact comes before nearer but approximate');
    assert.equal(one('9000 Main St, TX').how, 'exact');

    // Rows that do not name their town are matched through where the town is.
    assert.deepEqual(index.find('508 Oak Hollow Rd, Harrisburg, NC').hits, [], 'a town the data does not know, with nothing to place it by');
    const byTown = index.find('506 Oak Hollow Rd, Harrisburg, NC', { townAt: (city) => (city === 'HARRISBURG' ? [-80.66, 35.32] : null) });
    assert.deepEqual([byTown.hits[0].how, byTown.hits[0].label], ['between', '506 Oak Hollow Rd, NC']);
    assert.deepEqual(index.find('506 Oak Hollow Rd, Harrisburg, NC', { townAt: () => [-97, 30] }).hits, [], 'a town far from the street does not match it');
    assert.equal(one('12 St. Charles Ave, Fort Mill SC').how, 'exact');

    // A street that is not there at all, and words that are not an address.
    assert.deepEqual([index.find('5 Nowhere Blvd, Charlotte').hits.length, index.find('5 Nowhere Blvd, Charlotte').street], [0, false]);
    assert.deepEqual([index.find('120 N Main St, Raleigh, NC').hits.length, index.find('120 N Main St, Raleigh, NC').street], [0, true]);
    assert.equal(index.find('').parsed, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('work in hand can be saved and returned to, and a number given twice is kept once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-addr-'));
  try {
    const all = rows();
    const b = new A.AddressBuilder(path.join(dir, 'work'), 16);
    for (const r of all.slice(0, 60)) b.add(...r);
    const mark = b.checkpoint();
    for (const r of all.slice(60, 90)) b.add(...r); // a file that was not finished when the app stopped
    b.spool.flush();
    assert.equal(b.add('', 5, 0, 0, 'x', 'y', 'z'), false);
    assert.equal(b.add('Main St', 'none', 0, 0, 'x', 'y', 'z'), false);

    const again = new A.AddressBuilder(path.join(dir, 'work'), 16);
    again.restore(mark);
    assert.equal(again.rows, 60);
    for (const r of all.slice(60)) again.add(...r);
    for (const r of all.slice(0, 10)) again.add(...r); // the same addresses once more
    const meta = again.finish(path.join(dir, 'a.dat'));
    assert.equal(meta.addresses, all.length);
    const index = new A.AddressIndex(path.join(dir, 'a.dat'), meta);
    assert.equal(index.find('20 Main St, Monroe, NC').hits[0].how, 'exact');
    assert.equal(index.find('198 N Main St, Charlotte').hits[0].how, 'exact');
    assert.throws(() => new A.AddressBuilder(path.join(dir, 'work'), 16).restore({ lengths: new Array(16).fill(1e9), locs: 0, rows: 0 }), /not whole/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
