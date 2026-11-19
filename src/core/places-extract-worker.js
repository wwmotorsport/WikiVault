'use strict';
// Reads an OpenStreetMap extract off the main thread, so the window and the map stay live meanwhile.
const { parentPort, workerData } = require('node:worker_threads');
const { run } = require('./places-extract');

run(workerData, (patch) => parentPort.postMessage({ type: 'progress', patch }))
  .then((result) => parentPort.postMessage({ type: 'done', result }))
  .catch((err) => parentPort.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) }));
