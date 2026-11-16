#!/usr/bin/env node
'use strict';
// Stand-in for the Foundry Local CLI in tests. Behaviour is driven by a JSON
// file named in FAKE_FOUNDRY_STATE:
//   { "group": "server" | "service", "running": bool, "url": "http://127.0.0.1:PORT",
//     "catalog": { "<alias>": "<full model id>" }, "cached": ["<id>"], "loadedFile": "<path>" }
const fs = require('node:fs');

const stateFile = process.env.FAKE_FOUNDRY_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const loaded = () => JSON.parse(fs.readFileSync(state.loadedFile, 'utf8'));
const setLoaded = (arr) => fs.writeFileSync(state.loadedFile, JSON.stringify(arr));
const [group, cmd, arg] = process.argv.slice(2);
state.calls = [...(state.calls || []), process.argv.slice(2).join(' ')];
save();

if (group === 'server' || group === 'service') {
  if (group !== state.group) {
    console.error(`Unrecognized command or argument '${group}'.`);
    process.exit(1);
  }
  if (cmd === 'status') {
    if (state.running) console.log(`Model management service is running on ${state.url}/openai/status`);
    else { console.log('Model management service is not running!'); }
    process.exit(0);
  }
  if (cmd === 'start') {
    state.running = true; save();
    console.log(`Service is Started on ${state.url}/, PID 4242!`);
    process.exit(0);
  }
}
if (group === 'model') {
  const id = state.catalog[arg] || (Object.values(state.catalog).includes(arg) ? arg : null);
  if (!id) { console.error(`Model ${arg} was not found in the catalog`); process.exit(1); }
  if (cmd === 'download') {
    console.log(`Downloading ${id}...`);
    console.log('[####################################] 100.00 %');
    state.cached = [...new Set([...(state.cached || []), id])]; save();
    process.exit(0);
  }
  if (cmd === 'load') {
    if (!(state.cached || []).includes(id)) { console.error(`Model ${arg} not found in cache. Download it first.`); process.exit(1); }
    if (state.rejectTtl && process.argv.includes('--ttl')) { console.error("Unrecognized command or argument '--ttl'."); process.exit(1); }
    setLoaded([...new Set([...loaded(), id])]);
    if (state.engineFile) fs.writeFileSync(state.engineFile, JSON.stringify([...new Set([...JSON.parse(fs.readFileSync(state.engineFile, 'utf8')), id])]));
    console.log(`Model ${id} loaded successfully`);
    process.exit(0);
  }
}
console.error('Required command was not provided.');
process.exit(1);
