'use strict';
// Runs in its own process so that reading large PDFs never holds up the window.
// One request at a time: { id, file } in, { id, pages } or { id, error } out.
const { extractPages } = require('../core/pdf-text');

process.parentPort.on('message', async (e) => {
  const { id, file } = e.data || {};
  try { process.parentPort.postMessage({ id, pages: await extractPages(file) }); } catch (err) { process.parentPort.postMessage({ id, error: err.message || String(err) }); }
});
