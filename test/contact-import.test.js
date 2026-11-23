'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vcard = require('../src/core/vcard');
const { AddressBook, noteAddress } = require('../src/core/address-book');

test('a list made by hand is read by its plain column names', () => {
  const one = vcard.parseCsv('Name,Full Address\nAda Quill,"12 Oak St, Unit 4, Springfield, IL 62701"\nBo Reed,\nCy Vale,"PO Box 9, Portland, OR 97201"\n');
  assert.deepStrictEqual(one.map((c) => [c.name, c.addresses.map((a) => a.text)]), [['Ada Quill', ['12 Oak St, Unit 4, Springfield, IL 62701']], ['Bo Reed', []], ['Cy Vale', ['PO Box 9, Portland, OR 97201']]]);
  const parts = vcard.parseCsv('First,Last,Street Address,Apt,City,State,Zip,Cell Phone,Email\nAda,Quill,12 Oak St,Unit 4,Springfield,IL,62701,555-0100,ada@example.com\n');
  assert.deepStrictEqual(parts.map((c) => [c.name, c.addresses[0].text, c.phones, c.emails]), [['Ada Quill', '12 Oak St, Unit 4, Springfield, IL 62701', [{ label: 'cell', value: '555-0100' }], ['ada@example.com']]]);
  // A file from Google keeps being read by Google's own columns.
  const google = vcard.parseCsv('Name,Address 1 - Formatted,Address 1 - Label,Phone 1 - Value\nAda Quill,"12 Oak St\nSpringfield, IL 62701",Home,555-0100\n');
  assert.deepStrictEqual(google[0].addresses, [{ label: 'home', text: '12 Oak St\nSpringfield, IL 62701' }]);
});

test('an address that landed in a contact\'s note is used as its address, and what was left out is counted', () => {
  assert.strictEqual(noteAddress('12 Oak St, Springfield, IL 62701'), '12 Oak St, Springfield, IL 62701');
  assert.strictEqual(noteAddress('Met at the lake\n12 Oak St, Springfield, IL 62701'), '12 Oak St, Springfield, IL 62701');
  assert.strictEqual(noteAddress('PO Box 9, Portland, OR 97201'), 'PO Box 9, Portland, OR 97201');
  assert.strictEqual(noteAddress('Likes 3 dogs and tea'), '');
  assert.strictEqual(noteAddress('2 kids, born 2019 and 2021'), '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-book-'));
  try {
    const book = new AddressBook(path.join(dir, 'addressbook.json'), {});
    const out = book.importContacts([
      { name: 'Ada Quill', note: '12 Oak St, Springfield, IL 62701', addresses: [], phones: [], emails: [] },
      { name: 'Bo Reed', note: 'Likes tea', addresses: [], phones: [], emails: [] },
      { name: 'Cy Vale', note: '', addresses: [], phones: [{ label: 'mobile', value: '555-0101' }], emails: [] },
      { name: 'Di Wren', note: 'An old note', addresses: [{ label: 'home', text: '40 Elm Ave, Portland, OR 97201' }], phones: [], emails: [] },
    ], 'google');
    assert.deepStrictEqual([out.contacts, out.entries, out.skipped, out.fromNotes], [4, 3, 1, 1]);
    assert.deepStrictEqual(book.entries.map((e) => [e.name, e.address]).sort(), [['Ada Quill', '12 Oak St, Springfield, IL 62701'], ['Cy Vale', ''], ['Di Wren', '40 Elm Ave, Portland, OR 97201']]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
