'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { relink } = require('../scripts/set-download-link');

const page = (inner) => `# Title\n\nSee Wikivault-Setup-0.1.0.exe outside the block.\n\n<!-- download:start -->\n${inner}\n<!-- download:end -->\n\nMore text, 5 MB.\n`;
const OLD = '**[Download Wikivault-Setup-0.15.0.exe](https://github.com/someone/Repo/releases/download/V0.15.0/Wikivault-Setup-0.15.0.exe)**\n\nVersion 0.15.0, 116 MB.';

test('the download block is pointed at a new release: link, file name, version and size', () => {
  const out = relink(page(OLD), { repo: 'someone/Repo', tag: 'v0.16.0', file: 'Wikivault-Setup-0.16.0.exe', bytes: 123 * 1024 * 1024 });
  assert.match(out, /\[Download Wikivault-Setup-0\.16\.0\.exe\]\(https:\/\/github\.com\/someone\/Repo\/releases\/download\/v0\.16\.0\/Wikivault-Setup-0\.16\.0\.exe\)/);
  assert.match(out, /Version 0\.16\.0, 123 MB\./);
  assert.match(out, /See Wikivault-Setup-0\.1\.0\.exe outside the block\./, 'text outside the block is left alone');
  assert.match(out, /More text, 5 MB\./);
});

test('the tag is used exactly as it was written, and an older build never replaces a newer link', () => {
  const info = { repo: 'someone/Repo', tag: 'V0.15.0', file: 'Wikivault-Setup-0.15.0.exe', bytes: 116 * 1024 * 1024 };
  assert.equal(relink(page(OLD), info), page(OLD), 'same release: nothing changes');
  const newer = relink(page(OLD), { ...info, tag: 'v0.16.0', file: 'Wikivault-Setup-0.16.0.exe' });
  assert.equal(relink(newer, info), newer, 'rebuilding 0.15.0 later does not move the link back');
  assert.throws(() => relink(page(OLD), { ...info, file: 'setup.exe' }), /No version number/);
});
