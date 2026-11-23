'use strict';
// Setup and downloads: one page that lists everything the app can fetch or set up, says what is done
// and what is left, adds up the room it needs, and fetches the lot in one go.
// It opens by itself the first time a version is run. Shares the page with app.js and uses its helpers.

const hub = { want: null, sizes: { wikipedia: null, libs: {} }, errors: {}, running: false, stopAsked: false, current: null, measuring: false, waiters: [], popped: false, resumed: false, fresh: null, wasNew: null, rates: {}, autoKey: null, autoTimer: null, autoNote: '' };
const { driveParts: hubDriveParts, Rate: HubRate, timeLeft: hubTimeLeft } = WikivaultHubCalc;
const HUB_SINCE = { gps: '0.23.0', contacts: '0.23.0', addresses: '0.21.0', more: '0.21.0', routing: '0.19.0' };
const HUB_CHIP = { done: 'Done', todo: 'To do', update: 'Update', working: 'Working', failed: 'Failed', off: 'Not chosen', info: 'Optional' };
const hubOlder = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
const hubSame = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.slice().sort().join() === b.slice().sort().join();

/** What is ticked. Starts from what was saved, and failing that from what is already there. */
function hubWant() {
  if (hub.want) return hubFill();
  const saved = state.settings.hub.want || {};
  const m = state.maps;
  hub.want = { regions: null, level: null,  wikipedia: true, ai: true, school: true, map: true, routing: true, addresses: true, more: true, places: true, libs: {}, ...saved };
  return hubFill();
}
/**
 * What is ticked, with the areas and the detail filled in. Until the user chooses them they follow the map
 * that is there, or the usual choice when there is none; they are not written down until chosen.
 */
function hubFill() {
  const w = { ...hub.want }; const m = state.maps;
  if (!Array.isArray(w.regions)) w.regions = m ? (m.map ? m.map.regions.slice() : m.regions.filter((r) => r.default).map((r) => r.id)) : [];
  if (w.level == null) w.level = m && m.map ? (m.levels.filter((l) => l.zoom <= m.map.maxZoom).pop() || m.levels[0]).zoom : 14;
  return w;
}
function hubSet(patch) { hubWant(); Object.assign(hub.want, patch); api.hubSave({ want: hub.want }).catch(() => {}); renderHub(true); }

/** Resolve when `test()` holds. Looked at each time the app's state changes. */
function hubUntil(test, ms = 48 * 3600 * 1000) {
  return new Promise((resolve, reject) => {
    if (test()) { resolve(); return; }
    const w = { test, resolve, timer: setTimeout(() => { hub.waiters = hub.waiters.filter((x) => x !== w); reject(new Error('It did not finish in time.')); }, ms) };
    hub.waiters.push(w);
  });
}
function hubTick() { for (const w of hub.waiters.slice()) if (w.test()) { clearTimeout(w.timer); hub.waiters = hub.waiters.filter((x) => x !== w); w.resolve(); } }

/** Start something that runs as a map job and wait for it to end. */
async function hubMapJob(start) {
  await hubUntil(() => !state.maps.job);
  await start();
  await hubUntil(() => Boolean(state.maps.job), 4000).catch(() => {}); // a small job can be over before it is seen
  await hubUntil(() => !state.maps.job);
  if (state.maps.error) throw new Error(state.maps.error);
}

