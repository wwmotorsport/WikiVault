'use strict';
// Requests typed into Ask that are about the map: "directions from my house to my mother-in-law's house",
// "take me to work", "where does Dave live", "what is the nearest hospital to home", "pharmacies within ten
// miles of work". This module recognises them and finds the places they name,
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

// ---------------------------------------------------------------- kinds of place, as people name them

// Each line: the kinds of place meant (ids from the map's registry), and the words for them, singular or plural.
const KINDS = [
  [['hospital'], /^(?:hospitals?|emergency rooms?|ers?|emergency departments?|medical cent(?:er|re)s?|trauma cent(?:er|re)s?)$/],
  [['clinic'], /^(?:clinics?|urgent cares?|urgent care (?:clinics?|cent(?:er|re)s?)|walk[- ]in clinics?|doctors?|doctor'?s'? offices?|physicians?|health cent(?:er|re)s?)$/],
  [['hospital', 'clinic'], /^(?:medical (?:help|care|attention|facilit(?:y|ies))|medical|health ?care|emergency care)$/],
  [['pharmacy'], /^(?:pharmac(?:y|ies)|drug ?stores?|chemists?)$/],
  [['medical_supply'], /^medical suppl(?:y|ies)(?: (?:shops?|stores?))?$/],
  [['veterinary'], /^(?:vets?|veterinar(?:y|ies|ians?)|veterinary clinics?|animal hospitals?)$/],
  [['fire'], /^(?:fire ?stations?|fire departments?|fire ?houses?|fire ?halls?)$/],
  [['police'], /^(?:police|police stations?|police departments?|sheriffs?|sheriff'?s? (?:offices?|departments?)|cops?|law enforcement)$/],
  [['ambulance'], /^(?:ambulance stations?|ambulances?|ems|ems stations?|paramedics?)$/],
  [['water_works'], /^(?:water (?:treatment )?(?:works|plants?|facilit(?:y|ies))|water treatment|waterworks)$/],
  [['wastewater'], /^(?:waste ?water (?:treatment )?(?:plants?|works|facilit(?:y|ies))|sewage (?:treatment )?(?:plants?|works))$/],
  [['water_tower'], /^water towers?$/],
  [['drinking_water', 'spring'], /^(?:water|drinking water|fresh water|clean water|potable water|water sources?|sources? of water|water points?)$/],
  [['drinking_water'], /^(?:drinking water points?|drinking fountains?|water fountains?|water taps?)$/],
  [['spring'], /^(?:springs?|wells?|water wells?|springs and wells)$/],
  [['power_plant'], /^(?:power (?:plants?|stations?)|generating stations?|power generation)$/],
  [['substation'], /^(?:(?:power |electrical |electric(?:ity)? )?sub ?stations?)$/],
  [['fuel'], /^(?:fuel|fuel stations?|gas|gasoline|petrol|diesel|gas stations?|petrol stations?|filling stations?|service stations?|gas pumps?)$/],
  [['propane'], /^(?:propane|bottled gas|lp gas|lpg|propane (?:refills?|dealers?|suppliers?|tanks?))$/],
  [['supermarket'], /^(?:supermarkets?|grocer(?:y|ies)|grocery stores?|grocers?|food stores?|food markets?|markets?)$/],
  [['wholesale'], /^(?:wholesale(?: clubs?| stores?)?|warehouse clubs?|bulk (?:food|stores?))$/],
  [['food_bank'], /^(?:food banks?|food pantr(?:y|ies)|soup kitchens?)$/],
  [['supermarket', 'wholesale', 'food_bank'], /^(?:food|food supplies|places? to (?:get|buy) food)$/],
  [['department'], /^(?:department stores?|general stores?|big box stores?|variety stores?)$/],
  [['hardware'], /^(?:hardware|hardware stores?|building suppl(?:y|ies)|lumber ?yards?|home improvement(?: stores?)?|tools?)$/],
  [['farm_supply'], /^(?:farm suppl(?:y|ies)|feed stores?|farm stores?|feed and seed|agricultural suppl(?:y|ies))$/],
  [['outdoor'], /^(?:outdoor (?:stores?|shops?|gear)|sporting goods(?: stores?)?|camping (?:stores?|gear|supplies))$/],
  [['weapons'], /^(?:gun (?:shops?|stores?|dealers?)|guns?|firearms?(?: dealers?| stores?)?|hunting (?:shops?|stores?|supplies)|ammo|ammunition)$/],
  [['hardware', 'department', 'farm_supply', 'outdoor'], /^(?:supplies|suppl(?:y|ies) stores?)$/],
  [['airfield'], /^(?:airports?|airfields?|air ?strips?|landing strips?|heliports?)$/],
  [['rest_area'], /^(?:rest (?:areas?|stops?)|service areas?|truck stops?)$/],
  [['campsite'], /^(?:camp ?sites?|camp ?grounds?|camping|places? to camp)$/],
  [['ranger'], /^ranger stations?$/],
  [['military'], /^(?:military (?:bases?|sites?|installations?|posts?)|army bases?|air force bases?|naval bases?|national guard(?: armor(?:y|ies))?|armor(?:y|ies))$/],
  [['townhall'], /^(?:town halls?|city halls?|court ?houses?|county offices?|municipal buildings?)$/],
  [['town'], /^(?:towns?|cit(?:y|ies)|villages?|settlements?|towns and cities|cities and towns)$/],
];
/** The wording of a kind of place, without the words around it. */
function kindWords(text) {
  let t = fold(text).replace(/[’]/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^(?:the|a|an|any|some|all|every|open|good|best|decent|public|major|big|large|other|more|24[- ]?hour|all[- ]night)\s+/, '');
  // "anywhere to get propane", "a place that sells ammunition": the thing wanted is the kind
  t = t.replace(/^(?:anywhere|somewhere|any ?place|some ?place|place|places|where)\s+(?:(?:to|i can|we can|you can|one can)\s+(?:get|buy|find|purchase|pick up|fill up(?: with| on)?)|that sells?|selling|with)\s+(?:some\s+|any\s+|a\s+|an\s+)?/, '');
  t = t.replace(/\s+(?:locations?|places?|spots?|facilit(?:y|ies)|options?|stores? or shops?)$/, (m) => (/\b(?:medical|water treatment|wastewater)\b/.test(t) ? m : ''));
  return t.trim();
}
/** The kinds of place some wording names: { cats: [ids], one: whether one was asked for } or null. */
function kindsOf(text) {
  const t = kindWords(text);
  if (!t) return null;
  for (const [cats, re] of KINDS) if (re.test(t)) return { cats, one: !/(?:s|ies)$/.test(t) || /^(?:gas|ems|police|supplies|hardware|propane|lp gas|food|groceries|medical|camping)$/.test(t) && !/stations|stores|shops/.test(t) };
  return null;
}

const NUMS = { a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty five': 25, 'twenty-five': 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, 'seventy five': 75, 'seventy-five': 75, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, 'one hundred': 100 };
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(NUMS).sort((a, b) => b.length - a.length).join('|')})`;
const numOf = (s) => (s in NUMS ? NUMS[s] : Number(s));
const UNIT = '(miles?|mi|km|kms|kilometers?|kilometres?|klicks?)';
const kmOf = (n, unit) => (/^mi/.test(unit) ? n * 1.609344 : n);
const NEARME = /^(?:here|me|us|my (?:current |present )?(?:location|position|spot)|(?:the |our )?current (?:location|position)|where i am(?: now)?|where i'm at|where we are|this (?:place|spot|location)|my area|this area|the area)$/;

/**
 * A request for the places of some kind near somewhere, or null: "the nearest hospital to home", "pharmacies
 * within ten miles of work", "is there a gas station near my mother's house", "how many hospitals are within
 * 20 miles", "five closest supermarkets", "hospitals in Albany".
 * Returns { kind: 'near', what, cats: [ids] | null, one, at: text | null, radiusKm, count, how: 'list' | 'far' | 'count', sure }.
 * `sure` only when the kind is one the map knows: "the nearest star to the sun" is not for the map.
 */
function parseNear(text) {
  let f = fold(text).replace(/[’]/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim();
  if (!f) return null;
  let how = 'list';
  const lead = /^(?:(?:what|which)(?:'s| is| are| would be)?|where (?:can|do|could|would|should|might) (?:i|we|you|one) (?:find|get|buy|go for|go to get|go to)|where(?:'s| is| are)?|is there|are there|do you (?:know|have)(?: of)?|find|show|list|name|locate|look up|look for|search for|get|give|display|map|how (?:far|close|near)(?: away)? (?:is|are)|how many)\s+/.exec(f);
  if (lead) { how = /^how many/.test(lead[0]) ? 'count' : /^how (?:far|close|near)/.test(lead[0]) ? 'far' : 'list'; f = f.slice(lead[0].length); }
  f = f.replace(/^(?:me|us)\s+/, '');
  let near = false; let superl = false; let at = null; let radiusKm = null; let count = null; let within = false;
  // A distance: "within 10 miles (of X)", "in a ten mile radius (of X)", "less than 5 km from X", "inside a radius of 20 miles around X"
  let m = new RegExp(`\\s+(?:(?:that|which) (?:is|are) |(?:is|are) |located |situated )?(?:within|in|inside|less than|under|no more than|up to)\\s+(?:a |an |the )?${NUM}[- ]?${UNIT}(?:[- ]?radius| distance| range)?(?:\\s+(?:of|from|around|to|away from)\\s+(.+))?$`).exec(f)
    || new RegExp(`\\s+(?:(?:that|which) (?:is|are) |(?:is|are) |located |situated )?(?:within|in|inside)\\s+(?:a |an |the )?radius of\\s+${NUM}[- ]?${UNIT}(?:\\s+(?:of|from|around|to)\\s+(.+))?$`).exec(f);
  if (m) { radiusKm = kmOf(numOf(m[1]), m[2]); at = m[3] || null; f = f.slice(0, m.index); near = true; within = true; }
  f = f.replace(/^(?:(?:all|any|some|the|every|of)\s+)+/, '');
  const takeCount = () => { const c = new RegExp(`^(?:(?:top|first)\\s+)?${NUM}\\s+`).exec(f); if (c && !/^(?:a|an)$/.test(c[1])) { count = Math.max(1, Math.min(50, Math.round(numOf(c[1])))); f = f.slice(c[0].length); } else f = f.replace(/^(?:a|an)\s+/, ''); };
  takeCount();
  const front = /^(?:next[- ])?(nearest|closest|nearby|near ?by|local|surrounding)\s+/.exec(f);
  if (front) { near = true; superl = /nearest|closest/.test(front[1]); f = f.slice(front[0].length); takeCount(); }
  if (!at) {
    if ((m = /\s+(?:(?:that|which) (?:is|are)\s+|(?:is|are)\s+)?(?:near ?by|close ?by|around here|near here|in (?:the|this|my) area|around|closest|nearest)$/.exec(f))) { superl = superl || /(?:closest|nearest)$/.test(m[0]); f = f.slice(0, m.index); near = true; }
    else if ((m = /\s+(?:(?:that|which)\s+)?(?:(?:is|are)\s+)?(?:the\s+)?(nearest|closest|near|nearby|close|next)(?: to| by)?\s+(.+)$/.exec(f))) { at = m[2]; superl = superl || /nearest|closest/.test(m[1]); f = f.slice(0, m.index); near = true; }
    else if (near && (m = /\s+(?:to|from|around|by|in|at|of|for)\s+(.+)$/.exec(f))) { at = m[1]; f = f.slice(0, m.index); }
    else if ((m = /\s+(?:around|in|at)\s+(.+)$/.exec(f))) { at = m[1]; f = f.slice(0, m.index); within = true; } // "hospitals in Albany": only for a kind the map knows
  }
  f = f.replace(/\s+(?:is|are|there|that|which)$/, '').trim();
  const kinds = kindsOf(f);
  const what = kindWords(f);
  if (!what || what.length > 60 || what.split(' ').length > 6) return null;
  if (!near && !kinds) return null;
  if (at) { at = tidy(at.replace(/\s+(?:is|are|please|right now|now)$/, '')); if (NEARME.test(at)) at = null; }
  // "where is the hospital" has no "nearest" in it: that is a question of where one named thing is, not this.
  if (!near && !within) return null;
  return { kind: 'near', what, cats: kinds ? kinds.cats : null, one: kinds ? kinds.one && !count : !/s$/.test(what) && !count, at, radiusKm, count, how, superl, sure: Boolean(kinds) };
}

/**
 * A typed request as a map request, or null.
 * Returns { kind: 'route', from: text|null, to: text, mode, sure }, { kind: 'where', what: text, sure },
 * or what parseNear returns.
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
  // the places of a kind near somewhere
  const nearby = parseNear(t);
  if (nearby) return nearby;
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
const hint = (text) => /\b(?:directions?|route|navigate|navigation|on (?:the|a|my) map|drive (?:to|from|over)|driving (?:to|from|over)|get to|way to|nearest|closest|near ?by|near (?:me|here|home|work|my|our)|close to (?:me|here|home|work|my|our)|around here|within \w+ (?:miles?|mi|km|kilometers?|kilometres?)|mile radius)\b/i.test(String(text || ''));

const HERE = /^(?:here|me|my (?:current |present )?(?:location|position|spot)|(?:the |our )?current (?:location|position)|where i am(?: now)?|where i'm at|where we are)$/;
const THERE = /^(?:there|that (?:place|address|location|spot|one)|the same (?:place|spot)|it|that|this (?:place|one))$/;
const HOME = /^(?:home|house|place|apartment|flat|home address|house address)$/;
const WORK = /^(?:work|office|workplace|job|work address)$/;
const SCHOOL = /^school$/;
const MEET = /^(?:meeting (?:point|place|spot)|meet(?:ing)?[- ]?up (?:point|place|spot)|rally(?:ing)? point|rendezvous(?: point)?)$/;
const THING = /\s+(house|home|place|address|home address|apartment|flat|cabin|farm|office|work|workplace|job|work address|school)$/;

const nameOf = (e) => (e.label ? `${e.name} (${e.label})` : e.name);
const pointOf = (e) => ({ lon: e.lon, lat: e.lat, label: nameOf(e), ...(e.how && e.how !== 'exact' && e.how !== 'manual' ? { approx: e.why || 'Its address was not found exactly in the address data.', how: e.how } : {}) });
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
  // "there", "that place": the place the last request was about.
  if (THERE.test(t)) return ctx.last ? { point: ctx.last, via: 'last', own: true, said: ctx.last.label } : { miss: 'Say which place you mean: nothing has been found on the map yet in this conversation.', own: true };
  // "the nearest hospital", "the closest gas station to work": the first of that kind, nearest first.
  { const n = /^(?:the\s+)?(?:nearest|closest)\s+/.test(t) ? parseNear(t) : null;
    if (n && n.cats && ctx.nearby) {
      const o = originOf(n, ctx);
      if (o && o.miss) return { miss: o.miss, own: true };
      const h = o && ctx.nearby({ cats: n.cats, near: [o.point.lon, o.point.lat], limit: 1 })[0];
      if (h) return { point: { lon: h.o, lat: h.a, label: h.d ? `${h.n || kindName(n.cats, ctx)}, ${h.d}` : h.n || kindName(n.cats, ctx) }, hit: h, via: 'nearest', own: true, said: `${h.n || 'the nearest one'} (the nearest to ${o.point.label})`, others: [] };
      if (o) return { miss: `No ${kindName(n.cats, ctx).toLowerCase()} are in the places on this computer near ${o.point.label}. The places are on the Setup page.`, own: true };
    } }
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
  if (hit.c === 'saved') return { point: { lon: hit.o, lat: hit.a, label: hit.n, ...(hit.approx ? { approx: hit.why || 'Its address was not found exactly in the address data.', how: hit.how } : {}) }, hit, via: 'name', own: true, said: hit.n, others: [] };
  const label = hit.c === 'address' ? hit.n : hit.d ? `${hit.n}, ${hit.d}` : hit.n;
  return { point: { lon: hit.o, lat: hit.a, label, ...(hit.c === 'address' && hit.approx ? { approx: hit.d, how: hit.how } : {}) }, hit, via: hit.c === 'address' ? 'address' : 'place', own: false, said: label, others: [] };
}

const PROMPT = 'You sort one request typed into an offline atlas with an address book. Reply with one line of JSON and nothing else: {"intent":"route"|"where"|"near"|"none","from":"","to":"","what":"","miles":0}\n'
  + 'route: the person wants directions, a route, or the distance or travel time between real places they could drive or walk to. Put the start in "from" (leave it empty when none is given) and the destination in "to".\n'
  + 'where: the person wants a person\'s address or a place shown on the map. Put it in "to".\n'
  + 'near: the person wants the nearest places of some kind (a hospital, a pharmacy, fuel, water, a shop by name), or the ones within some distance. Put the kind in "what" in one or two words, the place they should be near in "to" (leave it empty when none is given, or when it is "me" or "here"), and the distance in miles in "miles" (0 when none is given).\n'
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
  const what = tidy(j.what);
  if (j.intent === 'near' && what) {
    const kinds = kindsOf(what); const miles = Number(j.miles);
    return { kind: 'near', what: kindWords(what), cats: kinds ? kinds.cats : null, one: kinds ? kinds.one : !/s$/.test(what), at: to && !NEARME.test(fold(to)) ? to : null, radiusKm: miles > 0 && miles < 3000 ? miles * 1.609344 : null, count: null, how: 'list', superl: false, sure: false, byModel: true };
  }
  return null;
}

const kindName = (cats, ctx) => (cats || []).map((id) => (ctx.kinds && ctx.kinds[id]) || id).join(', ');
const MI = 0.621371;
const milesText = (km) => { const mi = km * MI; return mi < 0.1 ? 'under a tenth of a mile' : `${mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)} mile${mi >= 0.95 && mi < 1.05 ? '' : 's'}`; };
const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Which way one place lies from another, as one of eight winds. */
function windOf(from, to) {
  const rad = Math.PI / 180;
  const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
  return WINDS[Math.round((((Math.atan2(y, x) / rad) + 360) % 360) / 45) % 8];
}

/**
 * Where a "near" request is centred: the place it names; with none named, where the receiver says the
 * computer is, else the place pinned as Home. Returns { point, said, own, note? }, { miss }, or null when the
 * place named was not found.
 */
function originOf(ask, ctx) {
  if (ask.at) {
    const r = place(ask.at, ctx);
    if (!r) return null;
    if (r.miss) return { miss: r.miss };
    return { point: r.point, said: r.said, own: r.own, others: r.others };
  }
  if (ctx.here) return { point: ctx.here, said: 'your GPS position', own: true, note: 'No place was named, so this is measured from your GPS position.' };
  const home = ctx.book ? place('my home', { ...ctx, search: null, nearby: null }) : null;
  if (home && home.point) return { point: home.point, said: home.said, own: true, note: `No place was named and no GPS receiver is connected, so this is measured from ${home.point.label}, which is pinned as Home.` };
  return { miss: 'Say near where, as in "the nearest hospital to 350 5th Ave, New York NY". With a place pinned as Home on the Saved tab, or a GPS receiver connected, that is used when you name none.' };
}

/** Carry out a request for the places of a kind near somewhere. */
function planNear(ask, ctx) {
  if (!ctx.nearby) return null;
  const o = originOf(ask, ctx);
  const names = ask.cats ? kindName(ask.cats, ctx) : `Places named "${ask.what}"`;
  const said = `${ask.cats ? names : `"${ask.what}"`}${ask.radiusKm ? ` within ${milesText(ask.radiusKm)}` : ' near'}${ask.radiusKm ? ' of' : ''} ${ask.at || 'you'}`;
  if (!o) return ask.sure ? { kind: 'near', error: `"${ask.at}" was not found among your saved places and contacts, or in the map's addresses and places. Try the name as it is saved, a town, or a full address (number, street, town).`, said } : null;
  // A kind the map does not know is looked for by name, and counts as a map request only around a place of the user's own.
  if (!ask.cats && !(o.own || ask.sure)) return null;
  if (o.miss) return ask.sure || ask.cats ? { kind: 'near', error: o.miss, said } : null;
  const at = o.point;
  const reach = ask.radiusKm || (ask.cats ? null : 80);
  const want = ask.count || (ask.radiusKm ? 25 : ask.one ? 5 : 10);
  let found = ctx.nearby({ cats: ask.cats, q: ask.cats ? '' : ask.what, near: [at.lon, at.lat], limit: 400 });
  if (reach) found = found.filter((h) => h.km <= reach);
  // One building can be in the data twice (drawn as a point and as an outline): the same name within 300 m is one place.
  const hits = [];
  for (const h of found) {
    const name = fold(h.n || '');
    if (name && hits.some((x) => fold(x.n || '') === name && Math.hypot((x.a - h.a) * 111, (x.o - h.o) * 111 * Math.cos(h.a * Math.PI / 180)) < 0.3)) continue;
    hits.push({ ...h, miles: Math.round(h.km * MI * 10) / 10, far: milesText(h.km), wind: h.km < 0.05 ? '' : windOf(at, { lat: h.a, lon: h.o }) });
  }
  if (!hits.length) {
    if (!ask.cats) return ask.sure ? { kind: 'near', error: `Nothing named "${ask.what}" was found within ${milesText(reach)} of ${at.label}. The map knows places by kind (hospitals, pharmacies, fuel, water, supermarkets, hardware and more) and by the names in its data.`, said } : null;
    return { kind: 'near', error: ask.radiusKm ? `No ${names.toLowerCase()} are within ${milesText(ask.radiusKm)} of ${at.label} in the places on this computer.` : `No ${names.toLowerCase()} are in the places on this computer. They are fetched on the Setup page, under Places.`, said };
  }
  const notes = [];
  if (o.note) notes.push(o.note);
  if (o.others && o.others.length) notes.push(`${o.others.length === 1 ? 'Another person also fits' : 'Other people also fit'}: ${o.others.slice(0, 4).join(', ')}. ${at.label} was used.`);
  if (at.approx) notes.push(`The position of ${at.label} is approximate, so the distances are too. ${String(at.approx).replace(/^Approximate\. /, '')}`);
  // Some places are a lesser sort of their kind: a cage of exchange cylinders outside a shop is propane, but it is
  // not a propane supplier, and there are thirty of them to each supplier. They are listed, and named for what they
  // are, but they do not get to be the whole list: the nearest few of the full sort are always in it.
  let list = hits.slice(0, want);
  const lessIn = list.filter((h) => h.less);
  const keepMain = Math.min(3, want);
  if (lessIn.length && list.length - lessIn.length < keepMain) {
    let main = hits.filter((h) => !h.less);
    if (main.length < keepMain && found.length >= 400) {
      // The four hundred nearest were nearly all of the lesser sort: look farther for the others (the map gives two thousand at most).
      const far = ctx.nearby({ cats: ask.cats, q: ask.cats ? '' : ask.what, near: [at.lon, at.lat], limit: 2000 }).filter((h) => !h.less && h.km <= (reach || 250));
      main = far.slice(0, keepMain).map((h) => ({ ...h, miles: Math.round(h.km * MI * 10) / 10, far: milesText(h.km), wind: h.km < 0.05 ? '' : windOf(at, { lat: h.a, lon: h.o }) }));
    }
    const add = main.filter((h) => !list.some((x) => x.i === h.i)).slice(0, keepMain - (list.length - lessIn.length));
    if (add.length) {
      for (let i = list.length - 1, room = add.length - Math.max(0, want - list.length); i >= 0 && room > 0; i--) if (list[i].less) { list.splice(i, 1); room--; }
      list = list.concat(add).sort((a, b) => a.km - b.km);
      const sorts = [...new Set(lessIn.map((h) => (h.x && h.x.kind) || '').filter(Boolean))].map((s) => s.toLowerCase());
      notes.push(`Most of the nearest are of a lesser sort${sorts.length ? ` (${sorts.join('; ')})` : ''}, so the nearest ${add.length === 1 ? 'one' : add.length} of the full sort ${add.length === 1 ? 'is' : 'are'} listed with them, though farther away.`);
    }
  }
  return {
    kind: 'near', at, what: ask.what, cats: ask.cats, names, one: Boolean(ask.one), how: ask.how, radius: ask.radiusKm ? milesText(ask.radiusKm) : null,
    total: hits.length, hits: list, notes,
    said: `${ask.cats ? names : `Places named "${ask.what}"`} ${ask.radiusKm ? `within ${milesText(ask.radiusKm)} of` : 'nearest to'} ${o.said}`,
  };
}

/** Carry out a recognised request: find its places. Null when the wording was not surely about the map and none of its places is the user's own. */
function plan(ask, ctx) {
  const notes = [];
  const also = (r) => { if (r.others && r.others.length) notes.push(`${r.others.length === 1 ? 'Another person also fits' : 'Other people also fit'}: ${r.others.slice(0, 4).join(', ')}. ${r.point.label} was used.`); };
  const lost = (what) => `"${what}" was not found among your saved places and contacts, or in the map's addresses and places. Try the name as it is saved, or a full address (number, street, town).`;

  if (ask.kind === 'near') return planNear(ask, ctx);
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
 *   { kind: 'near', at: {...}, names, hits: [{ n, d, a, o, km, miles, far, wind, ... }], total, radius, one, how, said, notes: [] }
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

module.exports = { parse, parseNear, kindsOf, place, plan, understand, readModel, hint, modeOf, windOf, PROMPT };
