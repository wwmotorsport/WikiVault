'use strict';
const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/core/catalog');
const { startDownloadServer } = require('./helpers');
const { pdfFromJpegs, jpegInfo, byName } = require('../src/core/jpeg-pdf');

test('a library that is not a Wikimedia project is found by the start of its file name, in the folder it is kept in', async () => {
  const srv = await startDownloadServer();
  try {
    srv.addCopy('outdoors.stackexchange.com_en_all_2026-09.zim', 'wikipedia_en_all_maxi_2026-10.zim');
    srv.addCopy('outdoors.stackexchange.com_en_all_2026-10.zim', 'wikipedia_en_all_maxi_2026-10.zim');
    srv.addCopy('diy.stackexchange.com_en_all_2026-10.zim', 'wikipedia_en_all_maxi_2026-10.zim');
    srv.addCopy('irp.fas.org_en_military-medicine_2026-10.zim', 'wikipedia_en_all_maxi_2026-10.zim');
    srv.addCopy('appropedia_en_all_maxi_2026-02.zim', 'wikipedia_en_all_maxi_2026-10.zim');
    const a = await catalog.findLatestEdition({ baseUrl: srv.baseUrl, project: 'outdoors', folder: 'stack_exchange', prefix: 'outdoors.stackexchange.com_en_all_' });
    assert.deepStrictEqual([a.file, a.date, a.url], ['outdoors.stackexchange.com_en_all_2026-10.zim', '2026-10', `${srv.baseUrl}/zim/stack_exchange/outdoors.stackexchange.com_en_all_2026-10.zim`]);
    const b = await catalog.findLatestEdition({ baseUrl: srv.baseUrl, project: 'milmed', folder: 'zimit', prefix: 'irp.fas.org_en_military-medicine_' });
    assert.strictEqual(b.file, 'irp.fas.org_en_military-medicine_2026-10.zim');
    const c = await catalog.findLatestEdition({ baseUrl: srv.baseUrl, project: 'appropedia', folder: 'other' });
    assert.strictEqual(c.url, `${srv.baseUrl}/zim/other/appropedia_en_all_maxi_2026-02.zim`);
    assert.ok((await catalog.fetchRemoteSize(a.url)) > 1000);
  } finally { await srv.close(); }
});

test('page pictures are made into a PDF, one to a page, turned the way the camera says', async () => {
  // Two tiny JPEGs: a grey page standing up, and a colour one taken with the camera on its side.
  const grey = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//wAALCABQADwBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APTqKKKKKKKKxIo72/1LUwNXu7aO3uFijjhSEgDyY3/ijY5y571Y/su9/wChg1L/AL923/xqj+y73/oYNS/7923/AMao/su9/wChg1L/AL923/xqj+y73/oYNS/7923/AMao0V7jztSt7m7luvs10I0klVA20wxvg7VA6se1adFZmk/8hHW/+v1f/SeGtOiiiszSf+Qjrf8A1+r/AOk8NadFYVvfR6fqmrrcwX3726WRGisppVZfIiXIZVI6qR+FWv7esv8AnjqX/gsuf/iKP7esv+eOpf8Agsuf/iKP7esv+eOpf+Cy5/8AiKP7esv+eOpf+Cy5/wDiKZoTma41a4EU8cc14Gj86F4iwEES52sAcZUjp2rWoooooooooooooooooooooooooooooooooooooooooooooooor//Z', 'base64');
  const info = jpegInfo(grey);
  assert.deepStrictEqual(info && [info.w, info.h, info.components, info.rotate], [60, 80, 1, 0]);
  assert.strictEqual(jpegInfo(Buffer.from('not a picture')), null);
  const made = pdfFromJpegs([grey, Buffer.from('not a picture'), grey]);
  assert.deepStrictEqual([made.pages, made.left], [2, 1]);
  assert.strictEqual(made.pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  const warn = console.warn; const lg = console.log; console.warn = () => {}; console.log = () => {};
  const pdfjs = require('../src/vendor/pdfjs/pdf.js'); globalThis.pdfjsWorker = require('../src/vendor/pdfjs/pdf.worker.js');
  console.warn = warn; console.log = lg;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(made.pdf), isEvalSupported: false, verbosity: 0 }).promise;
  assert.strictEqual(doc.numPages, 2);
  const page = await doc.getPage(1);
  const view = page.getViewport({ scale: 1 });
  assert.deepStrictEqual([Math.round(view.width), Math.round(view.height), page.rotate], [612, 816, 0]);
  const ops = await page.getOperatorList();
  assert.ok(ops.fnArray.includes(pdfjs.OPS.paintImageXObject));
  await doc.destroy();
  assert.deepStrictEqual(['page 10.jpg', 'Page 2.jpg', 'page 1.jpg'].sort(byName), ['page 1.jpg', 'Page 2.jpg', 'page 10.jpg']);
});
