'use strict';
// Breadcrumbs: where the GPS receiver has been. Recording (when it is switched on), the layer on the map that
// shows it as lines or as dots, and the Trips tab that lists the trips and finds them by place and by date.
// Shares the page with app.js and gps.js and uses their helpers ($, el, state, mapView, mapGo, gps...).

const crumbs = {
  show: localStorage.getItem('wikivault-crumbs-show') !== '0', // the layer on the map
  mode: localStorage.getItem('wikivault-crumbs-mode') === 'dots' ? 'dots' : 'lines',
  last: null, batch: [], timer: 0,
  lines: [], live: [], dots: [], loaded: '', loading: false,
  trips: [], picked: null, sure: null, stamp: '',
};

const crumbsMetres = (a, b) => WikivaultGpsSmooth.metres({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] });

/**
 * A reading from the receiver. When recording is on and the receiver has moved, it is kept: at most one position
 * every two seconds, and none while standing still, so that a trip is a line and not a blot.
 */
function crumbsOnFix(fix) {
  if (!state || !state.tracks || !state.tracks.on || !fix.has) return;
  if (fix.speed != null && fix.speed < 0.8) return;
  const now = Date.now(); const here = [fix.lon, fix.lat];
  // (A recorded drive played back for the tests runs many times faster than a real one.)
  if (crumbs.last && (now - crumbs.last.t < (state.gpsFake ? 60 : 1900) || crumbsMetres(crumbs.last.at, here) < 10)) return;
  crumbs.last = { t: now, at: here };
  crumbs.batch.push({ t: now, lat: fix.lat, lon: fix.lon, speed: fix.speed });
  // Drawn at once, so that the trail grows behind the mark.
  crumbs.live.push([Math.round(fix.lon * 1e5) / 1e5, Math.round(fix.lat * 1e5) / 1e5]);
  crumbsDraw();
  if (crumbs.batch.length >= 5) crumbsFlush(); else if (!crumbs.timer) crumbs.timer = setTimeout(crumbsFlush, 8000);
}

/** Hand what has been gathered to the store. */
function crumbsFlush() {
  clearTimeout(crumbs.timer); crumbs.timer = 0;
  if (!crumbs.batch.length) return;
  const points = crumbs.batch; crumbs.batch = [];
  api.tracksAdd(points).catch(() => {});
}

function crumbsOverlay(map) {
  if (map.getSource('crumbs')) return;
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['crumbs', 'crumbs-dots', 'crumbs-pick']) map.addSource(id, { type: 'geojson', data: empty });
  const under = map.getLayer('route-case') ? 'route-case' : undefined;
  const dark = mapLook.dark;
  map.addLayer({ id: 'crumbs-line', type: 'line', source: 'crumbs', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#ff8ac6' : '#b0126a', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 3, 16, 4.5], 'line-opacity': 0.75 } }, under);
  map.addLayer({ id: 'crumbs-dot', type: 'circle', source: 'crumbs-dots', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 2.4, 16, 4], 'circle-color': dark ? '#ff8ac6' : '#b0126a', 'circle-opacity': 0.8 } }, under);
  map.addLayer({ id: 'crumbs-pick-case', type: 'line', source: 'crumbs-pick', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#0b0d10' : '#ffffff', 'line-width': 9 } }, under);
  map.addLayer({ id: 'crumbs-pick-line', type: 'line', source: 'crumbs-pick', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#ffc2e2' : '#7a0c4a', 'line-width': 5 } }, under);
  crumbs.loaded = '';
  crumbsLoad();
}

/** Put what is held onto the map. */
function crumbsDraw() {
  if (typeof mapView === 'undefined' || !mapView || !mapView.getSource('crumbs')) return;
  const on = crumbs.show;
  const lines = on && crumbs.mode === 'lines' ? [...crumbs.lines.filter((l) => !l.live).map((l) => l.c), ...(crumbsLiveLine().length > 1 ? [crumbsLiveLine()] : [])] : [];
  mapView.getSource('crumbs').setData({ type: 'FeatureCollection', features: lines.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] : [] });
  const dots = on && crumbs.mode === 'dots' ? [...crumbs.dots, ...crumbs.live] : [];
  mapView.getSource('crumbs-dots').setData({ type: 'FeatureCollection', features: dots.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: dots } }] : [] });
  const pick = crumbs.picked && crumbs.picked.line && crumbs.picked.line.length > 1 ? crumbs.picked.line : null;
  mapView.getSource('crumbs-pick').setData({ type: 'FeatureCollection', features: pick ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pick } }] : [] });
}
/** The trip being recorded, as it stands: what the store had when it was last asked, and what has been added since. */
function crumbsLiveLine() { const had = crumbs.lines.find((l) => l.live); return had ? [...had.c, ...crumbs.live] : crumbs.live; }

