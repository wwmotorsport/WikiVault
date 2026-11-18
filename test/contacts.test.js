'use strict';
// The address book: contacts files, contacts accounts, and placing addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vcard = require('../src/core/vcard');
const sync = require('../src/core/contacts-sync');
const { AddressBook } = require('../src/core/address-book');

const APPLE = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Okafor;Ada;;;', 'FN:Ada Okafor', 'ORG:Okafor & Daughters;', 'item1.ADR;type=HOME;type=pref:;;120 North Main Street;Charlotte;NC;28202;United States',
  'item1.X-ABADR:us', 'item2.ADR;type=WORK:;;30 Elm Avenue\\, Suite 4;Concord;NC;28025;', 'TEL;type=CELL;type=VOICE;type=pref:(704) 555-0101', 'item3.TEL:704-555-0102', 'item3.X-ABLabel:_$!<Sister>!$_',
  'EMAIL;type=INTERNET:ada@example.com', 'NOTE:Gate code 4411\\nSpare key under the', '  third stone', 'UID:ABC-1', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'N:Mart=C3=ADnez;Jos=C3=A9', 'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mart=C3=ADnez', 'TEL;HOME:555 0199', 'ADR;HOME;ENCODING=QUOTED-PRINTABLE:;;Calle Ju=C3=A1rez 45;Monterrey;NL;64000;M=', '=C3=A9xico', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:4.0', 'N:;;;;', 'EMAIL:nobody@example.com', 'END:VCARD', 'BEGIN:VCARD', 'VERSION:4.0', 'FN:Fire Hall', 'TEL;VALUE=uri;TYPE="work,voice":tel:+1-704-555-0111', 'END:VCARD', ''].join('\r\n');

test('vCard files from Apple, Google and old phones are read', () => {
  const cards = vcard.parse(APPLE);
  assert.equal(cards.length, 4);
  const ada = cards[0];
  assert.deepEqual([ada.name, ada.org, ada.uid, ada.emails], ['Ada Okafor', 'Okafor & Daughters', 'ABC-1', ['ada@example.com']]);
  assert.deepEqual(ada.addresses, [{ label: 'home', text: '120 North Main Street\nCharlotte, NC 28202\nUnited States' }, { label: 'work', text: '30 Elm Avenue, Suite 4\nConcord, NC 28025' }]);
  assert.deepEqual(ada.phones, [{ label: 'mobile', value: '(704) 555-0101' }, { label: 'sister', value: '704-555-0102' }]);
  assert.equal(ada.note, 'Gate code 4411\nSpare key under the third stone');
  assert.deepEqual([cards[1].name, cards[1].addresses[0].text, cards[1].phones[0]], ['José Martínez', 'Calle Juárez 45\nMonterrey, NL 64000\nMéxico', { label: 'home', value: '555 0199' }]);
  assert.equal(cards[2].name, 'nobody@example.com', 'a card with no name is called by what it has');
  assert.deepEqual(cards[3].phones, [{ label: 'work', value: '+1-704-555-0111' }]);
  assert.deepEqual(vcard.parse('nothing here'), []);
});

test('CSV files from Google Contacts and Outlook are read', () => {
  const google = 'First Name,Middle Name,Last Name,Organization Name,Notes,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Label,Address 1 - Formatted,Address 1 - Street,Address 1 - City,Address 2 - Label,Address 2 - Street,Address 2 - City,Address 2 - Region,Address 2 - Postal Code\r\n'
    + 'Ada,,Okafor,,"Likes ""tea"", not coffee",ada@example.com,Mobile,704-555-0101 ::: 704-555-0102,Home,"120 N Main St\nCharlotte, NC 28202",120 N Main St,Charlotte,* Work,30 Elm Ave,Concord,NC,28025\r\n,,,Fire Hall,,,Work,704-555-0111,,,,,,,,,\r\n';
  const g = vcard.parseAny(google);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].name, g[0].note, g[0].emails], ['Ada Okafor', 'Likes "tea", not coffee', ['ada@example.com']]);
  assert.deepEqual(g[0].addresses, [{ label: 'home', text: '120 N Main St\nCharlotte, NC 28202' }, { label: 'work', text: '30 Elm Ave\nConcord, NC 28025' }]);
  assert.deepEqual(g[0].phones.map((p) => p.value), ['704-555-0101', '704-555-0102']);
  assert.deepEqual([g[1].name, g[1].phones[0]], ['Fire Hall', { label: 'work', value: '704-555-0111' }]);
  const outlook = vcard.parseCsv('First Name,Last Name,Company,Home Street,Home City,Home State,Home Postal Code,Mobile Phone,E-mail Address\nSam,Reed,,9 Oak Hollow Rd,Harrisburg,NC,28075,555-0133,sam@example.com\n');
  assert.deepEqual([outlook[0].name, outlook[0].addresses[0], outlook[0].phones[0], outlook[0].emails], ['Sam Reed', { label: 'home', text: '9 Oak Hollow Rd\nHarrisburg, NC 28075' }, { label: 'mobile', value: '555-0133' }, ['sam@example.com']]);
  assert.deepEqual(vcard.parseCsv('only a header\n'), []);
});

