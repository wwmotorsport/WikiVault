'use strict';
// "Directions to here" and "Directions from here": one end of a trip is chosen, from the saved list, a place's
// pop-up or a click on the map, and the other end is asked for. It can be taken from the pins and the saved list,
// be the GPS position, be typed (a name, an address, a place), or be picked on the map.
// Shares the page with app.js and book.js and uses their helpers ($, el, state, mapGo, mapRoute, bookUi...).

const trip = { which: null, other: null, point: null, picking: false, busy: false };

/** One end is chosen: put it on the Directions tab and ask for the other. `which` is 'to' or 'from'. */
function tripStart(which, point) {
  if (!state?.maps?.routing) { $('map-error').textContent = 'Directions need the routing data, which has not been downloaded yet. It is on the Setup page.'; $('map-error').hidden = false; return; }
  if (mapPopup) mapPopup.remove();
  showView('map');
  mapGo.tab = 'go'; mapGo.picking = null;
  mapSetPoint(which, point);
  Object.assign(trip, { which, other: which === 'to' ? 'from' : 'to', point, picking: false, busy: false });
  $('trip-title').textContent = `Directions ${which} ${point.label}`;
  $('trip-sub').textContent = which === 'to' ? 'Where are you starting from? Choose from the list, or type a name, an address or a place.' : 'Where are you going? Choose from the list, or type a name, an address or a place.';
  $('trip-q').value = '';
  $('trip-error').hidden = true;
  tripPaint();
  if (!bookUi.data) bookLoad().then(tripPaint);
  if (!$('trip').open) $('trip').showModal();
  $('trip-q').focus();
}

/** What can be chosen as the other end: the end already set, the GPS position, pins first, then the saved list. */
function tripChoices() {
  const words = $('trip-q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  const set = mapGo[trip.other];
  if (!words.length && set) out.push({ name: set.label, kind: trip.other === 'from' ? 'The start already chosen' : 'The destination already chosen', point: set });
  const here = typeof gpsPoint === 'function' ? gpsPoint() : null;
  if (here && words.every((w) => 'my position gps here'.includes(w))) out.push({ name: MY_POSITION, kind: 'From the GPS receiver', point: here });
  const order = (e) => { const i = BOOK_PINS.findIndex((p) => p[0] === e.pin); return i < 0 ? 99 : i; };
  const entries = ((bookUi.data && bookUi.data.entries) || []).filter((e) => e.lat != null && !(Math.abs(e.lat - trip.point.lat) < 1e-6 && Math.abs(e.lon - trip.point.lon) < 1e-6));
  for (const e of entries.slice().sort((a, b) => order(a) - order(b))) {
    const pin = e.pin ? e.pinName || (BOOK_PINS.find((p) => p[0] === e.pin) || [])[1] : '';
    const hay = `${e.name} ${e.label} ${e.address} ${e.org} ${bookRel(e)} ${pin}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out.push({ name: e.label ? `${e.name} (${e.label})` : e.name, kind: [pin ? `Pinned: ${pin}` : '', bookRel(e)].filter(Boolean).join(', '), addr: bookLine(e.address), point: mapPointOf(bookHitOf(e)) });
    if (out.length >= 60) break;
  }
  return out;
}

function tripPaint() {
  if (!trip.point) return;
  const list = tripChoices();
  $('trip-list').replaceChildren(...list.map((c) => {
    const li = el('li');
    const b = el('button', 'map-hit');
    b.type = 'button';
    b.append(el('span', 'map-hit-name', c.name));
    if (c.kind) b.append(el('span', 'map-hit-kind', c.kind));
    if (c.addr) b.append(el('span', 'map-hit-addr', c.addr));
    b.addEventListener('click', () => tripGo(c.point));
    li.append(b);
    return li;
  }));
  const typed = $('trip-q').value.trim();
  $('trip-none').hidden = list.length > 0;
  $('trip-none').textContent = typed ? 'Nothing saved fits that. Press Get directions to look for it among the map\'s addresses, places and towns.' : 'Nothing is saved with a place on the map yet. Type an address or a place, or pick the spot on the map.';
  $('trip-go').disabled = trip.busy;
}

/** The other end is given, or typed: find what was typed, close the question, and make the route. */
async function tripGo(point) {
  if (trip.busy) return;
  const other = trip.other;
  const typed = $('trip-q').value.trim();
  if (!point && !typed && mapGo[other]) point = mapGo[other];
  if (!point && !typed) { $('trip-error').textContent = other === 'from' ? 'Choose where you are starting from, or type it.' : 'Choose where you are going, or type it.'; $('trip-error').hidden = false; return; }
  trip.busy = true; $('trip-error').hidden = true; $('trip-go').textContent = 'Looking for it'; tripPaint();
  try {
    // What was typed is looked for as on the Directions tab: saved names first, then addresses, places and towns.
    if (!point) { mapGo[other] = null; $(`map-${other}`).value = typed; point = await mapResolve(other); }
  } catch (err) {
    $('trip-error').textContent = err.message; $('trip-error').hidden = false;
    return;
  } finally { trip.busy = false; $('trip-go').textContent = 'Get directions'; tripPaint(); }
  mapSetPoint(other, point);
  $('trip').close();
  // Anything wrong with the route itself (no road near an end, no way through) is said on the Directions tab.
  guard(() => mapRoute(), $('map-error'));
}

/** After the other end was picked on the map, the route is made without another press. */
function tripPicked() {
  if (!trip.picking) return;
  trip.picking = false;
  if (mapGo.from && mapGo.to) guard(() => mapRoute(), $('map-error'));
}

/** A click on a bare part of the map: a small card for the spot, with directions to and from it. */
function tripSpot(map, ev, hadPopup) {
  if (hadPopup || mapGo.picking || bookUi.picking || trip.busy) return;
  const layers = ['hits-dot', 'book-dot'].filter((id) => map.getLayer(id));
  if (layers.length && map.queryRenderedFeatures(ev.point, { layers }).length) return;
  const h = { c: 'spot', i: 'spot', a: ev.lngLat.lat, o: ev.lngLat.lng, n: 'A spot on the map', kind: '' };
  if (mapPopup) mapPopup.remove();
  mapPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 6, focusAfterOpen: false }).setLngLat([h.o, h.a]).setDOMContent(mapDetails(h)).addTo(map);
}

$('trip-q').addEventListener('input', () => { $('trip-error').hidden = true; tripPaint(); });
$('trip-form').addEventListener('submit', (ev) => { ev.preventDefault(); tripGo(null); });
$('trip-cancel').addEventListener('click', () => $('trip').close());
$('trip-pick').addEventListener('click', () => {
  $('trip').close();
  trip.picking = true;
  mapGo.picking = trip.other;
  paintMapGo();
});
