'use strict';
// Wiki golf: get from one article to another using only the links inside the articles,
// in as few clicks as possible. Every click is a stroke; the lowest total over the round wins.
//
// Two parts, neither of which needs Electron:
//   makeHole  lays out a hole by walking a few links away from a random article, so every hole
//             is known to be reachable and has a par.
//   GolfGame  keeps the round: whose turn it is, the strokes, the scorecard.

const { parse } = require('node-html-parser');
const { extractArticle } = require('./extract');

/** Links walked when a hole is laid out. Par is one more, so the route found is always under par. */
const LENGTHS = { short: 2, medium: 3, long: 4 };
const MIXED = ['medium', 'short', 'long'];
const MAX_PLAYERS = 6;

const NOT_A_PAGE = /\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?|og[gav]|webm|mp[34]|wav|pdf|css|js|json|xml|txt|woff2?)$/i;
const NOT_CONTENT = /^(file|image|media|category|special|template|help|talk|user|module|mediawiki)([ _]talk)?:/i;
// Pages that make a poor start or target: lists, disambiguation pages, bare years and dates.
const DULL_TITLE = /^(lists? of|index of|outline of|timeline of|glossary of)\b|\((disambiguation|surname|given name|name)\)$|^\d{1,4}s?( BC)?$|^(january|february|march|april|may|june|july|august|september|october|november|december)( \d{1,2})?$|^main[ _]page$/i;
const LINK_SKIP = '.navbox, .vertical-navbox, .sidebar, .reflist, .references, .mw-references-wrap, .hatnote, .metadata, .ambox, .infobox, .toc, #toc, .thumb, figure, .gallery, .noprint, .sistersitebox, .authority-control, .mw-editsection';

const unescape = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * One spelling per page: no query, no fragment, and every part of the path escaped the same way.
 * The result is still a working address ("What_is_life%3F" keeps its question mark escaped), so it
 * can be opened as well as compared.
 */