/** Every row of the page, worked out from the app's state. */
function hubItems() {
  const w = hubWant(); const e = state.edition; const active = e && e.active; const m = state.maps; const out = [];
  const busyW = Boolean(e && BUSY.includes(e.phase));
  const p = e && e.progress;
  // 1. The library and Wikipedia
  if (!active) {
    out.push(busyW
      ? { id: 'wikipedia', title: 'Wikipedia', state: 'working', detail: p && p.total ? `Downloading: ${bytes(p.downloaded)} of ${bytes(p.total)}. The rest of this page can be fetched meanwhile.` : 'Getting ready to download.', bytes: p && p.total ? p.total - p.downloaded : hub.sizes.wikipedia, action: { label: 'Show the download', run: () => { hubClosePop(); showView('setup'); render(); } } }
      : { id: 'wikipedia', title: 'Where the library lives, and Wikipedia', state: 'todo', detail: 'Start here: choose the folder or partition for the library and how much of Wikipedia to keep. Everything else on this page is stored beside it.', bytes: hub.sizes.wikipedia, action: { label: 'Choose and start', primary: true, run: () => { hubClosePop(); showView('setup'); render(); } } });
  } else if (busyW) out.push({ id: 'wikipedia', title: 'Wikipedia', state: 'working', detail: p && p.total ? `Updating: ${bytes(p.downloaded)} of ${bytes(p.total)}.` : `Updating (${e.phase}).`, bytes: 0 });
  else if (e.updateAvailable) out.push({ id: 'wikipedia', title: 'Wikipedia', state: w.wikipedia ? 'update' : 'off', tick: 'wikipedia', detail: `You have the ${editionName(active.date)} edition. ${e.latest && e.latest.date ? `The ${editionName(e.latest.date)} edition is out.` : 'A newer edition is out.'}`, bytes: (e.latest && e.latest.bytes) || active.bytes });
  else out.push({ id: 'wikipedia', title: 'Wikipedia', state: 'done', detail: `${active.date ? `${editionName(active.date)} edition` : 'Local edition'}, ${bytes(active.bytes)}, in ${state.settings.dataDir}.`, bytes: 0 });

  // 2. Offline answers
  const ai = state.ai; const aiOn = state.settings.ai.enabled !== false; const tuned = Object.keys(state.settings.ai.speedTests || {}).length > 0;
  if (!aiOn) out.push({ id: 'ai', title: 'Offline answers', state: 'off', detail: 'Switched off in the group "Answers from the local model", lower on this page. Questions show matching passages instead of a written answer.', bytes: 0 });
  else if (ai.busy || ai.tune) out.push({ id: 'ai', title: 'Offline answers', state: 'working', detail: ai.busy || 'Timing the models on this computer to pick the best one.', bytes: 0 });
  else if (ai.state === 'ready' && (tuned || state.settings.ai.provider !== 'foundry')) out.push({ id: 'ai', title: 'Offline answers', state: 'done', detail: `Set up and tuned to this computer${ai.modelId ? `: ${ai.modelId}${ai.device ? ` on the ${ai.device}` : ''}` : ''}.`, bytes: 0 });
  // Set up on an earlier day: the model is on the disk and is loaded with the first question, or was put away after a while unused.
  else if (tuned && (ai.state === 'unknown' || ai.resting)) out.push({ id: 'ai', title: 'Offline answers', state: 'done', detail: 'Set up and tuned to this computer. The model is loaded when the first question is asked.', bytes: 0 });
  else out.push({ id: 'ai', title: 'Offline answers', state: w.ai ? 'todo' : 'off', tick: 'ai', detail: ai.state === 'ready' ? 'A model is installed but has not been tuned: the app can time the models that suit this computer and keep the best.' : 'Installs the local model that writes answers from the articles, then times the models that suit this computer and keeps the best. Needs a few gigabytes; the exact amount depends on the computer.', bytes: null, sizeNote: 'depends on this computer' });

  if (active || state.settings.dataDir) {
    // 3. School
    const s = state.school;
    if (s) {
      const have = s.have >= s.files;
      out.push({ id: 'school', title: `School: ${s.title || `grade ${s.grade}`}`, state: s.job ? 'working' : have ? 'done' : w.school ? 'todo' : 'off', tick: have || s.job ? null : 'school',
        detail: s.job ? `Fetching the books: ${s.job.done || 0} of ${s.job.total || s.files}.` : have ? `${s.files} books, ${bytes(s.bytes)}, with a year of guided lessons.` : `${s.files - s.have} of ${s.files} books still to fetch. A full school year of lessons with their teacher guides.`,
        bytes: have ? 0 : Math.round(745e6 * (1 - s.have / Math.max(1, s.files))) });
    }
    // 4. The map and what goes with it
    if (m) {
      const regs = w.regions || []; const named = m.regions.filter((r) => regs.includes(r.id)).map((r) => r.name).join(', ') || 'no area chosen';
      const job = m.job; const jobOf = (kinds) => Boolean(job && kinds.includes(job.kind + (job.kind === 'overture' ? `:${job.what}` : '')));
      const measured = m.measured && hubSame(m.measured.regions, regs) ? m.measured : null;
      const level = m.levels.find((l) => l.zoom === w.level) || m.levels[m.levels.length - 1];
      const mapDone = Boolean(m.map && hubSame(m.map.regions, regs) && m.map.maxZoom >= level.zoom);
      const lv = measured && measured.levels.find((l) => l.zoom === level.zoom);
      out.push({ id: 'map', title: 'Offline map', state: jobOf(['map', 'measure']) ? 'working' : mapDone ? 'done' : !regs.length || !w.map ? 'off' : m.map ? 'update' : 'todo', tick: mapDone ? null : 'map',
        detail: mapDone ? `${named}, down to "${(m.levels.find((l) => l.zoom === m.map.maxZoom) || level).name}", ${bytes(m.map.bytes)}.` : m.map ? `You have a map of other areas or less detail. Ticked now: ${named}, "${level.name}".` : `${named}, "${level.name}".`,
        bytes: mapDone ? 0 : lv ? lv.bytes : null, pick: !jobOf(['map', 'measure']) });
      const routeDone = Boolean(m.routing && hubSame(m.routing.regions, regs));
      out.push({ id: 'routing', title: 'Directions', state: jobOf(['routing']) ? 'working' : routeDone ? 'done' : w.routing && regs.length ? 'todo' : 'off', tick: routeDone ? null : 'routing',
        detail: routeDone ? `Routing data for ${named}, ${bytes(m.routing.bytes)}. Turn-by-turn directions, with areas you mark as blocked.` : 'The road network for working out routes by car, bicycle or on foot.',
        bytes: routeDone ? 0 : m.routingMeasured && hubSame(m.routingMeasured.regions, regs) ? m.routingMeasured.bytes : null });
      const om = m.overtureMeasured && hubSame(m.overtureMeasured.regions, regs) ? m.overtureMeasured : null;
      const adDone = Boolean(m.addresses && hubSame(m.addresses.regions, regs));
      out.push({ id: 'addresses', title: 'Street addresses', state: jobOf(['overture:addresses']) ? 'working' : adDone ? 'done' : w.addresses && regs.length ? 'todo' : 'off', tick: adDone ? null : 'addresses',
        detail: adDone ? `${m.addresses.addresses.toLocaleString()} addresses, ${bytes(m.addresses.bytes)}. Search an address, or get directions to one.` : 'Lets you search a street address and get directions to it. Large: the index needs several times its own size in working room while it is built.',
        bytes: adDone ? 0 : om && om.addresses ? om.addresses.bytes + om.addresses.rows * 14 : null });
      // The places are one thing to the user, whichever of the two sources each came from. The ready-made set holds
      // both; built here, they are two fetches, one after the other (see hubRun).
      const moreDone = Boolean(m.overture && hubSame(m.overture.regions, regs));
      const osmDone = Boolean(m.places && !m.places.partial && hubSame(m.places.regions || [], regs));
      const plDone = osmDone && moreDone;
      const pm = m.placesMeasured && hubSame(m.placesMeasured.regions, regs) ? m.placesMeasured : null;
      const ready = pm && pm.how === 'central' ? pm : null;
      // A ready-made set is worth fetching over places built here (it is sorted, and has sizes), or over a set a month older.
      const newer = Boolean(plDone && ready && (!m.places.built || !(m.overture.sorted >= 2) || Date.parse(ready.built) - Date.parse(m.places.built) > 30 * 86400000));
      const wantPl = w.places && regs.length;
      const plBytes = ready ? ready.bytes : pm ? pm.left + (moreDone ? 0 : om && om.places ? Math.round(om.places.bytes / 20) : 0) : null;
      const plKeeps = ready ? Math.round(ready.bytes * 3.5) : pm ? Math.round(pm.left * 0.02) : null;
      const total = (m.places ? m.places.total : 0) + (m.overture ? m.overture.total : 0);
      out.push({ id: 'places', title: 'Places: hospitals, fuel, shops, towns and more', state: jobOf(['places', 'overture:places']) ? 'working' : plDone ? (newer && wantPl ? 'update' : 'done') : wantPl ? 'todo' : 'off', tick: plDone && !newer ? null : 'places',
        detail: plDone && !newer ? `${total.toLocaleString()} places, sorted into kinds.`
          : plDone ? `${total.toLocaleString()} places are here. A ready-made set built on ${String(ready.built).slice(0, 10)} can take their place: sorted by exact kind, checked against the official hospital list, and with the size of each place.`
            : m.placesKept && hubSame(m.placesKept.regions || [], regs) ? `${m.placesKept.done} of ${m.placesKept.total} ${m.placesKept.how === 'extract' ? 'files were read' : 'pieces were fetched'} before it stopped, and what they held is kept. Fetching carries on from there.`
              : ready ? `A ready-made set of places from OpenStreetMap and Overture Maps, already sorted into kinds, built on ${String(ready.built).slice(0, 10)} and rebuilt every week.`
                : 'Places from OpenStreetMap and Overture Maps. The ready-made set could not be reached, so they are built on this computer: a large download (about 13 GB for the whole continent) of which little is kept.',
        bytes: plDone && !newer ? 0 : plBytes, keeps: plDone && !newer ? 0 : plKeeps, room: plDone && !newer ? 0 : pm ? plKeeps + pm.largest : null, sizeNote: '' });
    }
    // 5. Other libraries
    for (const lib of state.libraries || []) {
      const on = Boolean(w.libs[lib.id]);
      const libBusy = BUSY.includes(lib.phase);
      out.push({ id: `lib:${lib.id}`, title: lib.name, state: libBusy ? 'working' : lib.active ? 'done' : on ? 'todo' : 'off', tick: lib.active || libBusy ? null : `lib:${lib.id}`,
        detail: lib.active ? `${lib.active.date ? `${editionName(lib.active.date)} edition` : 'Local edition'}, ${bytes(lib.active.bytes)}.` : lib.about || '', bytes: lib.active ? 0 : hub.sizes.libs[lib.id] ?? null, needsWikipedia: true });
    }
    // 6. The Survival Guides: every collection not yet added, fetched and converted one after the other.
    if (state.guides) {
      const g = state.guides; const missing = g.collections.filter((c) => !c.have); const got = g.collections.length - missing.length;
      const gBusy = g.collections.some((c) => c.phase !== 'idle');
      out.push({ id: 'guides', title: 'Survival Guides', state: gBusy ? 'working' : !missing.length ? 'done' : w.guides ? 'todo' : 'off', tick: !missing.length || gBusy ? null : 'guides',
        detail: got ? `${got} of ${g.collections.length} collections added, ${g.articles.toLocaleString('en-US')} articles.` : 'Practical guides on water, first aid and medicine, food, knots and disasters, converted on this computer into articles with their pictures.',
        bytes: missing.reduce((n, c) => n + ((c.latest && c.latest.bytes) || c.approxBytes), 0), needsWikipedia: true });
    }
  }
  // 6. Things that are set up, not downloaded
  // Set up once: a receiver that has worked is remembered, and connects by itself from then on.
  const gpsSet = typeof gpsKnown === 'function' && Boolean(gpsKnown());
  const gpsOn = gps.status === 'fix' || gps.status === 'waiting';
  const gpsIdle = gps.status === 'off' || gps.status === 'lost';
  out.push({ id: 'gps', title: 'GPS receiver', state: 'info',
    detail: gps.status === 'fix' ? 'Connected, with a position. It connects by itself whenever it is plugged in.' : gps.status === 'waiting' ? 'Connected, waiting for a position. It connects by itself whenever it is plugged in.' : gps.status === 'searching' ? `${gps.detail}...`
      : gps.detail ? (gps.status === 'off' && !gpsSet ? `Not found. ${gps.detail}` : gps.detail)
        : gpsSet ? (gps.paused ? 'Set up. Disconnected for now: it connects again when it is plugged in again or Wikivault is next started.' : 'Set up. Not plugged in at the moment: it connects by itself when it is.')
          : 'A USB receiver shows where you are on the map and leads you turn by turn. Plug it in and press the button.',
    bytes: 0, done: gpsSet || gpsOn, action: m && m.routing ? { label: gpsOn ? 'Open the map' : gpsSet ? 'Look for it now' : 'Find my GPS receiver', run: () => { hubClosePop(); mapGo.tab = 'go'; showView('map'); render(); if (gpsIdle) gpsFind(); } } : null, note: m && m.routing ? '' : 'Needs the map and the directions first.',
    link: gpsIdle && !gpsSet && typeof gpsBuy === 'function' ? gpsBuy() : null });
  const b = state.book;
  if (b) {
    const acc = [b.accounts.google ? 'Google' : '', b.accounts.icloud ? 'iCloud' : ''].filter(Boolean);
    out.push({ id: 'contacts', title: 'Address book', state: 'info', done: b.count > 0, bytes: 0,
      detail: b.count ? `${b.count.toLocaleString()} saved, ${b.located.toLocaleString()} placed on the map.${acc.length ? ` Kept in step with ${acc.join(' and ')}.` : ' No contacts account is connected.'}` : 'Keep the addresses of family and friends in the app, with a copy of your Google or iCloud contacts that is refreshed by itself.',
      action: m && m.map ? { label: acc.length ? 'Open the address book' : 'Connect a contacts account', run: () => { hubClosePop(); mapGo.tab = 'book'; showView('map'); render(); bookLoad(); if (!acc.length) $('book-accounts').click(); } } : null, note: m && m.map ? '' : 'Opens from the Map page, once there is a map.' });
  }
  for (const it of out) {
    if (hub.errors[it.id] && it.state !== 'done' && it.state !== 'working') { it.state = 'failed'; it.error = hub.errors[it.id]; }
    it.isNew = Boolean(hub.wasNew && HUB_SINCE[it.id] && hubOlder(hub.wasNew, HUB_SINCE[it.id]) && it.state !== 'done' && !it.done);
  }
  return out;
}
const hubLeft = (it) => it.state === 'todo' || it.state === 'update' || it.state === 'failed';

