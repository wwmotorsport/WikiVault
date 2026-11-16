#!/usr/bin/env node
'use strict';
// Plays the part of powershell.exe for the Node-side tests: finds the script the
// app asked to run and runs it under pwsh with the mocked Storage cmdlets.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
let script = null;
const i = args.indexOf('-File');
if (i >= 0) script = args[i + 1];
const e = args.indexOf('-EncodedCommand');
if (e >= 0) {
  const cmd = Buffer.from(args[e + 1], 'base64').toString('utf16le');
  if (!/Start-Process/.test(cmd) || !/-Verb RunAs/.test(cmd)) { console.error('expected an elevation request'); process.exit(90); }
  if (process.env.FAKE_UAC === 'decline') { console.error('The operation was canceled by the user.'); process.exit(1223); }
  script = (/-File "([^"]+)"/.exec(cmd) || [])[1];
}
if (!script) { console.error('no script'); process.exit(91); }
const r = spawnSync(process.env.WIKIVAULT_PWSH, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'harness.ps1'), script], { stdio: 'inherit', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } });
process.exit(r.status == null ? 92 : r.status);
