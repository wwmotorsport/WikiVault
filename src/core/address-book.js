'use strict';
// The address book: people and places the user wants to keep, with where they are.
//
// Entries are typed in, saved from the map, or brought in from a contacts account or file. One entry is one
// address: a contact with a home and a work address becomes two entries, and a contact with no address is
// kept for its telephone number. Each address is looked up in the app's own address data to get a position,
// so it can be shown on the map and driven to with no connection.
// Kept as one JSON file in the app's own data folder, not in the library. No Electron, no network.

const fs = require('node:fs');
const crypto = require('node:crypto');

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
const keyOf = (c, address) => crypto.createHash('sha1').update(`${c.uid || fold(c.name)}|${fold(oneLine(address))}`).digest('hex').slice(0, 16);

class AddressBook {
  /** `locate(address)` returns { lat, lon, how, why } or null; it is the app's address search. */
  constructor(file, { locate = () => null, log = () => {} } = {}) { this.file = file; this.locate = locate; this.log = log; this.entries = []; this.sources = {}; this.next = 1; }

  load() {
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.entries = Array.isArray(j.entries) ? j.entries : []; this.sources = j.sources || {}; this.next = Number(j.next) || this.entries.length + 1; } catch { this.entries = []; this.sources = {}; this.next = 1; }
    return this;
  }
  save() { fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, next: this.next, sources: this.sources, entries: this.entries })); fs.renameSync(`${this.file}.tmp`, this.file); }

  summary() {
    const withAddress = this.entries.filter((e) => e.address).length;
    return { count: this.entries.length, withAddress, located: this.entries.filter((e) => e.lat != null).length, approximate: this.entries.filter((e) => e.lat != null && e.how && e.how !== 'exact' && e.how !== 'manual').length, sources: this.sources };
  }
  list() { return this.entries.slice().sort((a, b) => fold(a.name).localeCompare(fold(b.name)) || fold(a.label).localeCompare(fold(b.label))); }
  get(id) { return this.entries.find((e) => e.id === id) || null; }

  /** Work out where an entry is from its address, unless the user has placed it by hand. */
  place(e) {
    if (e.fixed) return e;
    const hit = e.address ? this.locate(oneLine(e.address)) : null;
    if (hit) { e.lat = hit.lat; e.lon = hit.lon; e.how = hit.how; e.why = hit.why || ''; } else { e.lat = null; e.lon = null; e.how = null; e.why = ''; }
    return e;
  }

  /** Add an entry, or change one when `id` is given. A position given with it is kept as placed by hand. */
  put({ id = null, name, label = '', address = '', phones = '', email = '', org = '', note = '', lat = null, lon = null }) {
    name = String(name || '').trim().slice(0, 200);
    if (!name) throw new Error('Give the entry a name.');
    const fields = { name, label: String(label || '').trim().slice(0, 40), address: String(address || '').trim().slice(0, 500), phones: String(phones || '').trim().slice(0, 300), email: String(email || '').trim().slice(0, 200), org: String(org || '').trim().slice(0, 200), note: String(note || '').trim().slice(0, 2000) };
    let e = id ? this.get(id) : null;
    if (id && !e) throw new Error('That entry is no longer there.');
    const moved = !e || e.address !== fields.address;
    if (!e) { e = { id: `b${this.next++}`, src: 'own' }; this.entries.push(e); }
    Object.assign(e, fields, { src: 'own' }); // an entry changed by hand is the user's own from then on: a later sync leaves it alone
    const here = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== null && lon !== null;
    if (here) Object.assign(e, { lat: Number(lat), lon: Number(lon), how: 'manual', why: '', fixed: true });
    else if (moved) { e.fixed = false; this.place(e); }
    this.save();
    return e;
  }
  remove(id) { const n = this.entries.length; this.entries = this.entries.filter((e) => e.id !== id); if (this.entries.length !== n) this.save(); return this.entries.length !== n; }

  /**
   * Bring in the contacts of one source ('google', 'icloud', or 'file'), replacing what came from it before.
   * Entries the user has changed or made are left alone, and an address already placed is not looked up again.
   * Returns { contacts, entries, added, removed, located }.
   */
  importContacts(contacts, source, info = {}) {
    const before = new Map(this.entries.filter((e) => e.src === source).map((e) => [e.key, e]));
    const own = new Set(this.entries.filter((e) => e.src === 'own' && e.key).map((e) => e.key));
    const fresh = []; const seen = new Set();
    for (const c of contacts) {
      const phones = (c.phones || []).map((p) => (p.label ? `${p.value} (${p.label})` : p.value)).join('; ').slice(0, 300);
      const places = (c.addresses || []).length ? c.addresses : [{ label: '', text: '' }];
      for (const a of places) {
        const address = String(a.text || '').trim();
        if (!address && !phones) continue; // nothing to find them by
        const key = keyOf(c, address);
        if (seen.has(key) || own.has(key)) continue;
        seen.add(key);
        const old = before.get(key);
        const e = old || { id: `b${this.next++}`, src: source, key };
        Object.assign(e, { name: String(c.name || '').slice(0, 200) || 'No name', label: String(a.label || '').slice(0, 40), phones, email: (c.emails || [])[0] || '', org: c.org || '', note: c.note || '' });
        if (!old || old.address !== address || old.lat == null) { e.address = address; this.place(e); }
        fresh.push(e);
      }
    }
    const removed = [...before.keys()].filter((k) => !seen.has(k)).length;
    this.entries = this.entries.filter((e) => e.src !== source).concat(fresh);
    this.sources[source] = { ...(this.sources[source] || {}), ...info, date: new Date().toISOString(), contacts: contacts.length, entries: fresh.length, error: null };
    this.save();
    return { contacts: contacts.length, entries: fresh.length, added: fresh.filter((e) => !before.has(e.key)).length, removed, located: fresh.filter((e) => e.lat != null).length };
  }

  /** Forget a source and, unless told to keep them, the entries that came from it. */
  dropSource(source, keep = false) {
    if (keep) for (const e of this.entries) { if (e.src === source) e.src = 'own'; } else this.entries = this.entries.filter((e) => e.src !== source);
    delete this.sources[source];
    this.save();
  }
  noteError(source, message) { this.sources[source] = { ...(this.sources[source] || {}), error: message, tried: new Date().toISOString() }; this.save(); }

  /** Look up again every address that has no exact position: after address data has been fetched, more will be found. */
  locateAll() {
    let found = 0;
    for (const e of this.entries) { if (e.fixed || !e.address || e.how === 'exact') continue; const had = e.lat != null; this.place(e); if (!had && e.lat != null) found += 1; }
    this.save();
    return { found, ...this.summary() };
  }

  /** Entries matching typed words, by name, address, label or organisation. Those with a position come first. */
  search(q, limit = 8) {
    const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const e of this.entries) {
      const hay = fold(`${e.name} ${e.label} ${e.org} ${e.address}`);
      if (!words.every((w) => hay.includes(w))) continue;
      const name = fold(e.name);
      out.push({ e, score: (name.startsWith(words[0]) ? 0 : 2) + (words.every((w) => name.includes(w)) ? 0 : 1) + (e.lat == null ? 4 : 0) });
    }
    return out.sort((a, b) => a.score - b.score || fold(a.e.name).localeCompare(fold(b.e.name))).slice(0, limit).map((x) => x.e);
  }
}

module.exports = { AddressBook, oneLine };
