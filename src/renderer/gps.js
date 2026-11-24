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
  autoZoom: localStorage.getItem('wikivault-gps-autozoom') !== '0', // zoom to keep the next turn in view while a route is followed
  zoomHeld: false, zoomWant: null,                                   // held: the user zoomed by hand, and it waits to be asked back
  turn: localStorage.getItem('wikivault-gps-turn') === 'heading' ? 'heading' : 'north', // which way up the map is kept while it follows
  glide: new WikivaultGpsSmooth.Glide(), shown: null, raf: 0, handsUntil: 0, easeUntil: 0,
  speak: localStorage.getItem('wikivault-gps-speak') === '1',
  guide: null, route: null, heard: {}, spoken: [], rerouteAt: 0, arrived: false, info: null,
};
const GPS_SPEEDS = [4800, 9600, 38400, 115200, 19200, 57600];
const gpsWait = (ms) => new Promise((r) => setTimeout(r, ms));

// The receiver that worked last time: its USB numbers and its speed. Kept so that it is set up once: after that it
// is picked up by itself when the app starts and whenever it is plugged in.
function gpsKnown() { try { const k = JSON.parse(localStorage.getItem('wikivault-gps-known') || 'null'); return k && k.speed ? k : null; } catch { return null; } }
const gpsIsKnown = (port, k) => { const i = port.getInfo(); return Boolean(k && (i.usbVendorId || 0) === (k.vid || 0) && (i.usbProductId || 0) === (k.pid || 0)); };

/** The position as an end of a route, or null when there is none. */
function gpsPoint() { return gps.fix && gps.fix.has ? { lon: gps.fix.lon, lat: gps.fix.lat, label: MY_POSITION, gps: true } : null; }

function gpsSay(text) {
  gps.spoken.push(text); if (gps.spoken.length > 20) gps.spoken.shift();
  if (!gps.speak || !window.speechSynthesis) return;
  try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice on this computer */ }
}

/**
 * Read from a port for a moment and say whether it sends GPS sentences. Leaves the port open when it does.
 * Returns { got: { reader, dec, start } } or { how, bytes }: 'refused' (would not open), 'slow' (did not answer
 * in time), 'silent' (opened and sent nothing), 'noise' (sent something that is not GPS sentences).
 */
async function gpsProbe(port, baudRate) {
  // A port that belongs to something else (a paired Bluetooth device that is switched off, say) can take a long time to refuse.
  // It is given a few seconds, and then left out altogether. The buffer is a large one: a receiver that never
  // pauses fills a small one whenever the map keeps the computer busy for a moment.
  const opened = await Promise.race([port.open({ baudRate, bufferSize: 65536 }).then(() => 'open', () => 'refused'), gpsWait(4000).then(() => 'slow')]);
  if (opened === 'slow') { port.wikivaultSlow = true; return { how: 'slow', bytes: 0 }; }
  if (opened !== 'open') return { how: 'refused', bytes: 0 };
  // Some USB-to-serial chips send nothing until the computer says it is ready to listen.
  try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch { /* not every port has the lines */ }
  const probe = new WikivaultNmea.Reader();
  const dec = new TextDecoder('latin1');
  // A receiver speaks once a second, and at 4800 baud one burst takes most of that second: listen through two of them.
  // Mistakes on the line (the port is usually opened in the middle of a character) are read past, not taken for silence.
  const s = await WikivaultGpsRead.sample(port, probe, { ms: port.getInfo().usbVendorId ? 2600 : 1700, decoder: dec });
  if (s.reader) return { got: { reader: s.reader, dec, start: probe }, errors: s.errors };
  try { await port.close(); } catch { /* already closed */ }
  return { how: s.bytes || s.errors ? 'noise' : 'silent', bytes: s.bytes, errors: s.errors };
}