/** Fetch the trips' lines (or their dots) for the map, when the layer is shown and they are not held already. */
async function crumbsLoad(force = false) {
  const t = state && state.tracks;
  if (!t || crumbs.loading) return;
  const want = `${crumbs.show ? crumbs.mode : 'off'}:${t.count}:${t.recording ? t.recording.id : ''}`;
  if (!force && want === crumbs.loaded) { crumbsDraw(); return; }
  crumbs.loading = true;
  try {
    if (!crumbs.show) { crumbs.lines = []; crumbs.dots = []; } else if (crumbs.mode === 'lines') { crumbs.lines = await api.tracksLines(); crumbs.dots = []; } else { crumbs.dots = await api.tracksDots(); crumbs.lines = []; }
    crumbs.live = []; // what was drawn ahead of the store is now in what the store gave
    crumbs.loaded = want;
  } catch { /* drawn again at the next change */ } finally { crumbs.loading = false; }
  crumbsDraw();
}

const crumbsMiles = (m) => (m < 16093 ? `${(m / 1609.344).toFixed(1)} miles` : `${Math.round(m / 1609.344).toLocaleString('en-US')} miles`);
const crumbsSpan = (ms) => { const min = Math.max(1, Math.round(ms / 60000)); return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`; };
const crumbsDay = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const crumbsClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** A day typed into a date box, as the time that day begins (or, with `end`, the last moment of it) here. */
const crumbsDate = (text, end) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || ''); if (!m) return null; const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0); return d.getTime(); };

async function tripsLoad() {
  if (!state || !state.tracks) return;
  try { crumbs.trips = await api.tracksList({ text: $('trips-text').value, after: crumbsDate($('trips-after').value, false), before: crumbsDate($('trips-before').value, true) }); } catch { crumbs.trips = []; }
  paintTrips();
}

/** Show one trip on the map, on its own and in full. */
async function tripsPick(trip) {
  if (crumbs.picked && crumbs.picked.id === trip.id) { crumbs.picked = null; crumbsDraw(); paintTrips(); return; }
  let pts = [];
  try { pts = await api.tracksPoints(trip.id); } catch { /* shown as not found below */ }
  crumbs.picked = { id: trip.id, line: pts.map((p) => [p[0], p[1]]) };
  crumbsDraw(); paintTrips();
  if (mapView && trip.box) { gps.handsUntil = performance.now() + 15000; mapView.fitBounds([[trip.box[0], trip.box[1]], [trip.box[2], trip.box[3]]], { padding: 60, maxZoom: 15, duration: 700 }); }
}

function paintTrips() {
  const t = state && state.tracks;
  if (!t || !$('trips-list')) return;
  $('trips-on').checked = t.on;
  const rec = t.recording;
  $('trips-status').textContent = !t.on ? (t.count ? 'Recording is off. The trips already kept stay until you delete them.' : 'Recording is off. Switch it on and each drive with the GPS receiver connected is kept as a trip.')
    : rec ? `Recording a trip now: ${crumbsMiles(rec.meters)} since ${crumbsClock(rec.start)}.`
      : (gps.status === 'fix' || gps.status === 'waiting') ? 'Recording is on. A trip begins when the receiver starts to move.' : 'Recording is on. Trips are kept while the GPS receiver is connected.';
  $('trips-show').checked = crumbs.show;
  $('trips-mode-lines').setAttribute('aria-pressed', String(crumbs.mode === 'lines')); $('trips-mode-dots').setAttribute('aria-pressed', String(crumbs.mode === 'dots'));
  $('trips-mode').hidden = !crumbs.show;
  const filtered = Boolean($('trips-text').value.trim() || $('trips-after').value || $('trips-before').value);
  $('trips-count').textContent = !t.count ? 'No trips have been kept yet.' : filtered ? `${crumbs.trips.length} of ${t.count} ${t.count === 1 ? 'trip matches' : 'trips match'}.` : `${t.count} ${t.count === 1 ? 'trip' : 'trips'}, ${crumbsMiles(t.meters)} in all.`;
  $('trips-find').hidden = !t.count;
  const list = $('trips-list');
  list.replaceChildren(...crumbs.trips.map((trip) => {
    const li = el('li', crumbs.picked && crumbs.picked.id === trip.id ? 'on' : '');
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'trip-row';
    btn.title = crumbs.picked && crumbs.picked.id === trip.id ? 'Showing on the map. Press again to stop showing it.' : 'Show this trip on the map';
    const same = crumbsDay(trip.start) === crumbsDay(trip.end);
    btn.append(el('span', 'map-hit-name', `${crumbsDay(trip.start)}, ${crumbsClock(trip.start)} to ${same ? '' : `${crumbsDay(trip.end)}, `}${crumbsClock(trip.end)}`));
    const ends = trip.from && trip.to ? (trip.from === trip.to ? `Around ${trip.from}` : `${trip.from} to ${trip.to}`) : trip.from || trip.to || '';
    btn.append(el('span', 'map-hit-kind', [ends, crumbsMiles(trip.meters), crumbsSpan(trip.end - trip.start)].filter(Boolean).join(' · ')));
    if (trip.via && trip.via.length) btn.append(el('span', 'trip-via', `By way of ${trip.via.slice(0, 6).join(', ')}${trip.via.length > 6 ? ' and more' : ''}`));
    btn.addEventListener('click', () => tripsPick(trip));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'link-btn trip-del';
    const sure = crumbs.sure === trip.id;
    del.textContent = sure ? 'Yes, delete this trip' : 'Delete';
    del.addEventListener('click', async () => {
      if (crumbs.sure !== trip.id) { crumbs.sure = trip.id; paintTrips(); return; }
      crumbs.sure = null; if (crumbs.picked && crumbs.picked.id === trip.id) crumbs.picked = null;
      try { await api.tracksRemove(trip.id); } catch { /* still listed, then */ }
      crumbs.loaded = ''; await tripsLoad(); crumbsLoad(true);
    });
    li.append(btn, del);
    return li;
  }));
  $('trips-clear').hidden = !t.count;
  $('trips-clear').textContent = crumbs.sure === 'all' ? `Yes, delete all ${t.count} ${t.count === 1 ? 'trip' : 'trips'}` : 'Delete all trips';
  paintCrumbsKey();
}
function paintCrumbsKey() { const key = $('map-key-crumbs'); if (key) { key.checked = crumbs.show; key.closest('label').classList.toggle('off', !crumbs.show); } }

/** The recording tick in the GPS panel on the map, and its line about what is being kept. */
function paintCrumbsPanel() {
  const t = state && state.tracks;
  paintCrumbsKey();
  const row = $('map-gps-crumbs-row'); if (!row) return;
  row.hidden = !t;
  if (!t) return;
  $('map-gps-crumbs').checked = t.on;
  $('map-gps-crumbs-note').textContent = t.on ? (t.recording ? `Recording: ${crumbsMiles(t.recording.meters)} so far.` : `${t.count} ${t.count === 1 ? 'trip' : 'trips'} kept.`) : '';
}

/** Called whenever the app's state changes: the trips may have changed, or a trip may have begun or ended. */
function crumbsState() {
  const t = state && state.tracks;
  if (!t) return;
  const stamp = `${t.on}:${t.count}:${t.recording ? t.recording.id : ''}`;
  if (stamp !== crumbs.stamp) { crumbs.stamp = stamp; if (!t.on) { crumbs.last = null; crumbs.batch = []; } crumbsLoad(); if (mapGo.tab === 'trips') tripsLoad(); }
  paintCrumbsPanel();
  if (mapGo.tab === 'trips') paintTrips();
}

async function crumbsRecord(on) {
  if (!on) crumbsFlush();
  try { await api.tracksSet(on); } catch { /* the tick is put back by the next paint */ }
}
function crumbsShow(on) { crumbs.show = Boolean(on); localStorage.setItem('wikivault-crumbs-show', crumbs.show ? '1' : '0'); crumbsLoad(); paintTrips(); paintCrumbsKey(); }
function crumbsMode(mode) { crumbs.mode = mode === 'dots' ? 'dots' : 'lines'; localStorage.setItem('wikivault-crumbs-mode', crumbs.mode); crumbsLoad(); paintTrips(); }

$('trips-on').addEventListener('change', () => crumbsRecord($('trips-on').checked));
$('map-gps-crumbs').addEventListener('change', () => crumbsRecord($('map-gps-crumbs').checked));
$('map-gps-trips').addEventListener('click', () => { mapGo.tab = 'trips'; mapGo.picking = null; paintMapGo(); tripsLoad(); });
$('trips-show').addEventListener('change', () => crumbsShow($('trips-show').checked));
$('map-key-crumbs').addEventListener('change', () => crumbsShow($('map-key-crumbs').checked));
$('trips-mode-lines').addEventListener('click', () => crumbsMode('lines'));
$('trips-mode-dots').addEventListener('click', () => crumbsMode('dots'));
{ let wait = 0; const again = () => { clearTimeout(wait); wait = setTimeout(tripsLoad, 200); }; $('trips-text').addEventListener('input', again); $('trips-after').addEventListener('change', again); $('trips-before').addEventListener('change', again); }
$('trips-clear').addEventListener('click', async () => {
  if (crumbs.sure !== 'all') { crumbs.sure = 'all'; paintTrips(); return; }
  crumbs.sure = null; crumbs.picked = null;
  try { await api.tracksClear(); } catch { /* still there, then */ }
  crumbs.loaded = ''; await tripsLoad(); crumbsLoad(true);
});
$('map-tab-trips').addEventListener('click', () => { mapGo.tab = 'trips'; mapGo.picking = null; crumbs.sure = null; paintMapGo(); tripsLoad(); });
window.addEventListener('beforeunload', crumbsFlush);
