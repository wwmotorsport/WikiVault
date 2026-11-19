'use strict';
// GPS: reads a USB receiver through the serial port it shows up as, puts the position on the map,
// and follows a route with it. Shares the page with app.js and uses its helpers ($, el, state, mapGo...).
//
// The receiver is only ever read, never written to. Every port is tried at the usual speeds until one
// sends positions, so there is nothing to configure.

const gps = {
  port: null, reader: null, stopping: false,
  status: 'off',        // off | searching | waiting (connected, no fix yet) | fix | lost
  detail: '', fix: null, last: 0,
  follow: localStorage.getItem('wikivault-gps-follow') !== '0',
  speak: localStorage.getItem('wikivault-gps-speak') === '1',
  guide: null, route: null, heard: {}, spoken: [], rerouteAt: 0, arrived: false, info: null,
};
const GPS_SPEEDS = [4800, 9600, 38400, 115200];
const gpsWait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The position as an end of a route, or null when there is none. */
function gpsPoint() { return gps.fix && gps.fix.has ? { lon: gps.fix.lon, lat: gps.fix.lat, label: MY_POSITION, gps: true } : null; }

function gpsSay(text) {
  gps.spoken.push(text); if (gps.spoken.length > 20) gps.spoken.shift();
  if (!gps.speak || !window.speechSynthesis) return;
  try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice on this computer */ }
}

/** Read from a port for a moment and say whether it sends GPS sentences. Leaves the port open when it does. */
async function gpsProbe(port, baudRate) {
  // A port that belongs to something else (a paired Bluetooth device that is switched off, say) can take a long time to refuse.
  // It is given a few seconds, and then left out altogether.
  const opened = await Promise.race([port.open({ baudRate }).then(() => 'open', () => 'refused'), gpsWait(4000).then(() => 'slow')]);
  if (opened === 'slow') { port.wikivaultSlow = true; return null; }
  if (opened !== 'open') return null;
  const probe = new WikivaultNmea.Reader();
  const reader = port.readable.getReader();
  const dec = new TextDecoder('latin1');
  const until = Date.now() + 1700;
  try {
    while (Date.now() < until && probe.sentences < 2) {
      const r = await Promise.race([reader.read(), gpsWait(until - Date.now()).then(() => null)]);
      if (!r) break;
      if (r.done) break;
      probe.push(dec.decode(r.value, { stream: true }));
    }
  } catch { /* a port that cannot be read is not the receiver */ }
  if (probe.sentences >= 2) return { reader, dec, start: probe };
  try { await reader.cancel(); } catch { /* already closed */ }
  try { reader.releaseLock(); await port.close(); } catch { /* already closed */ }
  return null;
}

/** Keep reading the connected receiver until it is unplugged or disconnected. */
async function gpsListen(port, reader, dec) {
  const nmea = new WikivaultNmea.Reader(gpsOnFix);
  gps.port = port; gps.reader = reader; gps.stopping = false;
  try {
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      nmea.push(dec.decode(r.value, { stream: true }));
    }
  } catch { /* unplugged */ }
  try { reader.releaseLock(); await port.close(); } catch { /* already gone */ }
  gps.port = null; gps.reader = null;
  if (!gps.stopping) { gps.status = 'lost'; gps.detail = 'The receiver stopped answering. Plug it in again and press the button.'; gps.fix = null; gpsDraw(); paintGps(); }
}

/** Look for a receiver on every serial port. Started by a click, which the browser requires before it will show the ports. */
async function gpsFind() {
  if (gps.status === 'searching') return;
  await gpsOff(true);
  gps.status = 'searching'; gps.detail = 'Looking at the serial ports'; paintGps();
  try {
    if (state.gpsFake) { gpsReplay(await api.gpsFake()); return; }
    if (!navigator.serial) throw new Error('This computer does not let the app read serial ports.');
    let ports = await navigator.serial.getPorts();
    if (!ports.length) {
      // The ports have to be asked for, one request each, while the click that started this still counts.
      gps.ports = null;
      try { await api.gpsWant(null); ports = [await navigator.serial.requestPort()]; } catch { ports = []; }
      for (const p of (gps.ports || []).slice(1)) { try { await api.gpsWant(p.id); const more = await navigator.serial.requestPort(); if (!ports.includes(more)) ports.push(more); } catch { /* that one is not offered */ } }
    }
    // USB devices first: a receiver is one, and the ports built into the computer or made by Bluetooth are not.
    ports = ports.slice().sort((a, b) => Number(Boolean(b.getInfo().usbVendorId)) - Number(Boolean(a.getInfo().usbVendorId)));
    if (!ports.length) throw new Error('No serial port was found. Plug the receiver in, wait for Windows to finish setting it up, and try again. Some receivers need a driver from the maker.');
    for (const port of ports) {
      for (const speed of GPS_SPEEDS) {
        gps.detail = `Trying port ${ports.indexOf(port) + 1} of ${ports.length} at ${speed} baud`; paintGps();
        if (port.wikivaultSlow) break;
        const got = await gpsProbe(port, speed);
        if (!got) continue;
        gps.status = 'waiting'; gps.detail = ''; gps.info = { speed, ...port.getInfo() };
        localStorage.setItem('wikivault-gps-on', '1');
        paintGps();
        gpsListen(port, got.reader, got.dec);
        return;
      }
    }
    throw new Error(`${ports.length === 1 ? 'A serial port was found, but nothing on it' : `${ports.length} serial ports were found, but nothing on them`} is sending GPS positions. Check that the receiver is plugged in and its light is on.`);
  } catch (err) { gps.status = 'off'; gps.detail = err.message; paintGps(); }
}

