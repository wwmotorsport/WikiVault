'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDrive, speedTest, verdict, existing } = require('../src/core/drive-check');

test('what Windows says of a drive is read whether it prints words or numbers', () => {
  assert.deepStrictEqual(readDrive('{"bus":"USB","model":"Acme Portable SSD","fs":"exFAT","type":"Fixed"}'), { bus: 'USB', model: 'Acme Portable SSD', fs: 'exFAT', external: true, network: false });
  assert.strictEqual(readDrive('{"bus":"7","model":"","fs":"NTFS","type":"3"}').external, true);
  assert.strictEqual(readDrive('{"bus":"NVMe","model":"Inside","fs":"NTFS","type":"Fixed"}').external, false);
  assert.strictEqual(readDrive('{"bus":"","model":"","fs":"FAT32","type":"Removable"}').external, true); // a card reader that names no bus
  assert.strictEqual(readDrive('{"bus":"","fs":"NTFS","type":"Network"}').network, true);
  assert.strictEqual(readDrive('not json'), null);
});

test('the verdict on a drive: unusable, poor, fair or good, with what to look for instead', () => {
  const usb = { bus: 'USB', fs: 'exFAT', external: true };
  assert.strictEqual(verdict({ ...usb, fs: 'FAT32' }, { writeMBs: 300, syncMs: 1 }).level, 'unusable');
  assert.match(verdict({ ...usb, fs: 'FAT32' }, null).title, /cannot hold a file larger than 4 GB/);
  const slow = verdict(usb, { writeMBs: 8.4, syncMs: 60 });
  assert.strictEqual(slow.level, 'poor');
  assert.match(slow.title, /about 8\.4 MB a second, which is too slow/);
  assert.ok(slow.lines.some((l) => /portable SSD/.test(l)) && slow.lines.some((l) => /blue or USB-C port/.test(l)));
  assert.strictEqual(verdict(usb, { writeMBs: 60, syncMs: 3 }).level, 'fair');
  const disk = verdict(usb, { writeMBs: 130, syncMs: 40 }); // a spinning disk: quick to fill, slow to answer
  assert.strictEqual(disk.level, 'fair');
  assert.match(disk.title, /slow to answer small requests/);
  const good = verdict(usb, { writeMBs: 412.6, syncMs: 1.2 });
  assert.deepStrictEqual([good.level, /about 413 MB a second/.test(good.title)], ['good', true]);
  assert.strictEqual(verdict({ network: true }, null).level, 'poor');
});

test('the drive is timed by writing to it, in the nearest folder that exists, and the test file is removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-drive-'));
  try {
    const target = path.join(dir, 'not', 'made', 'yet');
    assert.strictEqual(existing(target), dir);
    const r = await speedTest(target, { bytes: 8 * 1024 * 1024, small: 4 });
    assert.ok(r.writeMBs > 0 && r.syncMs >= 0 && r.bytes === 8 * 1024 * 1024, JSON.stringify(r));
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
