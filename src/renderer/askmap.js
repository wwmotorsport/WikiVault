'use strict';
// Requests typed into Ask that are for the map: directions between places, where someone lives, and the
// places of some kind near somewhere ("the nearest hospital to home").
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
    if (!(await show())) say('No map has been downloaded yet, so it cannot be shown. The map is on the Options and Setup page.', 'qa-note'); else add('Show it on the map again', show);
    if (plan.routing) { add('Directions to here', () => tripStart('to', plan.to)); add('Directions from here', () => tripStart('from', plan.to)); }
    done();
    return;
  }

  if (plan.kind === 'near') {
    // The places of a kind near somewhere, nearest first: said here, listed on the Places tab, and drawn on the map.
    const where = plan.at.label;
    const first = plan.hits[0];
    const nameOf = (h) => h.n || 'One with no name recorded';
    const dist = (h) => `${h.far}${h.wind ? ` to the ${h.wind}` : ''}`;
    const several = plan.cats && plan.cats.length > 1;
    const sizeWord = plan.size ? `${plan.size === 'large' ? 'Large' : 'Small'} ` : '';
    say(plan.radius ? `${sizeWord}${sizeWord ? plan.names.toLowerCase() : plan.names} within ${plan.radius} of ${where}` : `${sizeWord}${sizeWord ? plan.names.toLowerCase() : plan.names} ${plan.bySize ? 'around' : 'nearest to'} ${where}`, 'qa-near-title');
    if (plan.how === 'count') say(`${plan.total === 1 ? 'There is 1' : `There are ${plan.total}`}${plan.radius ? ` within ${plan.radius}` : ' in the places on this computer near there'}.${plan.total > plan.hits.length ? ` The nearest ${plan.hits.length} are listed.` : ''}`);
    else say(`The nearest is ${nameOf(first)}, ${dist(first)} of ${where} in a straight line.${plan.total > plan.hits.length ? ` ${plan.total} were found${plan.radius ? ` within ${plan.radius}` : ''}; the nearest ${plan.hits.length} are listed.` : ''}`);
    const hits = plan.hits.map((h) => ({ ...h, kmFrom: where }));
    const show = async (id) => {
      showView('map');
      if (!(await askMapReady())) return false;
      // As if they had been found on the Places tab: the list beside the map, the marks on it.
      $('map-q').value = ''; $('map-cat').value = '';
      mapAsked += 1;
      mapHits = { total: hits.length, hits };
      mapSelected = null;
      if (mapPopup) { mapPopup.remove(); mapPopup = null; }
      mapGo.tab = 'find';
      paintMapGo(); paintMapResults(); mapDrawHits();
      if (id) mapSelect(id);
      else {
        const b = new maplibregl.LngLatBounds([plan.at.lon, plan.at.lat], [plan.at.lon, plan.at.lat]);
        for (const h of hits) b.extend([h.o, h.a]);
        mapView.fitBounds(b, { padding: 70, maxZoom: Math.min(14, mapView.getMaxZoom()), duration: 600 });
      }
      return true;
    };
    const drive = async (h) => {
      showView('map'); mapGo.tab = 'go'; paintMapGo();
      await askMapReady();
      mapGo.alt = 0;
      mapSetPoint('from', plan.at);
      mapSetPoint('to', { lon: h.o, lat: h.a, label: h.d ? `${nameOf(h)}, ${h.d}` : nameOf(h) });
      await mapRoute().catch(() => {});
    };
    const list = el('ol', 'qa-near');
    const rows = new Map();
    for (const h of hits) {
      const li = el('li');
      li.append(el('b', '', nameOf(h)));
      const facts = [dist(h), several ? h.kind : '', h.less && h.x && h.x.kind ? h.x.kind : '', h.area ? `about ${h.area}` : '', h.x && h.x.emergency === 'yes' ? 'emergency room' : h.x && h.x.emergency === 'no' && h.x.listed ? 'no emergency room' : '', h.x && h.x.listed ? 'on the Medicare list' : '', h.s === 'ov' ? 'from Overture Maps' : ''].filter(Boolean).join(' · ');
      li.append(el('span', 'qa-near-far', facts));
      if (h.d) li.append(el('span', 'qa-near-line', h.d));
      if (h.p) li.append(el('span', 'qa-near-line', h.p));
      const road = el('span', 'qa-near-line qa-near-road'); road.hidden = true; li.append(road);
      const acts = el('span', 'qa-near-acts');
      const see = el('button', 'link-btn', 'Show on the map'); see.type = 'button'; see.addEventListener('click', () => show(h.i));
      acts.append(see);
      if (plan.routing) { const go = el('button', 'link-btn', 'Directions'); go.type = 'button'; go.addEventListener('click', () => drive(h)); acts.append(go); }
      li.append(acts);
      rows.set(h.i, road);
      list.append(li);
    }
    entry.answer.append(list);
    if (!plan.hasMap) say('No map has been downloaded yet, so they cannot be shown on it. The map is on the Options and Setup page.', 'qa-note');
    else if (await show(null)) add('Show them on the map again', () => show(null));
    done('Found on this computer, in the places fetched for the offline map. Distances are in a straight line. No model wrote this.');
    // By road, the nearest in a straight line is not always the nearest: the first few are measured along the roads.
    if (plan.routing && plan.how !== 'count') {
      const byRoad = [];
      for (const h of hits.slice(0, 3)) {
        try {
          const r = await api.mapsRoute({ points: [[plan.at.lon, plan.at.lat], [h.o, h.a]], mode: 'car', alt: 0, noMotorways: false, blocks: mapGo.blocks || [] });
          const road = rows.get(h.i); road.textContent = `By road: ${tripMiles(r.meters)}, about ${tripTime(r.seconds)}.`; road.hidden = false;
          byRoad.push({ h, meters: r.meters });
        } catch { /* no road found to that one: the straight line stands */ }
      }
      const best = byRoad.slice().sort((a, b) => a.meters - b.meters)[0];
      if (best && best.h.i !== first.i && byRoad.some((x) => x.h.i === first.i)) { const p = el('p', 'map-approx', `By road, ${nameOf(best.h)} is nearer than ${nameOf(first)}: ${tripMiles(best.meters)} against ${tripMiles(byRoad.find((x) => x.h.i === first.i).meters)}.`); list.after(p); }
      thread.scrollTop = thread.scrollHeight;
    }
    return;
  }

  // Directions: the two ends go into the Directions tab, exactly as if they had been typed and found there.
  say(`From ${plan.from.label} to ${plan.to.label}.`);
  if (!plan.routing) { say('Both places were found, but directions need the routing data, which has not been downloaded yet. It is on the Options and Setup page, under Directions.', 'qa-note'); add('Open the Options and Setup page', () => showView('hub')); done(); return; }
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
    for (const which of ['from', 'to']) if (plan[which].approx) { const t = mapApproxText(which, plan[which]); say(`${t.lead ? `${t.lead} ` : ''}${t.rest}`, t.rough ? 'map-approx map-approx-rough' : 'map-approx'); }
    add('Show the route again', () => { showView('map'); mapGo.tab = 'go'; paintMapGo(); });
  } catch (err) {
    status.textContent = `The places were found, but no route could be made: ${err.message}`;
    status.className = 'qa-note';
  }
  done();
}
