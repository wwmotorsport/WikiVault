'use strict';
// Downloads go through Node's own http, where a dropped connection is an error to retry, not a crash.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetchLike } = require('../src/core/httpx');
const { MapsLibrary } = require('../src/core/maps-library');

const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => { s.closeAllConnections(); s.close(r); }) })); });

test('answers are read as json, text, bytes and headers; a redirect is followed', async () => {
  const site = await listen((req, res) => {
    if (req.url === '/moved') { res.writeHead(302, { location: '/j' }); return res.end(); }
    if (req.url === '/j') { res.writeHead(200, { 'content-type': 'application/json', etag: '"e1"' }); return res.end('{"a":1}'); }
    if (req.url === '/echo') { let b = ''; req.on('data', (c) => { b += c; }); return req.on('end', () => { res.writeHead(200); res.end(`${req.method} ${req.headers['user-agent']} ${req.headers['content-length']} ${b}`); }); }
    if (req.url === '/bytes') { res.writeHead(206, { 'content-range': 'bytes 2-5/10' }); return res.end(Buffer.from([2, 3, 4, 5])); }
    res.writeHead(404); res.end('no');
  });
  try {
    const j = await fetchLike(`${site.origin}/moved`);
    assert.deepEqual([j.status, j.ok, j.headers.get('ETag'), j.headers.get('missing'), await j.json()], [200, true, '"e1"', null, { a: 1 }]);
    const e = await fetchLike(`${site.origin}/echo`, { method: 'POST', headers: { 'user-agent': 'Tester' }, body: 'data=1' });
    assert.equal(await e.text(), 'POST Tester 6 data=1');
    const b = await fetchLike(`${site.origin}/bytes`, { headers: { Range: 'bytes=2-5' } });
    assert.deepEqual([b.status, b.headers.get('content-range'), [...Buffer.from(await b.arrayBuffer())]], [206, 'bytes 2-5/10', [2, 3, 4, 5]]);
    const h = await fetchLike(`${site.origin}/j`, { method: 'HEAD' });
    assert.equal(h.status, 200);
    const n = await fetchLike(`${site.origin}/nothing`);
    assert.deepEqual([n.status, n.ok], [404, false]);
    n.body.destroy();
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(fetchLike(`${site.origin}/j`, { signal: ac.signal }), { name: 'AbortError' });
  } finally { await site.close(); }
});

test('a connection lost part-way is an error on the body, also when nobody was reading yet', async () => {
  const site = await listen((req, res) => { res.writeHead(200, { 'content-length': 1000 }); res.write(Buffer.alloc(100)); setTimeout(() => res.socket.destroy(), 30); });
  try {
    const a = await fetchLike(`${site.origin}/x`);
    await assert.rejects(a.arrayBuffer());
    const b = await fetchLike(`${site.origin}/x`);
    await new Promise((r) => setTimeout(r, 150)); // the connection is gone before the body is asked for
    await assert.rejects(b.text());
    const c = await fetchLike(`${site.origin}/x`);
    await new Promise((r) => setTimeout(r, 150));
    await assert.rejects((async () => { for await (const chunk of c.body) assert.ok(chunk.length); })());
  } finally { await site.close(); }
});

test('a routing file whose download is cut again and again still arrives whole, carrying on each time', async () => {
  const whole = crypto.randomBytes(900 * 1024);
  const asked = [];
  // Every answer is cut after 200 KB, the way a busy server drops a long download.
  const site = await listen((req, res) => {
    const from = Number((/bytes=(\d+)-/.exec(req.headers.range || '') || [0, 0])[1]);
    asked.push(from);
    res.writeHead(from ? 206 : 200, { 'content-length': whole.length - from, ...(from ? { 'content-range': `bytes ${from}-${whole.length - 1}/${whole.length}` } : {}) });
    const end = Math.min(whole.length, from + 200 * 1024);
    res.write(whole.subarray(from, end), () => { if (end === whole.length) res.end(); else setTimeout(() => res.socket.destroy(), 20); });
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-cut-'));
  try {
    const lib = new MapsLibrary({ dir, pause: () => Promise.resolve() });
    let seen = 0;
    const dest = path.join(dir, 'W85_N35.rd5');
    await lib.fetchFile(`${site.origin}/W85_N35.rd5`, dest, whole.length, new AbortController().signal, (n) => { seen += n; });
    assert.ok(fs.readFileSync(dest).equals(whole), 'the file is whole and in order');
    assert.equal(seen, whole.length, 'nothing counted twice');
    assert.ok(asked.length >= 5 && asked[0] === 0 && asked.every((v, i) => i === 0 || v > asked[i - 1]), `carried on each time: ${asked.join()}`);
    assert.ok(!fs.existsSync(`${dest}.part`));
    // A server that is simply not there is given up on, not tried for ever.
    await site.close();
    await assert.rejects(lib.fetchFile(`${site.origin}/gone.rd5`, path.join(dir, 'gone.rd5'), 10, new AbortController().signal, () => {}));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