/** Keep reading the connected receiver until it is unplugged or disconnected. Mistakes on the line are read past. */
async function gpsListen(port, reader, dec) {
  const nmea = new WikivaultNmea.Reader(gpsOnFix);
  gps.port = port; gps.reader = reader; gps.stopping = false;
  const end = await WikivaultGpsRead.follow(port, reader, { onText: (t) => nmea.push(t), stopping: () => gps.stopping, onReader: (r) => { gps.reader = r; }, decoder: dec });
  try { await port.close(); } catch { /* already gone */ }
  if (gps.port !== port) return; // disconnected, or already looked for again
  gps.port = null; gps.reader = null;
  if (!gps.stopping) {
    gps.status = 'lost'; gps.detail = gpsKnown() ? 'The receiver was unplugged or stopped answering. Plug it in again and it is picked up by itself.' : 'The receiver stopped answering. Plug it in again and press the button.'; gps.fix = null; gps.shown = null; gps.glide.reset(); gps.progress = null; gps.autoAfter = Date.now() + 3000; gpsDraw(); paintGps(); gpsBanner(null);
    if (typeof crumbsFlush === 'function') crumbsFlush();
    api.gpsLog([`receiver lost (${end.why === 'gone' ? 'the port is gone' : end.why === 'errors' ? 'nothing but mistakes on the line' : 'its stream closed'}), ${end.errors} mistakes on the line read past while it was connected`]).catch(() => {});
  }
}

/**
 * Ask for every serial port, one request each. The browser wants a click behind a request; when the app connects
 * by itself the main process stands in for the click. The ports are left in gps.asked; returns how many.
 */
async function gpsRequestPorts() {
  const got = [];
  gps.ports = null;
  try { await api.gpsWant(null); got.push(await navigator.serial.requestPort()); } catch { /* none is offered */ }
  for (const p of (gps.ports || []).slice(1)) { try { await api.gpsWant(p.id); const more = await navigator.serial.requestPort(); if (!got.includes(more)) got.push(more); } catch { /* that one is not offered */ } }
  gps.asked = got;
  return got.length;
}

async function gpsFind({ quiet = false, given = null } = {}) {
  if (gps.status === 'searching') return;
  const known = gpsKnown();
  await gpsOff(true);
  gps.paused = false;
  gps.status = 'searching'; gps.detail = quiet ? 'Connecting to the receiver' : 'Looking at the serial ports'; paintGps(); if (!quiet) gpsShow();
  const tried = [];
  try {
    if (state.gpsFake) { gpsReplay(await api.gpsFake()); return; }
    if (!navigator.serial) throw new Error('This computer does not let the app read serial ports.');
    let ports = given || await navigator.serial.getPorts();
    // By itself (no button pressed) only the receiver that worked before is opened: nothing else is touched.
    // (A receiver connected with an earlier version left no note of which it was: then the USB ports are looked at, once.)
    if (quiet) { ports = ports.filter((p) => (known ? gpsIsKnown(p, known) : p.getInfo().usbVendorId)); if (!ports.length) { gps.status = 'off'; gps.detail = ''; paintGps(); return; } }
    // The ports have to be asked for while the click that started this still counts.
    if (!ports.length) { await gpsRequestPorts(); ports = gps.asked || []; }
    // USB devices first: a receiver is one, and the ports built into the computer or made by Bluetooth are not.
    ports = ports.slice().sort((a, b) => Number(Boolean(b.getInfo().usbVendorId)) - Number(Boolean(a.getInfo().usbVendorId)));
    // The one that worked last time goes first, at the speed it worked at.
    ports.sort((a, b) => Number(gpsIsKnown(b, known)) - Number(gpsIsKnown(a, known)));
    for (const port of ports) {
      const info = port.getInfo();
      const t = { vid: info.usbVendorId || 0, pid: info.usbProductId || 0, results: [] };
      tried.push(t);
      // The speeds receivers are sold at come first; the rest are only worth trying on a USB device.
      const speeds = info.usbVendorId ? GPS_SPEEDS.slice() : GPS_SPEEDS.slice(0, 4);
      if (gpsIsKnown(port, known) && speeds.includes(known.speed)) { speeds.splice(speeds.indexOf(known.speed), 1); speeds.unshift(known.speed); }
      for (const speed of speeds) {
        gps.detail = `Trying port ${ports.indexOf(port) + 1} of ${ports.length} at ${speed} baud`; paintGps();
        if (port.wikivaultSlow) { t.results.push({ speed, how: 'slow', bytes: 0 }); break; }
        const r = await gpsProbe(port, speed);
        if (!r.got) { t.results.push({ speed, how: r.how, bytes: r.bytes, errors: r.errors || 0 }); if (r.how === 'refused' && t.results.length >= 2) break; continue; }
        gps.status = 'waiting'; gps.detail = ''; gps.info = { speed, ...info };
        localStorage.setItem('wikivault-gps-on', '1');
        try { localStorage.setItem('wikivault-gps-known', JSON.stringify({ vid: t.vid, pid: t.pid, speed, date: new Date().toISOString() })); } catch { /* found again by the button, then */ }
        paintGps(); if (typeof renderHub === 'function' && view === 'hub') renderHub();
        api.gpsLog([`receiver found${quiet ? ' by itself' : ''} on port ${ports.indexOf(port) + 1} of ${ports.length}${t.vid ? ` [USB ${t.vid.toString(16)}:${t.pid.toString(16)}]` : ''} at ${speed} baud${r.errors ? `, after reading past ${r.errors} mistakes on the line` : ''}`]).catch(() => {});
        gps.listening = gpsListen(port, r.got.reader, r.got.dec);
        return;
      }
    }
    // By itself and not answering: it is left alone for a minute, and nothing is made of it.
    if (quiet) { gps.autoAfter = Date.now() + 60000; gps.status = 'off'; gps.detail = 'The receiver is plugged in but did not answer. It is tried again in a minute; "Find my GPS receiver" looks into it now.'; paintGps(); api.gpsLog(['the known receiver did not answer when tried by itself', ...WikivaultGpsWhy.explain({ tried }).lines]).catch(() => {}); return; }
    // Not found: Windows is asked what it knows about its ports, which tells a missing driver from an unplugged receiver.
    gps.detail = 'Asking Windows about its ports'; paintGps();
    let hardware = null;
    try { hardware = WikivaultGpsWhy.readHardware(await api.gpsHardware()); } catch { /* the search's own account will do */ }
    const why = WikivaultGpsWhy.explain({ tried, hardware });
    api.gpsLog(['no receiver found', ...why.lines, why.text]).catch(() => {});
    throw new Error(why.text);
  } catch (err) { gps.status = 'off'; gps.detail = err.message; paintGps(); gpsShow(); if (typeof renderHub === 'function' && view === 'hub') renderHub(); }
}

