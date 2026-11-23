'use strict';
// Reads the words of a scanned page (text recognition), for pages of the Survival Guides that are pictures with no
// words behind them. The engine is Tesseract, compiled to run inside the app; its English data is packed with the
// app, so nothing is fetched and no page leaves this computer. One reader is started on first use and shared.

const path = require('node:path');

// Under Node the library loads the engine built for both of Tesseract's recognisers (tesseract-core, -simd or
// -relaxedsimd, whichever the processor allows), whatever is asked of it; those three are the ones packed.
// Packed apps keep these files beside the archive (see "asarUnpack" in package.json): a worker thread and the
// engine's own loader read them as ordinary files.
const real = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

class Reader {
  constructor({ log = () => {}, create = null } = {}) { this.create = create; this.log = log; this.worker = null; this.starting = null; this.idle = null; this.pages = 0; this.broken = null; this.said = false; }

  async start() {
    if (this.worker) return this.worker;
    // A reader that could not be started is not tried again for every page: each try would leave a worker behind.
    if (this.broken) throw new Error(this.broken);
    if (!this.starting) {
      this.starting = (async () => {
        const createWorker = this.create || require('tesseract.js').createWorker;
        const worker = await createWorker('eng', 1, {
          workerPath: real(require.resolve('tesseract.js/src/worker-script/node/index.js')),
          langPath: real(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0')),
          cacheMethod: 'none', gzip: true,
          errorHandler: (err) => { if (!this.broken && !this.said) { this.said = true; this.log(`text recognition: ${String((err && err.message) || err).split('\n')[0].slice(0, 300)}`); } },
        });
        this.worker = worker;
        return worker;
      })().catch((err) => {
        this.broken = `the text reader could not be started (${String((err && err.message) || err).split('\n')[0].slice(0, 200)})`;
        this.log(`text recognition: ${this.broken}; scanned pages are kept as pictures without their words`);
        throw new Error(this.broken);
      }).finally(() => { this.starting = null; });
    }
    return this.starting;
  }

  /**
   * The words of one page picture (JPEG or PNG bytes), as paragraphs in reading order. An empty list when the page
   * has no words that could be read.
   * @returns {Promise<string[]>}
   */
  async read(bytes) {
    clearTimeout(this.idle);
    const worker = await this.start();
    try {
      const { data } = await worker.recognize(Buffer.from(bytes), {}, { text: true, blocks: true });
      this.pages += 1;
      return data && Array.isArray(data.blocks) ? fromBlocks(data.blocks) : tidy(data && data.text, data && data.confidence);
    } finally {
      // The reader holds a good deal of memory: it is let go when no page has come for a while.
      this.idle = setTimeout(() => { this.close().catch(() => {}); }, 60000);
      this.idle.unref?.();
    }
  }

  async close() {
    clearTimeout(this.idle);
    const w = this.worker; this.worker = null;
    if (w) await w.terminate().catch(() => {});
  }
}

/** The engine's text as paragraphs: lines joined, words broken at a line's end mended, and noise left out. */
function tidy(text, confidence = 100) {
  if (!text || confidence < 25) return []; // a photograph or a drawing "read" as letters
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    let para = '';
    for (const line of block.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!para) para = line;
      else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(line)) para = para.slice(0, -1) + line;
      else para += ` ${line}`;
    }
    para = para.replace(/\s+/g, ' ').trim();
    // A paragraph has to be mostly letters: specks and rules come out as strings of punctuation.
    const letters = para.replace(/[^A-Za-z]/g, '').length;
    if (para.length >= 3 && letters >= para.length * 0.5) out.push(para);
  }
  return out;
}

/**
 * Paragraphs from what the engine found, keeping only what it was sure of. A drawing "read" as letters comes out as
 * short words of low confidence; a line is kept when most of its words were read with confidence, and a paragraph
 * when real words are left in it.
 */
function fromBlocks(blocks, { sure = 60 } = {}) {
  const out = [];
  for (const block of blocks || []) {
    for (const par of block.paragraphs || []) {
      const lines = [];
      for (const line of par.lines || []) {
        const words = (line.words || []).filter((w) => w.text && w.text.trim());
        if (!words.length) continue;
        const good = words.filter((w) => w.confidence >= sure);
        if (good.length < Math.max(1, words.length * 0.6)) continue;
        // Within a line that reads well, a doubtful word is more often right than wrong: it is kept unless it is noise.
        lines.push(words.filter((w) => w.confidence >= sure || (w.confidence >= 35 && /^[A-Za-z][A-Za-z'-]+[.,;:]?$/.test(w.text))).map((w) => w.text).join(' '));
      }
      const made = tidy(lines.join('\n'));
      for (const text of made) if ((text.match(/[A-Za-z]{3,}/g) || []).length >= 2) out.push(text);
    }
  }
  return out;
}

module.exports = { Reader, tidy, fromBlocks };
