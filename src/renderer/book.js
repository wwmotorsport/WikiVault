'use strict';
// The address book in the Map panel: the Saved tab, the entry form and the contacts accounts.
// Shares the page with app.js and uses its helpers ($, el, state, api, mapGo, mapView...).

const bookUi = { data: null, stamp: '', editing: null, picking: false, busy: false };
const bookLine = (s) => String(s || '').replace(/\s*\n\s*/g, ', ');
const bookStamp = () => { const b = state?.book; return b ? `${b.count}:${b.located}:${Object.values(b.sources || {}).map((s) => s.date || '').join()}` : ''; };

async function bookLoad() {
  try { bookUi.data = await api.bookList(); bookUi.stamp = bookStamp(); } catch { bookUi.data = { entries: [] }; }
  paintBook(); bookDraw();
}

function paintBook() {
  const b = state?.book;
  if (!b || !$('book-list')) return;
  paintAccounts();
  if (bookUi.stamp !== bookStamp() && !bookUi.busy) { bookUi.stamp = bookStamp(); bookLoad(); return; } // an account was read, or another entry saved
  const lines = [];
  if (!b.count) lines.push('Nothing saved yet. Add people and places by hand, save them from the map, or connect a contacts account.');
  else {
    lines.push(`${b.count.toLocaleString()} saved, ${b.located.toLocaleString()} with a place on the map${b.approximate ? ` (${b.approximate.toLocaleString()} approximate)` : ''}.`);
    if (b.withAddress > b.located) lines.push(b.addressData ? `${(b.withAddress - b.located).toLocaleString()} could not be placed from their address. Open one to place it by hand.` : `${(b.withAddress - b.located).toLocaleString()} have an address but no place yet: fetch the addresses, under Change or update, and they are placed by themselves.`);
  }
  if (b.busy) lines.push(`${b.busy}...`);
  for (const [name, s] of Object.entries(b.sources || {})) if (s.error) lines.push(`${name === 'google' ? 'Google' : name === 'icloud' ? 'iCloud' : 'The file'}: ${s.error}`);
  $('book-status').textContent = lines.join(' ');
  if (mapGo.tab !== 'book' || !bookUi.data) return;
  const q = $('book-q').value.trim().toLowerCase();
  const shown = bookUi.data.entries.filter((e) => !q || `${e.name} ${e.label} ${e.address} ${e.org}`.toLowerCase().includes(q)).slice(0, 300);
  $('book-list').replaceChildren(...shown.map((e) => {
    const li = el('li');
    const btn = el('button', 'map-hit');
    btn.type = 'button';
    btn.append(el('span', 'map-hit-name', e.label ? `${e.name} (${e.label})` : e.name), el('span', 'map-hit-kind', e.src === 'google' ? 'Google' : e.src === 'icloud' ? 'iCloud' : e.src === 'file' ? 'Imported' : 'Yours'));
    if (e.address) btn.append(el('span', 'map-hit-addr', bookLine(e.address)));
    if (e.phones) btn.append(el('span', 'map-hit-addr', e.phones));
    if (e.address && e.lat == null) btn.append(el('span', 'map-hit-approx', 'Not on the map yet'));
    else if (e.lat != null && e.how && e.how !== 'exact' && e.how !== 'manual') btn.append(el('span', 'map-hit-approx', e.how === 'town' ? 'Approximate: the town only' : 'Approximate position'));
    btn.addEventListener('click', () => bookShow(e));
    li.append(btn);
    return li;
  }));
}

/** Show an entry on the map if it has a place, and open it for editing if not. */
function bookShow(e) {
  if (e.lat == null || !mapView) { bookEdit(e.id); return; }
  const hit = { c: 'saved', i: `bk${e.id}`, a: e.lat, o: e.lon, n: e.label ? `${e.name} (${e.label})` : e.name, d: bookLine(e.address), p: e.phones, kind: 'Saved', how: e.how, approx: Boolean(e.how && e.how !== 'exact' && e.how !== 'manual'), why: e.why };
  if (mapPopup) mapPopup.remove();
  mapPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 10 }).setLngLat([e.lon, e.lat]).setDOMContent(mapDetails(hit)).addTo(mapView);
  mapView.easeTo({ center: [e.lon, e.lat], zoom: Math.max(mapView.getZoom(), Math.min(14, mapView.getMaxZoom())), duration: 600 });
}

