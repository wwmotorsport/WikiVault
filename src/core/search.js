'use strict';
/**
 * Search ordering. The reader engine's full-text search ranks by how often the words occur in an
 * article's body and takes no notice of titles, so a search for "differential" leads with
 * "Differential equation" and never shows the article called "Differential". Here the title index
 * and the full-text results are merged and ordered together, with no model involved.
 */
const { keywords, stem } = require('./rank');
const { extractArticle } = require('./extract');

const FIRST_PAGE = 50;      // full-text results considered for re-ordering
const LISTY = /^(lists?|index|outline|timeline|glossary|bibliography) of\b/i;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stems = (s) => norm(s).split(' ').filter(Boolean).map(stem);

/** How well a title answers the query on its own, 0 to 100. */
function titleScore(title, query) {
  const q = norm(query);
  const t = norm(title);
  if (!q || !t) return 0;
  const base = norm(String(title).replace(/\s*\([^)]*\)\s*$/, '')); // "Mercury (planet)" -> "mercury"
  const qs = stems(query);
  const ts = stems(title);
  const inTitle = qs.filter((w) => ts.includes(w)).length / qs.length;
  let score;
  if (t === q) score = 100;
  else if (base === q) score = 82;
  else if (stems(base).join(' ') === qs.join(' ')) score = 76;       // singular for plural and the like
  else if (t.startsWith(`${q} `) || base.startsWith(`${q} `)) score = 48;
  else if (inTitle === 1) score = 42;
  else if (inTitle >= 0.5) score = 26 * inTitle;
  else return 0;
  if (score < 76) score -= Math.min(12, Math.max(0, ts.length - qs.length) * 2); // nearer in length is nearer in meaning
  if (LISTY.test(title) && !LISTY.test(query) && !/\b(list|timeline|index|outline|glossary)\b/i.test(query)) score -= 25;
  if (/\(disambiguation\)\s*$/i.test(title)) score -= 12;
  return Math.max(0, score);
}

/** Order merged candidates. Each has { title, ftRank?, sugRank? }. */
function order(candidates, query) {
  for (const c of candidates) {
    c.score = titleScore(c.title, query)
      + (c.ftRank != null ? 30 * 20 / (20 + c.ftRank) : 0)
      + (c.sugRank != null ? 10 * 5 / (5 + c.sugRank) : 0);
  }
  return candidates.sort((a, b) => b.score - a.score || (a.ftRank ?? 1e9) - (b.ftRank ?? 1e9));
}

/** Split text into parts with the query's words marked, the shape the results list draws. */
function markHits(text, query) {
  const want = new Set(stems(query));
  return String(text).split(/([\p{L}\p{N}]+)/u).filter(Boolean)
    .map((part) => ({ text: part, hit: want.has(stem(norm(part))) }))
    .reduce((out, p) => { const last = out.at(-1); if (last && last.hit === p.hit) last.text += p.text; else out.push(p); return out; }, []);
}

/** The opening lines of an article, for a result that came from the title index and has no excerpt. */
async function leadSnippet(engine, item, query, signal) {
  try {
    const { text } = await engine.fetchHtml(item.url, { signal });
    const lead = extractArticle(text).chunks?.[0]?.text || '';
    return lead ? markHits(lead.length > 260 ? `${lead.slice(0, 260).replace(/\s+\S*$/, '')}…` : lead, query) : [];
  } catch { return []; }
}

/** Queries to fall back on when no article contains every word: first without filler words, then one word short. */
function relaxations(query) {
  const all = (String(query).match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu) || []);
  const kw = keywords(query);
  const out = [];
  if (kw.length && kw.length < all.length) out.push({ words: kw, dropped: [] });
  if (kw.length >= 2 && kw.length <= 7) {
    // Drop the shortest word first: short words carry the least, and typos are caught either way.
    const byLength = kw.map((w, i) => ({ w, i })).sort((a, b) => a.w.length - b.w.length || b.i - a.i);
    for (const { w, i } of byLength) out.push({ words: kw.filter((_, j) => j !== i), dropped: [w] });
  }
  return out;
}

/**
 * The first page of results: title matches and the engine's top full-text results, ordered together.
 * Later pages (start > 0) are the engine's own, from where the first page left off.
 */
async function smartSearch(engine, query, { start = 0, pageLength = 20, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { total: 0, items: [], nextStart: 0, usedQuery: q, dropped: [] };
  if (start > 0) {
    const r = await engine.search(q, { start, pageLength, signal });
    return { ...r, nextStart: start + r.items.length, usedQuery: q, dropped: [] };
  }

  let [ft, sug] = await Promise.all([
    engine.search(q, { start: 0, pageLength: FIRST_PAGE, signal }),
    engine.suggest(q, 10, { signal }).catch(() => []),
  ]);
  let usedQuery = q;
  let dropped = [];
  if (!ft.total) {
    for (const v of relaxations(q)) {
      const r = await engine.search(v.words.join(' '), { start: 0, pageLength: FIRST_PAGE, signal });
      if (r.total) { ft = r; usedQuery = v.words.join(' '); dropped = v.dropped; break; }
    }
  }

  const byPath = new Map();
  ft.items.forEach((it, i) => byPath.set(it.path, { ...it, ftRank: i }));
  sug.forEach((s, i) => {
    const have = byPath.get(s.path);
    if (have) have.sugRank = i;
    else byPath.set(s.path, { title: s.title, path: s.path, url: s.url, link: s.url, snippet: [], words: 0, sugRank: i });
  });
  const items = order([...byPath.values()], q);

  // Title-only results near the top get their opening lines, so every result says what it is.
  const bare = items.slice(0, 12).filter((it) => !it.snippet?.length).slice(0, 6);
  if (bare.length) {
    const fill = Promise.all(bare.map(async (it) => { it.snippet = await leadSnippet(engine, it, q, signal); }));
    await Promise.race([fill, new Promise((r) => setTimeout(r, 2500))]);
  }
  return { total: Math.max(ft.total, items.length), items, nextStart: ft.items.length, usedQuery, dropped };
}

module.exports = { smartSearch, titleScore, order, relaxations, markHits };