/** How much of a row is on the disk already, in bytes; null for rows that keep nothing in the library. */
function hubHave(id) {
  const e = state.edition; const m = state.maps; const s = state.school;
  const part = (x) => (x && x.phase === 'downloading' && x.progress && x.progress.downloaded) || 0;
  const of = (x) => (x ? ((x.active && x.active.bytes) || 0) + part(x) : 0) || null;
  if (id === 'wikipedia') return of(e);
  if (id.startsWith('lib:')) return of((state.libraries || []).find((x) => x.id === id.slice(4)));
  if (id === 'school') return (s && s.bytes) || null;
  if (id === 'guides') return (state.guides && state.guides.bytes) || null;
  if (!m) return null;
  if (id === 'places') return ((m.places && m.places.bytes) || 0) + ((m.overture && m.overture.bytes) || 0) || null;
  const kept = { map: m.map, routing: m.routing, addresses: m.addresses }[id];
  return (kept && kept.bytes) || null;
}

/**
 * What a row that is at work is doing: { text, value, max, rate, left }. `value` of `max` fills its bar (neither
 * when the amount is not known), `rate` is bytes a second, `left` the bytes still to come.
 */
function hubProgress(it) {
  const fetched = (x, what) => {
    if (!x) return null;
    const p = x.progress || {};
    if (x.phase === 'downloading' && p.total) return { value: p.downloaded || 0, max: p.total, text: `${p.note ? `${p.note}. ` : ''}Downloading ${what}: ${bytes(p.downloaded || 0)} of ${bytes(p.total)}`, rate: p.bytesPerSec || null, left: p.total - (p.downloaded || 0) };
    if (x.phase === 'verifying' && p.total) return { value: p.verified || 0, max: p.total, text: `Checking ${what} against its published checksum: ${bytes(p.verified || 0)} of ${bytes(p.total)}`, left: 0 };
    return { text: x.phase === 'checking' ? 'Asking which edition is the newest' : x.phase === 'switching' ? 'Opening the new edition' : x.phase === 'moving' ? 'Moving the library' : 'Getting ready to download', left: null };
  };
  let pr = null;
  if (it.id === 'wikipedia') pr = fetched(state.edition, 'Wikipedia');
  else if (it.id.startsWith('lib:')) pr = fetched((state.libraries || []).find((x) => x.id === it.id.slice(4)), it.title);
  else if (it.id === 'school') { const j = state.school && state.school.job; if (j) pr = { value: j.done || 0, max: j.total || 1, text: `${j.kind === 'index' ? 'Reading the books so that they can be searched' : 'Fetching the books'}: ${j.done || 0} of ${j.total || 0}${j.current ? `, now ${j.current}` : ''}`, bytesNow: j.kind === 'download' ? j.bytes || 0 : null, left: null }; }
  else if (it.id === 'guides') { const c = state.guides && state.guides.collections.find((x) => x.phase !== 'idle'); if (c) pr = { text: `${c.name}: ${typeof guidesPhase === 'function' ? guidesPhase(c) : 'working'}`, left: null }; }
  else if (it.id === 'ai') pr = { text: state.ai.busy || 'Timing the models on this computer to pick the best one', left: null };
  else { const j = state.maps && state.maps.job; if (j) { const v = mapJobView(j); pr = { value: v.value, max: v.max, text: [v.title, String(v.detail || '').split(/\. (?=[A-Z])/).slice(0, 1).join('. ')].filter(Boolean).join(': ').replace(/\.$/, ''), bytesNow: v.bytesNow, left: v.bytesNow != null && v.max ? Math.max(0, v.max - v.bytesNow) : null }; } }
  if (!pr) return null;
  // A speed that the downloader does not give is worked out here, from the bytes seen arriving.
  if (pr.rate == null && pr.bytesNow != null) { hub.rates[it.id] = hub.rates[it.id] || new HubRate(); pr.rate = hub.rates[it.id].push(pr.bytesNow).get(); }
  return pr;
}
const hubSpeed = (rate) => (rate >= 1048576 ? `${(rate / 1048576).toFixed(1)} MB/s` : rate > 0 ? `${Math.max(1, Math.round(rate / 1024))} KB/s` : '');
const hubRoot = (d) => String((d && d.root) || '').replace(/[\\/]+$/, '') || 'this drive';