function bookOverlay(map) {
  if (map.getSource('book')) return;
  map.addSource('book', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'book-dot', type: 'circle', source: 'book', minzoom: 7, paint: { 'circle-radius': 6, 'circle-color': '#8e24aa', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'book-name', type: 'symbol', source: 'book', minzoom: 11, layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': mapLook.dark ? '#e7c6f2' : '#5b1670', 'text-halo-color': mapLook.dark ? '#14181d' : '#fff', 'text-halo-width': 1.5 } });
  if (!map.bookWired) { map.bookWired = true; map.on('click', 'book-dot', (ev) => { const id = ev.features[0] && ev.features[0].properties.id; const e = bookUi.data && bookUi.data.entries.find((x) => x.id === id); if (e && !mapGo.picking && !bookUi.picking) { ev.preventDefault(); bookShow(e); } }); }
  if (!bookUi.data) bookLoad(); else bookDraw();
}
function bookDraw() {
  if (typeof mapView === 'undefined' || !mapView || !mapView.getSource('book') || !bookUi.data) return;
  mapView.getSource('book').setData({ type: 'FeatureCollection', features: bookUi.data.entries.filter((e) => e.lat != null).map((e) => ({ type: 'Feature', properties: { id: e.id, n: e.name }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } })) });
}

/** Open the form for an entry, or for a new one started from `seed`. */
function bookEdit(id, seed = null) {
  const e = id ? bookUi.data && bookUi.data.entries.find((x) => x.id === id) : null;
  if (id && !e) { bookLoad().then(() => { if (bookUi.data.entries.some((x) => x.id === id)) bookEdit(id); }); return; }
  const v = e || seed || {};
  bookUi.editing = { id: e ? e.id : null, lat: v.lat ?? null, lon: v.lon ?? null, placed: Boolean(seed && seed.lat != null) || (e && e.how === 'manual') };
  $('book-edit-title').textContent = e ? 'Change a saved entry' : 'Save a person or place';
  $('book-name').value = v.name || ''; $('book-label').value = v.label || ''; $('book-address').value = v.address || ''; $('book-phones').value = v.phones || ''; $('book-note').value = v.note || '';
  $('book-delete').hidden = !e;
  $('book-edit-error').hidden = true;
  bookWhere(e);
  if (!$('book-edit').open) $('book-edit').showModal();
  $('book-name').focus();
}
function bookWhere(e) {
  const ed = bookUi.editing;
  let text = 'When you save, the address is looked up in the address data to place it on the map.';
  if (ed.placed && ed.lat != null) text = `Placed by hand at ${Number(ed.lat).toFixed(5)}, ${Number(ed.lon).toFixed(5)}. It stays there whatever the address says.`;
  else if (e && e.lat != null) text = e.how === 'exact' ? 'Found in the address data.' : e.why || 'Placed approximately from the address.';
  else if (e && e.address) text = state?.book?.addressData ? 'This address was not found in the address data. You can place it on the map by hand.' : 'There is no address data yet, so it has no place on the map. Fetch the addresses, or place it by hand.';
  if (e && (e.src === 'google' || e.src === 'icloud')) text += ` It came from ${e.src === 'google' ? 'Google' : 'iCloud'}: once you change it here it is yours, and reading the account again leaves it alone.`;
  $('book-where').textContent = text;
}

$('book-add').addEventListener('click', () => bookEdit(null, {}));
$('book-q').addEventListener('input', () => paintBook());
$('book-cancel').addEventListener('click', () => { bookUi.editing = null; $('book-edit').close(); });
$('book-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ed = bookUi.editing;
  try {
    await api.bookPut({ id: ed.id, name: $('book-name').value, label: $('book-label').value, address: $('book-address').value, phones: $('book-phones').value, note: $('book-note').value, ...(ed.placed && ed.lat != null ? { lat: ed.lat, lon: ed.lon } : {}) });
    bookUi.editing = null;
    $('book-edit').close();
    await bookLoad();
  } catch (err) { $('book-edit-error').textContent = err.message; $('book-edit-error').hidden = false; }
});
$('book-delete').addEventListener('click', async () => {
  const ed = bookUi.editing;
  if (!ed || !ed.id) return;
  await api.bookRemove(ed.id).catch(() => {});
  bookUi.editing = null; $('book-edit').close();
  await bookLoad();
});
// Placing by hand: the form steps aside, the next click on the map is the place, and the form comes back.
$('book-pin').addEventListener('click', () => {
  if (!mapView) { $('book-edit-error').textContent = 'Download a map first, to have something to click on.'; $('book-edit-error').hidden = false; return; }
  bookUi.picking = true;
  bookUi.kept = { name: $('book-name').value, label: $('book-label').value, address: $('book-address').value, phones: $('book-phones').value, note: $('book-note').value };
  $('book-edit').close();
  mapView.getCanvas().style.cursor = 'crosshair';
  $('map-error').textContent = 'Click the map where this entry belongs.'; $('map-error').hidden = false;
  mapView.once('click', (ev) => {
    bookUi.picking = false; mapView.getCanvas().style.cursor = ''; $('map-error').hidden = true;
    const ed = bookUi.editing; if (!ed) return;
    ed.lat = ev.lngLat.lat; ed.lon = ev.lngLat.lng; ed.placed = true;
    $('book-edit').showModal();
    Object.entries(bookUi.kept).forEach(([k, v]) => { $(`book-${k}`).value = v; });
    bookWhere(null);
  });
});