/** Bring the GPS box into sight: what the search says is of no use below the edge of the panel. */
function gpsShow() { const box = $('gps-box'); if (box && view === 'map' && box.offsetParent) box.scrollIntoView({ block: 'nearest' }); }

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
  // The port is closed by the reading that was going on: wait for that, so that it can be opened again at once.
  if (gps.listening) { await Promise.race([gps.listening, gpsWait(1500)]); gps.listening = null; }
  gps.port = null; gps.reader = null; gps.fix = null; gps.guide = null; gps.route = null; gps.shown = null; gps.glide.reset();
  if (typeof mapView !== 'undefined' && mapView && (mapView.getBearing() || mapView.getPadding().top)) mapView.easeTo({ bearing: 0, padding: GPS_FLAT, duration: 400 });
  if (typeof crumbsFlush === 'function') crumbsFlush();
  gps.progress = null;
  // Disconnected by the user: left alone until it is asked for, plugged in again, or the app is next started.
  if (!quiet) { gps.status = 'off'; gps.detail = ''; gps.paused = true; localStorage.removeItem('wikivault-gps-on'); }
  gpsDraw(); paintGps(); gpsBanner(null);
}

function gpsOnFix(fix) {
  const first = !(gps.fix && gps.fix.has) && fix.has;
  gps.fix = fix; gps.last = Date.now();
  gps.status = fix.has ? 'fix' : 'waiting';
  if (fix.has) {
    // The mark does not hop to each reading: it glides there, and the map with it (see gpsFrame).
    gps.glide.to({ lat: fix.lat, lon: fix.lon, course: fix.course, speed: fix.speed }, performance.now());
    if (first && mapView) {
      gps.easeUntil = performance.now() + 900;
      mapView.easeTo({ center: [fix.lon, fix.lat], ...(mapView.getZoom() < 12 ? { zoom: Math.min(15, mapView.getMaxZoom()) } : {}), duration: 800 });
    }
    if (!gps.raf) gps.raf = requestAnimationFrame(gpsFrame);
  } else { gps.shown = null; gps.glide.reset(); gpsDraw(); }
  if (fix.has) gpsGuide(fix);
  if (fix.has && typeof crumbsOnFix === 'function') crumbsOnFix(fix);
  paintGps();
}