/** The bar that shows where the room on the library's drive goes, now and once everything ticked is here. */
function hubDisk(need, unknown) {
  const box = $('hub-disk'); const d = state.disk;
  if (!d || !d.library) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const groups = [{ title: d.onPartition ? `The library's own partition (${hubRoot(d.library)})` : `The drive the library is on (${hubRoot(d.library)})`, id: 'library', parts: hubDriveParts(d.library, state.libraryBytes || 0, need) }];
  if (d.main) groups.push({ title: `The drive the partition was cut from (${hubRoot(d.main)})`, id: 'main', parts: hubDriveParts(d.main, 0, 0) });
  const NAMES = { other: 'Everything else on it', app: 'Wikivault, downloaded so far', add: 'To be added by what is ticked', over: 'To be added by what is ticked', free: 'Free' };
  box.replaceChildren(el('h2', 'hub-disk-title', 'Room on the disk'), ...groups.filter((g) => g.parts).map((g) => {
    const p = g.parts; const wrap = el('div', 'hub-drive'); wrap.dataset.drive = g.id;
    wrap.append(el('p', 'hub-drive-name', `${g.title}: ${bytes(p.total)} in all`));
    const bar = el('div', 'hub-bar');
    bar.setAttribute('role', 'img');
    const said = [];
    const legend = el('ul', 'hub-legend');
    const rows = g.id === 'library'
      ? [['other', p.other], ['app', p.app], [p.short ? 'over' : 'add', p.add + p.short], ['free', p.freeAfter]]
      : [['other', p.other], ['free', p.freeAfter]];
    for (const part of p.parts) { const seg = el('span', `hub-seg hub-seg-${part.key}`); seg.style.flexGrow = String(Math.max(part.share, 0.004)); bar.append(seg); }
    for (const [key, n] of rows) {
      const li = el('li', `hub-key hub-key-${key}`);
      li.dataset.key = key;
      const label = key === 'free' ? (g.id === 'library' && need > 0 ? 'Free once that is here' : 'Free') : key === 'other' && g.id === 'main' ? 'In use' : NAMES[key];
      li.append(el('span', `hub-swatch hub-seg-${key}`), el('span', 'hub-key-name', label), el('span', 'hub-key-size', key === 'over' ? `${bytes(n)}, which is ${bytes(p.short)} more than fits` : bytes(n)));
      legend.append(li); said.push(`${label} ${bytes(n)}`);
    }
    bar.setAttribute('aria-label', `${g.title}, ${bytes(p.total)} in all: ${said.join(', ')}.`);
    wrap.append(bar, legend);
    if (g.id === 'library' && unknown) wrap.append(el('p', 'small-print', `${unknown} ticked ${unknown === 1 ? 'row has' : 'rows have'} not been measured yet and ${unknown === 1 ? 'is' : 'are'} not in the bar.`));
    return wrap;
  }));
}

