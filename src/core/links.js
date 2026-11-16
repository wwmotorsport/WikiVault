'use strict';
// Links from one Wikimedia project to another. In the offline copies these are ordinary web
// links (https://en.wikibooks.org/wiki/First_Aid). When the project they point at is downloaded
// too, the app follows them inside the offline copy instead.

const PROJECTS = ['wikipedia', 'wikibooks', 'wikiversity'];

/**
 * Which project and page a web address points at, or null when it is not a page of a known
 * project in the wanted language.
 *   https://en.wikibooks.org/wiki/First_Aid#Burns   -> { project: 'wikibooks', path: 'First_Aid', hash: '#Burns' }
 *   //en.m.wikipedia.org/wiki/Saturn V              -> { project: 'wikipedia', path: 'Saturn_V', hash: '' }
 *   https://en.wikipedia.org/w/index.php?title=Moon -> { project: 'wikipedia', path: 'Moon', hash: '' }
 */
function sisterLink(url, language = 'en') {
  let u;
  try { u = new URL(String(url), 'https://x.invalid/'); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const m = /^([a-z-]+)\.(?:m\.)?([a-z]+)\.org$/i.exec(u.hostname);
  if (!m || m[1].toLowerCase() !== language || !PROJECTS.includes(m[2].toLowerCase())) return null;
  let title = null;
  if (u.pathname.startsWith('/wiki/')) {
    try { title = decodeURIComponent(u.pathname.slice('/wiki/'.length)); } catch { return null; }
  } else if (u.pathname === '/w/index.php') {
    // Only a plain "show this page" address: anything with an action is a job for the website.
    const keys = [...u.searchParams.keys()];
    if (keys.length === 1 && keys[0] === 'title') title = u.searchParams.get('title');
  }
  title = (title || '').trim().replace(/ /g, '_');
  if (!title || /^(special|file|media):/i.test(title)) return null;
  return { project: m[2].toLowerCase(), path: title, hash: u.hash || '' };
}

/** The spellings worth trying for a page, since the first letter of a title is capitalised by the wiki. */
function pathCandidates(path) {
  const upper = path.charAt(0).toUpperCase() + path.slice(1);
  return upper === path ? [path] : [path, upper];
}

module.exports = { sisterLink, pathCandidates, PROJECTS };