/** How far down the map the mark sits when the map is turned to the way of travel: more of the road ahead is seen. */
const gpsAhead = () => ({ top: Math.round((mapView ? mapView.getContainer().clientHeight : 0) * 0.3), bottom: 0, left: 0, right: 0 });
const GPS_FLAT = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * One frame of the glide: the mark is drawn where it has got to and, when the map is following, the map is moved
 * (and turned, when it is kept the way of travel) to match. Runs only while the mark is on its way somewhere.
 */
function gpsFrame() {
  gps.raf = 0;
  if (gps.status !== 'fix' || !gps.fix || !gps.fix.has) return;
  const now = performance.now();
  const p = gps.glide.at(now);
  if (!p) return;
  gps.shown = p;
  gpsDraw();
  let zooming = false;
  // The map is left alone while the user has hold of it, and for a few seconds after.
  if (gps.follow && view === 'map' && mapView && now > gps.handsUntil && now > gps.easeUntil) {
    const cam = { center: [p.lon, p.lat] };
    if (gps.turn === 'heading' && p.bearing != null) { cam.bearing = p.bearing; cam.padding = gpsAhead(); }
    // While a route is followed the map is zoomed, a little each frame, to keep the next turn in view; not while the
    // user has set the zoom by hand, until they ask for it back.
    if (gps.autoZoom && !gps.zoomHeld && gps.zoomWant != null && gps.guide) {
      const z = mapView.getZoom(); const d = gps.zoomWant - z;
      // Eased by the time that has passed, so that it is as quick on any screen: most of the way in about a second.
      const dt = Math.min(120, Math.max(0, now - (gps.frameAt || now)));
      if (Math.abs(d) > 0.02) { cam.zoom = z + d * (1 - Math.exp(-(dt || 16) / 420)); zooming = true; }
    }
    const before = mapView.getZoom();
    mapView.jumpTo(cam, { glide: true });
    if (zooming && Math.abs(mapView.getZoom() - before) < 1e-5) zooming = false; // the map will go no further: do not keep asking
  }
  gps.frameAt = now;
  // Frames go on while the mark is moving, and while the map has not yet reached the zoom it is making for (standing
  // at a light, or just after auto-zoom was asked back).
  if (p.moving || zooming) gps.raf = requestAnimationFrame(gpsFrame); else gps.frameAt = 0;
}

/** Keep the map north up, or turned to the way of travel. */
function gpsTurnSet(mode) {
  gps.turn = mode === 'heading' ? 'heading' : 'north';
  localStorage.setItem('wikivault-gps-turn', gps.turn);
  if (mapView) {
    const p = gps.shown;
    gps.easeUntil = performance.now() + 650;
    if (gps.turn === 'north') mapView.easeTo({ bearing: 0, padding: GPS_FLAT, duration: 600 });
    else if (p && gps.follow) mapView.easeTo({ center: [p.lon, p.lat], ...(p.bearing != null ? { bearing: p.bearing } : {}), padding: gpsAhead(), duration: 600 });
    if (!gps.raf && gps.status === 'fix') gps.raf = requestAnimationFrame(gpsFrame);
  }
  paintGps();
}

/** A new route, or none: start following it afresh. */
function gpsRouteChanged() {
  const r = mapGo.route;
  if (r === gps.route) return;
  gps.route = r; gps.heard = {}; gps.arrived = false; gps.zoomHeld = false; gps.zoomWant = null;
  // A route worked out from the position starts at the nearest road. Until the car is on it, being that far away is not "off the route".
  gps.slack = r && r.coords && r.coords.length && mapGo.from && mapGo.from.gps && gps.fix && gps.fix.has ? WikivaultGuide.metres([gps.fix.lon, gps.fix.lat], r.coords[0]) + 40 : 0;
  gps.guide = r && r.coords && r.coords.length > 1 ? new WikivaultGuide.Guide(r) : null;
  if (!gps.guide) { gps.progress = null; gpsBanner(null); } else if (gps.fix && gps.fix.has) gpsGuide(gps.fix);
  paintGps(); // the panel on the map shows the trip, and a route can arrive between two positions
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
  gps.zoomWant = gpsZoomWanted(fix);
  const rest = `${tripMiles(u.remaining)} to go`;
  if (!u.next) { gpsBanner('Continue to the end of the route', rest); return; }
  gpsBanner(`In ${WikivaultGuide.said(u.next.meters)}: ${u.next.text}`, rest);
  // What is said: at once after a turn when the next is far off, then at a distance that grows with the speed.
  const words = WikivaultGuide.announce(u.next, fix.speed, gps.heard);
  if (words) gpsSay(words);
}

