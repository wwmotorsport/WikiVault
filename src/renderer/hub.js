'use strict';
// Setup and downloads: one page that lists everything the app can fetch or set up, says what is done
// and what is left, adds up the room it needs, and fetches the lot in one go.
// It opens by itself the first time a version is run. Shares the page with app.js and uses its helpers.

const hub = { want: null, sizes: { wikipedia: null, libs: {} }, errors: {}, running: false, stopAsked: false, current: null, measuring: false, waiters: [], popped: false, resumed: false, fresh: null, wasNew: null };
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
  if (!aiOn) out.push({ id: 'ai', title: 'Offline answers', state: 'off', detail: 'Switched off under Library. Questions show matching passages instead of a written answer.', bytes: 0 });
  else if (ai.busy || ai.tune) out.push({ id: 'ai', title: 'Offline answers', state: 'working', detail: ai.busy || 'Timing the models on this computer to pick the best one.', bytes: 0 });
  else if (ai.state === 'ready' && (tuned || state.settings.ai.provider !== 'foundry')) out.push({ id: 'ai', title: 'Offline answers', state: 'done', detail: `Set up and tuned to this computer${ai.modelId ? `: ${ai.modelId}${ai.device ? ` on the ${ai.device}` : ''}` : ''}.`, bytes: 0 });
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
      const moreDone = Boolean(m.overture && hubSame(m.overture.regions, regs));
      out.push({ id: 'more', title: 'Places: shops, fuel, hospitals and more', state: jobOf(['overture:places']) ? 'working' : moreDone ? 'done' : w.more && regs.length ? 'todo' : 'off', tick: moreDone ? null : 'more',
        detail: moreDone ? `${m.overture.total.toLocaleString()} places from Overture Maps.` : 'Places from Overture Maps. Quick to fetch.', bytes: moreDone ? 0 : om && om.places ? Math.round(om.places.bytes / 20) : null });
      const plDone = Boolean(m.places && hubSame(m.places.regions || [], regs));
      out.push({ id: 'places', title: 'Places: towns, water, power and services', state: jobOf(['places']) ? 'working' : plDone ? 'done' : w.places && regs.length ? 'todo' : 'off', tick: plDone ? null : 'places',
        detail: plDone ? `${m.places.total.toLocaleString()} places from OpenStreetMap.` : m.placesKept && hubSame(m.placesKept.regions || [], regs) ? `${m.placesKept.done} of ${m.placesKept.total} pieces were fetched before it stopped, and are kept. Fetching again carries on from there.` : 'Places from OpenStreetMap, including the kinds Overture does not have: towns, water works, power plants, springs. Small, but slow: it comes from a free, shared server in pieces, two at a time. Pieces that arrive are kept, so a run that fails carries on where it stopped.',
        bytes: plDone ? 0 : null, sizeNote: 'small' });
    }
    // 5. Other libraries
    for (const lib of state.libraries || []) {
      const on = Boolean(w.libs[lib.id]);
      const libBusy = BUSY.includes(lib.phase);
      out.push({ id: `lib:${lib.id}`, title: lib.name, state: libBusy ? 'working' : lib.active ? 'done' : on ? 'todo' : 'off', tick: lib.active || libBusy ? null : `lib:${lib.id}`,
        detail: lib.active ? `${lib.active.date ? `${editionName(lib.active.date)} edition` : 'Local edition'}, ${bytes(lib.active.bytes)}.` : lib.about || '', bytes: lib.active ? 0 : hub.sizes.libs[lib.id] ?? null, needsWikipedia: true });
    }
  }
  // 6. Things that are set up, not downloaded
  out.push({ id: 'gps', title: 'GPS receiver', state: 'info', detail: gps.status === 'fix' ? 'Connected, with a position.' : gps.status === 'waiting' ? 'Connected, waiting for a position.' : 'A USB receiver shows where you are on the map and leads you turn by turn. Plug it in and press the button.',
    bytes: 0, done: gps.status === 'fix' || gps.status === 'waiting', action: m && m.routing ? { label: gps.status === 'off' || gps.status === 'lost' ? 'Find my GPS receiver' : 'Open the map', run: () => { hubClosePop(); mapGo.tab = 'go'; showView('map'); render(); if (gps.status === 'off' || gps.status === 'lost') gpsFind(); } } : null, note: m && m.routing ? '' : 'Needs the map and the directions first.' });
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