function canonical(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.split('/').map((seg) => encodeURIComponent(unescape(seg))).join('/')}`;
  } catch { return String(url || ''); }
}

/** The page's path inside the library, readable: "Saturn_V", "Physics/Essays/Light". */
function pathOf(url, contentBase) {
  const c = canonical(url);
  const base = contentBase ? `${canonical(contentBase)}/` : null;
  const rest = base && c.startsWith(base) ? c.slice(base.length) : c.split('/').filter(Boolean).pop() || '';
  return rest.split('/').map(unescape).join('/');
}

/** "Saturn_V" at the end of an address becomes "Saturn V". */
function titleFromUrl(url, contentBase) { return pathOf(url, contentBase).replace(/_/g, ' '); }

function isArticleUrl(url, contentBase) {
  const c = canonical(url);
  if (!c.startsWith(`${canonical(contentBase)}/`)) return false;
  const rest = pathOf(c, contentBase);
  if (!rest || NOT_A_PAGE.test(rest)) return false;
  return !NOT_CONTENT.test(rest) && !NOT_CONTENT.test(rest.split('/').pop());
}

/** Titles are compared without regard to case, underscores or spacing. */
const sameTitle = (a, b) => {
  const n = (t) => String(t || '').replace(/[_\s]+/g, ' ').trim().toLowerCase();
  return Boolean(n(a)) && n(a) === n(b);
};

function pageTitle(html, url) {
  const root = parse(html);
  const t = (root.querySelector('title')?.text || root.querySelector('h1')?.text || '').replace(/\s+/g, ' ').trim();
  return t || titleFromUrl(url);
}

/**
 * The articles a page links to from its running text, in page order, each once.
 * Navigation boxes, reference lists and info boxes are left out; they are not what a player reads.
 */
function articleLinks(html, pageUrl, contentBase) {
  const root = parse(html);
  const scope = root.querySelector('#mw-content-text') || root.querySelector('body') || root;
  for (const n of scope.querySelectorAll(LINK_SKIP)) n.remove();
  const here = canonical(pageUrl);
  const collect = (selector) => {
    const out = [];
    const seen = new Set([here]);
    for (const a of scope.querySelectorAll(selector)) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) continue;
      let abs;
      try { abs = new URL(href, pageUrl).toString(); } catch { continue; }
      if (!isArticleUrl(abs, contentBase)) continue;
      const c = canonical(abs);
      if (seen.has(c)) continue;
      seen.add(c);
      out.push({ url: c, title: (a.getAttribute('title') || a.text || '').replace(/\s+/g, ' ').trim() || titleFromUrl(c, contentBase) });
    }
    return out;
  };
  const inText = collect('p a');
  return inText.length >= 3 ? inText : collect('a');
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Lay out one hole. Starts at a random article and follows `steps` links chosen at random from the
 * running text, never visiting a page twice. Where it ends is the target.
 *   getPage(url) -> { url, text }   the page and its address after redirects
 *   randomUrl                         an address that redirects to a random article
 * Returns { start, target: { url, title, lead }, steps, par, route: [titles] }. In a very small library
 * a shorter hole than asked for is returned rather than none.
 */
async function makeHole({ getPage, randomUrl, contentBase, steps = 3, rng = Math.random, signal, attempts = 10 }) {
  let best = null;
  let n = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw new Error('Cancelled');
    let cur;
    try { cur = await getPage(`${randomUrl}${randomUrl.includes('?') ? '&' : '?'}n=${Date.now()}-${n++}`); } catch { continue; }
    if (!cur?.text || !isArticleUrl(cur.url, contentBase)) continue;
    const startTitle = pageTitle(cur.text, cur.url);
    if (DULL_TITLE.test(startTitle)) continue;
    const path = [{ url: canonical(cur.url), title: startTitle, text: cur.text }];
    const visited = new Set([path[0].url]);
    let firstLinks = null;
    while (path.length - 1 < steps) {
      const links = articleLinks(cur.text, cur.url, contentBase).filter((l) => !visited.has(l.url) && !DULL_TITLE.test(l.title));
      if (!firstLinks) firstLinks = new Set(links.map((l) => l.url));
      // Early links tend to be the better-known subjects, so the walk stays away from the far end of long pages.
      let next = null;
      for (const cand of shuffle(links.slice(0, 40), rng).slice(0, 5)) {
        let page;
        try { page = await getPage(cand.url); } catch { continue; }
        const c = canonical(page.url);
        if (!page.text || visited.has(c) || !isArticleUrl(c, contentBase)) continue;
        const title = pageTitle(page.text, c);
        if (DULL_TITLE.test(title)) continue;
        next = { url: c, title, text: page.text };
        break;
      }
      if (!next) break;
      visited.add(next.url);
      path.push(next);
      cur = next;
    }
    const walked = path.length - 1;
    if (walked < 1) continue;
    // A longer hole whose target is one click from the tee is not the hole that was asked for.
    const shortcut = walked >= 2 && firstLinks.has(path[walked].url);
    if (!best || (walked > best.walked && !shortcut)) best = { path, walked, shortcut };
    if (walked === steps && !shortcut) break;
  }
  if (!best) throw new Error('Could not lay out a hole here: the articles that came up have no links to follow. Try again.');
  const { path, walked } = best;
  const last = path[walked];
  let lead = '';
  try { lead = extractArticle(last.text).chunks?.[0]?.text || ''; } catch { /* no lead */ }
  lead = lead.replace(/\s*Key facts:[\s\S]*$/, '').trim(); // the info box summary that the extractor appends
  if (lead.length > 320) lead = `${lead.slice(0, 320).replace(/\s+\S*$/, '')}…`;
  return {
    base: canonical(contentBase),
    start: { url: path[0].url, title: path[0].title },
    target: { url: last.url, title: last.title, lead },
    steps: walked,
    par: walked + 1,
    route: path.map((p) => p.title),
  };
}

/** The most strokes a hole can cost. Giving up, or reaching this many, scores this many. */
const strokeLimit = (par) => par * 3;

function scoreName(strokes, par) {
  if (strokes === 1) return 'Hole in one';
  const d = strokes - par;
  if (d <= -3) return 'Albatross';
  if (d === -2) return 'Eagle';
  if (d === -1) return 'Birdie';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  if (d === 3) return 'Triple bogey';
  return `${d} over par`;
}

const toPar = (d) => (d === 0 ? 'level par' : d > 0 ? `${d} over` : `${-d} under`);

function cleanNames(players) {
  const names = [];
  for (const raw of (Array.isArray(players) ? players : []).slice(0, MAX_PLAYERS)) {
    let name = String((raw && typeof raw === 'object' ? raw.name : raw) || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) name = `Player ${names.length + 1}`;
    let unique = name;
    for (let i = 2; names.includes(unique); i++) unique = `${name} ${i}`;
    names.push(unique);
  }
  return names.length ? names : ['Player 1'];
}

/**
 * One round. Phases:
 *   layout    the next hole is being laid out
 *   tee       the hole is shown and the named player is about to start
 *   playing   that player is reading and clicking; visit() counts the strokes
 *   done      that player has finished the hole
 *   summary   everyone has played the hole; routes are shown
 *   finished  the scorecard
 */
class GolfGame {
  constructor({ players, holes = 3, length = 'medium', library = 'Wikipedia', useHandicaps = false } = {}) {
    this.players = cleanNames(players);
    // Saved players bring an id, a character and a handicap; a bare name is a guest.
    const list = (Array.isArray(players) ? players : []).slice(0, MAX_PLAYERS);
    this.profiles = this.players.map((name, i) => {
      const p = list[i] && typeof list[i] === 'object' ? list[i] : {};
      return { id: p.id || null, name, character: p.character || null, colour: p.colour || null, handicap: Number.isFinite(p.handicap) ? p.handicap : null };
    });
    this.useHandicaps = Boolean(useHandicaps);
    this.holeCount = [1, 3, 6, 9].includes(Number(holes)) ? Number(holes) : 3;
    this.length = length === 'mixed' || LENGTHS[length] ? length : 'medium';
    this.library = library;
    this.holes = [];      // { hole, cards: [ { strokes, path, holed, gaveUp } | null per player ] }
    this.holeIndex = 0;
    this.turn = 0;        // position in this hole's playing order
    this.phase = 'layout';
    this.error = null;
    this.live = null;     // the turn in progress
  }

  /** Steps to walk for the hole about to be laid out. */
  stepsForNext() {
    const key = this.length === 'mixed' ? MIXED[this.holeIndex % MIXED.length] : this.length;
    return LENGTHS[key];
  }

  /** The player who tees off first rotates each hole. */
  order() { return this.players.map((_, i) => (i + this.holeIndex) % this.players.length); }
  get playerIndex() { return this.order()[this.turn]; }
  get current() { return this.holes[this.holeIndex] || null; }

  setHole(hole) {
    if (this.phase !== 'layout' && !(this.phase === 'tee' && this.canRelay())) throw new Error('A hole is already in play.');
    this.holes[this.holeIndex] = { hole, cards: this.players.map(() => null) };
    this.turn = 0;
    this.error = null;
    this.phase = 'tee';
  }

  /** A different hole can be asked for until the first player has teed off. */
  canRelay() { return this.phase === 'tee' && this.turn === 0; }
  relay() {
    if (!this.canRelay()) throw new Error('This hole has already been started.');
    this.holes.length = this.holeIndex;
    this.phase = 'layout';
  }
  layoutFailed(message) { this.error = message; }

  teeOff() {
    if (this.phase !== 'tee') throw new Error('Nobody is on the tee.');
    this.live = { strokes: 0, path: [], onCourse: false };
    this.phase = 'playing';
    return this.current.hole.start.url;
  }

  _finish(extra) {
    const { hole } = this.current;
    const limit = strokeLimit(hole.par);
    const holed = Boolean(extra.holed);
    this.current.cards[this.playerIndex] = {
      strokes: holed ? this.live.strokes : limit,
      taken: this.live.strokes,
      path: this.live.path.slice(),
      holed,
      gaveUp: Boolean(extra.gaveUp),
    };
    this.live = null;
    this.phase = 'done';
  }

  /**
   * The reader arrived at a page. Returns what that meant: null (ignored), 'start', 'stroke',
   * 'holed' or 'limit'.
   */
  visit(url) {
    if (this.phase !== 'playing') return null;
    const { hole } = this.current;
    const c = canonical(url);
    if (!this.live.onCourse) {
      if (c !== hole.start.url) return null;
      this.live.onCourse = true;
      this.live.path.push(hole.start.title);
      this.live.at = c;
      return 'start';
    }
    if (c === this.live.at) return null; // reload, or a jump within the page
    if (NOT_A_PAGE.test(pathOf(c, hole.base))) return null;
    this.live.strokes += 1;
    this.live.at = c;
    this.live.path.push(c === hole.target.url ? hole.target.title : c === hole.start.url ? hole.start.title : titleFromUrl(c, hole.base));
    if (c === hole.target.url) { this._finish({ holed: true }); return 'holed'; }
    if (this.live.strokes >= strokeLimit(hole.par)) { this._finish({}); return 'limit'; }
    return 'stroke';
  }

  /**
   * The page now showing, by its title. A second way to notice the start and the target, for when
   * the reader's address for a page is not spelled the way the hole recorded it. Returns 'start',
   * 'holed' or null.
   */
  titled(url, title) {
    if (this.phase !== 'playing') return null;
    const { hole } = this.current;
    const c = canonical(url);
    if (!this.live.onCourse) {
      if (!sameTitle(title, hole.start.title)) return null;
      this.live.onCourse = true;
      this.live.path.push(hole.start.title);
      this.live.at = c;
      return 'start';
    }
    if (c !== this.live.at || !sameTitle(title, hole.target.title)) return null;
    this.live.path[this.live.path.length - 1] = hole.target.title;
    this._finish({ holed: true });
    return 'holed';
  }

  giveUp() {
    if (this.phase !== 'playing') throw new Error('Nobody is playing a hole.');
    this._finish({ gaveUp: true });
  }

  /** Move on: to the next player, the hole's summary, the next hole, or the scorecard. */
  next() {
    if (this.phase === 'done') {
      if (this.turn + 1 < this.players.length) { this.turn += 1; this.phase = 'tee'; } else this.phase = 'summary';
      return this.phase;
    }
    if (this.phase === 'summary') {
      if (this.holeIndex + 1 < this.holeCount) { this.holeIndex += 1; this.turn = 0; this.phase = 'layout'; } else this.phase = 'finished';
      return this.phase;
    }
    throw new Error('Nothing to move on from.');
  }

  /**
   * Totals over the holes everyone has finished, best first. Equal totals share a place. With
   * handicaps in play each player's strokes are reduced by their handicap, scaled from nine holes
   * to the holes played, and the reduced ("net") totals decide the places.
   */
  standings() {
    const complete = this.holes.filter((h) => h.cards.every(Boolean));
    const par = complete.reduce((n, h) => n + h.hole.par, 0);
    const rows = this.players.map((name, i) => {
      const strokes = complete.reduce((n, h) => n + h.cards[i].strokes, 0);
      const hcp = this.profiles[i].handicap;
      const shots = this.useHandicaps && hcp != null ? Math.round((hcp * complete.length) / 9) : 0;
      return { index: i, id: this.profiles[i].id, name, strokes, toPar: strokes - par, shots, net: strokes - shots };
    }).sort((a, b) => a.net - b.net || a.strokes - b.strokes);
    rows.forEach((r, i) => { r.place = i > 0 && rows[i - 1].net === r.net ? rows[i - 1].place : i + 1; });
    return { par, holesPlayed: complete.length, rows, useHandicaps: this.useHandicaps };
  }

  /** The finished round, for the long-term records. */
  result(now = Date.now()) {
    if (this.phase !== 'finished') return null;
    const st = this.standings();
    return {
      at: now,
      library: this.library,
      holes: st.holesPlayed,
      par: st.par,
      useHandicaps: this.useHandicaps,
      players: st.rows.map((r) => ({
        id: r.id, name: r.name, strokes: r.strokes, net: r.net, place: r.place,
        cards: this.holes.map((h) => ({ par: h.hole.par, strokes: h.cards[r.index].strokes, holed: h.cards[r.index].holed })),
      })),
    };
  }

  snapshot() {
    const cur = this.current;
    const reveal = this.phase === 'summary' || this.phase === 'finished';
    const card = (c, par) => (c ? {
      strokes: c.strokes, holed: c.holed, gaveUp: c.gaveUp,
      name: c.holed ? scoreName(c.strokes, par) : c.gaveUp ? 'Picked up' : 'Out of strokes',
      path: reveal ? c.path : null,
    } : null);
    const out = {
      phase: this.phase,
      error: this.error,
      library: this.library,
      players: this.players,
      profiles: this.profiles,
      useHandicaps: this.useHandicaps,
      holeCount: this.holeCount,
      length: this.length,
      holeNumber: this.holeIndex + 1,
      player: this.phase === 'layout' || reveal ? null : this.players[this.playerIndex],
      nextPlayer: this.phase === 'done' && this.turn + 1 < this.players.length ? this.players[this.order()[this.turn + 1]] : null,
      canRelay: this.canRelay(),
      hole: null,
      live: null,
      last: null,
      cards: null,
      scorecard: null,
      standings: this.standings(),
    };
    if (cur && this.phase !== 'layout') {
      const { hole } = cur;
      out.hole = { start: hole.start, target: hole.target, par: hole.par, limit: strokeLimit(hole.par), route: reveal ? hole.route : null };
      if (this.phase === 'playing') out.live = { strokes: this.live.strokes, path: this.live.path.slice(), onCourse: this.live.onCourse };
      // The route stays hidden until everyone has played the hole.
      if (this.phase === 'done') out.last = card(cur.cards[this.playerIndex], hole.par);
      if (reveal) out.cards = this.order().map((i) => ({ player: this.players[i], ...card(cur.cards[i], hole.par) }));
    }
    if (this.phase === 'finished' || this.phase === 'summary') {
      out.scorecard = this.holes.filter((h) => h.cards.every(Boolean)).map((h, i) => ({
        number: i + 1, par: h.hole.par, from: h.hole.start.title, to: h.hole.target.title,
        strokes: h.cards.map((c) => c.strokes),
      }));
    }
    return out;
  }
}

module.exports = { GolfGame, makeHole, articleLinks, canonical, pathOf, titleFromUrl, isArticleUrl, sameTitle, scoreName, strokeLimit, toPar, cleanNames, LENGTHS, MAX_PLAYERS };
