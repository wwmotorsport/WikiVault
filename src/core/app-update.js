'use strict';
// Looks for a newer version of Wikivault itself: asks GitHub, where the releases are published, which release is
// the latest. Nothing about this computer is sent; it is the same request a web browser makes to see the page.

const { fetchJson } = require('./httpx');
const { compareVersions } = require('./catalog');

const REPO = 'wwmotorsport/WikiVault';
const HOME = `https://github.com/${REPO}`;

/** Only links to the project's own pages on GitHub are handed on: what comes back is not trusted to say where to go. */
const ours = (url) => typeof url === 'string' && url.toLowerCase().startsWith(`${HOME.toLowerCase()}/`);

/**
 * What a release, as GitHub describes it, means for a copy of the app at version `current`.
 * @returns {{latest:string, newer:boolean, url:string, page:string, bytes:number|null, published:string|null}|null}
 */
function readRelease(json, current) {
  if (!json || typeof json !== 'object' || json.draft || json.prerelease) return null;
  const latest = String(json.tag_name || '').replace(/^v/i, '');
  if (!/^\d+(?:\.\d+){1,3}$/.test(latest)) return null;
  const asset = (Array.isArray(json.assets) ? json.assets : []).find((a) => a && /^Wikivault-Setup-[\d.]+\.exe$/i.test(a.name || '') && ours(a.browser_download_url));
  const page = ours(json.html_url) ? json.html_url : `${HOME}/releases/latest`;
  return {
    latest, newer: compareVersions(latest, String(current)) > 0,
    url: asset ? asset.browser_download_url : page, direct: Boolean(asset), page,
    bytes: asset && Number.isFinite(asset.size) ? asset.size : null,
    published: typeof json.published_at === 'string' ? json.published_at : null,
  };
}

/** Ask which release is the latest. Throws when GitHub cannot be reached (no connection, most often). */
async function check(current, { url = process.env.WIKIVAULT_RELEASES_URL || `https://api.github.com/repos/${REPO}/releases/latest`, fetch = fetchJson, signal } = {}) {
  const json = await fetch(url, { signal, timeoutMs: 20000, headers: { accept: 'application/vnd.github+json' } });
  const r = readRelease(json && json.json !== undefined ? json.json : json, current);
  if (!r) throw new Error('GitHub did not say which version is the latest.');
  return r;
}

module.exports = { check, readRelease, REPO, HOME };
