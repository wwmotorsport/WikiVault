'use strict';
// The address book: people and places the user wants to keep, with where they are.
//
// Entries are typed in, saved from the map, or brought in from a contacts account or file. One entry is one
// address: a contact with a home and a work address becomes two entries, and a contact with no address is
// kept for its telephone number. Each address is looked up in the app's own address data to get a position,
// so it can be shown on the map and driven to with no connection.
// An entry can be pinned (Home, Work, School, Meeting point, or a name of the user's own) and its person
// given a relationship: a group (Family, Friends...) and a tie (mother, wife, father-in-law...). These are the
// user's own marks. They are kept in this app only, and reading a contacts account again leaves them in place.
// An address the downloaded data cannot place can be looked up online when the user has agreed to that (see
// geocode-online.js); what comes back is kept here, so it is asked for once and works with no connection after.
// Kept as one JSON file in the app's own data folder, not in the library. No Electron, no network.

const fs = require('node:fs');
const crypto = require('node:crypto');
const rel = require('./relations');
const geocode = require('./geocode-online');

const NEAR_ENOUGH = new Set(['exact', 'between', 'nearest']); // placements from the downloaded data that an online lookup would not better
const ASK_AGAIN_DAYS = 30; // an address the online lookup did not know is asked about again after this long

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const oneLine = (s) => String(s || '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
const whoOf = (c) => crypto.createHash('sha1').update(String(c.uid || fold(c.name))).digest('hex').slice(0, 12);
const keyOf = (c, address) => crypto.createHash('sha1').update(`${c.uid || fold(c.name)}|${fold(oneLine(address))}`).digest('hex').slice(0, 16);

/**
 * The address in a contact's note, when the note is one: a line (or the whole note) with a house number or PO box, a
 * street, and a town with its state or a ZIP code. Anything else in a note is left as a note.
 */
function noteAddress(note) {
  const text = String(note || '').trim();
  if (!text || text.length > 300) return '';
  const tries = [text.replace(/\s*\n\s*/g, ', '), ...text.split('\n').map((s) => s.trim())].filter(Boolean);
  for (const t of tries) {
    if (!/^(?:\d+[A-Za-z]?\s+\S|P\.?\s?O\.?\s*Box\s+\d)/i.test(t)) continue;
    const row = geocode.rowOf(t);
    if ((row && row.street && (row.zip || (row.city && row.state))) || /,\s*[A-Za-z]{2}\s+\d{5}(?:-\d{4})?$/.test(t)) return t;
  }
  return '';
}

class AddressBook {
  /** `locate(address)` returns { lat, lon, how, why } or null; it is the app's address search. */
  constructor(file, { locate = () => null, log = () => {} } = {}) { this.file = file; this.locate = locate; this.log = log; this.entries = []; this.sources = {}; this.next = 1; }

  load() {
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.entries = Array.isArray(j.entries) ? j.entries : []; this.sources = j.sources || {}; this.placedBy = j.placedBy || ''; this.next = Number(j.next) || this.entries.length + 1; } catch { this.entries = []; this.sources = {}; this.next = 1; }
    return this;
  }
  save() { fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({ v: 1, next: this.next, placedBy: this.placedBy || '', sources: this.sources, entries: this.entries })); fs.renameSync(`${this.file}.tmp`, this.file); }

  summary() {
    const withAddress = this.entries.filter((e) => e.address).length;
    return { count: this.entries.length, withAddress, pinned: this.entries.filter((e) => e.pin).length, related: this.entries.filter((e) => e.group || e.tie).length, located: this.entries.filter((e) => e.lat != null).length, approximate: this.entries.filter((e) => e.lat != null && e.how && e.how !== 'exact' && e.how !== 'manual' && e.how !== 'online').length, online: this.entries.filter((e) => e.how === 'online').length, lookable: this.toLookUp().length, sources: this.sources };
  }
  list() { return this.entries.slice().sort((a, b) => fold(a.name).localeCompare(fold(b.name)) || fold(a.label).localeCompare(fold(b.label))); }
  get(id) { return this.entries.find((e) => e.id === id) || null; }

  /** Work out where an entry is from its address, unless the user has placed it by hand. */
  place(e) {
    if (e.fixed) return e;
    const text = e.address ? oneLine(e.address) : '';
    const hit = text ? this.locate(text) : null;
    if (e.web && e.web.of !== text) delete e.web; // the address has changed since it was looked up online
    // What an online lookup found stands in when the downloaded data knows the town at best. A house the data has,
    // or a street it can place the number along, is at least as good and needs no connection to check.
    if (e.web && e.web.lat != null && !(hit && hit.lat != null && NEAR_ENOUGH.has(hit.how))) {
      Object.assign(e, { lat: e.web.lat, lon: e.web.lon, how: 'online', why: `Looked up online as ${e.web.matched || text}. The lookup places a number along its street from the range of numbers on the block, so the mark may be a few doors from the house.` });
      return e;
    }
    if (hit && hit.lat != null) { e.lat = hit.lat; e.lon = hit.lon; e.how = hit.how; e.why = hit.why || ''; } else { e.lat = null; e.lon = null; e.how = null; e.why = (hit && hit.why) || ''; } // with no place, `why` says what stood in the way
    return e;
  }

  /** The user's marks, tidied: { pin, pinName, group, tie }. A known tie brings its group when none was given. */
  static marks({ pin = '', pinName = '', group = '', tie = '' } = {}) {
    pin = rel.PINS.some((p) => p.id === pin) ? pin : '';
    tie = rel.tieOf(tie);
    group = rel.GROUPS.some((g) => g.id === group) ? group : '';
    if (!group && tie) group = rel.groupOfTie(tie);
    return { pin, pinName: pin ? String(pinName || '').trim().slice(0, 40) : '', group, tie };
  }
  /** Everything kept about the same person: an account's contact with two addresses is two entries. */
  samePerson(e) { return e.who ? this.entries.filter((x) => x.who === e.who && x.src === e.src) : [e]; }

  /**
   * Add an entry, or change one when `id` is given. A position given with it is kept as placed by hand.
   * Changing what an account's entry says (name, address, telephone...) makes it the user's own, which a later
   * sync leaves alone. Pinning it or giving it a relationship does not: it stays in step with the account.
   */
  put({ id = null, name, label, address, phones, email, org, note, lat = null, lon = null, pin, pinName, group, tie }) {
    let e = id ? this.get(id) : null;
    if (id && !e) throw new Error('That entry is no longer there.');
    const text = (v, old, max) => (v === undefined ? (old || '') : String(v || '').trim().slice(0, max));
    const old = e || {};
    const fields = { name: text(name, old.name, 200), label: text(label, old.label, 40), address: text(address, old.address, 500), phones: text(phones, old.phones, 300), email: text(email, old.email, 200), org: text(org, old.org, 200), note: text(note, old.note, 2000) };
    if (!fields.name) throw new Error('Give the entry a name.');
    const here = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && lat !== null && lon !== null;
    const moved = !e || String(e.address || '').replace(/\r\n?/g, '\n').trim().slice(0, 500) !== fields.address.replace(/\r\n?/g, '\n');
    const same = (a, b) => String(a || '').replace(/\r\n?/g, '\n').trim() === String(b || '').replace(/\r\n?/g, '\n').trim();
    const limit = { name: 200, label: 40, address: 500, phones: 300, email: 200, org: 200, note: 2000 };
    const changed = !e || Object.keys(fields).some((k) => !same(String(e[k] || '').trim().slice(0, limit[k]), fields[k])) || (here && (Number(lat) !== e.lat || Number(lon) !== e.lon));
    if (!e) { e = { id: `b${this.next++}`, src: 'own' }; this.entries.push(e); }
    if (changed) Object.assign(e, fields, { src: 'own' });
    if (here) Object.assign(e, { lat: Number(lat), lon: Number(lon), how: 'manual', why: '', fixed: true });
    else if (moved) { e.fixed = false; this.place(e); }
    if ([pin, pinName, group, tie].some((v) => v !== undefined)) {
      const m = AddressBook.marks({ pin: pin === undefined ? e.pin : pin, pinName: pinName === undefined ? e.pinName : pinName, group: group === undefined ? e.group : group, tie: tie === undefined ? e.tie : tie });
      Object.assign(e, { pin: m.pin, pinName: m.pinName });
      for (const x of this.samePerson(e)) Object.assign(x, { group: m.group, tie: m.tie }); // the relationship is the person's, the pin is the address's
    }
    this.save();
    return e;
  }
  remove(id) { const n = this.entries.length; this.entries = this.entries.filter((e) => e.id !== id); if (this.entries.length !== n) this.save(); return this.entries.length !== n; }

  /**
   * Bring in the contacts of one source ('google', 'icloud', or 'file'), replacing what came from it before.
   * Entries the user has changed or made are left alone, and an address already placed is not looked up again.
   * Returns { contacts, entries, added, removed, located, skipped, fromNotes }: `skipped` are contacts with neither an
   * address nor a telephone number (there is nothing to find them by), `fromNotes` those whose address was in their note.
   */
  importContacts(contacts, source, info = {}) {
    let skipped = 0; let fromNotes = 0;
    const before = new Map(this.entries.filter((e) => e.src === source).map((e) => [e.key, e]));
    // The user's marks are carried over when an address changes in the account, which gives the entry a new key.
    const people = new Map();
    for (const e of before.values()) { const w = e.who; if (!w) continue; if (!people.has(w)) people.set(w, []); people.get(w).push(e); }
    const own = new Set(this.entries.filter((e) => e.src === 'own' && e.key).map((e) => e.key));
    const fresh = []; const seen = new Set();
    for (const c of contacts) {
      const phones = (c.phones || []).map((p) => (p.label ? `${p.value} (${p.label})` : p.value)).join('; ').slice(0, 300);
      let places = (c.addresses || []).length ? c.addresses : [{ label: '', text: '' }];
      // An address typed (or imported) into a contact's note, where a list uploaded to an account can land: used as its address.
      if (!(c.addresses || []).length) { const inNote = noteAddress(c.note); if (inNote) { places = [{ label: '', text: inNote }]; fromNotes += 1; } }
      if (!phones && !places.some((a) => String(a.text || '').trim())) skipped += 1;
      for (const a of places) {
        const address = String(a.text || '').trim();
        if (!address && !phones) continue; // nothing to find them by
        const key = keyOf(c, address);
        if (seen.has(key) || own.has(key)) continue;
        seen.add(key);
        const old = before.get(key);
        const who = whoOf(c);
        const e = old || { id: `b${this.next++}`, src: source, key };
        if (!old) {
          // Not seen before under this key: the same person's earlier entries say who they are to the user, and
          // an earlier entry with the same label (or the only one) hands on its pin.
          const was = people.get(who) || [];
          const kin = was.find((x) => x.group || x.tie);
          if (kin) Object.assign(e, { group: kin.group || '', tie: kin.tie || '' });
          const gone = was.filter((x) => x.pin && !contacts.some((cc) => whoOf(cc) === who && (cc.addresses || []).some((aa) => keyOf(cc, String(aa.text || '').trim()) === x.key)));
          const from = gone.find((x) => fold(x.label) === fold(a.label)) || (gone.length === 1 && places.length === 1 ? gone[0] : null);
          if (from && !from.handed) { from.handed = true; Object.assign(e, { pin: from.pin, pinName: from.pinName || '' }); }
        }
        e.who = who;
        Object.assign(e, { name: String(c.name || '').slice(0, 200) || 'No name', label: String(a.label || '').slice(0, 40), phones, email: (c.emails || [])[0] || '', org: c.org || '', note: c.note || '' });
        if (!old || old.address !== address || old.lat == null) { e.address = address; this.place(e); }
        fresh.push(e);
      }
    }
    for (const e of before.values()) delete e.handed;
    const removed = [...before.keys()].filter((k) => !seen.has(k)).length;
    this.entries = this.entries.filter((e) => e.src !== source).concat(fresh);
    this.sources[source] = { ...(this.sources[source] || {}), ...info, date: new Date().toISOString(), contacts: contacts.length, entries: fresh.length, error: null };
    this.save();
    return { contacts: contacts.length, entries: fresh.length, added: fresh.filter((e) => !before.has(e.key)).length, removed, located: fresh.filter((e) => e.lat != null).length, skipped, fromNotes };
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

  /**
   * The addresses an online lookup could help with: [{ id, address }]. Those the downloaded data places at the
   * house or along the street are left out, as are those placed by hand, those the service cannot use (no house
   * number, or outside the United States), and those it was asked about lately without finding them.
   */
  toLookUp(now = Date.now()) {
    const out = [];
    for (const e of this.entries) {
      if (!e.address || e.fixed || NEAR_ENOUGH.has(e.how) || e.how === 'manual' || e.how === 'online') continue;
      const text = oneLine(e.address);
      if (e.web && e.web.of === text && (e.web.lat != null || now - Date.parse(e.web.date) < ASK_AGAIN_DAYS * 86400000)) continue;
      if (!geocode.rowOf(text)) continue;
      out.push({ id: e.id, address: text });
    }
    return out;
  }
  /**
   * Keep what an online lookup said. `asked` is what toLookUp() gave, `found` a Map from id to { lat, lon, matched,
   * exact }. An address that was asked about and not found is remembered too, so that it is not sent again for a while.
   */
  applyLookup(asked, found, now = Date.now()) {
    let placed = 0;
    for (const a of asked) {
      const e = this.get(a.id);
      if (!e || e.fixed || oneLine(e.address || '') !== a.address) continue; // changed while the answer was on its way
      const hit = found.get(String(a.id));
      e.web = hit ? { of: a.address, date: new Date(now).toISOString(), lat: hit.lat, lon: hit.lon, matched: hit.matched || '', exact: Boolean(hit.exact) } : { of: a.address, date: new Date(now).toISOString() };
      this.place(e);
      if (e.how === 'online') placed += 1;
    }
    this.save();
    return { asked: asked.length, placed };
  }

  /** Pinned entries of one kind ('home', 'work'...), or those whose own pin name is the words given. Placed ones first. */
  pinned(kind, named = '') {
    const want = fold(named).trim();
    return this.list().filter((e) => e.pin && (want ? fold(e.pinName) === want : e.pin === kind)).sort((a, b) => (a.lat == null) - (b.lat == null));
  }
  /** Entries of the people with one of these ties, e.g. ['mother-in-law']. Placed ones first. */
  related(ties) {
    const want = new Set(ties);
    return this.list().filter((e) => e.tie && want.has(e.tie)).sort((a, b) => (a.lat == null) - (b.lat == null));
  }

  /**
   * Entries matching typed words, by name, address, label, organisation, relationship or pin. "mom" finds the
   * person marked as mother, and "family" everyone in that group. Those with a position come first.
   */
  search(q, limit = 8) {
    const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const ties = new Set(rel.tiesMeant(q));
    const group = rel.groupMeant(q);
    const out = [];
    for (const e of this.entries) {
      const kin = (e.tie && ties.has(e.tie)) || (group && e.group === group);
      const hay = fold(`${e.name} ${e.label} ${e.org} ${e.address} ${e.tie || ''} ${rel.groupName(e.group)} ${e.pin ? `${rel.pinName(e.pin)} ${e.pinName || ''}` : ''}`);
      if (!kin && !words.every((w) => hay.includes(w))) continue;
      const name = fold(e.name);
      out.push({ e, score: (kin ? -2 : 0) + (e.pin ? -1 : 0) + (name.startsWith(words[0]) ? 0 : 2) + (words.every((w) => name.includes(w)) ? 0 : 1) + (e.lat == null ? 6 : 0) });
    }
    return out.sort((a, b) => a.score - b.score || fold(a.e.name).localeCompare(fold(b.e.name))).slice(0, limit).map((x) => x.e);
  }
}

module.exports = { noteAddress, AddressBook, oneLine, fold };