function renderHub(force) {
  if (!state || !$('hub-steps')) return;
  hubTick();
  const items = hubItems();
  const left = items.filter(hubLeft);
  $('hub-badge').hidden = !left.length; $('hub-badge').textContent = String(left.length);
  optPaint(items);
  if (!hub.resumed && state.settings.hub.running && !hub.running) { hub.resumed = true; hubRun(); }
  // The Map section shows the same rows and the same button for the map's own things.
  if (view === 'map' && typeof mapSetupOpen !== 'undefined' && mapSetupOpen && state.maps) paintMapSetup(state.maps);
  if (view !== 'hub' && !$('hub-pop').open) return;
  const focused = document.activeElement && $('hub-steps').contains(document.activeElement) ? document.activeElement : null;
  if (focused && focused.tagName === 'SELECT' && !force) return; // a list is open: do not pull it from under the pointer

  const active = state.edition && state.edition.active;
  $('hub-lead').textContent = !active && !state.settings.dataDir
    ? 'Nothing is downloaded yet. Start with the first row. The rest can be ticked now and fetched with one button once the library has a home.'
    : left.length ? `${left.length} ${left.length === 1 ? 'thing is' : 'things are'} ticked and not yet done. Everything already in place is marked Done and is left alone.` : 'Everything ticked is in place. Tick more below, or come back after an update.';
  $('hub-new').hidden = !hub.fresh;
  if (hub.fresh) { $('hub-new-title').textContent = `New in version ${state.version}`; $('hub-new-list').replaceChildren(...hub.fresh.map((t) => el('li', '', t))); }

  const w = hubWant();
  const sums = { need: 0, have: 0, unknown: 0, keeps: 0, room: 0 };
  $('hub-steps').replaceChildren(...items.map((it) => {
    const li = el('li', `hub-step hub-${it.state}${it.done ? ' hub-have' : ''}`);
    li.dataset.id = it.id;
    const head = el('div', 'hub-head');
    head.append(el('span', 'hub-chip', it.state === 'info' ? (it.done ? 'Done' : 'Optional') : HUB_CHIP[it.state]));
    const title = el('span', 'hub-title', it.title);
    if (it.isNew) title.append(el('span', 'hub-newtag', 'New'));
    head.append(title);
    // Two columns at the right: what is still to download for this row as it is ticked now, and what is here already.
    const pr = it.state === 'working' ? hubProgress(it) : null;
    if (it.state !== 'working') delete hub.rates[it.id];
    const todo = it.state === 'working' ? (pr && pr.left != null ? pr.left : it.bytes) : hubLeft(it) ? it.bytes : null;
    const need = el('span', 'hub-size hub-need', it.state === 'working' ? (todo != null ? bytes(todo) : '') : hubLeft(it) ? (it.bytes != null ? bytes(it.bytes) : it.sizeNote || 'not measured') : it.state === 'off' && it.bytes ? `${bytes(it.bytes)} if ticked` : '');
    if (it.state === 'off' && it.bytes) need.classList.add('hub-size-off');
    const have = hubHave(it.id);
    head.append(need, el('span', 'hub-size hub-have-size', have ? bytes(have) : ''));
    sums.need += todo || 0; sums.have += have || 0;
    // What stays on the disk, and the room needed while fetching, are the same as the download for all but the places.
    const counted = hubLeft(it) || it.state === 'working';
    sums.keeps += counted && it.keeps != null ? it.keeps : todo || 0; sums.room += counted && it.room != null ? it.room : todo || 0;
    if ((hubLeft(it) || it.state === 'working') && todo == null && !it.sizeNote && it.id !== 'ai') sums.unknown += 1;
    li.append(head);
    if (it.tick) {
      const key = it.tick; const row = el('label', 'hub-tick');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', id: `hub-tick-${key.replace(':', '-')}`, checked: key.startsWith('lib:') ? Boolean(w.libs[key.slice(4)]) : Boolean(w[key]), disabled: hub.running });
      box.addEventListener('change', () => { if (key.startsWith('lib:')) hubSet({ libs: { ...w.libs, [key.slice(4)]: box.checked } }); else hubSet({ [key]: box.checked }); });
      row.append(box, el('span', '', 'Include'));
      li.append(row);
    }
    if (pr) {
      // At work: a bar, what is happening in a few words, how fast, and how long it should take.
      const box = el('div', 'hub-prog');
      const bar = document.createElement('progress');
      if (pr.max) { bar.max = pr.max; bar.value = Math.min(pr.value || 0, pr.max); }
      const row = el('div', 'hub-prog-row');
      row.append(bar, el('span', 'hub-prog-rate', hubSpeed(pr.rate)));
      const eta = pr.left ? hubTimeLeft(pr.left, pr.rate) : '';
      box.append(row, el('p', 'hub-prog-text', `${pr.text.replace(/\.$/, '')}${eta ? `, ${eta}` : ''}.`));
      li.append(box);
    } else li.append(el('p', 'hub-detail', it.detail));
    if (it.note) li.append(el('p', 'small-print', it.note));
    if (it.pick && state.maps) {
      const pick = el('div', 'hub-pick');
      for (const r of state.maps.regions) {
        const row = el('label', 'map-check');
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', id: `hub-region-${r.id}`, checked: (w.regions || []).includes(r.id), disabled: hub.running });
        box.addEventListener('change', () => hubSet({ regions: box.checked ? [...new Set([...(w.regions || []), r.id])] : (w.regions || []).filter((x) => x !== r.id) }));
        row.append(box, el('span', '', r.name));
        pick.append(row);
      }
      const sel = Object.assign(document.createElement('select'), { id: 'hub-level', disabled: hub.running });
      sel.setAttribute('aria-label', 'How much detail the map keeps');
      const measured = state.maps.measured && hubSame(state.maps.measured.regions, w.regions || []) ? state.maps.measured : null;
      for (const l of state.maps.levels) { const mz = measured && measured.levels.find((x) => x.zoom === l.zoom); sel.append(Object.assign(document.createElement('option'), { value: String(l.zoom), textContent: `${l.name}${mz ? `, ${bytes(mz.bytes)}` : ''}`, selected: l.zoom === w.level })); }
      sel.addEventListener('change', () => hubSet({ level: Number(sel.value) }));
      pick.append(sel);
      li.append(pick);
    }
    if (it.error) li.append(el('p', 'map-approx', it.error));
    if (it.action) {
      const btn = el('button', `btn small${it.action.primary ? ' primary' : ''}`, it.action.label);
      btn.type = 'button'; btn.id = `hub-act-${it.id}`;
      btn.addEventListener('click', it.action.run);
      li.append(btn);
    }
    if (it.link) {
      const p = el('p', 'small-print hub-link', `${it.link.text} `);
      const a = el('button', 'link-btn', it.link.label); a.type = 'button'; a.id = `hub-link-${it.id}`;
      a.addEventListener('click', () => api.openExternal(it.link.url));
      p.append(a); li.append(p);
    }
    return li;
  }));
  if (focused && focused.id && $(focused.id)) $(focused.id).focus();

  // The sums of the two columns, and the room they take.
  const need = sums.need; const unknown = sums.unknown; const room = sums.room;
  hub.need = room; hub.unknown = unknown;
  const free = state.disk && state.disk.library ? state.disk.library.free : state.freeBytes;
  hub.free = free;
  $('hub-sum-need').textContent = need >= 5e6 ? bytes(need) : left.length || hub.running ? 'very little' : 'nothing';
  $('hub-sum-have').textContent = sums.have ? bytes(sums.have) : 'nothing yet';
  $('hub-sum-note').textContent = unknown ? `plus ${unknown} not measured yet` : '';
  hubDisk(sums.keeps, unknown);
  const total = $('hub-total'); total.replaceChildren();
  if (free != null && room > free) total.append(el('p', 'map-approx', `What is ticked needs ${bytes(room - free)} more than there is room for. Untick something, choose less map detail, ${state.partition && state.libraryOnPartition ? 'make the partition larger in the library group on this page, ' : ''}or add storage.`));
  if (hub.running) total.append(el('p', 'small-print', hub.stopAsked ? 'Stopping once the current download has finished.' : 'Downloading what is ticked, one thing after another. You can leave this page and use the app; it carries on, and starts again by itself if the app is closed and opened.'));
  if (hub.measuring) total.append(el('p', 'small-print', 'Working out the sizes. This reads only summaries and takes a minute or two.'));
  else if (hub.autoNote) total.append(el('p', 'small-print', hub.autoNote));
  const anyMap = items.some((it) => ['map', 'routing', 'addresses', 'places'].includes(it.id) && hubLeft(it) && it.bytes == null) || Object.keys(w.libs).some((id) => w.libs[id] && hub.sizes.libs[id] == null);
  $('hub-sizes').hidden = !anyMap && hub.sizes.wikipedia != null;
  const key = JSON.stringify([w.regions, w.level, Object.keys(w.libs).filter((id) => w.libs[id]).sort(), ['map', 'routing', 'addresses', 'places'].filter((id) => w[id])]);
  // The sizes are worked out by the page itself only for someone who came for the downloads: the same page now holds the
  // library's settings, and a visit to move the library should not start the map's servers being asked anything.
  if (anyMap && hub.autoOk && $('opt-downloads').open && !hub.running && !hub.measuring && hub.autoKey !== key && state.maps && !state.maps.job) {
    clearTimeout(hub.autoTimer);
    hub.autoTimer = setTimeout(() => { if (hub.running || hub.measuring || !hub.autoOk || (view !== 'hub' && !$('hub-pop').open)) return; hub.autoKey = key; hubMeasure(true); }, 900);
  }
  $('hub-sizes').disabled = hub.running || hub.measuring;
  const startable = left.filter((it) => it.id !== 'wikipedia' || active);
  $('hub-go').disabled = hub.running || hub.measuring || !startable.length || (!active && !state.settings.dataDir);
  $('hub-go').textContent = hub.running ? 'Downloading' : `Download everything ticked${startable.length ? ` (${startable.length})` : ''}`;
  $('hub-stop').hidden = !hub.running;
  $('hub-stop').disabled = hub.stopAsked;
}

