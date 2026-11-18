'use strict';
// Requests typed into Ask that are about the map: "directions from my house to my mother-in-law's house",
// "take me to work", "where does Dave live". This module recognises them and finds the places they name,
// first among the user's own pins, relationships and contacts, then in the address and place data.
//
// Recognition is by rule, so it is instant and works with no model. Wording the rules do not settle is put to
// the local model when there is one. A request is "sure" when its wording can only be about travel or the map
// ("directions", "route", "take me to", "on the map"); otherwise it counts only if one of the places it names
// is the user's own, so that "where is Jordan" about a country still goes to the articles.
// No Electron, no network.

const rel = require('./relations');

const fold = rel.fold;
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.;:!?"]+|[\s,.;:!?"]+$/g, '').trim();
const POLITE = /^(?:please|pls|hey|hi|hello|ok|okay|so|now|kindly|can you|could you|would you|will you|can i (?:get|have|see)|could i (?:get|have|see)|i need|i want|i would like|i'd like|id like|give me|show me|tell me|get me|find me|i need to know|i want to know)\b[\s,]*/i;
const TAIL = /[\s,]*(?:please|pls|thanks|thank you|for me|right now|now)$/i;
const BY = /[\s,]*\b(?:by car|by bike|by bicycle|by foot|on foot|on a bike|on my bike|walking|driving|cycling|biking)$/i;

function modeOf(text) {
  const t = fold(text);
  if (/\b(?:walk|walking|on foot|by foot|hike|hiking)\b/.test(t)) return 'foot';
  if (/\b(?:bike|biking|bicycle|cycle|cycling)\b/.test(t)) return 'bike';
  return null;
}
function strip(text) {
  let t = tidy(text);
  for (let i = 0; i < 4; i++) { const n = tidy(t.replace(POLITE, '').replace(TAIL, '')); if (n === t) break; t = n; }
  return t;
}
const end = (s) => tidy(tidy(s).replace(BY, '').replace(TAIL, '').replace(/^(?:to|at|for)\s+/i, ''));

/**
 * A typed request as a map request, or null.
 * Returns { kind: 'route', from: text|null, to: text, mode, sure } or { kind: 'where', what: text, sure }.
 */
function parse(text) {
  const t = strip(text);
  if (!t || t.length > 300) return null;
  const mode = modeOf(t);
  const TRAVEL = '(?:directions?|route|routes|navigate|navigation|drive|driving|walk|walking|bike|biking|cycle|cycling|ride|way)';
  let m;
  // from A to B, and to B from A
  if ((m = new RegExp(`\\b${TRAVEL}\\b.*?\\bfrom\\s+(.+?)\\s+to\\s+(.+)$`, 'i').exec(t))) return { kind: 'route', from: end(m[1]), to: end(m[2]), mode, sure: true };
  if ((m = new RegExp(`\\b${TRAVEL}\\b.*?\\bto\\s+(.+?)\\s+from\\s+(.+)$`, 'i').exec(t))) return { kind: 'route', from: end(m[2]), to: end(m[1]), mode, sure: true };
  if ((m = /\b(?:how (?:do|can|would|should|could) (?:i|we|you)|how to|best way to|quickest way to|fastest way to|way to|how far|how long|how many miles|distance|get|getting|go|going|travel|trip)\b.*?\bfrom\s+(.+?)\s+to\s+(.+)$/i.exec(t))) return { kind: 'route', from: end(m[1]), to: end(m[2]), mode, sure: false };
  if ((m = /^from\s+(.+?)\s+to\s+(.+)$/i.exec(t))) return { kind: 'route', from: end(m[1]), to: end(m[2]), mode, sure: false };
  // to B only
  if ((m = /\b(?:directions?|route|navigate|navigation)\s+(?:me\s+)?(?:to|for|toward|towards)\s+(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: true };
  if ((m = /\b(?:take|lead|guide|drive|walk) (?:me|us)\s+(?:to\s+)?(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: true };
  if ((m = /\b(?:how (?:do|can|would|should|could) (?:i|we) (?:get|go|drive|walk|travel|bike|cycle|ride)|how to (?:get|go|drive|walk)|(?:best|quickest|fastest|shortest) way)\s+(?:to\s+)?(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: false };
  if ((m = /\bhow (?:far|long|many miles)\b.*?\bto\s+(?:get to\s+|drive to\s+|walk to\s+)?(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: false };
  if ((m = /\bhow far(?: away)? (?:is|are)\s+(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: false };
  if ((m = /^(?:drive|walk|bike|cycle|ride|go|get|navigate) (?:to\s+)?(.+)$/i.exec(t))) return { kind: 'route', from: null, to: end(m[1]), mode, sure: /^navigate/i.test(t) };
  // where something is
  if ((m = /^(?:show|find|locate|where is|where's|where are|put|see|pull up|bring up|map)\s+(?:me\s+)?(.+?)\s+on (?:the|a|my) map$/i.exec(t))) return { kind: 'where', what: end(m[1]), sure: true };
  if ((m = /^(.+?)\s+on (?:the|a|my) map$/i.exec(t)) && !/^(?:what|why|how|who|when|is|are|does|do)\b/i.test(t)) return { kind: 'where', what: end(m[1]), sure: true };
  if ((m = /^where (?:does|do|did)\s+(.+?)\s+(?:live|lives|work|works|stay|stays)$/i.exec(t))) return { kind: 'where', what: /\bwork/i.test(t.split(' ').pop()) ? `${end(m[1])}'s work` : end(m[1]), sure: false };
  if ((m = /^(?:where is|where's|where are|wheres)\s+(.+?)(?:\s+located)?$/i.exec(t))) return { kind: 'where', what: end(m[1]), sure: false };
  if ((m = /^(?:what is|what's|whats)\s+(?:the\s+)?address (?:of|for)\s+(.+)$/i.exec(t))) return { kind: 'where', what: end(m[1]), sure: false };
  if ((m = /^(?:what is|what's|whats)\s+(.+?)\s+address$/i.exec(t))) return { kind: 'where', what: `${end(m[1])} address`, sure: false };
  if ((m = /^(?:the\s+)?address (?:of|for)\s+(.+)$/i.exec(t))) return { kind: 'where', what: end(m[1]), sure: false };
  if ((m = /^(?:show|find|locate|map)\s+(?:me\s+)?(.+\b(?:house|home|place|address|office|apartment|flat|cabin|farm|work))$/i.exec(t))) return { kind: 'where', what: end(m[1]), sure: false };
  return null;
}

/** Whether wording the rules did not settle is worth putting to the model. */
const hint = (text) => /\b(?:directions?|route|navigate|navigation|on (?:the|a|my) map|drive (?:to|from|over)|driving (?:to|from|over)|get to|way to)\b/i.test(String(text || ''));

const HERE = /^(?:here|me|my (?:current |present )?(?:location|position|spot)|(?:the |our )?current (?:location|position)|where i am(?: now)?|where i'm at|where we are)$/;
const HOME = /^(?:home|house|place|apartment|flat|home address|house address)$/;
const WORK = /^(?:work|office|workplace|job|work address)$/;
const SCHOOL = /^school$/;
const MEET = /^(?:meeting (?:point|place|spot)|meet(?:ing)?[- ]?up (?:point|place|spot)|rally(?:ing)? point|rendezvous(?: point)?)$/;
const THING = /\s+(house|home|place|address|home address|apartment|flat|cabin|farm|office|work|workplace|job|work address|school)$/;

const nameOf = (e) => (e.label ? `${e.name} (${e.label})` : e.name);
const pointOf = (e) => ({ lon: e.lon, lat: e.lat, label: nameOf(e), ...(e.how && e.how !== 'exact' && e.how !== 'manual' ? { approx: e.why || 'Its address was not found exactly in the address data.' } : {}) });
const hitOf = (e) => ({ c: 'saved', i: `bk${e.id}`, a: e.lat, o: e.lon, n: nameOf(e), d: String(e.address || '').replace(/\s*\n\s*/g, ', '), p: e.phones || '', kind: 'Saved', how: e.how, approx: Boolean(e.how && e.how !== 'exact' && e.how !== 'manual'), why: e.why || '' });

/** Of one person's or one pin's entries, the one meant: a wanted label first, then a home, then any with a place. */
function choose(list, want) {
  const placed = list.filter((e) => e.lat != null);
  const pool = placed.length ? placed : list;
  const by = (re) => pool.find((e) => re.test(fold(e.label)));
  return (want === 'work' ? by(/work|office|job/) : null) || (want === 'school' ? by(/school/) : null) || (want !== 'work' ? by(/home|house/) : null) || pool[0] || null;
}

/**
 * Find the place some wording names. `ctx`: { book, search(text) -> hit|null, here: point|null }.
 * Returns { point, hit, via, own, said, others } when found; { miss } with the reason when it names something of the
 * user's that cannot be placed; null when nothing fits.
 * `own` says it came from the user's pins, relationships or contacts.
 */
function place(text, ctx) {
  const raw = tidy(text);
  let t = fold(raw).replace(/[’]/g, "'").replace(/[^a-z0-9' ,.#/&-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const c = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
  if (c && Math.abs(Number(c[1])) <= 90 && Math.abs(Number(c[2])) <= 180) return { point: { lon: Number(c[2]), lat: Number(c[1]), label: `${Number(c[1]).toFixed(5)}, ${Number(c[2]).toFixed(5)}` }, via: 'spot', own: false, said: `${Number(c[1]).toFixed(5)}, ${Number(c[2]).toFixed(5)}`, others: [] };
  if (HERE.test(t)) return ctx.here ? { point: ctx.here, via: 'gps', own: true, said: 'your GPS position' } : { miss: 'The GPS receiver has no position yet, so the app does not know where "here" is. Name the place you are starting from.' };
  const book = ctx.book;
  const mine = /^(?:my|our)\s+/.test(t);
  t = t.replace(/^(?:my|our|the)\s+/, '');
  const found = (list, want, via, said) => {
    const e = choose(list, want);
    if (!e) return null;
    const people = [...new Set(list.map((x) => x.name))];
    if (e.lat == null) return { miss: e.address ? `${e.name} is in the address book, but the address (${String(e.address).replace(/\s*\n\s*/g, ', ')}) has no place on the map yet. Open the entry on the Saved tab and place it by hand, or fetch the address data.` : `${e.name} is in the address book, but with no address.`, own: true };
    return { point: pointOf(e), hit: hitOf(e), entry: e, via, own: true, said: said(e), others: people.length > 1 ? people.filter((n) => n !== e.name) : [] };
  };
  if (book) {
    // 1. the user's own pins: "home", "my house", "work", "the office", "meeting point", or a pin's own name
    const kind = HOME.test(t) ? 'home' : WORK.test(t) ? 'work' : SCHOOL.test(t) ? 'school' : MEET.test(t) ? 'meet' : null;
    if (kind) {
      const r = found(book.pinned(kind), null, 'pin', (e) => `${rel.pinName(kind)}: ${nameOf(e)}`);
      if (r) return r;
      if (mine || kind === 'meet' || /^(?:home|work)$/.test(t)) return { miss: `Nothing is pinned as ${rel.pinName(kind)} yet. Open the place on the Saved tab, choose Edit, and pin it as ${rel.pinName(kind)}.`, own: true };
    }
    const named = found(book.pinned(null, t), null, 'pin', (e) => `${e.pinName}: ${nameOf(e)}`);
    if (named) return named;
    // 2. a person, by tie or by name, with or without "...'s house"
    const thing = THING.exec(t);
    const want = thing ? (/work|office|job/.test(thing[1]) ? 'work' : thing[1] === 'school' ? 'school' : 'home') : null;
    const owner = (thing ? t.slice(0, thing.index) : t).trim();
    const tries = [...new Set([owner, owner.replace(/'s$|s'$/, ''), owner.replace(/'s$|s'$|s$/, '')])].filter(Boolean);
    for (const who of tries) {
      const ties = rel.tiesMeant(who);
      if (ties.length) {
        const list = book.related(ties);
        const r = found(list, want, 'tie', (e) => `${e.tie}: ${nameOf(e)}`);
        if (r) return r;
        if (mine || thing) return { miss: `Nobody in the address book is marked as your ${rel.tieOf(who)} yet. Open the person on the Saved tab, choose Edit, and set the relationship.`, own: true };
      }
    }
    for (const who of tries) {
      // "my friend Dave": the tie word in front is dropped when the rest is a name
      const words = who.split(' ');
      const names = [who, ...(words.length > 1 && (rel.tiesMeant(words[0]).length || rel.groupMeant(words[0])) ? [words.slice(1).join(' ')] : [])];
      for (const n of names) {
        const all = book.search(n, 12).filter((e) => n.split(/[^a-z0-9]+/).filter(Boolean).every((w) => fold(e.name).split(/[^a-z0-9]+/).includes(w)));
        if (!all.length) continue;
        const first = all[0].who || all[0].id;
        const r = found(all.filter((e) => (e.who || e.id) === first).concat(all.filter((e) => (e.who || e.id) !== first)), want, 'name', (e) => nameOf(e));
        if (r) return r;
      }
    }
    if (thing && !tries.length) return null;
  }
  // 3. an address, a place or a town from the map data
  const hit = ctx.search ? ctx.search(raw.replace(/^(?:my|our|the)\s+/i, '')) : null;
  if (!hit) return null;
  if (hit.c === 'saved') return { point: { lon: hit.o, lat: hit.a, label: hit.n, ...(hit.approx ? { approx: hit.why || 'Its address was not found exactly in the address data.' } : {}) }, hit, via: 'name', own: true, said: hit.n, others: [] };
  const label = hit.c === 'address' ? hit.n : hit.d ? `${hit.n}, ${hit.d}` : hit.n;
  return { point: { lon: hit.o, lat: hit.a, label, ...(hit.c === 'address' && hit.approx ? { approx: hit.d } : {}) }, hit, via: hit.c === 'address' ? 'address' : 'place', own: false, said: label, others: [] };
}

const PROMPT = 'You sort one request typed into an offline atlas with an address book. Reply with one line of JSON and nothing else: {"intent":"route"|"where"|"none","from":"","to":""}\n'
  + 'route: the person wants directions, a route, or the distance or travel time between real places they could drive or walk to. Put the start in "from" (leave it empty when none is given) and the destination in "to".\n'
  + 'where: the person wants a person\'s address or a place shown on the map. Put it in "to".\n'
  + 'none: anything else, such as a question of general knowledge, history or science.\n'
  + 'Copy the wording of each place from the request, such as "my house" or "my mother-in-law\'s house". Do not add or correct anything.';

/** Read the model's one line. Returns a parse() result or null. */
function readModel(answer) {
  const m = /\{[^{}]*\}/.exec(String(answer || ''));
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const to = tidy(j.to); const from = tidy(j.from);
  if (j.intent === 'route' && to) return { kind: 'route', from: from || null, to, mode: null, sure: false, byModel: true };
  if (j.intent === 'where' && to) return { kind: 'where', what: to, sure: false, byModel: true };
  return null;
}

/** Carry out a recognised request: find its places. Null when the wording was not surely about the map and none of its places is the user's own. */
function plan(ask, ctx) {
  const notes = [];
  const also = (r) => { if (r.others && r.others.length) notes.push(`${r.others.length === 1 ? 'Another person also fits' : 'Other people also fit'}: ${r.others.slice(0, 4).join(', ')}. ${r.point.label} was used.`); };
  const lost = (what) => `"${what}" was not found among your saved places and contacts, or in the map's addresses and places. Try the name as it is saved, or a full address (number, street, town).`;

  if (ask.kind === 'where') {
    const r = place(ask.what, ctx);
    const said = `Where is ${ask.what}`;
    if (!r) return ask.sure ? { kind: 'where', error: lost(ask.what), said } : null;
    if (!r.own && !ask.sure) return null;
    if (r.miss) return { kind: 'where', error: r.miss, said };
    also(r);
    return { kind: 'where', to: r.point, hit: r.hit || null, own: r.own, said: `Show ${r.said} on the map`, notes };
  }

  const to = place(ask.to, ctx);
  let from = ask.from ? place(ask.from, ctx) : null;
  // Wording that is not surely about travel counts only when one end is the user's own.
  if (!ask.sure && !((to && to.own) || (from && from.own))) return null;
  const said = `Directions${ask.from ? ` from ${ask.from}` : ''} to ${ask.to}`;
  if (!to) return { kind: 'route', error: lost(ask.to), said };
  if (to.miss) return { kind: 'route', error: to.miss, said };
  if (ask.from && !from) return { kind: 'route', error: lost(ask.from), said };
  if (from && from.miss) return { kind: 'route', error: from.miss, said };
  if (!from) {
    // No start given: from where the receiver says the computer is, else from home.
    if (ctx.here) { from = { point: ctx.here, said: 'your GPS position', own: true }; notes.push('No start was given, so the route starts at your GPS position.'); } else {
      const home = ctx.book ? place('my home', { ...ctx, search: null }) : null;
      if (home && home.point) { from = home; notes.push(`No start was given, so the route starts from ${home.point.label}, which is pinned as Home.`); } else return { kind: 'route', error: 'Say where to start from, as in "directions from 350 5th Ave, New York NY to work". With a place pinned as Home, or a GPS receiver connected, the start can be left out.', said };
    }
  }
  also(to); also(from);
  return { kind: 'route', from: from.point, to: to.point, mode: ask.mode || null, said: `Directions from ${from.said} to ${to.said}`, notes };
}

/**
 * Understand a typed request. `ctx`: { book, search, here, model: async () => ({ chat }) | null, signal, onStatus }.
 * Returns null when it is not a map request, else a plan:
 *   { kind: 'route', from: { label, lon, lat, approx? }, to: {...}, mode, said, notes: [] }
 *   { kind: 'where', to: {...}, hit, said, notes: [] }
 *   { kind, error, said }   a map request that could not be carried out, with the reason
 * The model is only asked when the rules did not settle it and the wording hints at the map.
 */
async function understand(text, ctx) {
  const ask = parse(text);
  const out = ask ? plan(ask, ctx) : null;
  if (out || !ctx.model || !hint(text)) return out;
  let llm = null;
  try { llm = await ctx.model(); } catch (err) { if (err && err.name === 'AbortError') throw err; }
  if (!llm) return null;
  let read = null;
  try {
    if (ctx.onStatus) ctx.onStatus('Working out what is being asked');
    read = readModel(await llm.chat({ messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: tidy(text).slice(0, 300) }], maxTokens: 80, temperature: 0, signal: ctx.signal }));
  } catch (err) { if (err && err.name === 'AbortError') throw err; }
  if (!read) return null;
  return plan({ ...read, mode: modeOf(text), sure: true }, ctx);
}

module.exports = { parse, place, plan, understand, readModel, hint, modeOf, PROMPT };
