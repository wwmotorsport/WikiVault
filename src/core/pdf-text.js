'use strict';
// Reads the text of a PDF, page by page, for the curriculum search index. Text only: nothing is
// drawn, no fonts are loaded and no script inside a PDF is run.

const fsp = require('node:fs/promises');

let pdfjs = null;
function lib() {
  if (!pdfjs) {
    // The library looks for an optional drawing package when it loads and complains when it is absent.
    // Nothing is drawn here, so that complaint is kept out of the log.
    const warn = console.warn; const logFn = console.log;
    console.warn = () => {}; console.log = () => {};
    try {
      pdfjs = require('../vendor/pdfjs/pdf.js');
      // The parser is loaded here and handed over directly. Left to itself the library looks for it
      // the way a web page would whenever it is not sure it is running under plain Node, which is
      // the case in the app's helper process.
      globalThis.pdfjsWorker = require('../vendor/pdfjs/pdf.worker.js');
    } finally { console.warn = warn; console.log = logFn; }
  }
  return pdfjs;
}

/**
 * The text of one page in reading order: top of the page first, left to right. Headings and running
 * heads therefore come at the start of the string and page numbers at the end.
 */
function pageText(items) {
  const lines = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3; // items within about 3 points share a line
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: it.transform[4], s: it.str });
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join('\n');
}

/**
 * @param {string} file
 * @param {{onPage?: (done:number,total:number)=>void, signal?: AbortSignal}} [opts]
 * @returns {Promise<string[]>} one string per page
 */
async function extractPages(file, { onPage = () => {}, signal } = {}) {
  const data = new Uint8Array(await fsp.readFile(file));
  const doc = await lib().getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new Error('Cancelled');
      let text = '';
      try {
        const page = await doc.getPage(n);
        text = pageText((await page.getTextContent()).items);
        page.cleanup();
      } catch { /* a page that cannot be read is left empty; the rest of the book is still indexed */ }
      pages.push(text);
      onPage(n, doc.numPages);
    }
  } finally { await doc.destroy().catch(() => {}); }
  return pages;
}

module.exports = { extractPages, pageText };
