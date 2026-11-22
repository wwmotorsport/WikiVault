'use strict';
// GPS: what the panel on the map shows about the receiver and the trip, as rows of a name and a value.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultGpsFacts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WINDS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];
  const MAKERS = { 0x067b: 'Prolific', 0x0403: 'FTDI', 0x10c4: 'Silicon Labs', 0x1a86: 'QinHeng', 0x1546: 'u-blox', 0x0e8d: 'MediaTek' };
  const miles = (m) => (m < 160 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} feet` : m < 16093 ? `${(m / 1609.344).toFixed(1)} miles` : `${Math.round(m / 1609.344)} miles`);
  /** The way something is heading, in words and degrees: "North-east (48°)". */
  function heading(deg) { const d = ((Number(deg) % 360) + 360) % 360; return `${WINDS[Math.round(d / 45) % 8]} (${Math.round(d)}°)`; }
  /** Metres a second as miles an hour. Below walking pace a receiver's speed is noise, and reads as standing still. */
  function mph(ms) { return ms == null ? null : ms < 0.8 ? 0 : Math.round(ms * 2.23694); }

  /** The words on the folded button and at the head of the panel, by the receiver's state. */
  const LABELS = { fix: 'GPS: connected', waiting: 'GPS: connected, no position yet', searching: 'GPS: looking for the receiver', lost: 'GPS: receiver lost', off: 'GPS: not connected' };

  /**
   * The rows: [{ name, value, big? }] and { sep: true } between the trip and the receiver.
   * `fix` is the reader's latest ({ has, lat, lon, speed, course, sats, accuracy, alt, time }), `info` what is known
   * of the port ({ speed, usbVendorId }), `progress` the guide's latest when a route is followed ({ remaining,
   * next: { meters, text }, arrived, off }), `route` the route ({ meters, seconds }), `now` the clock in ms,
   * `clock(ms)` a time of day in words and `said(m)` a distance as it is spoken.
   */
  function facts({ fix = null, info = null, progress = null, route = null, now = Date.now(), clock = (ms) => new Date(ms).toLocaleTimeString(), said = miles } = {}) {
    const rows = [];
    const has = Boolean(fix && fix.has);
    if (has && progress && route && route.meters > 0) {
      if (progress.arrived) rows.push({ name: 'Trip', value: 'You have arrived' });
      else if (progress.off) rows.push({ name: 'Trip', value: 'Off the route: a new one is being worked out' });
      else {
        rows.push({ name: 'Next turn', value: progress.next ? `In ${said(progress.next.meters)}: ${progress.next.text}` : 'Continue to the end of the route' });
        rows.push({ name: 'To go', value: miles(progress.remaining) });
        if (route.seconds > 0) rows.push({ name: 'Arriving about', value: clock(now + 1000 * route.seconds * Math.min(1, Math.max(0, progress.remaining / route.meters))) });
      }
      rows.push({ sep: true });
    }
    if (has) {
      const v = mph(fix.speed);
      rows.push({ name: 'Speed', value: v == null ? 'Not reported' : `${v} mph`, big: true });
      if (v && fix.course != null) rows.push({ name: 'Heading', value: heading(fix.course) });
      rows.push({ name: 'Position', value: `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` });
      rows.push({ name: 'Good to about', value: `${Math.round((fix.accuracy || 10) * 3.28084)} feet` });
      if (fix.alt != null) rows.push({ name: 'Height', value: `${Math.round(fix.alt * 3.28084).toLocaleString('en-US')} feet above sea level` });
    }
    if (fix && fix.sats != null) rows.push({ name: 'Satellites', value: has ? `${fix.sats} in use` : `${fix.sats} in view so far` });
    if (fix && fix.time != null) rows.push({ name: 'Satellite time', value: clock(fix.time) });
    if (info && info.speed) rows.push({ name: 'Receiver', value: `${info.usbVendorId ? `USB${MAKERS[info.usbVendorId] ? ` (${MAKERS[info.usbVendorId]})` : ''}` : 'Serial port'}, ${info.speed} baud` });
    return rows;
  }

  return { facts, heading, mph, LABELS };
});