/** For the tests: play back recorded sentences as if a receiver were sending them. */
async function gpsReplay(text) {
  const nmea = new WikivaultNmea.Reader(gpsOnFix);
  gps.status = 'waiting'; gps.detail = ''; gps.info = { speed: 4800 }; gps.stopping = false; gps.port = {};
  paintGps();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (gps.stopping) break;
    if (/^#wait/.test(line)) { await gpsWait(Number(line.slice(6)) || 500); continue; }
    if (/^#hold/.test(line)) { await new Promise((r) => { gps.release = r; }); gps.release = null; continue; } // the test says when to drive on
    nmea.push(`${line}\r\n`);
    await gpsWait(60);
  }
}

async function gpsOff(quiet) {
  gps.stopping = true;
  try { if (gps.reader) await gps.reader.cancel(); } catch { /* already closed */ }
  gps.port = null; gps.reader = null; gps.fix = null; gps.guide = null; gps.route = null;
  if (!quiet) { gps.status = 'off'; gps.detail = ''; localStorage.removeItem('wikivault-gps-on'); }
  gpsDraw(); paintGps(); gpsBanner(null);
}

function gpsOnFix(fix) {
  const first = !(gps.fix && gps.fix.has) && fix.has;
  gps.fix = fix; gps.last = Date.now();
  gps.status = fix.has ? 'fix' : 'waiting';
  gpsDraw();
  if (fix.has && mapView && (first || (gps.follow && view === 'map' && !mapView.isMoving()))) {
    mapView.easeTo({ center: [fix.lon, fix.lat], ...(first && mapView.getZoom() < 12 ? { zoom: Math.min(15, mapView.getMaxZoom()) } : {}), duration: first ? 800 : 500 });
  }
  if (fix.has) gpsGuide(fix);
  paintGps();
}

/** A new route, or none: start following it afresh. */
function gpsRouteChanged() {
  const r = mapGo.route;
  if (r === gps.route) return;
  gps.route = r; gps.heard = {}; gps.arrived = false;
  // A route worked out from the position starts at the nearest road. Until the car is on it, being that far away is not "off the route".
  gps.slack = r && r.coords && r.coords.length && mapGo.from && mapGo.from.gps && gps.fix && gps.fix.has ? WikivaultGuide.metres([gps.fix.lon, gps.fix.lat], r.coords[0]) + 40 : 0;
  gps.guide = r && r.coords && r.coords.length > 1 ? new WikivaultGuide.Guide(r) : null;
  if (!gps.guide) gpsBanner(null); else if (gps.fix && gps.fix.has) gpsGuide(gps.fix);
}

function gpsGuide(fix) {
  if (!gps.guide || !mapGo.route) return;
  const u = gps.guide.update([fix.lon, fix.lat], fix.accuracy || 10, gps.slack || 0);
  if (u.dist < 30) gps.slack = 0;
  gps.progress = u;
  if (u.arrived) {
    // An address that was not found exactly: the end of the route is near it, or only in its town, and that is said.
    const to = mapGo.to && mapGo.to.approx ? mapGo.to : null;
    const rough = to && to.how === 'town';
    gpsBanner(to ? 'You have reached the approximate position' : 'You have arrived', rough ? 'This is the middle of the town or ZIP code, not the address: the address was not found in the data.' : to ? 'The exact address was not found in the data. It should be close by.' : '');
    if (!gps.arrived) { gps.arrived = true; gpsSay(rough ? 'You have reached the middle of the town. The exact address was not found, so this is not the address itself.' : to ? 'You have reached the approximate position. The exact address was not found. It should be close by.' : 'You have arrived.'); }
    return;
  }
  if (u.off) {
    gpsBanner('Off the route', 'Working out a new one from where you are');
    // A new route from here, but not over and over while one is still being worked out.
    if (!mapGo.busy && Date.now() - gps.rerouteAt > 8000 && mapGo.to) {
      gps.rerouteAt = Date.now();
      mapGo.from = gpsPoint(); $('map-from').value = MY_POSITION;
      gpsSay('Off the route. Finding a new one.');
      mapRoute({ again: true }).catch((err) => { $('map-error').textContent = err.message; $('map-error').hidden = false; });
    }
    return;
  }
  const rest = `${tripMiles(u.remaining)} to go`;
  if (!u.next) { gpsBanner('Continue to the end of the route', rest); return; }
  gpsBanner(`In ${WikivaultGuide.said(u.next.meters)}: ${u.next.text}`, rest);
  // Each turn is announced when it comes within a quarter of a mile, and again just before it.
  const far = `${u.next.index}:far`; const near = `${u.next.index}:near`;
  if (u.next.meters <= 60 && !gps.heard[near]) { gps.heard[near] = true; gps.heard[far] = true; gpsSay(`${u.next.text}.`); }
  else if (u.next.meters <= 400 && !gps.heard[far]) { gps.heard[far] = true; gpsSay(`In ${WikivaultGuide.said(u.next.meters)}, ${u.next.text.charAt(0).toLowerCase()}${u.next.text.slice(1)}.`); }
}

function gpsBanner(next, rest) {
  const box = $('map-guide');
  box.hidden = !next;
  if (next) { $('map-guide-next').textContent = next; $('map-guide-rest').textContent = rest || ''; }
}

function gpsOverlay(map) {
  if (map.getSource('gps')) return;
  map.addSource('gps', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'gps-halo', type: 'circle', source: 'gps', paint: { 'circle-radius': 16, 'circle-color': '#1a73e8', 'circle-opacity': 0.18 } });
  map.addLayer({ id: 'gps-dot', type: 'circle', source: 'gps', paint: { 'circle-radius': 7, 'circle-color': '#1a73e8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
  gpsDraw();
}
function gpsDraw() {
  if (typeof mapView === 'undefined' || !mapView || !mapView.getSource('gps')) return;
  const f = gps.fix;
  mapView.getSource('gps').setData({ type: 'FeatureCollection', features: f && f.has ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } }] : [] });
}