function renderHub(force) {
  if (!state || !$('hub-steps')) return;
  hubTick();
  const items = hubItems();
  const left = items.filter(hubLeft);
  $('hub-badge').hidden = !left.length; $('hub-badge').textContent = String(left.length);
  if (!hub.resumed && state.settings.hub.running && !hub.running) { hub.resumed = true; hubRun(); }
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
  $('hub-steps').replaceChildren(...items.map((it) => {
    const li = el('li', `hub-step hub-${it.state}${it.done ? ' hub-have' : ''}`);
    li.dataset.id = it.id;
    const head = el('div', 'hub-head');
    head.append(el('span', 'hub-chip', it.state === 'info' ? (it.done ? 'Done' : 'Optional') : HUB_CHIP[it.state]));
    const title = el('span', 'hub-title', it.title);
    if (it.isNew) title.append(el('span', 'hub-newtag', 'New'));
    head.append(title);
    const size = it.state === 'done' || it.state === 'info' || it.state === 'working' ? '' : it.bytes != null ? bytes(it.bytes) : it.state === 'off' ? '' : it.sizeNote || 'not measured yet';
    head.append(el('span', 'hub-size', size));
    li.append(head);
    if (it.tick) {
      const key = it.tick; const row = el('label', 'hub-tick');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', id: `hub-tick-${key.replace(':', '-')}`, checked: key.startsWith('lib:') ? Boolean(w.libs[key.slice(4)]) : Boolean(w[key]), disabled: hub.running });
      box.addEventListener('change', () => { if (key.startsWith('lib:')) hubSet({ libs: { ...w.libs, [key.slice(4)]: box.checked } }); else hubSet({ [key]: box.checked }); });
      row.append(box, el('span', '', 'Include'));
      li.append(row);
    }
    li.append(el('p', 'hub-detail', it.detail));
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
    return li;
  }));
  if (focused && focused.id && $(focused.id)) $(focused.id).focus();

  const need = left.reduce((n, it) => n + (it.bytes || 0), 0);
  const unknown = left.filter((it) => it.bytes == null && !it.sizeNote).length;
  const free = state.freeBytes;
  const total = $('hub-total'); total.replaceChildren();
  if (left.length) total.append(el('p', '', `Still to fetch: about ${bytes(need) || '0 MB'}${unknown ? `, plus ${unknown} not measured yet` : ''}. Free on the library's drive: ${free == null ? 'unknown' : bytes(free)}.`));
  if (free != null && need > free) total.append(el('p', 'map-approx', `That is ${bytes(need - free)} more than there is room for. Untick something, choose less map detail, or make room${state.partition && state.libraryOnPartition ? ': the partition can be made larger from the Library page' : ''}.`));
  if (hub.running) total.append(el('p', 'small-print', hub.stopAsked ? 'Stopping once the current download has finished.' : 'Downloading what is ticked, one thing after another. You can leave this page and use the app; it carries on, and starts again by itself if the app is closed and opened.'));
  if (hub.measuring) total.append(el('p', 'small-print', 'Working out the sizes. This reads only summaries and takes a minute or two.'));
  const anyMap = items.some((it) => ['map', 'routing', 'addresses', 'more'].includes(it.id) && hubLeft(it) && it.bytes == null) || Object.keys(w.libs).some((id) => w.libs[id] && hub.sizes.libs[id] == null);
  $('hub-sizes').hidden = !anyMap && hub.sizes.wikipedia != null;
  $('hub-sizes').disabled = hub.running || hub.measuring;
  const startable = left.filter((it) => it.id !== 'wikipedia' || active);
  $('hub-go').disabled = hub.running || hub.measuring || !startable.length || (!active && !state.settings.dataDir);
  $('hub-go').textContent = hub.running ? 'Downloading' : `Download everything ticked${startable.length ? ` (${startable.length})` : ''}`;
  $('hub-stop').hidden = !hub.running;
  $('hub-stop').disabled = hub.stopAsked;
}

