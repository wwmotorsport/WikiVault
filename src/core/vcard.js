'use strict';
// Contacts as other programs write them: vCard files (versions 2.1, 3.0 and 4.0, as Google, Apple and
// others export them) and the CSV files that Google Contacts and Outlook export.
// Both are read into the same plain shape: { uid, name, org, note, addresses: [{ label, text }],
// phones: [{ label, value }], emails: [value] }. No Electron, no network.

const clean = (s) => String(s == null ? '' : s).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
const unescape = (s) => s.replace(/\\([nN,;:\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
/** Split on a separator that is not escaped with a backslash. */
function split(s, sep) {
  const out = []; let cur = '';
  for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i += 1; } else if (s[i] === sep) { out.push(cur); cur = ''; } else cur += s[i]; }
  out.push(cur);
  return out;
}
function quotedPrintable(s, charset) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) { if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s.charCodeAt(i) & 0xff); }
  const buf = Buffer.from(bytes);
  return /8859|latin|1252/i.test(charset || '') ? buf.toString('latin1') : buf.toString('utf8');
}
const LABELS = { HOME: 'home', WORK: 'work', CELL: 'mobile', MOBILE: 'mobile', IPHONE: 'mobile', MAIN: 'main', FAX: 'fax', OTHER: 'other' };
function labelOf(params) {
  const types = [];
  for (const p of params) { const m = /^(?:TYPE=)?(.*)$/i.exec(p); if (/^[A-Z-]+=/.test(p.toUpperCase()) && !/^TYPE=/i.test(p)) continue; for (const t of m[1].replace(/"/g, '').split(',')) types.push(t.trim().toUpperCase()); }
  for (const t of types) if (LABELS[t]) return LABELS[t];
  return '';
}
/** An ADR value (box;extended;street;town;region;code;country) as lines of address. */
function addressText(value) {
  const f = split(value, ';').map((x) => clean(unescape(x)));
  const line2 = [f[3], [f[4], f[5]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [f[0], f[1], f[2], line2, f[6]].filter(Boolean).join('\n');
}

/** Read the text of a vCard file, which may hold many cards. */
function parse(text) {
  // Lines that were folded are joined again: a line beginning with a space or tab continues the one before,
  // and in the old quoted-printable form a line ending in "=" continues on the next.
  const raw = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const lines = [];
  for (let i = 0; i < raw.length; i++) { let l = raw[i]; while (/ENCODING=QUOTED-PRINTABLE/i.test(l.split(':')[0]) && l.endsWith('=') && i + 1 < raw.length) { l = l.slice(0, -1) + raw[i + 1]; i += 1; } lines.push(l); }
  const out = []; let card = null; const names = new Map();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon).split(';'); let value = line.slice(colon + 1);
    const full = head[0].toUpperCase(); const group = full.includes('.') ? full.slice(0, full.indexOf('.')) : ''; const prop = full.slice(full.indexOf('.') + 1);
    const params = head.slice(1);
    if (prop === 'BEGIN' && /^VCARD$/i.test(value.trim())) { card = { uid: '', name: '', org: '', note: '', addresses: [], phones: [], emails: [], n: '' }; names.clear(); continue; }
    if (!card) continue;
    if (prop === 'END') {
      if (!card.name) card.name = card.n || card.org || (card.emails[0] || '');
      // Apple writes its own label for an address or number on a separate line of the same group.
      for (const list of [card.addresses, card.phones]) for (const it of list) { if (it.group && names.has(it.group)) it.label = names.get(it.group); delete it.group; }
      delete card.n;
      if (card.name || card.addresses.length || card.phones.length) out.push(card);
      card = null; continue;
    }
    if (params.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p) || /^QUOTED-PRINTABLE$/i.test(p))) value = quotedPrintable(value, (params.find((p) => /^CHARSET=/i.test(p)) || '').slice(8));
    if (prop === 'FN') card.name = clean(unescape(value));
    else if (prop === 'N') { const f = split(value, ';').map((x) => clean(unescape(x))); card.n = [f[3], f[1], f[2], f[0], f[4]].filter(Boolean).join(' '); }
    else if (prop === 'ORG') card.org = clean(split(value, ';').map(unescape).filter(Boolean).join(', '));
    else if (prop === 'NOTE') card.note = clean(unescape(value)).slice(0, 2000);
    else if (prop === 'UID') card.uid = value.trim();
    else if (prop === 'ADR') { const t = addressText(value); if (t) card.addresses.push({ label: labelOf(params), text: t, group }); }
    else if (prop === 'TEL') { const v = clean(unescape(value)).replace(/^tel:/i, ''); if (v) card.phones.push({ label: labelOf(params), value: v, group }); }
    else if (prop === 'EMAIL') { const v = clean(unescape(value)); if (v) card.emails.push(v); }
    else if (prop === 'X-ABLABEL' && group) names.set(group, clean(unescape(value)).replace(/^_\$!<(.*)>!\$_$/, '$1').toLowerCase());
  }
  return out;
}

/** Rows of a CSV file, with quoted fields that may hold commas, quotes and line breaks. */
function csvRows(text) {
  const rows = []; let row = []; let cur = ''; let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false; } else cur += ch; continue; }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i += 1; row.push(cur); cur = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; } else cur += ch;
  }
  row.push(cur); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** Read a contacts CSV as Google Contacts or Outlook exports it. */
function parseCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  const at = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (name) => { const i = at(name); return i >= 0 ? clean(r[i]) : ''; };
    const c = { uid: '', name: get('Name') || [get('First Name'), get('Middle Name'), get('Last Name')].filter(Boolean).join(' '), org: get('Organization Name') || get('Organization 1 - Name') || get('Company'), note: get('Notes').slice(0, 2000), addresses: [], phones: [], emails: [] };
    head.forEach((h, i) => {
      const v = clean(r[i]); if (!v) return;
      let m;
      if ((m = /^Address (\d+) - Formatted$/i.exec(h))) c.addresses.push({ label: (get(`Address ${m[1]} - Label`) || get(`Address ${m[1]} - Type`)).replace(/^\* ?/, '').toLowerCase(), text: v });
      else if ((m = /^Phone (\d+) - Value$/i.exec(h))) for (const one of v.split(' ::: ')) c.phones.push({ label: (get(`Phone ${m[1]} - Label`) || get(`Phone ${m[1]} - Type`)).replace(/^\* ?/, '').toLowerCase(), value: one });
      else if (/^E-?mail (\d+) - Value$/i.test(h) || /^E-?mail( \d)? Address$/i.test(h)) for (const one of v.split(' ::: ')) c.emails.push(one);
      else if ((m = /^(Home|Business|Other) Street$/i.exec(h))) { const k = m[1]; const t = [v, [get(`${k} City`), [get(`${k} State`), get(`${k} Postal Code`)].filter(Boolean).join(' ')].filter(Boolean).join(', '), get(`${k} Country/Region`) || get(`${k} Country`)].filter(Boolean).join('\n'); c.addresses.push({ label: k === 'Business' ? 'work' : k.toLowerCase(), text: t }); }
      else if ((m = /^(Home|Business|Mobile|Other|Primary) Phone$/i.exec(h))) c.phones.push({ label: m[1] === 'Business' ? 'work' : m[1].toLowerCase(), value: v });
    });
    // Google also writes the parts of an address; they are used when the formatted one is missing.
    for (let n = 1; n <= 6 && !c.addresses.some((a) => a.n === n); n++) {
      if (at(`Address ${n} - Formatted`) >= 0 && get(`Address ${n} - Formatted`)) continue;
      const street = get(`Address ${n} - Street`); if (!street) continue;
      c.addresses.push({ label: (get(`Address ${n} - Label`) || get(`Address ${n} - Type`)).replace(/^\* ?/, '').toLowerCase(), text: [street, [get(`Address ${n} - City`), [get(`Address ${n} - Region`), get(`Address ${n} - Postal Code`)].filter(Boolean).join(' ')].filter(Boolean).join(', '), get(`Address ${n} - Country`)].filter(Boolean).join('\n') });
    }
    if (!c.name) c.name = c.org || c.emails[0] || '';
    if (c.name || c.addresses.length || c.phones.length) out.push(c);
  }
  return out;
}

/** Read a contacts file of either kind, told apart by what it holds. */
function parseAny(text) { return /BEGIN:VCARD/i.test(String(text).slice(0, 4000)) ? parse(text) : parseCsv(text); }

module.exports = { parse, parseCsv, parseAny, csvRows, addressText };