test('the book places addresses, keeps what the user changed, and follows its sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-book-'));
  try {
    let asked = 0;
    const known = { '120 North Main Street, Charlotte, NC 28202, United States': { lat: 35.23, lon: -80.848, how: 'exact' }, '30 Elm Avenue, Suite 4, Concord, NC 28025': { lat: 35.41, lon: -80.58, how: 'between', why: 'Approximate.' } };
    const book = new AddressBook(path.join(dir, 'book.json'), { locate: (a) => { asked += 1; return known[a] || null; } }).load();
    const cards = vcard.parse(APPLE);
    const r = book.importContacts(cards, 'icloud', { account: 'ada@example.com' });
    assert.deepEqual(r, { contacts: 4, entries: 4, added: 4, removed: 0, located: 2 });
    assert.deepEqual(book.summary().sources.icloud.account, 'ada@example.com');
    assert.deepEqual([book.summary().count, book.summary().withAddress, book.summary().located, book.summary().approximate], [4, 3, 2, 1]);
    const [home, work] = book.list().filter((e) => e.name === 'Ada Okafor');
    assert.deepEqual([home.label, home.lat, home.how, home.phones, work.label, work.how, work.why], ['home', 35.23, 'exact', '(704) 555-0101 (mobile); 704-555-0102 (sister)', 'work', 'between', 'Approximate.']);
    assert.equal(book.list().some((e) => e.name === 'nobody@example.com'), false, 'no address and no number: nothing to keep');
    assert.equal(book.list().find((e) => e.name === 'Fire Hall').address, '');

    // The user moves one by hand and writes one of their own.
    const jose = book.list().find((e) => e.name === 'José Martínez');
    assert.equal(jose.lat, null);
    book.put({ ...jose, lat: 25.67, lon: -100.31 });
    const cabin = book.put({ name: 'The cabin', address: '', note: 'No address: placed on the map', lat: 35.9, lon: -82.1 });
    assert.deepEqual([cabin.src, cabin.how, cabin.fixed], ['own', 'manual', true]);
    assert.throws(() => book.put({ name: '  ' }), /name/);

    // The account is read again: one contact has gone, one address changed, the rest is not looked up again.
    asked = 0;
    const next = cards.filter((c) => c.name !== 'Fire Hall');
    next[0] = { ...next[0], addresses: [next[0].addresses[0], { label: 'work', text: '500 Oak Hollow Road\nHarrisburg, NC' }] };
    const again = book.importContacts(next, 'icloud');
    assert.deepEqual([again.entries, again.added, again.removed], [2, 1, 2]);
    assert.equal(asked, 1, 'only the new address was looked up');
    const all = book.list();
    assert.deepEqual(all.map((e) => `${e.name}/${e.label}/${e.src}`), ['Ada Okafor/home/icloud', 'Ada Okafor/work/icloud', 'José Martínez/home/own', 'The cabin//own']);
    assert.deepEqual([all[2].lat, all[2].how], [25.67, 'manual'], 'the entry the user placed is theirs now and stays put');
    assert.equal(all[0].id, home.id, 'an entry that is still there keeps its identity');

    // Search, by any word. Entries with a position come first.
    assert.deepEqual(book.search('ada').map((e) => e.label), ['home', 'work']);
    assert.deepEqual(book.search('okafor charlotte').map((e) => e.label), ['home']);
    assert.deepEqual(book.search('jose').map((e) => e.name), ['José Martínez']);
    assert.deepEqual(book.search(''), []);

    // More address data arrives: what could not be placed is tried again, what was placed by hand is left.
    known['500 Oak Hollow Road, Harrisburg, NC'] = { lat: 35.3, lon: -80.8, how: 'exact' };
    assert.equal(book.locateAll().found, 1);
    assert.equal(book.list()[2].lat, 25.67);

    const reopened = new AddressBook(path.join(dir, 'book.json')).load();
    assert.equal(reopened.list().length, 4);
    assert.equal(reopened.put({ name: 'New' }).id, `b${book.next}`);
    book.noteError('icloud', 'offline');
    assert.equal(book.summary().sources.icloud.error, 'offline');
    book.dropSource('icloud');
    assert.deepEqual([book.list().map((e) => e.name), book.summary().sources], [['José Martínez', 'The cabin'], {}]);
    assert.ok(book.remove(cabin.id) && !book.remove(cabin.id));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => { s.closeAllConnections(); s.close(r); }) })); });