/** Find out how big everything ticked is. Reads summaries only. */
async function hubMeasure() {
  if (hub.measuring || hub.running) return;
  hub.measuring = true; $('hub-error').hidden = true; renderHub(true);
  const w = hubWant(); const m = state.maps; const fails = [];
  const attempt = async (name, fn) => { try { await fn(); } catch (err) { fails.push(`${name}: ${err.message}`); } };
  await attempt('Wikipedia', async () => { const f = (await api.setupFlavours()).find((x) => x.flavour === state.settings.flavour); hub.sizes.wikipedia = f ? f.bytes : null; });
  for (const id of Object.keys(w.libs)) if (w.libs[id] && hub.sizes.libs[id] == null) await attempt(id, async () => { hub.sizes.libs[id] = (await api.extraInfo(id)).bytes; });
  // Only what is ticked, still to fetch, and of unknown size is measured.
  const open = (id) => { const it = hubItems().find((x) => x.id === id); return Boolean(it && hubLeft(it) && it.bytes == null); };
  if (m && w.regions.length) {
    if (open('map')) await attempt('Map', () => hubMapJob(() => api.mapsMeasure(w.regions)));
    if (open('routing')) await attempt('Directions', () => hubMapJob(() => api.mapsRoutingMeasure(w.regions)));
    if (open('addresses') || open('more')) await attempt('Addresses and places', () => hubMapJob(() => api.mapsOvertureMeasure(w.regions)));
  }
  hub.measuring = false;
  if (fails.length) { $('hub-error').textContent = `Some sizes could not be worked out. ${fails.join(' ')}`; $('hub-error').hidden = false; }
  renderHub(true);
}

/** Fetch everything ticked that is not there yet, one thing after another. */
async function hubRun() {
  if (hub.running) return;
  hub.running = true; hub.stopAsked = false; hub.errors = {}; $('hub-error').hidden = true;
  hubWant();
  await api.hubSave({ running: true, want: hub.want }).catch(() => {});
  renderHub(true);
  const w = hubWant();
  const item = (id) => hubItems().find((it) => it.id === id);
  const due = (id) => { const it = item(id); return Boolean(it && hubLeft(it)); };
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
    const kinds = [due('addresses') ? 'addresses' : '', due('more') ? 'places' : ''].filter(Boolean);
    // Places before addresses: they are quick, and the addresses take the longest of all.
    if (kinds.includes('places')) await step('more', () => hubMapJob(() => api.mapsOvertureDownload(w.regions, ['places'])));
    if (kinds.includes('addresses')) await step('addresses', () => hubMapJob(() => api.mapsOvertureDownload(w.regions, ['addresses'])));
    // The places server often fails part of the way. What arrived is kept, so it is simply asked again a few times.
    await step('places', async () => {
      for (let round = 0; ; round++) {
        try { await hubMapJob(() => api.mapsPlaces(w.regions)); return; } catch (err) {
          if (hub.stopAsked || round >= 3 || !/carries on from there/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 30000));
        }
      }
    });
    const libs = (state.libraries || []).filter((l) => due(`lib:${l.id}`));
    if (libs.length && !hub.stopAsked) {
      await hubUntil(() => Boolean(state.edition && state.edition.active)); // the other libraries open in Wikipedia's reader, so they wait for it
      for (const l of libs) await step(`lib:${l.id}`, async () => { await api.extraDownload(l.id); const lib = () => state.libraries.find((x) => x.id === l.id); await hubUntil(() => BUSY.includes(lib().phase), 6000).catch(() => {}); await hubUntil(() => !BUSY.includes(lib().phase)); if (!lib().active) throw new Error(lib().error || 'It did not finish.'); });
    }
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
$('hub-go').addEventListener('click', () => hubRun());
$('hub-stop').addEventListener('click', () => { hub.stopAsked = true; renderHub(true); });

// This is the last script: if the app's state arrived while the scripts were loading, draw now.
if (state) render();
