'use strict';
// Requests typed into Ask that are for the map: directions between places and where someone lives.
// The main process works out what was asked and finds the places (see core/map-ask.js); this carries the
// plan out on the Map page and says in the Ask panel what was done.
// Shares the page with app.js and uses its helpers ($, el, state, mapGo, mapView, mapRoute...).

/** Wait until the map has been made, for up to a few seconds. False when there is no map to wait for. */
async function askMapReady() {
  if (!state?.maps?.map) return false;
  for (let i = 0; i < 60 && !(mapView && mapView.loaded()); i++) await new Promise((r) => setTimeout(r, 100));
  return Boolean(mapView);
}

async function askMap(entry, plan, question) {
  const say = (text, cls = '') => { const p = el('p', cls, text); entry.answer.append(p); return p; };
  const buttons = el('p', 'qa-map');
  const add = (label, fn) => { const b = el('button', 'btn small', label); b.type = 'button'; b.addEventListener('click', fn); buttons.append(b); return b; };
  const done = (note) => {
    if (state?.engine?.ready) add('Search the articles instead', () => { if (!activeAsk) ask(question, false, true); });
    entry.answer.append(buttons);
    entry.box.append(el('p', 'qa-foot', note || 'Found on this computer, from your saved places and the offline map. No model wrote this.'));
    thread.scrollTop = thread.scrollHeight;
  };
  if (plan.error) { say(plan.error, 'qa-note'); if (/Saved tab/.test(plan.error)) add('Open the Saved tab', () => { showView('map'); mapGo.tab = 'book'; paintMapGo(); bookLoad(); }); done(); return; }
  for (const n of plan.notes || []) say(n, 'small-print');

  if (plan.kind === 'where') {
    const h = plan.hit;
    say(plan.to.label);
    if (h && h.d) say(h.d);
    if (h && h.p) say(h.p);
    if (plan.to.approx) say(`The position on the map is approximate. ${String(plan.to.approx).replace(/^Approximate\. /, '')}`, 'small-print');
    const show = async () => {
      showView('map');
      if (!(await askMapReady())) return false;
      if (mapPopup) mapPopup.remove();
      const hit = h || { c: 'spot', i: 'ask', a: plan.to.lat, o: plan.to.lon, n: plan.to.label, d: '' };
      mapPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 10, focusAfterOpen: false }).setLngLat([plan.to.lon, plan.to.lat]).setDOMContent(mapDetails(hit)).addTo(mapView);
      mapView.easeTo({ center: [plan.to.lon, plan.to.lat], zoom: Math.max(mapView.getZoom(), Math.min(14, mapView.getMaxZoom())), duration: 600 });
      return true;
    };
    if (!(await show())) say('No map has been downloaded yet, so it cannot be shown. The map is on the Setup page.', 'qa-note'); else add('Show it on the map again', show);
    if (plan.routing) { add('Directions to here', () => tripStart('to', plan.to)); add('Directions from here', () => tripStart('from', plan.to)); }
    done();
    return;
  }

  // Directions: the two ends go into the Directions tab, exactly as if they had been typed and found there.
  say(`From ${plan.from.label} to ${plan.to.label}.`);
  if (!plan.routing) { say('Both places were found, but directions need the routing data, which has not been downloaded yet. It is on the Setup page, under Directions.', 'qa-note'); add('Open the Setup page', () => showView('hub')); done(); return; }
  showView('map');
  mapGo.tab = 'go';
  paintMapGo();
  await askMapReady();
  if (plan.mode && [...$('map-mode').options].some((o) => o.value === plan.mode)) $('map-mode').value = plan.mode;
  mapGo.alt = 0;
  mapSetPoint('from', plan.from);
  mapSetPoint('to', plan.to);
  const status = say('Working out the route');
  try {
    await mapRoute();
    const r = mapGo.route;
    const mode = (state.maps.modes.find((x) => x.id === r.mode) || {}).name || '';
    status.textContent = `${tripMiles(r.meters)}, about ${tripTime(r.seconds)}${mode ? ` (${mode.toLowerCase()})` : ''}. The route is drawn on the map, with ${r.steps.length} turns listed beside it.`;
    for (const [which, label] of [['from', 'The start'], ['to', 'The destination']]) if (plan[which].approx) say(`${label} is approximate, so the last part of the directions may be off. ${String(plan[which].approx).replace(/^Approximate\. /, '')}`, 'small-print');
    add('Show the route again', () => { showView('map'); mapGo.tab = 'go'; paintMapGo(); });
  } catch (err) {
    status.textContent = `The places were found, but no route could be made: ${err.message}`;
    status.className = 'qa-note';
  }
  done();
}