/** The zoom at which the next turn (or the end of the route) is in view ahead, or null when no route is followed. */
function gpsZoomWanted(fix) {
  const u = gps.progress;
  if (!gps.guide || !mapGo.route || !u || u.arrived || !mapView) return null;
  const box = mapView.getContainer();
  const ahead = gps.turn === 'heading' ? box.clientHeight * 0.62 : Math.min(box.clientWidth, box.clientHeight) * 0.45;
  return WikivaultGuide.zoomFor(u.next ? u.next.meters : u.remaining, fix.lat, ahead, fix.speed || 0, { min: Math.max(9.5, mapView.getMinZoom()), max: Math.min(17, mapView.getMaxZoom()) });
}
/** Take up zooming to the next turn again, after the user zoomed the map by hand. */
function gpsZoomResume() { gps.zoomHeld = false; gps.handsUntil = 0; /* asked back: the map is taken up at once */ paintGps(); if (!gps.raf && gps.status === 'fix') gps.raf = requestAnimationFrame(gpsFrame); }

/**
 * End the trip: the route and its guidance go, the GPS stays connected and the map keeps showing where you are.
 * The places chosen stay in the From and To boxes, so "Get directions" takes the trip up again.
 */
function gpsEndTrip() {
  if (!mapGo.route) return;
  mapGo.route = null; mapGo.alt = 0;
  paintMapGo(); mapDrawRoute();
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
  // While the user has hold of the map (dragging it, zooming it) the following waits, and for a few seconds after.
  const hands = (e) => { if (!e || e.originalEvent) gps.handsUntil = performance.now() + 4000; };
  for (const ev of ['mousedown', 'touchstart', 'wheel', 'drag', 'zoom']) map.on(ev, hands);
  // Zooming by hand (the wheel, a pinch, the + and - buttons, a double click) keeps the zoom where it was put.
  const zoomed = (e) => { if (e && e.originalEvent && gps.guide && gps.autoZoom && !gps.zoomHeld) { gps.zoomHeld = true; paintGps(); } };
  map.on('zoomstart', zoomed); map.on('wheel', zoomed);
  // The mark when the map is turned to the way of travel: an arrow, pointing the way the car is going.
  if (!map.hasImage('gps-arrow')) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.beginPath(); g.moveTo(32, 5); g.lineTo(55, 57); g.lineTo(32, 45); g.lineTo(9, 57); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.stroke(); g.fillStyle = '#1a73e8'; g.fill();
    map.addImage('gps-arrow', g.getImageData(0, 0, 64, 64), { pixelRatio: 2 });
  }
  map.setFilter('gps-dot', ['!=', ['get', 'arrow'], true]);
  map.addLayer({ id: 'gps-arrow', type: 'symbol', source: 'gps', filter: ['==', ['get', 'arrow'], true], layout: { 'icon-image': 'gps-arrow', 'icon-size': 1.15, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  gpsDraw();
}
function gpsDraw() {
  if (typeof mapView === 'undefined' || !mapView || !mapView.getSource('gps')) return;
  const f = gps.fix; const at = f && f.has ? gps.shown || f : null;
  const arrow = Boolean(at && gps.turn === 'heading' && gps.shown && gps.shown.bearing != null);
  mapView.getSource('gps').setData({ type: 'FeatureCollection', features: at ? [{ type: 'Feature', properties: { arrow, bearing: arrow ? gps.shown.bearing : 0 }, geometry: { type: 'Point', coordinates: [at.lon, at.lat] } }] : [] });
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
  const f = gps.fix; const on = gps.status === 'waiting' || gps.status === 'fix';
  const known = gpsKnown();
  let text = known ? (gps.paused ? 'Disconnected. It connects again when you press the button, plug it in again, or next start Wikivault.' : 'Set up. The receiver is not plugged in at the moment: it is picked up by itself when it is.') : 'Not connected. Plug in a USB GPS receiver and press the button.';
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
  $('gps-find').textContent = known ? 'Look for my GPS receiver now' : 'Find my GPS receiver';
  paintGpsPanel(text);
}

$('gps-find').addEventListener('click', () => gpsFind());
$('gps-off').addEventListener('click', () => gpsOff(false));
$('gps-from').addEventListener('click', () => { const p = gpsPoint(); if (p) { mapGo.tab = 'go'; mapSetPoint('from', p); } });
$('gps-follow').addEventListener('change', () => { gps.follow = $('gps-follow').checked; localStorage.setItem('wikivault-gps-follow', gps.follow ? '1' : '0'); if (!gps.follow && mapView && (mapView.getBearing() || mapView.getPadding().top)) mapView.easeTo({ bearing: 0, padding: GPS_FLAT, duration: 400 }); else if (gps.follow && !gps.raf && gps.status === 'fix') gps.raf = requestAnimationFrame(gpsFrame); paintGps(); });
$('gps-speak').addEventListener('change', () => { gps.speak = $('gps-speak').checked; localStorage.setItem('wikivault-gps-speak', gps.speak ? '1' : '0'); if (gps.speak) gpsSay('Turns will be spoken.'); });

// Once a receiver has been set up it is connected by itself: when the app starts, when it is plugged in, and
// (looked at every few seconds, in case the plugging-in went unannounced) whenever it is seen and not in use.
async function gpsAuto(now) {
  if (gps.paused || !(gps.status === 'off' || gps.status === 'lost') || !navigator.serial || typeof state === 'undefined' || !state || state.gpsFake) return;
  const known = gpsKnown();
  // Connected with an earlier version, which kept no note of the receiver: looked for once, and noted when found.
  const legacy = !known && !gps.legacyTried && localStorage.getItem('wikivault-gps-on') === '1';
  if (!known && !legacy) return;
  if (!now && gps.autoAfter && Date.now() < gps.autoAfter) return;
  try {
    const mine = (p) => (known ? gpsIsKnown(p, known) : Boolean(p.getInfo().usbVendorId));
    let ports = await navigator.serial.getPorts();
    // Where the ports are not shown without a click, the main process makes the request as if there had been one.
    if (!ports.some(mine)) { await api.gpsGesture(); ports = gps.asked || []; }
    if (legacy) gps.legacyTried = true;
    if (gps.status === 'searching' || gps.status === 'waiting' || gps.status === 'fix') return; // the button was pressed meanwhile
    if (ports.some(mine)) await gpsFind({ quiet: true, given: ports });
  } catch { /* looked at again shortly */ }
}
if (navigator.serial) {
  // Plugged in: Windows needs a moment to finish with it. This also ends a "Disconnect", which was about the last time it was in.
  navigator.serial.addEventListener('connect', () => { gps.paused = false; gps.autoAfter = 0; setTimeout(() => gpsAuto(true), 1500); });
  setTimeout(() => gpsAuto(true), 2500);
  setInterval(() => gpsAuto(false), 8000);
}

// The GPS panel on the map: the key's twin in the other bottom corner. Folded, it is a button that says whether a
// receiver is connected; open, it shows what the receiver reports, the trip when one is followed, and the controls.
const gpsPanelOpen = () => { try { return localStorage.getItem('wikivault-map-gps') === 'open'; } catch { return false; } };
function paintGpsPanel(text) {
  const box = $('map-gps');
  if (!box) return;
  const m = state && state.maps;
  box.hidden = !(m && m.map);
  if (box.hidden) return;
  // While the map is waiting for a click, the panel folds away so that it is never what is clicked.
  const waiting = Boolean(mapGo.picking || (typeof bookUi === 'object' && bookUi.picking));
  const open = gpsPanelOpen() && !waiting;
  box.classList.toggle('folded', !open);
  box.classList.toggle('dark', Boolean(mapLook.dark));
  box.dataset.state = gps.status;
  const label = WikivaultGpsFacts.LABELS[gps.status] || WikivaultGpsFacts.LABELS.off;
  const f = gps.fix; const on = gps.status === 'waiting' || gps.status === 'fix';
  const v = gps.status === 'fix' && f ? WikivaultGpsFacts.mph(f.speed) : null;
  // Folded, with a position: the speed rides along, which is the one number worth a glance while driving.
  $('map-gps-pill-text').textContent = v != null ? `${label} · ${v} mph` : label;
  $('map-gps-pill').setAttribute('aria-expanded', String(open));
  $('map-gps-title').textContent = label;
  $('map-gps-body').hidden = !open;
  if (!open) return;
  $('map-gps-status').textContent = gps.status === 'fix' ? '' : text || '';
  $('map-gps-status').hidden = gps.status === 'fix';
  const rows = WikivaultGpsFacts.facts({ fix: on ? f : null, info: on ? gps.info : null, progress: gps.guide && mapGo.route ? gps.progress : null, route: mapGo.route, said: WikivaultGuide.said });
  $('map-gps-facts').replaceChildren(...rows.flatMap((r) => (r.sep ? [el('div', 'sep')] : [el('dt', '', r.name), el('dd', r.big ? 'big' : '', r.value)])));
  $('map-gps-find').hidden = on; $('map-gps-find').disabled = gps.status === 'searching';
  $('map-gps-find').textContent = gpsKnown() ? 'Look for my GPS receiver now' : 'Find my GPS receiver';
  $('map-gps-off').hidden = !on;
  $('map-gps-from').hidden = gps.status !== 'fix'; $('map-gps-centre').hidden = gps.status !== 'fix';
  $('map-gps-end').hidden = !(on && gps.guide && mapGo.route);
  $('map-gps-follow-row').hidden = !on; $('map-gps-speak-row').hidden = !on;
  $('map-gps-follow').checked = gps.follow; $('map-gps-speak').checked = gps.speak;
  const guiding = Boolean(on && gps.guide && mapGo.route);
  $('map-gps-zoom-row').hidden = !on; $('map-gps-zoom').checked = gps.autoZoom;
  $('map-gps-zoom-resume').hidden = !(guiding && gps.autoZoom && gps.zoomHeld); $('map-guide-zoom').hidden = $('map-gps-zoom-resume').hidden;
  if (typeof mapRouteLabel === 'function') mapRouteLabel();
  $('map-gps-turn-row').hidden = !on;
  $('map-gps-turn-north').setAttribute('aria-pressed', String(gps.turn === 'north')); $('map-gps-turn-heading').setAttribute('aria-pressed', String(gps.turn === 'heading'));
  $('map-gps-turn-note').textContent = gps.turn === 'heading' && !gps.follow ? 'Tick "Keep the map on my position" for the map to turn.' : '';
  if (typeof paintCrumbsPanel === 'function') paintCrumbsPanel();
}
const gpsPanelSet = (open) => { try { localStorage.setItem('wikivault-map-gps', open ? 'open' : 'closed'); } catch { /* not kept, that is all */ } paintGps(); };
$('map-gps-pill').addEventListener('click', () => gpsPanelSet(true));
$('map-gps-hide').addEventListener('click', () => gpsPanelSet(false));
$('map-gps-find').addEventListener('click', () => gpsFind());
$('map-gps-off').addEventListener('click', () => gpsOff(false));
$('map-gps-from').addEventListener('click', () => $('gps-from').click());
$('map-gps-end').addEventListener('click', gpsEndTrip);
$('map-guide-end').addEventListener('click', gpsEndTrip);
$('map-gps-centre').addEventListener('click', () => { const p = gpsPoint(); if (p && mapView) mapView.easeTo({ center: [p.lon, p.lat], zoom: Math.max(mapView.getZoom(), Math.min(15, mapView.getMaxZoom())), duration: 600 }); });
$('map-gps-turn-north').addEventListener('click', () => gpsTurnSet('north'));
$('map-gps-turn-heading').addEventListener('click', () => gpsTurnSet('heading'));
$('map-gps-zoom').addEventListener('change', () => { gps.autoZoom = $('map-gps-zoom').checked; localStorage.setItem('wikivault-gps-autozoom', gps.autoZoom ? '1' : '0'); gps.zoomHeld = false; paintGps(); });
$('map-gps-zoom-resume').addEventListener('click', gpsZoomResume);
$('map-guide-zoom').addEventListener('click', gpsZoomResume);
$('map-gps-follow').addEventListener('change', () => { $('gps-follow').checked = $('map-gps-follow').checked; $('gps-follow').dispatchEvent(new Event('change')); });
$('map-gps-speak').addEventListener('change', () => { $('gps-speak').checked = $('map-gps-speak').checked; $('gps-speak').dispatchEvent(new Event('change')); });

api.onGpsPorts((list) => { gps.ports = list; });

$('gps-buy-link').addEventListener('click', () => { const buy = gpsBuy(); if (buy) api.openExternal(buy.url); });
