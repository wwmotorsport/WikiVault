'use strict';
// Looking addresses up online: what is sent (street addresses and nothing else, in the body of a POST), how the
// answer is read, and how the address book keeps and uses it. The service here is a stand-in on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const G = require('../src/core/geocode-online');
const { AddressBook } = require('../src/core/address-book');
const { MapsLibrary } = require('../src/core/maps-library');
const { open, readBody } = require('../src/core/httpx');

test('an address is cut into street, town, state and ZIP code, however it was written', () => {
  const row = (t) => { const r = G.rowOf(t); return r ? [r.street, r.city, r.state, r.zip] : null; };
  assert.deepEqual(row('12 Main St\nSpringfield, IL 62701'), ['12 MAIN ST', 'SPRINGFIELD', 'IL', '62701']);
  assert.deepEqual(row('12 Main St, Springfield, Illinois'), ['12 MAIN ST', 'SPRINGFIELD', 'IL', '']);
  assert.deepEqual(row('12 Main St, 62701'), ['12 MAIN ST', '', '', '62701']);
  // The town and state written twice, as contacts programs do.
  assert.deepEqual(row('12 Main St, Springfield IL 62701, Springfield, IL'), ['12 MAIN ST', 'SPRINGFIELD', 'IL', '62701']);
  // Everything on one line, and the town left on the street's line.
  assert.deepEqual(row('12 Main St Springfield IL 62701'), ['12 MAIN ST', 'SPRINGFIELD', 'IL', '62701']);
  assert.deepEqual(row('100 B Elm Ave SE Springfield, IL 62701'), ['100 B ELM AVE SE', 'SPRINGFIELD', 'IL', '62701']);
  // A name before the street, an apartment after it, the country at the end: none of it is sent.
  assert.deepEqual(row('Acme Widgets\n12 Main Street Apt 4\nSuite 9\nSpringfield, IL 62701-1234\nUSA'), ['12 MAIN STREET', 'SPRINGFIELD', 'IL', '62701']);
  // A town called what a state is called.
  assert.deepEqual(row('12 Main St, New York, New York 10001'), ['12 MAIN ST', 'NEW YORK', 'NY', '10001']);
  assert.deepEqual(row('9 Elm St, Washington, DC 20001'), ['9 ELM ST', 'WASHINGTON', 'DC', '20001']);
  assert.deepEqual(row('5 Pine Rd, Indiana, PA 15701'), ['5 PINE RD', 'INDIANA', 'PA', '15701']);
  assert.deepEqual(row('7 Oak Ln, West Chester, PA'), ['7 OAK LN', 'WEST CHESTER', 'PA', '']);
  // What the service cannot use is not sent at all: no house number, a post office box, a town alone, another country.
  for (const t of ['Main St, Springfield IL', 'PO Box 12, Utica NY 13501', 'Springfield, IL', '12 Main St', '12 Main St, North Carolina', '12 King St W, Toronto, Ontario M5H 1A1', '', null]) assert.equal(row(t), null, String(t));
});

test('the list is plain rows, and the answer is read whatever it holds', () => {
  const list = G.csv([{ id: 'b1', street: '12 MAIN ST', city: 'SPRINGFIELD', state: 'IL', zip: '62701' }, { id: 'b2', street: '9 "ELM" ST\n', city: '', state: '', zip: '20001' }]);
  assert.equal(list, '"b1","12 MAIN ST","SPRINGFIELD","IL","62701"\r\n"b2","9 \'ELM\' ST ","","","20001"');
  const found = G.readAnswer([
    '"b1","12 MAIN ST, SPRINGFIELD, IL, 62701","Match","Exact","12 MAIN ST, SPRINGFIELD, IL, 62701","-89.650148,39.799999","1234","L"',
    '"b2","9 ELM ST, , , 20001","Match","Non_Exact","9 ELM ST NW, WASHINGTON, DC, 20001","-77.0199,38.9101","5678","R"',
    '"b3","1 NOWHERE LN, SPRINGFIELD, IL, ","No_Match"',
    '"b4","4 OAK, SPRINGFIELD, IL, ","Tie"',
    '"b5","5 PINE RD, INDIANA, PA, 15701","Match","Exact","5 PINE RD, INDIANA, PA, 15701","not,numbers","1","L"',
    '"b6","6 BAY RD, DOVER, DE, 19901","Match","Exact","6 BAY RD, DOVER, DE, 19901","0,0","1","L"',
    '', 'an error page, perhaps',
  ].join('\n'));
  assert.deepEqual([...found.keys()], ['b1', 'b2']);
  assert.deepEqual(found.get('b1'), { lat: 39.799999, lon: -89.650148, exact: true, matched: '12 MAIN ST, SPRINGFIELD, IL, 62701' });
  assert.deepEqual([found.get('b2').exact, found.get('b2').matched], [false, '9 ELM ST NW, WASHINGTON, DC, 20001']);
  assert.equal(G.readAnswer('<html>Service unavailable</html>').size, 0);
});

