'use strict';
// The converter window of the Survival Guides.
// PDFs are converted in a window of their own that is never shown: it has a canvas to draw pages on, and nothing
// else (no files, no network, no node). One PDF at a time; the window is closed when there is no more work.

const { BrowserWindow, ipcMain } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

let convertWin = null;
let convertJob = null;      // { id, file, onPage, signal, resolve, reject }
let convertWaiting = null;  // the window's request for its next PDF, answered when there is one
let convertSeq = 0;
let convertIdle = null;
function convertHandIn() {
  if (!convertWaiting || !convertJob || convertJob.handed) return;
  const give = convertWaiting; convertWaiting = null;
  convertJob.handed = true;
  fsp.readFile(convertJob.file).then((buf) => give({ id: convertJob.id, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) }), (err) => { const j = convertJob; convertJob = null; convertWaiting = give; j.reject(err); });
}
function convertClose() { clearTimeout(convertIdle); const w = convertWin; convertWin = null; convertWaiting = null; if (w && !w.isDestroyed()) w.destroy(); }
function convertPdf(file, { onPage, signal } = {}) {
  if (convertJob) return Promise.reject(new Error('Another document is being converted.'));
  clearTimeout(convertIdle);
  return new Promise((resolve, reject) => {
    convertSeq += 1;
    convertJob = { id: convertSeq, file, onPage, signal, resolve, reject, handed: false };
    if (!convertWin || convertWin.isDestroyed()) {
      convertWin = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { preload: path.join(__dirname, '..', 'convert-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, webSecurity: true } });
      const w = convertWin;
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (e) => e.preventDefault());
      const died = (why) => { if (convertWin === w) { convertWin = null; convertWaiting = null; } const j = convertJob; if (j) { convertJob = null; j.reject(new Error(`The converter stopped (${why}).`)); } };
      w.webContents.on('render-process-gone', (_e, d) => died(d.reason));
      w.on('closed', () => died('closed'));
      w.loadFile(path.join(__dirname, '..', 'renderer', 'guide-convert.html')).catch((err) => died(err.message));
    }
    convertHandIn();
  });
}
function convertHandlers() {
  const own = (event) => convertWin && !convertWin.isDestroyed() && event.sender === convertWin.webContents;
  ipcMain.handle('convert:next', (event) => (own(event) ? new Promise((give) => { convertWaiting = give; convertHandIn(); }) : null));
  ipcMain.handle('convert:page', async (event, p) => {
    const j = convertJob;
    if (!own(event) || !j || !p || p.id !== j.id) return { stop: true };
    if (j.signal?.aborted) return { stop: true };
    try { await j.onPage(p); } catch (err) { console.error(`guides: a page could not be kept: ${err.message}`); }
    return { stop: false };
  });
  ipcMain.handle('convert:done', (event, r) => {
    const j = convertJob;
    if (!own(event) || !j || !r || r.id !== j.id) return true;
    convertJob = null;
    if (r.stopped || j.signal?.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; j.reject(e); }
    else if (r.error) j.reject(new Error(r.error));
    else j.resolve({ pages: r.pages, outline: Array.isArray(r.outline) ? r.outline : [] });
    // The window is kept for the next document of the collection, and closed when none comes.
    clearTimeout(convertIdle); convertIdle = setTimeout(() => { if (!convertJob) convertClose(); }, 20000);
    return true;
  });
}

module.exports = { convertPdf, convertHandlers, convertClose };