const bodyOf = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => resolve(b)); });

test('Google: sign in through the browser, then read the contacts a page at a time', async () => {
  const seen = { token: [], people: [] };
  let code = null; let challenge = null;
  const site = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/token') {
      const f = Object.fromEntries(new URLSearchParams(await bodyOf(req))); seen.token.push(f);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (f.client_secret !== 'shh') { res.statusCode = 401; return res.end('{"error":"invalid_client"}'); }
      if (f.grant_type === 'authorization_code') {
        const ok = f.code === code && require('node:crypto').createHash('sha256').update(f.code_verifier).digest('base64url') === challenge;
        return res.end(ok ? '{"access_token":"at1","refresh_token":"rt1","expires_in":3599}' : '{"error":"invalid_grant"}');
      }
      if (f.refresh_token !== 'rt1') { res.statusCode = 400; return res.end('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}'); }
      return res.end('{"access_token":"at2","expires_in":3599}');
    }
    if (u.pathname === '/people') {
      seen.people.push([req.headers.authorization, u.searchParams.get('pageToken'), u.searchParams.get('personFields')]);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (!u.searchParams.get('pageToken')) return res.end(JSON.stringify({ connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Ada Okafor' }], addresses: [{ formattedValue: '120 N Main St\nCharlotte, NC 28202', type: 'home' }, { streetAddress: '30 Elm Ave', city: 'Concord', region: 'NC', postalCode: '28025', formattedType: 'Work' }], phoneNumbers: [{ value: '704-555-0101', type: 'mobile' }], emailAddresses: [{ value: 'ada@example.com' }], biographies: [{ value: 'Gate code 4411' }] }], nextPageToken: 'p2' }));
      return res.end(JSON.stringify({ connections: [{ resourceName: 'people/c2', organizations: [{ name: 'Fire Hall' }], phoneNumbers: [{ value: '704-555-0111' }] }, { resourceName: 'people/c3' }] }));
    }
    res.writeHead(404).end();
  });
  try {
    const endpoints = { auth: `${site.origin}/auth`, token: `${site.origin}/token`, people: `${site.origin}/people`, scope: sync.GOOGLE.scope };
    // The "browser": reads the address it is sent to, and comes back to the app the way Google's page would.
    const browser = (answer) => async (url) => {
      const u = new URL(url); const q = u.searchParams;
      assert.deepEqual([u.pathname, q.get('client_id'), q.get('response_type'), q.get('scope'), q.get('access_type'), q.get('code_challenge_method')], ['/auth', 'cid', 'code', sync.GOOGLE.scope, 'offline', 'S256']);
      assert.match(q.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
      challenge = q.get('code_challenge'); code = 'the-code';
      const back = await fetch(`${q.get('redirect_uri')}/?${answer(q.get('state'))}`);
      assert.equal(back.status, 200);
      assert.equal((await fetch(`${q.get('redirect_uri')}/favicon.ico`).catch(() => ({ status: 404 }))).status, 404);
    };
    const r = await sync.googleSignIn({ clientId: 'cid', clientSecret: 'shh', endpoints, open: browser((state) => `state=${state}&code=the-code`) });
    assert.deepEqual(r, { refreshToken: 'rt1' });
    await assert.rejects(sync.googleSignIn({ clientId: 'cid', clientSecret: 'shh', endpoints, open: browser(() => 'error=access_denied') }), /cancelled in the browser/);
    await assert.rejects(sync.googleSignIn({ clientId: 'cid', clientSecret: 'shh', endpoints, open: browser(() => 'state=forged&code=the-code') }), /did not finish/);
    await assert.rejects(sync.googleSignIn({ clientId: 'cid', clientSecret: 'wrong', endpoints, open: browser((state) => `state=${state}&code=the-code`) }), /client ID and secret/);
    await assert.rejects(sync.googleSignIn({ clientId: '', clientSecret: '', endpoints, open: () => {} }), /first/);
    await assert.rejects(sync.googleSignIn({ clientId: 'cid', clientSecret: 'shh', endpoints, open: () => {}, waitMs: 60 }), /in time/);

    const contacts = await sync.googleContacts({ clientId: 'cid', clientSecret: 'shh', refreshToken: 'rt1', endpoints });
    assert.deepEqual(contacts, [
      { uid: 'people/c1', name: 'Ada Okafor', org: '', note: 'Gate code 4411', addresses: [{ label: 'home', text: '120 N Main St\nCharlotte, NC 28202' }, { label: 'work', text: '30 Elm Ave\nConcord, NC 28025' }], phones: [{ label: 'mobile', value: '704-555-0101' }], emails: ['ada@example.com'] },
      { uid: 'people/c2', name: 'Fire Hall', org: 'Fire Hall', note: '', addresses: [], phones: [{ label: '', value: '704-555-0111' }], emails: [] },
    ]);
    assert.deepEqual(seen.people.map((p) => [p[0], p[1]]), [['Bearer at2', null], ['Bearer at2', 'p2']]);
    await assert.rejects(sync.googleContacts({ clientId: 'cid', clientSecret: 'shh', refreshToken: 'old', endpoints }), { code: 'SIGN_IN_AGAIN' });
  } finally { await site.close(); }
});

test('iCloud: the address books are found and their cards read, across a move to another server', async () => {
  const seen = [];
  const ms = (inner) => `<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">${inner}</multistatus>`;
  const cards = APPLE.split('END:VCARD\r\n').filter((c) => c.trim()).map((c) => `${c}END:VCARD\r\n`);
  let second = null;
  const handler = (who) => async (req, res) => {
    const body = await bodyOf(req);
    seen.push(`${who} ${req.method} ${req.url} depth=${req.headers.depth}`);
    if (req.headers.authorization !== `Basic ${Buffer.from('ada@example.com:abcd-efgh-ijkl-mnop').toString('base64')}`) { res.writeHead(401).end(); return; }
    const send = (xmlText) => res.writeHead(207, { 'content-type': 'text/xml' }).end(ms(xmlText));
    if (who === 'front' && req.url === '/') return send('<response><href>/</href><propstat><prop><current-user-principal><href>/1234/principal/</href></current-user-principal></prop></propstat></response>');
    if (who === 'front' && req.url === '/1234/principal/') return send(`<response xmlns:C="urn:ietf:params:xml:ns:carddav"><href>/1234/principal/</href><propstat><prop><C:addressbook-home-set><href>${second.origin}/1234/carddavhome/</href></C:addressbook-home-set></prop></propstat></response>`);
    if (who === 'back' && req.url === '/1234/carddavhome/') return send('<response><href>/1234/carddavhome/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response><response><href>/1234/carddavhome/card/</href><propstat><prop><resourcetype><collection/><addressbook xmlns="urn:ietf:params:xml:ns:carddav"/></resourcetype></prop></propstat></response>');
    if (who === 'back' && req.url === '/1234/carddavhome/card/' && req.method === 'PROPFIND') return send(`<response><href>/1234/carddavhome/card/</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>${cards.map((c, i) => `<response><href>/1234/carddavhome/card/c%20${i}.vcf</href><propstat><prop><getetag>"e${i}"</getetag><resourcetype/></prop></propstat></response>`).join('')}`);
    if (who === 'back' && req.method === 'REPORT') {
      const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]);
      return send(hrefs.map((h) => { const i = Number(/c%20(\d+)\.vcf/.exec(h)[1]); return `<response><href>${h}</href><propstat><prop><getetag>"e${i}"</getetag><address-data xmlns="urn:ietf:params:xml:ns:carddav">${i % 2 ? `<![CDATA[${cards[i]}]]>` : cards[i].replace(/&/g, '&amp;').replace(/</g, '&lt;')}</address-data></prop></propstat></response>`; }).join(''));
    }
    res.writeHead(404).end();
  };
  second = await listen(handler('back'));
  const first = await listen(handler('front'));
  try {
    const contacts = await sync.icloudContacts({ user: 'ada@example.com', password: 'abcd-efgh-ijkl-mnop', base: `${first.origin}/` });
    assert.deepEqual(contacts.map((c) => c.name), ['Ada Okafor', 'José Martínez', 'nobody@example.com', 'Fire Hall']);
    assert.equal(contacts[0].org, 'Okafor & Daughters', 'text that was escaped for XML is read back');
    assert.deepEqual(seen.map((s) => s.replace(/ depth=/, ' ')), ['front PROPFIND / 0', 'front PROPFIND /1234/principal/ 0', 'back PROPFIND /1234/carddavhome/ 1', 'back PROPFIND /1234/carddavhome/card/ 1', 'back REPORT /1234/carddavhome/card/ 1']);
    await assert.rejects(sync.icloudContacts({ user: 'ada@example.com', password: 'my-usual-password', base: `${first.origin}/` }), (err) => err.code === 'SIGN_IN_AGAIN' && /app-specific password/.test(err.message));
    await assert.rejects(sync.icloudContacts({ user: '', password: '' }), /first/);
  } finally { await first.close(); await second.close(); }
});