/** Where a receiver can be bought, when the app has been given one to point to: the words and the link. */
function gpsBuy() {
  const g = state && state.gear && state.gear.gps;
  if (!g) return null;
  return { text: `No receiver yet?${g.note ? ` ${g.note}` : ''}`, label: `${g.name || 'USB GPS receiver'}${g.seller ? ` on ${g.seller}` : ''} (opens your web browser)`, url: g.url };
}
function paintGps() {
  if (!$('gps-status')) return;
  { const buy = gpsBuy(); const off = gps.status === 'off' || gps.status === 'lost'; $('gps-buy').hidden = !(buy && off); if (buy) { $('gps-buy-text').textContent = buy.text; $('gps-buy-link').textContent = buy.label; } }
  if (view === 'map') gpsResume();
  const f = gps.fix; const on = gps.status === 'waiting' || gps.status === 'fix';
  let text = 'Not connected. Plug in a USB GPS receiver and press the button.';
  if (gps.status === 'searching') text = `${gps.detail}...`;
  else if (gps.status === 'waiting') text = `Connected${gps.info ? ` at ${gps.info.speed} baud` : ''}. Waiting for a position${f && f.sats != null ? `: ${f.sats} satellites in view` : ''}. Outdoors, or by a window, this takes a minute or two.`;
  else if (gps.status === 'fix') text = `Position: ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}, good to about ${Math.round((f.accuracy || 10) * 3.28084)} feet${f.sats != null ? `, ${f.sats} satellites` : ''}${f.speed != null && f.speed > 0.8 ? `, ${Math.round(f.speed * 2.23694)} mph` : ''}.`;
  else if (gps.detail) text = gps.detail;
  $('gps-status').textContent = text;
  $('gps-status').className = gps.status === 'lost' || (gps.status === 'off' && gps.detail) ? 'map-approx' : 'small-print';
  $('gps-find').hidden = on;
  $('gps-find').disabled = gps.status === 'searching';
  $('gps-off').hidden = !on;
  $('gps-from').hidden = gps.status !== 'fix';
  $('gps-follow-row').hidden = !on; $('gps-speak-row').hidden = !on;
  $('gps-follow').checked = gps.follow; $('gps-speak').checked = gps.speak;
}

$('gps-find').addEventListener('click', () => gpsFind());
$('gps-off').addEventListener('click', () => gpsOff(false));
$('gps-from').addEventListener('click', () => { const p = gpsPoint(); if (p) { mapGo.tab = 'go'; mapSetPoint('from', p); } });
$('gps-follow').addEventListener('change', () => { gps.follow = $('gps-follow').checked; localStorage.setItem('wikivault-gps-follow', gps.follow ? '1' : '0'); });
$('gps-speak').addEventListener('change', () => { gps.speak = $('gps-speak').checked; localStorage.setItem('wikivault-gps-speak', gps.speak ? '1' : '0'); if (gps.speak) gpsSay('Turns will be spoken.'); });

// A receiver that was in use last time is looked for again when the map is first opened, if the ports can be seen without asking.
let gpsTried = false;
async function gpsResume() {
  if (gpsTried || !localStorage.getItem('wikivault-gps-on') || !navigator.serial || state.gpsFake) return;
  gpsTried = true;
  try { if ((await navigator.serial.getPorts()).length) gpsFind(); } catch { /* ports cannot be listed until the button is pressed */ }
}

api.onGpsPorts((list) => { gps.ports = list; });

$('gps-buy-link').addEventListener('click', () => { const buy = gpsBuy(); if (buy) api.openExternal(buy.url); });