/** Find out how big everything ticked is. Reads summaries only. */
async function hubMeasure(auto = false) {
  if (hub.measuring || hub.running) return;
  hub.measuring = true; hub.autoNote = ''; $('hub-error').hidden = true; renderHub(true);
  const w = hubWant(); const m = state.maps; const fails = [];
  const attempt = async (name, fn) => { try { await fn(); } catch (err) { fails.push(`${name}: ${err.message}`); } };
  await attempt('Wikipedia', async () => { const f = (await api.setupFlavours()).find((x) => x.flavour === state.settings.flavour); hub.sizes.wikipedia = f ? f.bytes : null; });
  for (const id of Object.keys(w.libs)) if (w.libs[id] && hub.sizes.libs[id] == null) await attempt(id, async () => { hub.sizes.libs[id] = (await api.extraInfo(id)).bytes; });
  // Only what is ticked, still to fetch, and of unknown size is measured.
  const open = (id) => { const it = hubItems().find((x) => x.id === id); return Boolean(it && hubLeft(it) && it.bytes == null); };
  if (m && w.regions.length) {
    if (open('map')) await attempt('Map', () => hubMapJob(() => api.mapsMeasure(w.regions)));
    if (open('routing')) await attempt('Directions', () => hubMapJob(() => api.mapsRoutingMeasure(w.regions)));
    // The places first: when the ready-made set is there, Overture need not be asked about its places at all.
    const pmNow = () => { const x = state.maps.placesMeasured; return x && hubSame(x.regions, w.regions) ? x : null; };
    if (m.placesHow === 'extract' && w.places && !pmNow()) await attempt('Places', () => hubMapJob(() => api.mapsPlacesMeasure(w.regions)));
    if (open('addresses') || (open('places') && !(pmNow() && pmNow().how === 'central'))) await attempt('Addresses and places', () => hubMapJob(() => api.mapsOvertureMeasure(w.regions)));
  }
  hub.measuring = false;
  // Asked for by the page itself, a failure (no connection, most likely) is a note, not an error.
  if (fails.length && auto) hub.autoNote = 'Some sizes could not be worked out just now, which needs a connection. Press "Work out the sizes" to try again.';
  else if (fails.length) { $('hub-error').textContent = `Some sizes could not be worked out. ${fails.join(' ')}`; $('hub-error').hidden = false; }
  renderHub(true);
}

