'use strict';
// Parts of the app that can be left out of a release while they are still being built.
// A part that is off is not started and is not shown anywhere; its files on the disk are left alone.
//
// Three places can say whether a part is on, the later ones winning:
//   package.json   "wikivault": { "features": { "school": false } }   what a build ships with
//   settings.json  "features": { "school": true }                      one computer's own choice
//   environment    WIKIVAULT_FEATURES=school,-other                    for the tests

const KNOWN = { school: false };

function features({ pkg = {}, settings = {}, env = {} } = {}) {
  const out = { ...KNOWN };
  const take = (from) => { for (const [k, v] of Object.entries(from || {})) if (k in out && typeof v === 'boolean') out[k] = v; };
  take(pkg.wikivault && pkg.wikivault.features);
  take(settings.features);
  for (const word of String(env.WIKIVAULT_FEATURES || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const off = word.startsWith('-'); const k = off ? word.slice(1) : word;
    if (k in out) out[k] = !off;
  }
  return out;
}

module.exports = { features, KNOWN };
