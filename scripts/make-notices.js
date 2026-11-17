'use strict';
// Writes THIRD-PARTY-NOTICES.txt: the licence of everything shipped inside the installer, and a
// plain list of what the app downloads later from other publishers. Run by `npm run notices`.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const ISC = (who) => `ISC License\n\nCopyright (c) ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n`;

const line = '='.repeat(78);
let out = `THIRD-PARTY NOTICES FOR WIKIVAULT\n\nWikivault itself is under the MIT licence (see LICENSE.txt). This file lists other people's work.\n\n${line}\nPART 1 - INCLUDED IN THE INSTALLER\n${line}\n\n`;
out += 'Electron and Chromium\n  The application shell. Their licences are installed next to Wikivault.exe as\n  LICENSE.electron.txt and LICENSES.chromium.html.\n\n';
out += `IBM Plex Sans and IBM Plex Serif (fonts, unmodified)\n\n${fs.readFileSync(path.join(root, 'assets/fonts/IBM-Plex-LICENSE.txt'), 'utf8').trim()}\n\n`;
out += `Press Start 2P (font, unmodified; used in the wiki golf game)\n\n${fs.readFileSync(path.join(root, 'assets/fonts/PressStart2P-LICENSE.txt'), 'utf8').trim()}\n\n`;

out += `PDF.js 3.11.174 (unmodified; reads the text of the school books)\nhttps://github.com/mozilla/pdf.js\n\n${fs.readFileSync(path.join(root, 'src/vendor/pdfjs/LICENSE'), 'utf8').trim()}\n\n`;

const packages = Object.entries(lock.packages).filter(([dir, p]) => dir && !p.dev).sort(([a], [b]) => a.localeCompare(b));
for (const [dir, p] of packages) {
  const name = dir.replace(/^node_modules\//, '');
  const abs = path.join(root, dir);
  const meta = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
  const file = fs.readdirSync(abs).find((f) => /^licen[sc]e/i.test(f));
  const author = typeof meta.author === 'string' ? meta.author : meta.author?.name;
  const text = file ? fs.readFileSync(path.join(abs, file), 'utf8').trim() : (p.license === 'ISC' ? ISC(author || `the ${name} authors`).trim() : `Licence: ${p.license}`);
  const home = (meta.repository?.url || meta.homepage || '').replace(/^git\+/, '').replace(/\.git$/, '');
  out += `${'-'.repeat(78)}\n${name} ${p.version} (${p.license})${home ? `\n${home}` : ''}\n\n${text}\n\n`;
}

out += `${line}\nPART 2 - NOT INCLUDED: DOWNLOADED TO YOUR COMPUTER FROM THEIR PUBLISHERS\n${line}\n\nThese are fetched by the app, at your request, from the publisher's own servers. They are\nnot part of Wikivault and are used under their own terms.\n\n`;
out += [
  ['Kiwix tools (kiwix-serve)', 'The reader and search engine. GNU General Public License v3. Downloaded from download.kiwix.org. Source: https://github.com/kiwix/kiwix-tools'],
  ['Wikipedia edition (ZIM file)', 'Text is available under the Creative Commons Attribution-ShareAlike 4.0 licence (and, mostly, the GNU Free Documentation License); images and other media carry their own licences, stated on each file\'s page. Packaged and published by Kiwix / openZIM. Each article in the app links to itself as the source.'],
  ['Wikibooks and Wikiversity editions (ZIM files)', 'Text under the Creative Commons Attribution-ShareAlike licence; media under their own licences. Packaged and published by Kiwix / openZIM. Downloaded only if you add them.'],
  ['School materials for Grade 5 (PDF files)', 'Published by the Core Knowledge Foundation and downloaded from coreknowledge.org only if you ask for them. Core Knowledge Language Arts, History and Geography, and Science are under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 licence. Core Knowledge Mathematics is based on IM K-5 Math by Illustrative Mathematics, which is under the Creative Commons Attribution 4.0 licence. The files are used unchanged; each states its own terms. They may not be sold.'],
  ['Microsoft Foundry Local', 'The program that runs AI models. Installed with winget from Microsoft under Microsoft\'s licence terms, only if you agree.'],
  ['AI models', 'Downloaded by Foundry Local from Microsoft\'s model catalogue. Each model has its own licence, set by its publisher and shown in that catalogue.'],
].map(([name, text]) => `${name}\n  ${text}\n`).join('\n');
out += `\n${line}\nNAMES\n${line}\n\nWikipedia is a trademark of the Wikimedia Foundation. Kiwix, Microsoft, Foundry, IBM Plex, Core Knowledge and Illustrative Mathematics are names or trademarks of their owners. Wikivault is not affiliated with, endorsed by or sponsored by any of them.\n`;
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), out.replace(/\r\n/g, '\n'));
console.log(`THIRD-PARTY-NOTICES.txt: ${packages.length} packages, ${out.length} characters`);