/** Fetch everything ticked that is not there yet, one thing after another. */
async function hubRun(only = null) {
  if (hub.running) return;
  hub.running = true; hub.stopAsked = false; hub.errors = {}; $('hub-error').hidden = true;
  hubWant();
  await api.hubSave({ running: true, want: hub.want }).catch(() => {});
  renderHub(true);
  const w = hubWant();
  const item = (id) => hubItems().find((it) => it.id === id);
  const due = (id) => { if (only && !only.includes(id)) return false; const it = item(id); return Boolean(it && hubLeft(it)); };
  const step = async (id, fn) => {
    if (hub.stopAsked || !due(id)) return;
    hub.current = id; delete hub.errors[id]; renderHub(true);
    try { await fn(); const it = item(id); if (it && hubLeft(it)) throw new Error('It stopped before it was finished. Press the button to carry on.'); } catch (err) { hub.errors[id] = err.message; }
    renderHub(true);
  };
  try {
    // These two run by themselves and need no waiting for: the answers set themselves up, and Wikipedia has its own downloader.
    if (due('ai')) { const run = async () => { if (state.ai.state !== 'ready') await api.setupAnswers(); if (state.settings.ai.provider === 'foundry') await api.tuneRun(); }; run().catch((err) => { hub.errors.ai = err.message; renderHub(true); }); }
    if (state.edition && state.edition.active && due('wikipedia')) api.updateEdition().catch((err) => { hub.errors.wikipedia = err.message; renderHub(true); });
    await step('school', async () => { await api.schoolDownload(); await hubUntil(() => Boolean(state.school.job), 4000).catch(() => {}); await hubUntil(() => !state.school.job); if (state.school.error) throw new Error(state.school.error); });
    await step('map', () => hubMapJob(() => api.mapsDownload(w.regions, w.level)));
    await step('routing', () => hubMapJob(() => api.mapsRoutingDownload(w.regions)));
    // The places: the ready-made set when it can be had, which holds both sources. When it cannot, the app builds
    // OpenStreetMap's places here, and then Overture's are fetched as well. A fetch can fail part of the way; what
    // arrived is kept, so it is asked for again a few times.
    await step('places', async () => {
      for (let round = 0; ; round++) {
        try { await hubMapJob(() => api.mapsPlaces(w.regions, typeof gpsPoint === 'function' ? gpsPoint() : null)); break; } catch (err) {
          if (hub.stopAsked || round >= 3 || !/carries on from there|to carry on/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 30000));
        }
      }
      const ov = state.maps.overture;
      if (!hub.stopAsked && !(ov && hubSame(ov.regions, w.regions))) await hubMapJob(() => api.mapsOvertureDownload(w.regions, ['places']));
    });
    // The addresses last: they take the longest of all.
    await step('addresses', () => hubMapJob(() => api.mapsOvertureDownload(w.regions, ['addresses'])));
    const libs = (state.libraries || []).filter((l) => due(`lib:${l.id}`));
    if (libs.length && !hub.stopAsked) {
      await hubUntil(() => Boolean(state.edition && state.edition.active)); // the other libraries open in Wikipedia's reader, so they wait for it
      for (const l of libs) await step(`lib:${l.id}`, async () => { await api.extraDownload(l.id); const lib = () => state.libraries.find((x) => x.id === l.id); await hubUntil(() => BUSY.includes(lib().phase), 6000).catch(() => {}); await hubUntil(() => !BUSY.includes(lib().phase)); if (!lib().active) throw new Error(lib().error || 'It did not finish.'); });
    }
    await step('guides', async () => {
      await hubUntil(() => Boolean(state.edition && state.edition.active)); // the guides are read with Wikipedia's engine, so they wait for it
      const busyNow = () => state.guides.collections.some((x) => x.phase !== 'idle');
      for (const c of state.guides.collections.filter((x) => !x.have && x.phase === 'idle')) await api.guidesAdd(c.id);
      await hubUntil(busyNow, 6000).catch(() => {});
      await hubUntil(() => !busyNow(), 12 * 3600 * 1000);
      const bad = state.guides.collections.find((x) => !x.have);
      if (bad) throw new Error(bad.error || 'It did not finish.');
    });
  } finally {
    hub.running = false; hub.current = null;
    await api.hubSave({ running: false }).catch(() => {});
    renderHub(true);
  }
}

/** Open the page by itself, once for each version: on a clean install, and after an update. */
function hubMaybePop() {
  if (hub.popped || !state.acknowledged || state.settings.hub.seenVersion === state.version) return;
  if (document.querySelector('dialog[open]')) return;
  const active = state.edition && state.edition.active;
  if (active && !state.engine.ready) return;                  // let the library open first
  if (active && state.tour && state.tour.show && !tourOpened) return; // the tour goes first; this follows when it is closed
  if (golfPlaying()) return;
  hub.popped = true;
  hub.wasNew = state.settings.hub.seenVersion || (active ? '0.0.0' : null); // what is new is judged against the version last seen
  hub.fresh = active ? WHATS_NEW[state.version] || null : null;
  hub.autoOk = true;
  $('hub-pop-body').append($('hub-panel'));
  $('hub-pop').showModal();
  renderHub(true);
  $('hub-later').focus();
}
function hubClosePop() {
  if (!$('hub-pop').open) return;
  $('hub-pop').close();
  $('hub-home').append($('hub-panel'));
  api.hubSave({ seenVersion: state.version }).catch(() => {});
  renderHub(true);
}

