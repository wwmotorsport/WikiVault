'use strict';
// Points the download links in README.md, DOWNLOAD-INSTALLER.md and docs/USER-GUIDE.md at a release.
// Run by the build workflow after it has attached the installer, so the links always name a file
// that exists:   node scripts/set-download-link.js <owner/repo> <tag> <path to installer> [repo root]
// Only the text between <!-- download:start --> and <!-- download:end --> is touched.
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['README.md', 'DOWNLOAD-INSTALLER.md', 'docs/USER-GUIDE.md'];
const BLOCK = /(<!-- download:start -->)([\s\S]*?)(<!-- download:end -->)/g;
const newer = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/** The block with its link, file name, version and size replaced. Returns the text unchanged when the block names a newer version. */
function relink(text, { repo, tag, file, bytes }) {
  const version = (/(\d+\.\d+\.\d+)/.exec(file) || [])[1];
  if (!version) throw new Error(`No version number in the installer's name: ${file}`);
  const mb = Math.round(bytes / (1024 * 1024));
  return text.replace(BLOCK, (all, start, body, end) => {
    const have = (/Wikivault-Setup-(\d+\.\d+\.\d+)\.exe/.exec(body) || [])[1];
    if (have && newer(have, version)) return all;
    const next = body
      .replace(/https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/releases\/download\/[^/\s)]+\/Wikivault-Setup-\d+\.\d+\.\d+\.exe/g, `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${file}`)
      .replace(/Wikivault-Setup-\d+\.\d+\.\d+\.exe/g, file)
      .replace(/\bVersion \d+\.\d+\.\d+/g, `Version ${version}`)
      .replace(/\b\d+ MB\b/g, `${mb} MB`);
    return `${start}${next}${end}`;
  });
}

if (require.main === module) {
  const [repo, tag, installer, root = path.join(__dirname, '..')] = process.argv.slice(2);
  if (!repo || !tag || !installer) { console.error('usage: set-download-link.js <owner/repo> <tag> <installer> [repo root]'); process.exit(2); }
  const info = { repo, tag, file: path.basename(installer), bytes: fs.statSync(installer).size };
  let changed = 0;
  for (const name of FILES) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) continue;
    const before = fs.readFileSync(full, 'utf8');
    const after = relink(before, info);
    if (after !== before) { fs.writeFileSync(full, after); changed += 1; console.log(`updated ${name}`); }
  }
  console.log(changed ? `${changed} file(s) now point at ${info.file} in release ${tag}` : 'links already correct');
}

module.exports = { relink };
