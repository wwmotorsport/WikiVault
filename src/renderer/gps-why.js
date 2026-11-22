'use strict';
// GPS: saying why a receiver was not found. The search knows which ports it tried and what each did; Windows
// knows which devices it has set up and which it has no driver for. Put together, they tell a missing driver
// from an unplugged receiver from a port that is there and silent.
// Used in the window (as a script) and in the tests (as a module). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WikivaultGpsWhy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // The makers of the chips that turn USB into a serial port, by USB vendor number.
  const MAKERS = { '067B': 'Prolific', '0403': 'FTDI', '10C4': 'Silicon Labs', '1A86': 'QinHeng (CH340)', 1546: 'u-blox', '0E8D': 'MediaTek', '1199': 'Sierra Wireless' };
  const hex = (n) => (n == null || n === '' ? '' : (typeof n === 'number' ? n.toString(16) : String(n)).toUpperCase().padStart(4, '0'));
  const DRIVER = 'Install the USB driver from the receiver\'s maker (for a GlobalSat receiver it is on the support page of globalsat.com.tw, under the receiver\'s model), then unplug the receiver, plug it in again and press the button.';

  /**
   * What Windows says about its ports and its troubled USB devices, read from the rows the app asks it for
   * (Win32_PnPEntity: Name, DeviceID, PNPClass, ConfigManagerErrorCode). Returns
   * { ports: [{ name, com, vid, pid, bluetooth, ok }], unready: [{ name, vid, pid, code }] }.
   */
  function readHardware(rows) {
    const out = { ports: [], unready: [] };
    for (const r of Array.isArray(rows) ? rows : rows ? [rows] : []) {
      if (!r || typeof r !== 'object') continue;
      const id = String(r.DeviceID || ''); const name = String(r.Name || '').trim() || 'A device with no name';
      const usb = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(id) || /VID_([0-9A-F]{4})[&+]PID_([0-9A-F]{4})/i.exec(id);
      const vid = usb ? usb[1].toUpperCase() : ''; const pid = usb ? usb[2].toUpperCase() : '';
      const code = Number(r.ConfigManagerErrorCode) || 0;
      const com = (/\((COM\d+)\)/i.exec(name) || [])[1] || '';
      if (String(r.PNPClass || '') === 'Ports' && com) out.ports.push({ name, com: com.toUpperCase(), vid, pid, bluetooth: /^BTHENUM/i.test(id) || /bluetooth/i.test(name), ok: code === 0 });
      else if (/^USB\\/i.test(id) && code !== 0) out.unready.push({ name, vid, pid, code });
    }
    return out;
  }

  const list = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
  const count = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

  /**
   * Why no receiver was found, in words for the user, and lines for the log.
   * `tried` is what the search did: [{ vid, pid, results: [{ speed, how, bytes }] }] where how is 'refused'
   * (would not open), 'slow' (did not answer in time), 'silent' (opened and sent nothing), 'noise' (sent
   * something that is not GPS sentences). `hardware` is readHardware()'s result, or null when Windows was not asked.
   */
  function explain({ tried = [], hardware = null } = {}) {
    const hw = hardware || { ports: [], unready: [] };
    const lines = [];
    for (const p of hw.ports) lines.push(`Windows port: ${p.name}${p.vid ? ` [USB ${p.vid}:${p.pid}${MAKERS[p.vid] ? `, ${MAKERS[p.vid]}` : ''}]` : p.bluetooth ? ' [Bluetooth]' : ''}${p.ok ? '' : ' [not working]'}`);
    for (const d of hw.unready) lines.push(`Windows has no working driver for: ${d.name}${d.vid ? ` [USB ${d.vid}:${d.pid}${MAKERS[d.vid] ? `, ${MAKERS[d.vid]}` : ''}]` : ''} (code ${d.code})`);
    tried.forEach((t, i) => lines.push(`port ${i + 1} of ${tried.length}${t.vid ? ` [USB ${hex(t.vid)}:${hex(t.pid)}]` : ' [not USB]'}: ${t.results.map((r) => `${r.speed} ${r.how}${r.bytes ? ` (${r.bytes} bytes)` : ''}`).join(', ') || 'not tried'}`));

    // A USB device Windows could not set up is the receiver more often than not: a serial chip's maker settles it.
    const stuck = hw.unready.filter((d) => MAKERS[d.vid]).concat(hw.unready.filter((d) => !MAKERS[d.vid]));
    const stuckText = stuck.length ? `Windows can see a USB device that it has no working driver for (${stuck[0].name}${MAKERS[stuck[0].vid] ? `, a ${MAKERS[stuck[0].vid]} serial chip` : ''}). That is most likely the receiver. ${DRIVER}` : '';
    const usb = tried.filter((t) => t.vid);
    let text;
    if (!tried.length) {
      text = stuckText ? `No serial port was found. ${stuckText}` : 'No serial port was found. Plug the receiver in, wait for Windows to finish setting it up, and press the button again. If nothing changes, Windows needs the receiver\'s driver: it is on the maker\'s support page.';
    } else if (!usb.length) {
      const names = hw.ports.filter((p) => !p.vid).map((p) => p.com).filter(Boolean);
      text = `${count(tried.length, 'One serial port was', 'serial ports were')} found${names.length ? ` (${list(names.slice(0, 6))})` : ''}, but ${tried.length === 1 ? 'it is not' : 'none of them is'} a USB device: ${tried.length === 1 ? 'it belongs' : 'they belong'} to Bluetooth or to the computer itself. So the receiver has no port of its own yet. `
        + (stuckText || 'Check that it is plugged in and its light is on. If it is, Windows has not set it up: open Device Manager, look for a device with a yellow warning mark, and install the driver from the receiver\'s maker. Then unplug it, plug it in again and press the button.');
    } else {
      const t = usb[0];
      const known = hw.ports.find((p) => p.vid === hex(t.vid) && p.pid === hex(t.pid));
      const name = known ? known.name : `a USB serial port${MAKERS[hex(t.vid)] ? ` (${MAKERS[hex(t.vid)]})` : ''}`;
      const hows = new Set(t.results.map((r) => r.how));
      if (hows.has('noise')) text = `The receiver's port was found (${name}) and it is sending something, but not GPS sentences the app can read at any of the usual speeds. The receiver may be set to a mode of its maker's own. Unplug it, plug it in again and press the button; if that changes nothing, please report it.`;
      else if (hows.has('silent')) text = `The receiver's port was found (${name}) and it opened, but nothing came from it. Check that the receiver's light is on, unplug it, plug it in again and press the button. If it stays silent, the driver Windows chose may be the wrong one for it: install the one from the receiver's maker.`;
      else if (hows.has('slow') && !hows.has('refused')) text = `The receiver's port was found (${name}), but it did not answer when it was opened. Unplug the receiver, plug it in again and press the button.`;
      else text = `The receiver's port was found (${name}), but it could not be opened. Another program may be using it (close any other GPS or mapping program), or its driver is not working: install the one from the receiver's maker, then unplug the receiver and plug it in again.`;
    }
    return { text, lines };
  }

  return { readHardware, explain, MAKERS };
});