$('hub-later').addEventListener('click', () => hubClosePop());
$('hub-pop').addEventListener('cancel', (e) => { e.preventDefault(); hubClosePop(); });
$('hub-sizes').addEventListener('click', () => hubMeasure());
/** Start the downloads, unless what is ticked will not fit: then say so first, with what can be done about it. */
function hubStart() {
  const free = hub.free; const need = hub.need || 0;
  if (free == null || need <= free) { hubRun(); return; }
  const onPart = Boolean(state.partition && state.libraryOnPartition);
  $('hub-room-text').textContent = `What is ticked needs about ${bytes(need)}${hub.unknown ? `, plus ${hub.unknown} ${hub.unknown === 1 ? 'row' : 'rows'} not measured yet` : ''}. ${onPart ? "The library's partition" : "The library's drive"} has ${bytes(free)} free, which is ${bytes(need - free)} too little.`;
  $('hub-room-part').hidden = !(onPart && state.partitionAvailable);
  $('hub-room-opt-part').hidden = !onPart;
  $('hub-room').showModal();
  $('hub-room-back').focus();
}
$('hub-go').addEventListener('click', () => hubStart());
$('hub-room-back').addEventListener('click', () => $('hub-room').close());
$('hub-room-go').addEventListener('click', () => { $('hub-room').close(); hubRun(); });
$('hub-room-part').addEventListener('click', () => { $('hub-room').close(); hubClosePop(); showView('library'); render(); const b = $('psize-open'); if (b && !b.hidden) b.click(); });
$('hub-stop').addEventListener('click', () => { hub.stopAsked = true; renderHub(true); });

// ---- Options and Setup: one page, in groups ------------------------------------------------------------------------
// The Options and Setup page and the Library page were two places for one kind of thing. They are one page now. Each group folds,
// and its heading says whether it is complete or still needs something. The parts keep the ids they always had, so the
// code that fills them in is unchanged: this only gathers them under headings.
const OPT = [
  ['downloads', 'Downloads'],
  ['library', 'The library and where it is kept'],
  ['wikipedia', 'Wikipedia: updates and size'],
  ['libraries', 'More libraries'],
  ['answers', 'Answers from the local model'],
  ['about', 'About'],
];
const optKept = (id) => { try { return localStorage.getItem(`wv.opt.${id}`); } catch { return null; } };
function optBuild() {
  const host = $('opt-groups'); const body = {};
  for (const [id, title] of OPT) {
    const d = document.createElement('details'); d.className = 'opt-group'; d.id = `opt-${id}`;
    const s = document.createElement('summary');
    const flag = el('span', 'opt-flag', ''); flag.id = `opt-flag-${id}`;
    s.append(el('span', 'opt-name', title), flag);
    const b = el('div', 'opt-body'); b.id = `opt-body-${id}`;
    d.append(s, b); host.append(d); body[id] = b;
    // A group opened or closed by hand stays that way next time.
    s.addEventListener('click', () => setTimeout(() => { try { localStorage.setItem(`wv.opt.${id}`, d.open ? '1' : '0'); } catch { /* not kept */ } }, 0));
  }
  body.downloads.append($('hub-home'));
  // The Library page's parts, in the order they were, each under the heading it had.
  const under = { Updates: 'wikipedia', 'How much of Wikipedia': 'wikipedia', 'More libraries': 'libraries', Answers: 'answers', About: 'about' };
  let at = 'library';
  for (const node of [...document.querySelector('#view-library > .column').childNodes]) {
    if (node.nodeType === 1 && node.tagName === 'H2' && under[node.textContent.trim()]) {
      at = under[node.textContent.trim()];
      if (at !== 'wikipedia') { node.remove(); continue; }   // the group's heading says it already
      node.classList.add('opt-sub');
    }
    if (node.nodeType === 1 && node.id === 'lib-title') node.hidden = true;
    body[at].append(node);
  }
}
/** Open a group and bring it into view. */
function optOpen(id) { const d = $(`opt-${id}`); if (!d) return; d.open = true; d.dataset.init = '1'; setTimeout(() => d.scrollIntoView({ block: 'start' }), 0); }
function optOpenAll() { for (const [id] of OPT) { const d = $(`opt-${id}`); d.open = true; d.dataset.init = '1'; } }
/** The flag on each heading, and, the first time, which groups are open: the ones that still need something. */
function optPaint(items) {
  if (!state || !$('opt-downloads')) return;
  const e = state.edition; const active = Boolean(e && e.active); const left = items.filter(hubLeft);
  const wiki = items.find((it) => it.id === 'wikipedia');
  const libs = (state.libraries || []).filter((l) => l.active).length + (state.guides && state.guides.collections.some((c) => c.have) ? 1 : 0);
  const ai = state.ai || {}; const aiOn = Boolean(state.settings && state.settings.ai && state.settings.ai.enabled);
  const flags = {
    downloads: left.length ? ['todo', `${left.length} to fetch`] : ['ok', 'Complete'],
    library: active && state.settings.dataDir ? ['ok', 'Complete'] : ['todo', 'Needs setup'],
    wikipedia: !active ? ['todo', 'Not downloaded yet'] : wiki && wiki.state === 'update' ? ['todo', 'A newer edition is ready'] : wiki && wiki.state === 'working' ? ['todo', 'Downloading'] : ['ok', 'Complete'],
    libraries: libs ? ['ok', `${libs} added`] : ['none', 'Optional'],
    answers: !aiOn ? ['none', 'Switched off'] : ai.state === 'ready' ? ['ok', 'Complete'] : ['todo', 'Needs setup'],
    about: ['none', ''],
  };
  for (const [id] of OPT) {
    const [kind, text] = flags[id]; const f = $(`opt-flag-${id}`); const d = $(`opt-${id}`);
    f.textContent = text; f.className = `opt-flag opt-${kind}`; f.hidden = !text;
    if (!d.dataset.init) { d.dataset.init = '1'; const kept = optKept(id); d.open = kept != null ? kept === '1' : kind === 'todo'; }
  }
}
optBuild();

// This is the last script: if the app's state arrived while the scripts were loading, draw now.
if (state) render();
