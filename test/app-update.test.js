'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { check, readRelease } = require('../src/core/app-update');

const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/wwmotorsport/WikiVault/releases/tag/${tag}`, published_at: '2026-11-23T20:00:00Z', draft: false, prerelease: false,
  assets: [{ name: 'latest.yml', browser_download_url: `https://github.com/wwmotorsport/WikiVault/releases/download/${tag}/latest.yml`, size: 300 }, { name: `Wikivault-Setup-${tag.slice(1)}.exe`, browser_download_url: `https://github.com/wwmotorsport/WikiVault/releases/download/${tag}/Wikivault-Setup-${tag.slice(1)}.exe`, size: 160000000 }], ...extra });

test('a newer release is told from the same or an older one, and gives the installer to download', () => {
  const r = readRelease(release('v0.40.0'), '0.39.0');
  assert.deepStrictEqual(r, { latest: '0.40.0', newer: true, url: 'https://github.com/wwmotorsport/WikiVault/releases/download/v0.40.0/Wikivault-Setup-0.40.0.exe', direct: true, page: 'https://github.com/wwmotorsport/WikiVault/releases/tag/v0.40.0', bytes: 160000000, published: '2026-11-23T20:00:00Z' });
  assert.strictEqual(readRelease(release('v0.39.0'), '0.39.0').newer, false);
  assert.strictEqual(readRelease(release('v0.9.0'), '0.39.0').newer, false); // 0.9 is older than 0.39
  assert.strictEqual(readRelease(release('v0.40.0'), '0.39.1').newer, true);
});

test('what GitHub sends is not trusted to say where to go: links off the project are not handed on', () => {
  const odd = readRelease(release('v0.40.0', { html_url: 'https://example.com/x', assets: [{ name: 'Wikivault-Setup-0.40.0.exe', browser_download_url: 'https://example.com/Wikivault-Setup-0.40.0.exe', size: 1 }] }), '0.39.0');
  assert.deepStrictEqual([odd.url, odd.direct, odd.page], ['https://github.com/wwmotorsport/WikiVault/releases/latest', false, 'https://github.com/wwmotorsport/WikiVault/releases/latest']);
  assert.strictEqual(readRelease(release('v0.40.0', { prerelease: true }), '0.39.0'), null);
  assert.strictEqual(readRelease({ tag_name: 'nightly' }, '0.39.0'), null);
  assert.strictEqual(readRelease(null, '0.39.0'), null);
});

test('the check asks the releases address and reads the answer; no answer is an error to say, not a version', async () => {
  const asked = [];
  const r = await check('0.39.0', { url: 'https://api.github.com/x', fetch: async (url, o) => { asked.push([url, o.headers.accept]); return { json: release('v0.41.0') }; } });
  assert.deepStrictEqual([r.latest, r.newer], ['0.41.0', true]);
  assert.deepStrictEqual(asked, [['https://api.github.com/x', 'application/vnd.github+json']]);
  await assert.rejects(check('0.39.0', { fetch: async () => ({ json: { message: 'Not Found' } }) }), /did not say which version is the latest/);
  await assert.rejects(check('0.39.0', { fetch: async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); } }), /ENOTFOUND/);
});
