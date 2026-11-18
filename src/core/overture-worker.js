'use strict';
// Runs an Overture fetch off the main thread, so the window and the map stay live while millions of rows are read.
const { parentPort, workerData } = require('node:worker_threads');
const { run } = require('./overture');

run(workerData, (patch) => parentPort.postMessage({ type: 'progress', patch }))
  .then((result) => parentPort.postMessage({ type: 'done', result }))
  .catch((err) => parentPort.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) }));