// ---- contacts accounts
function paintAccounts() {
  const b = state?.book; if (!b || !$('book-acc').open) return;
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; };
  const line = (on, s, off) => (on ? `${s && s.date ? `Connected. Last read on ${when(s.date)}: ${s.contacts.toLocaleString()} contacts, ${s.entries.toLocaleString()} entries.` : 'Connected.'}${s && s.error ? ` ${s.error}` : ''}` : off);
  const g = b.accounts.google; const i = b.accounts.icloud;
  $('acc-google-status').textContent = line(g, b.sources.google, 'Not connected.') + (g ? ` Connected by ${b.accounts.googleBy}${b.accounts.googleUser ? `: ${b.accounts.googleUser}` : ''}.` : '');
  $('acc-icloud-status').textContent = line(Boolean(i), b.sources.icloud, 'Not connected.') + (i ? ` Account: ${i}.` : '');
  for (const [k, on] of [['google', g], ['icloud', Boolean(i)]]) { $(`acc-${k}-sync`).hidden = !on; $(`acc-${k}-off`).hidden = !on; }
  $('acc-google-connect').textContent = g && b.accounts.googleBy === 'sign-in' ? 'Sign in again' : 'Sign in with Google';
  $('acc-google-pass-connect').textContent = g && b.accounts.googleBy === 'app password' ? 'Connect again' : 'Connect with an app password';
  if (b.sources.google && b.sources.google.error && b.accounts.googleBy === 'sign-in') $('acc-google-how').open = true; // where the button to sign in again is
  $('acc-icloud-connect').textContent = i ? 'Connect again' : 'Connect iCloud';
  if (b.sources.file) $('acc-file-status').textContent = `Last file: ${b.sources.file.name || 'a contacts file'}, ${b.sources.file.contacts.toLocaleString()} contacts. Importing again replaces what it brought in.`;
  if (document.activeElement !== $('book-every')) $('book-every').value = String([6, 24, 168].includes(b.everyHours) ? b.everyHours : 24);
  const busy = Boolean(b.busy) || bookUi.busy;
  for (const id of ['acc-google-pass-connect', 'acc-google-connect', 'acc-google-sync', 'acc-google-off', 'acc-icloud-connect', 'acc-icloud-sync', 'acc-icloud-off', 'acc-file']) $(id).disabled = busy;
  if (b.busy) { $('book-acc-done').textContent = `${b.busy}...`; $('book-acc-done').hidden = false; }
}
async function bookDo(work, done) {
  bookUi.busy = true;
  $('book-acc-error').hidden = true; $('book-acc-done').hidden = true;
  paintAccounts();
  try { const r = await work(); if (r !== null) { $('book-acc-done').textContent = done(r); $('book-acc-done').hidden = false; } } catch (err) { $('book-acc-done').hidden = true; $('book-acc-error').textContent = err.message; $('book-acc-error').hidden = false; }
  bookUi.busy = false;
  await bookLoad();
  paintAccounts();
}
const bookTold = (name) => (r) => `${name}: ${r.contacts.toLocaleString()} contacts read, ${r.entries.toLocaleString()} entries kept, ${r.located.toLocaleString()} placed on the map.`;
$('book-accounts').addEventListener('click', () => { $('book-acc-error').hidden = true; $('book-acc-done').hidden = true; $('book-acc').showModal(); paintAccounts(); });
$('book-acc-close').addEventListener('click', () => $('book-acc').close());
$('acc-google-connect').addEventListener('click', () => bookDo(() => api.bookGoogleConnect($('acc-google-id').value, $('acc-google-secret').value).then((r) => { $('acc-google-secret').value = ''; $('acc-google-how').open = false; return r; }), bookTold('Google')));
$('acc-google-pass-connect').addEventListener('click', () => bookDo(() => api.bookGooglePassword($('acc-google-user').value, $('acc-google-pass').value).then((r) => { $('acc-google-pass').value = ''; return r; }), bookTold('Google')));
$('acc-icloud-connect').addEventListener('click', () => bookDo(() => api.bookIcloudConnect($('acc-icloud-user').value, $('acc-icloud-pass').value).then((r) => { $('acc-icloud-pass').value = ''; return r; }), bookTold('iCloud')));
$('acc-google-sync').addEventListener('click', () => bookDo(() => api.bookSync('google').then((r) => r.google), bookTold('Google')));
$('acc-icloud-sync').addEventListener('click', () => bookDo(() => api.bookSync('icloud').then((r) => r.icloud), bookTold('iCloud')));
$('acc-google-off').addEventListener('click', () => bookDo(() => api.bookDisconnect('google', false), () => 'Google was disconnected and its contacts removed from the book. Entries you changed yourself were kept.'));
$('acc-icloud-off').addEventListener('click', () => bookDo(() => api.bookDisconnect('icloud', false), () => 'iCloud was disconnected and its contacts removed from the book. Entries you changed yourself were kept.'));
$('acc-file').addEventListener('click', () => bookDo(() => api.bookImportFile(), bookTold('The file')));
$('book-every').addEventListener('change', () => api.bookEvery(Number($('book-every').value)).catch(() => {}));
