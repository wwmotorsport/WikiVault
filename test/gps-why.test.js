'use strict';
// Why a GPS receiver was not found: what the search tried, and what Windows says about its ports, put into
// words the user can act on. Also that receivers which name their sentences $GN (several satellite systems)
// are read like those that say $GP.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/renderer/gps-why');
const N = require('../src/renderer/nmea');

const bt = (n) => ({ Name: `Standard Serial over Bluetooth link (COM${n})`, DeviceID: `BTHENUM\\{00001101-0000-1000-8000-00805F9B34FB}_LOCALMFG&0000\\7&1&0&00000000000${n}_C0000000`, PNPClass: 'Ports', ConfigManagerErrorCode: 0 });
const quiet = (speeds, how = 'silent', bytes = 0) => speeds.map((speed) => ({ speed, how, bytes }));

test('what Windows says about its ports is read into ports and devices without a driver', () => {
  const hw = W.readHardware([
    bt(3), bt(4),
    { Name: 'Prolific USB-to-Serial Comm Port (COM7)', DeviceID: 'USB\\VID_067B&PID_23A3\\5&2C0B1F5&0&2', PNPClass: 'Ports', ConfigManagerErrorCode: 0 },
    { Name: 'USB-Serial Controller', DeviceID: 'USB\\VID_067B&PID_2303\\5&2C0B1F5&0&3', PNPClass: null, ConfigManagerErrorCode: 28 },
    { Name: 'Some Hub', DeviceID: 'USB\\ROOT_HUB30\\4&1', PNPClass: 'USB', ConfigManagerErrorCode: 0 },
    { Name: 'Printer Port (LPT1)', DeviceID: 'ACPI\\PNP0400\\1', PNPClass: 'Ports', ConfigManagerErrorCode: 0 },
    null, 'nonsense',
  ]);
  assert.deepEqual(hw.ports.map((p) => [p.com, p.vid, p.pid, p.bluetooth, p.ok]), [['COM3', '', '', true, true], ['COM4', '', '', true, true], ['COM7', '067B', '23A3', false, true]]);
  assert.deepEqual(hw.unready, [{ name: 'USB-Serial Controller', vid: '067B', pid: '2303', code: 28 }]);
  // One row alone, as PowerShell gives it for a single device, and nothing at all.
  assert.equal(W.readHardware(bt(5)).ports.length, 1);
  assert.deepEqual(W.readHardware(null), { ports: [], unready: [] });
});

test('a receiver Windows has no driver for is told from one that is not plugged in', () => {
  const five = [3, 4, 5, 6, 8].map(() => ({ vid: 0, pid: 0, results: quiet([4800, 9600, 38400, 115200]) }));
  // Bluetooth ports only, and a USB serial chip with no driver: that is the receiver.
  const noDriver = W.explain({ tried: five, hardware: W.readHardware([bt(3), bt(4), bt(5), bt(6), bt(8), { Name: 'USB-Serial Controller', DeviceID: 'USB\\VID_067B&PID_23A3\\1', ConfigManagerErrorCode: 28 }]) });
  assert.match(noDriver.text, /^5 serial ports were found \(COM3, COM4, COM5, COM6 and COM8\), but none of them is a USB device: they belong to Bluetooth or to the computer itself\. So the receiver has no port of its own yet\. Windows can see a USB device that it has no working driver for \(USB-Serial Controller, a Prolific serial chip\)\. That is most likely the receiver\. Install the USB driver/);
  assert.ok(noDriver.lines.some((l) => /^Windows has no working driver for: USB-Serial Controller \[USB 067B:23A3, Prolific\] \(code 28\)$/.test(l)));
  assert.ok(noDriver.lines.some((l) => /^port 1 of 5 \[not USB\]: 4800 silent, 9600 silent, 38400 silent, 115200 silent$/.test(l)));
  // The same ports and nothing waiting for a driver: it is not plugged in, or Windows has not noticed it.
  const absent = W.explain({ tried: five, hardware: W.readHardware([bt(3), bt(4), bt(5), bt(6), bt(8)]) });
  assert.match(absent.text, /none of them is a USB device.*Check that it is plugged in and its light is on\. If it is, Windows has not set it up: open Device Manager/);
  assert.doesNotMatch(absent.text, /most likely the receiver/);
  // Windows could not be asked: the search's own account still says the ports are not USB.
  assert.match(W.explain({ tried: five.slice(0, 1), hardware: null }).text, /^One serial port was found, but it is not a USB device: it belongs to Bluetooth/);
  // No port at all.
  assert.match(W.explain({ tried: [], hardware: W.readHardware([{ Name: 'USB-Serial Controller', DeviceID: 'USB\\VID_067B&PID_23A3\\1', ConfigManagerErrorCode: 28 }]) }).text, /^No serial port was found\. Windows can see a USB device that it has no working driver for/);
  assert.match(W.explain({ tried: [] }).text, /^No serial port was found\. Plug the receiver in/);
});

