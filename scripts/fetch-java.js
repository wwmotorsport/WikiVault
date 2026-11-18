'use strict';
// Puts a Java runtime for Windows in build/java-runtime, from where the installer packs it as
// resources/java. Directions need it: the routing engine (BRouter) is a Java program.
//
// The runtime is Eclipse Temurin (OpenJDK) 25.0.5, taken from the jdk4py package on PyPI, which
// ships Temurin's own files; java.exe and jvm.dll carry the Eclipse Foundation's signature.
// The download is checked against the SHA-256 below before anything is unpacked.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

const URL_ = 'https://files.pythonhosted.org/packages/d3/c5/4c8ef8f6a7d84b63111f372427c762d363953e05ecbdb3d6cb2d6418f815/jdk4py-25.0.5.0-py3-none-win_amd64.whl';
const SHA256 = '979626fbdfb41055e501b4b183f28248465b99dd03aeca7bbf3df37f2f081caf';
const VERSION = '25.0.5';

const root = path.join(__dirname, '..');
const out = path.join(root, 'build', 'java-runtime');
const cache = path.join(root, 'build', 'java-download');
const wheel = path.join(cache, path.basename(URL_));

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  const release = path.join(out, 'release');
  if (fs.existsSync(release) && fs.readFileSync(release, 'utf8').includes(`JAVA_VERSION="${VERSION}"`) && fs.existsSync(path.join(out, 'bin', 'java.exe'))) { console.log(`java runtime ${VERSION}: already in build/java-runtime`); return; }
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(wheel) || sha(wheel) !== SHA256) {
    const from = process.env.WIKIVAULT_JAVA_WHEEL; // a copy already on this machine
    if (from) fs.copyFileSync(from, wheel);
    else {
      console.log(`fetching ${URL_}`);
      const res = await fetch(URL_);
      if (!res.ok) throw new Error(`the download answered ${res.status}`);
      fs.writeFileSync(wheel, Buffer.from(await res.arrayBuffer()));
    }
  }
  const got = sha(wheel);
  if (got !== SHA256) throw new Error(`the Java runtime download does not match its checksum (${got})`);
  fs.rmSync(out, { recursive: true, force: true });
  const zip = new AdmZip(wheel);
  const prefix = 'jdk4py/java-runtime/';
  let files = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
    const rel = e.entryName.slice(prefix.length);
    if (rel.startsWith('include/')) continue; // headers for compiling against Java: not needed to run it
    const dest = path.join(out, rel);
    if (!dest.startsWith(out + path.sep)) throw new Error(`unexpected path in the archive: ${e.entryName}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    files += 1;
  }
  if (!fs.existsSync(path.join(out, 'bin', 'java.exe')) || !fs.existsSync(path.join(out, 'legal'))) throw new Error('the archive did not hold a Java runtime');
  console.log(`java runtime ${VERSION}: ${files} files in build/java-runtime`);
})().catch((err) => { console.error(`fetch-java: ${err.message}`); process.exit(1); });
