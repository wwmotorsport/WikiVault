'use strict';
// Keyword handling and BM25 passage ranking. This is what decides which
// passages a small local model gets to read, so it stays simple and predictable.

const STOPWORDS = new Set(`a about above after again all also am an and any are aren't as at be because been before being
below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in
into is isn't it its itself just let's me more most mustn't my myself no nor not of off on once only or other ought
our ours ourselves out over own same shan't she should shouldn't so some such than that the their theirs them
themselves then there these they this those through to too under until up very was wasn't we were weren't what when
where which while who whom whose why will with won't would wouldn't you your yours yourself yourselves
tell explain describe give list name mean means meaning called happen happened happens many much
please know known get got make made use used does did`.split(/\s+/));

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

function words(text) {
  return (String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || []);
}

/** Stemmed content terms. */
function tokenize(text) {
  const out = [];
  for (const w of words(text)) {
    const bare = w.replace(/['’]s$/, '');
    if (bare.length < 2 && !/\d/.test(bare)) continue;
    if (STOPWORDS.has(bare) || STOPWORDS.has(w)) continue;
    out.push(stem(bare));
  }
  return out;
}

/** Content words of a question in their original spelling, for the full-text search box. */
function keywords(question) {
  const seen = new Set();
  const out = [];
  for (const raw of String(question).match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu) || []) {
    const w = raw.replace(/['’]s$/i, '');
    const low = w.toLowerCase();
    if (STOPWORDS.has(low) || (low.length < 2 && !/\d/.test(low)) || seen.has(low)) continue;
    seen.add(low);
    out.push(w);
  }
  return out;
}

const JOINERS = new Set(['of', 'the', 'de', 'la', 'del', 'van', 'von', 'der', 'and', 'for', 'in', 'on', 'du', 'al']);

/** Capitalised runs such as "Apollo 11" or "Bay of Pigs" that are probably article titles. */
function properPhrases(question) {
  const tokens = String(question).match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu) || [];
  const phrases = [];
  let run = [];
  const flush = () => {
    while (run.length && JOINERS.has(run[run.length - 1].toLowerCase())) run.pop();
    if (run.length) phrases.push(run.join(' '));
    run = [];
  };
  tokens.forEach((t, i) => {
    const cap = /^\p{Lu}/u.test(t);
    const num = /^\d/.test(t);
    const low = t.toLowerCase();
    if (cap && !(i === 0 && STOPWORDS.has(low))) run.push(t);
    else if (run.length && (num || JOINERS.has(low))) run.push(t);
    else flush();
  });
  flush();
  // A lone capitalised first word ("Photosynthesis is...") still counts unless it is a stopword.
  return [...new Set(phrases)].filter((p) => p.length > 2);
}

/**
 * Score passages against a query with BM25 plus two gentle priors: an
 * article's opening section, and how well the article itself ranked.
 * @param {Array<{text:string,title:string,lead:boolean,articleRank:number}>} passages
 */
function rankPassages(queryText, passages, { k1 = 1.4, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(queryText))];
  if (!q.length || !passages.length) return passages.map((p) => ({ ...p, score: 0 }));

  const docs = passages.map((p) => {
    const toks = tokenize(`${p.section || ''} ${p.text}`);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, len: toks.length || 1, titleToks: new Set(tokenize(p.title || '')) };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const N = docs.length;
  const idf = new Map(q.map((t) => {
    const df = docs.reduce((n, d) => n + (d.tf.has(t) ? 1 : 0), 0);
    return [t, Math.log(1 + (N - df + 0.5) / (df + 0.5))];
  }));

  return passages.map((p, i) => {
    const d = docs[i];
    let bm = 0;
    let matched = 0;
    for (const t of q) {
      const f = d.tf.get(t) || 0;
      if (!f) continue;
      matched += 1;
      bm += idf.get(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    const titleHits = q.filter((t) => d.titleToks.has(t)).length / q.length;
    const coverage = matched / q.length;
    const score = (bm * (0.6 + 0.4 * coverage) + titleHits * (p.lead ? 1.2 : 0.3))
      * (p.lead ? 1.2 : 1)
      * (1 + 0.5 / (1 + (p.articleRank || 0)));
    return { ...p, score };
  });
}

module.exports = { tokenize, keywords, properPhrases, rankPassages, stem, STOPWORDS };