test('only street addresses are sent, in the body of one POST, and the address book keeps what comes back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-geo-'));
  const seen = [];
  const answers = { '12 MAIN ST': '-89.65,39.8', '77 NOWHERE LANE': '-80.9,35.2' };
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
      const rows = body.split(/\r\n/).filter((l) => /^"b\d+"/.test(l)).map((l) => {
        const c = l.split('","').map((s) => s.replace(/"/g, ''));
        const at = answers[c[1]];
        return at ? `"${c[0]}","${c.slice(1).join(', ')}","Match","Exact","${c[1]}, ${c[2]}, ${c[3]}, ${c[4]}","${at}","1","L"` : `"${c[0]}","${c.slice(1).join(', ')}","No_Match"`;
      });
      res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(`${rows.join('\n')}\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/geocoder/locations/addressbatch`;
  const post = async (u, body, headers, signal) => { const { res } = await open(u, { method: 'POST', body, signal, headers: { ...headers, 'Content-Length': String(body.length) } }); return (await readBody(res)).toString('utf8'); };
  try {
    // What the downloaded data can tell: one house exactly, one town roughly, the rest nothing.
    const known = {
      '1 Known Rd, Springfield, IL 62701': { lat: 39.7, lon: -89.6, how: 'exact' },
      '12 Main St, Springfield, IL 62701': { lat: 39.78, lon: -89.64, how: 'town', why: 'Approximate. That street is not in the address data, so this points at the middle of the town.' },
      '14 Main St, Springfield, IL 62701': { lat: 39.781, lon: -89.641, how: 'between', why: 'Approximate.' },
    };
    const book = new AddressBook(path.join(dir, 'book.json'), { locate: (a) => known[a] || { why: 'Not in the address data.' } }).load();
    book.importContacts([
      { uid: '1', name: 'Ann Private', phones: [{ value: '555 0100' }], emails: ['ann@example.org'], addresses: [{ label: 'home', text: '1 Known Rd\nSpringfield, IL 62701' }] },
      { uid: '2', name: 'Bo Secret', phones: [{ value: '555 0101' }], addresses: [{ label: 'home', text: '12 Main St\nSpringfield, IL 62701' }] },
      { uid: '3', name: 'Cy Hidden', addresses: [{ label: '', text: '77 Nowhere Lane, Charlotte, NC 28202' }] },
      { uid: '4', name: 'Di Quiet', addresses: [{ label: '', text: '5 Lost Ct, Smalltown, NC 28999' }] },
      { uid: '5', name: 'Ed Unseen', addresses: [{ label: '', text: 'Springfield, IL' }] },
      { uid: '6', name: 'Flo Nearby', addresses: [{ label: '', text: '14 Main St\nSpringfield, IL 62701' }] },
      { uid: '7', name: 'Gus Phone', phones: [{ value: '555 0107' }] },
    ], 'google');
    const by = (n) => book.list().find((e) => e.name === n);
    assert.deepEqual([book.summary().located, book.summary().approximate, book.summary().online, book.summary().lookable], [3, 2, 0, 3]);

    // Asked about: the three with a house number that the data could not put on their street. Not the house it
    // knows, not the one it can place along its street, not the town alone.
    const asked = book.toLookUp();
    assert.deepEqual(asked.map((a) => a.address), ['12 Main St, Springfield, IL 62701', '77 Nowhere Lane, Charlotte, NC 28202', '5 Lost Ct, Smalltown, NC 28999']);
    const out = await G.lookup(asked, { post, url });
    assert.deepEqual([out.asked, out.skipped, out.found.size], [3, 0, 2]);

    // One request, a POST with nothing in its address, holding street addresses and no name, telephone or email.
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].method, seen[0].url], ['POST', '/geocoder/locations/addressbatch']);
    assert.match(seen[0].type, /^multipart\/form-data; boundary=/);
    assert.match(seen[0].body, /name="benchmark"\r\n\r\nPublic_AR_Current/);
    assert.match(seen[0].body, /name="addressFile"; filename="addresses\.csv"/);
    assert.match(seen[0].body, /"12 MAIN ST","SPRINGFIELD","IL","62701"/);
    for (const secret of ['Ann ', 'Bo ', 'Cy ', 'Private', 'Secret', 'Hidden', 'Quiet', 'Unseen', 'Nearby', '555', 'example.org', 'KNOWN RD', '14 MAIN']) assert.ok(!seen[0].body.includes(secret) && !seen[0].body.toUpperCase().includes(secret.toUpperCase()), `${secret} is not sent`);

    assert.deepEqual(book.applyLookup(asked, out.found), { asked: 3, placed: 2 });
    assert.deepEqual([by('Bo Secret').how, by('Bo Secret').lat, by('Bo Secret').lon], ['online', 39.8, -89.65]);
    assert.match(by('Bo Secret').why, /^Looked up online as 12 MAIN ST, SPRINGFIELD, IL, 62701\. .* a few doors from the house\.$/);
    assert.deepEqual([by('Cy Hidden').how, by('Di Quiet').how, by('Di Quiet').lat], ['online', null, null]);
    assert.deepEqual([book.summary().located, book.summary().approximate, book.summary().online, book.summary().lookable], [4, 1, 2, 0]);

    // Kept on disk, so it works with no connection; what was not found is asked about again only after a month.
    const again = new AddressBook(path.join(dir, 'book.json'), { locate: (a) => known[a] || { why: 'Not in the address data.' } }).load();
    assert.equal(again.get(by('Bo Secret').id).how, 'online');
    assert.deepEqual(again.locateAll().located, 4, 'placing everything again keeps what was looked up');
    assert.equal(again.toLookUp().length, 0);
    assert.deepEqual(again.toLookUp(Date.now() + 31 * 86400000).map((a) => a.address), ['5 Lost Ct, Smalltown, NC 28999']);
    // Reading the account again changes nothing, and nothing is asked twice.
    again.importContacts([{ uid: '2', name: 'Bo Secret', addresses: [{ label: 'home', text: '12 Main St\nSpringfield, IL 62701' }] }, { uid: '3', name: 'Cy Hidden', addresses: [{ label: '', text: '77 Nowhere Lane, Charlotte, NC 28202' }] }], 'google');
    assert.deepEqual([again.summary().online, again.toLookUp().length], [2, 0]);

    // Once the downloaded data has the house, that is used; a place set by hand always wins; a new address starts over.
    known['12 Main St, Springfield, IL 62701'] = { lat: 39.79, lon: -89.66, how: 'exact' };
    again.locateAll();
    const bo = again.list().find((e) => e.name === 'Bo Secret');
    assert.deepEqual([bo.how, bo.lat], ['exact', 39.79]);
    const cy = again.list().find((e) => e.name === 'Cy Hidden');
    again.put({ id: cy.id, lat: 35.3, lon: -80.8 });
    assert.deepEqual([again.get(cy.id).how, again.get(cy.id).lat, again.toLookUp().length], ['manual', 35.3, 0]);
    again.put({ id: cy.id, address: '78 Nowhere Lane, Charlotte, NC 28202' });
    assert.deepEqual([again.get(cy.id).how, again.get(cy.id).web, again.toLookUp().map((a) => a.address)], [null, undefined, ['78 Nowhere Lane, Charlotte, NC 28202']]);
    // An answer that arrives after the address was changed is not used.
    assert.deepEqual(again.applyLookup([{ id: cy.id, address: '77 Nowhere Lane, Charlotte, NC 28202' }], new Map([[cy.id, { lat: 1, lon: 1, matched: 'x' }]])), { asked: 1, placed: 0 });
    assert.equal(again.get(cy.id).lat, null);

    // A long list goes in several requests, and a service that is down is an error, not a wrong answer.
    seen.length = 0;
    const many = Array.from({ length: 1001 }, (_, i) => ({ id: `b${i + 1}`, address: `${i + 1} Main St, Springfield, IL 62701` }));
    const big = await G.lookup(many, { post, url });
    assert.deepEqual([seen.length, big.asked, big.found.size], [2, 1001, 1]);
    await assert.rejects(G.lookup(asked, { post: async () => { throw new Error('no connection'); }, url }), /no connection/);
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a town named with its state is never placed at a namesake in another state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-town-'));
  try {
    fs.mkdirSync(path.join(dir, 'places'), { recursive: true });
    const towns = [
      { c: 'town', i: 'n1', n: 'Springfield', a: 39.8, o: -89.65, x: { population: '114000' } }, // Illinois
      { c: 'town', i: 'n2', n: 'Springfield', a: 37.21, o: -93.29, x: { population: '169000' } }, // Missouri
      { c: 'town', i: 'n3', n: 'Portland', a: 45.52, o: -122.68, x: { population: '650000' } }, // Oregon
      { c: 'town', i: 'n4', n: 'Portland', a: 43.66, o: -70.26, x: { population: '68000' } }, // Maine
    ];
    fs.writeFileSync(path.join(dir, 'places', 'town.json'), JSON.stringify({ items: towns }));
    fs.writeFileSync(path.join(dir, 'places.json'), JSON.stringify({ regions: ['us48'], date: '2026-11-20T00:00:00Z', total: towns.length, counts: { town: towns.length } }));
    const lib = new MapsLibrary({ dir });
    await lib.init();
    const at = (city, st, near) => { const t = lib.townAt(city, st, near || null); return t ? [t.a, t.o] : null; };
    // The state decides, wherever the user is and however big the other town is.
    assert.deepEqual(at('Springfield', 'IL', [-93.3, 37.2]), [39.8, -89.65]);
    assert.deepEqual(at('Springfield', 'MO'), [37.21, -93.29]);
    assert.deepEqual(at('Portland', 'ME'), [43.66, -70.26]);
    assert.deepEqual(at('Portland', 'OR'), [45.52, -122.68]);
    // No town of that name in the state: nothing, not the one across the country.
    assert.equal(at('Portland', 'SC'), null);
    assert.equal(at('Springfield', 'TX'), null);
    // With no state given, the nearest when the user's position is known, else the largest: as before.
    assert.deepEqual(at('Portland', '', [-70.3, 43.7]), [43.66, -70.26]);
    assert.deepEqual(at('Portland', ''), [45.52, -122.68]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