test('a receiver that has a port says what the port did', () => {
  const hardware = W.readHardware([bt(3), { Name: 'Prolific USB-to-Serial Comm Port (COM7)', DeviceID: 'USB\\VID_067B&PID_23A3\\1', PNPClass: 'Ports', ConfigManagerErrorCode: 0 }]);
  const all = [4800, 9600, 38400, 115200, 19200, 57600];
  const say = (results) => W.explain({ tried: [{ vid: 0x067b, pid: 0x23a3, results }, { vid: 0, pid: 0, results: quiet([4800]) }], hardware });
  assert.match(say(quiet(all)).text, /^The receiver's port was found \(Prolific USB-to-Serial Comm Port \(COM7\)\) and it opened, but nothing came from it\./);
  assert.match(say(quiet(all, 'noise', 512)).text, /it is sending something, but not GPS sentences the app can read/);
  assert.match(say(quiet(all.slice(0, 2), 'refused')).text, /but it could not be opened\. Another program may be using it/);
  assert.match(say(quiet(all.slice(0, 1), 'slow')).text, /but it did not answer when it was opened/);
  assert.ok(say(quiet(all, 'noise', 512)).lines.some((l) => l === 'port 1 of 2 [USB 067B:23A3]: 4800 noise (512 bytes), 9600 noise (512 bytes), 38400 noise (512 bytes), 115200 noise (512 bytes), 19200 noise (512 bytes), 57600 noise (512 bytes)'));
  // A USB port Windows was not asked about still gets a name of a kind.
  assert.match(W.explain({ tried: [{ vid: 0x067b, pid: 0x23a3, results: quiet(all) }], hardware: null }).text, /\(a USB serial port \(Prolific\)\)/);
});

test('sentences from a receiver that uses several satellite systems ($GN) give a position', () => {
  const sum = (s) => { let c = 0; for (const ch of s) c ^= ch.charCodeAt(0); return `$${s}*${c.toString(16).toUpperCase().padStart(2, '0')}`; };
  const fixes = [];
  const r = new N.Reader((f) => fixes.push(f));
  r.push(`${sum('GNGGA,123519,4042.7680,N,07400.3600,W,1,12,0.8,10.0,M,-34.0,M,,')}\r\n${sum('GNGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.2,0.8,0.9')}\r\n${sum('GNRMC,123519,A,4042.7680,N,07400.3600,W,0.0,0.0,221126,,,A')}\r\n${sum('GLGSV,1,1,00')}\r\n`);
  assert.equal(r.sentences, 4);
  const last = fixes[fixes.length - 1];
  assert.equal(last.has, true);
  assert.ok(Math.abs(last.lat - 40.7128) < 1e-4 && Math.abs(last.lon + 74.006) < 1e-4);
  assert.equal(last.sats, 12);
});
