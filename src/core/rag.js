'use strict';
// Question answering over the offline copy:
//   1. find candidate articles (title matches + full-text search, several phrasings)
//   2. read them and pick the passages that best match the question
//   3. hand only those passages to the local model and ask for a cited answer

const { extractArticle } = require('./extract');
const { keywords, properPhrases, rankPassages } = require('./rank');

const norm = (s) => String(s).toLowerCase().replace(/[_\s]+/g, ' ').trim();

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i).catch(() => null);
    }
  }));
  return out;
}

/** Ask the model for a few search phrasings. Optional; any failure just returns []. */
async function proposeQueries(llm, question, { signal, onStatus } = {}) {
  try {
    const text = await llm.chat({
      messages: [
        { role: 'system', content: 'You turn a question into search queries for an encyclopedia\'s full-text search. Reply with at most 3 lines. Each line is an article title or 1 to 4 keywords. No numbering, no quotes, no other text.' },
        { role: 'user', content: question },
      ],
      maxTokens: 48, temperature: 0, signal, onStatus,
    });
    return text.split(/\r?\n/)
      .map((l) => l.replace(/^[\s\-*\d.)"'`]+|["'`\s]+$/g, '').trim())
      .filter((l) => l && l.length <= 60 && l.split(/\s+/).length <= 6)
      .slice(0, 3);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}

// ---- conversation memory -------------------------------------------------
// A conversation is a short list of finished turns kept in memory by the app:
//   { question, standalone, answer, sources: [{ title, url }] }
// It is used in two ways: a follow-up ("where did he study?") is first rewritten
// into a question that stands alone, so the search has something to look for,
// and the last few turns are shown to the model when it writes the answer.

const HISTORY_TURNS = 3;
const stripCites = (s) => String(s || '').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s);

/** Rewrite a follow-up so it can be searched without the conversation. Falls back to the question as asked. */
async function standaloneQuestion(llm, question, history, { signal, onStatus } = {}) {
  const turns = (history || []).slice(-HISTORY_TURNS);
  if (!turns.length) return question;
  const convo = turns.map((t) => {
    const a = stripCites(t.answer);
    const about = (t.sources || []).map((x) => x.title).filter(Boolean).join(', ');
    return `Q: ${t.standalone || t.question}\nA: ${a ? clip(a, 300) : `(showed passages${about ? ` from ${about}` : ''})`}`;
  }).join('\n');
  try {
    const text = await llm.chat({
      messages: [
        { role: 'system', content: 'Rewrite the latest question so it can be understood without the conversation. Replace words like he, she, it, they, that and there with what they refer to. If the question already stands alone, repeat it unchanged. Reply with the rewritten question only, on one line.' },
        { role: 'user', content: `Conversation so far:\n${convo}\n\nLatest question: ${question}` },
      ],
      maxTokens: 64, temperature: 0, signal, onStatus,
    });
    const line = text.split(/\r?\n/)
      .map((l) => l.replace(/^(?:rewritten question|latest question|question|q)\s*:\s*/i, '').replace(/^["'`\s]+|["'`\s]+$/g, ''))
      .find(Boolean);
    return line && line.length >= 3 && line.length <= 300 ? line : question;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return question;
  }
}

/**
 * Find the passages most likely to answer the question.
 * @returns {Promise<{passages:Array, articles:Array, queries:string[]}>}
 */
async function retrieve(engine, question, opts = {}) {
  const {
    extraQueries = [], maxArticles = 5, contextChars = 6000, maxPassages = 8,
    pinnedUrl = null, contextArticles = [], signal, onStatus = () => {},
  } = opts;

  const kw = keywords(question);
  const phrases = properPhrases(question).slice(0, 3);
  const scores = new Map(); // path -> { score, title, url, exact }
  const bump = (path, title, url, amount, exact = false) => {
    if (!path) return;
    const cur = scores.get(path) || { score: 0, title, url, exact: false };
    cur.score += /\(disambiguation\)/i.test(title || '') ? amount * 0.3 : amount;
    cur.exact = cur.exact || exact;
    scores.set(path, cur);
  };
  const addList = (items, weight) => items.forEach((it, rank) => bump(it.path, it.title, it.url, weight / (10 + rank)));

  onStatus('Searching the offline copy');
  const tried = [];
  const fullText = async (q, weight) => {
    if (!q || tried.includes(q.toLowerCase())) return 0;
    tried.push(q.toLowerCase());
    const res = await engine.search(q, { pageLength: 8, signal }).catch(() => ({ total: 0, items: [] }));
    addList(res.items, weight);
    return res.items.length;
  };

  // Title matches: strongest signal when the question names its subject.
  await Promise.all([...phrases, kw.join(' ')].filter(Boolean).map(async (term) => {
    const hits = await engine.suggest(term, 3, { signal }).catch(() => []);
    hits.forEach((h, rank) => {
      const exact = norm(h.title) === norm(term);
      bump(h.path, h.title, h.url, (exact ? 30 : 8) / (10 + rank), exact);
    });
  }));

  // Full-text search needs every word to match, so try the full set first and loosen from there.
  let found = await fullText(kw.join(' '), 15);
  await Promise.all(extraQueries.map((q) => fullText(q, 12)));
  await Promise.all(phrases.map((p) => fullText(p, 10)));
  if (found < 3 && kw.length >= 3) {
    const byWeight = [...kw].sort((a, b) => b.length - a.length);
    const variants = kw.length <= 6
      ? kw.map((_, i) => kw.filter((__, j) => j !== i).join(' '))
      : [];
    variants.push(byWeight.slice(0, 3).join(' '), byWeight.slice(0, 2).join(' '));
    const counts = await Promise.all(variants.slice(0, 8).map((v) => fullText(v, 7)));
    found += counts.reduce((a, c) => a + c, 0);
  }
  if (!scores.size && kw.length) {
    await Promise.all(kw.slice(0, 4).map((w) => fullText(w, 4)));
  }

  // Articles the previous answer drew on stay in play for a follow-up. They count for
  // more when the question names no subject of its own ("tell me more about him").
  const carry = phrases.length ? 0.6 : 2;
  for (const a of contextArticles.slice(0, 3)) {
    const path = a.url ? engine.pathForUrl(String(a.url).split('#')[0]) : null;
    if (path) bump(path, a.title || '', engine.urlForPath(path), carry);
  }

  let pinnedPath = null;
  if (pinnedUrl) {
    pinnedPath = engine.pathForUrl(pinnedUrl);
    if (pinnedPath) bump(pinnedPath, '', engine.urlForPath(pinnedPath), 100, true);
  }

  const ranked = [...scores.entries()]
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArticles);
  if (!ranked.length) return { passages: [], articles: [], queries: tried };

  onStatus(`Reading ${ranked.length} article${ranked.length === 1 ? '' : 's'}`);
  const docs = await mapLimit(ranked, 4, async (a) => {
    const { text, url, status } = await engine.fetchHtml(a.url, { signal });
    if (status >= 400) return null;
    const art = extractArticle(text);
    return { ...a, url, title: art.title || a.title, chunks: art.chunks };
  });

  const pool = [];
  docs.forEach((d, articleRank) => {
    if (!d) return;
    for (const c of d.chunks) {
      pool.push({ ...c, title: d.title, url: d.url, path: d.path, articleRank, exact: d.exact });
    }
  });

  const queryText = [question, ...extraQueries].join(' ');
  const scored = rankPassages(queryText, pool).sort((a, b) => b.score - a.score);

  // Opening sections of articles the question names outright (or the open article) always go in.
  const chosen = [];
  const take = (p) => { if (!chosen.includes(p)) chosen.push(p); };
  scored.filter((p) => p.exact && p.lead).slice(0, 2).forEach(take);

  const perArticle = new Map();
  const cap = Math.max(2, Math.ceil(maxPassages / 2));
  let used = chosen.reduce((n, p) => n + p.text.length, 0);
  chosen.forEach((p) => perArticle.set(p.path, (perArticle.get(p.path) || 0) + 1));
  for (const p of scored) {
    if (chosen.length >= maxPassages) break;
    if (chosen.includes(p) || p.score <= 0) continue;
    if ((perArticle.get(p.path) || 0) >= cap && !(pinnedPath && p.path === pinnedPath)) continue;
    if (used + p.text.length > contextChars && chosen.length) continue;
    take(p);
    used += p.text.length;
    perArticle.set(p.path, (perArticle.get(p.path) || 0) + 1);
  }
  if (!chosen.length && scored.length) chosen.push(...scored.filter((p) => p.lead).slice(0, 2));

  const passages = chosen.map((p, i) => ({
    n: i + 1,
    title: p.title,
    section: p.section,
    url: p.anchor ? `${p.url.split('#')[0]}#${encodeURIComponent(p.anchor)}` : p.url,
    text: p.text.length > contextChars ? `${p.text.slice(0, contextChars)}…` : p.text,
  }));
  return {
    passages,
    articles: docs.filter(Boolean).map((d) => ({ title: d.title, url: d.url })),
    queries: tried,
  };
}

function editionLabel(date) {
  if (!date) return '';
  const [y, m] = date.split('-').map(Number);
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
  return month ? `${month} ${y}` : date;
}

function buildMessages(question, passages, { editionDate, history = [], standalone, source = 'Wikipedia' } = {}) {
  const edition = editionLabel(editionDate);
  const turns = history.slice(-HISTORY_TURNS).filter((t) => stripCites(t.answer));
  const system = [
    `You answer questions from an offline copy of English ${source}${edition ? ` (the ${edition} edition)` : ''}.`,
    'Use only the numbered excerpts below. Do not use anything else you know.',
    'After each sentence, cite the excerpt it came from like [1] or [2].',
    'If the excerpts do not answer the question, say that the offline copy did not turn up an answer, and say what the excerpts do cover.',
    'Be brief: one short paragraph, or a short list when several items are asked for.',
    turns.length ? 'Earlier questions and answers are included so you can follow the conversation. Base the new answer on the excerpts given with the latest question.' : '',
  ].filter(Boolean).join(' ');
  const excerpts = passages.map((p) => `[${p.n}] ${p.title}${p.section ? `, section "${p.section}"` : ''}\n${p.text}`).join('\n\n');
  const meaning = standalone && standalone !== question ? `\n(Meaning: ${standalone})` : '';
  const messages = [{ role: 'system', content: system }];
  for (const t of turns) {
    // Old citation numbers would point at the wrong excerpts now, so they are removed.
    messages.push({ role: 'user', content: t.question });
    messages.push({ role: 'assistant', content: clip(stripCites(t.answer), 500) });
  }
  messages.push({ role: 'user', content: `Excerpts:\n\n${excerpts}\n\nQuestion: ${question}${meaning}` });
  return messages;
}

/**
 * Full pipeline. If no model is available the passages are still returned so
 * the app can show them on their own. `history` is the conversation so far.
 */
async function answerQuestion({ engine, llm, question, history = [], settings = {}, editionDate, source, pinnedUrl, signal, onStatus = () => {}, onToken = () => {}, onSources = () => {}, onUnderstood = () => {} }) {
  const useLlm = Boolean(llm);
  const turns = history.slice(-HISTORY_TURNS);

  let standalone = question;
  if (turns.length && useLlm) {
    onStatus('Reading the conversation so far');
    standalone = await standaloneQuestion(llm, question, turns, { signal, onStatus });
    if (standalone !== question) onUnderstood(standalone);
  }

  let extraQueries = [];
  if (useLlm && settings.rewriteQueries !== false) {
    onStatus('Working out what to look up');
    extraQueries = await proposeQueries(llm, standalone, { signal, onStatus });
  }
  const found = await retrieve(engine, standalone, {
    extraQueries, pinnedUrl, signal, onStatus,
    contextArticles: turns.length ? (turns[turns.length - 1].sources || []) : [],
    contextChars: settings.contextChars || 6000,
    maxArticles: settings.maxArticles || 5,
  });
  onSources(found.passages);
  const base = { passages: found.passages, queries: found.queries, standalone };
  if (!found.passages.length) return { ...base, text: '', empty: true };
  if (!useLlm) return { ...base, text: '', passagesOnly: true };

  onStatus('Writing the answer');
  const text = await llm.chat({
    messages: buildMessages(question, found.passages, { editionDate, source, history: turns, standalone }),
    maxTokens: settings.maxAnswerTokens || 400,
    temperature: 0.2,
    signal, onToken,
    onStatus,
  });
  return { ...base, text };
}

/** What a finished turn contributes to the conversation: the articles it cited, or its top passages. */
function turnSources(text, passages) {
  const cited = new Set((String(text || '').match(/\[(\d+(?:\s*,\s*\d+)*)\]/g) || []).flatMap((m) => m.slice(1, -1).split(',').map(Number)));
  const used = passages.filter((p) => cited.has(p.n));
  const out = new Map();
  for (const p of (used.length ? used : passages.slice(0, 2))) {
    const url = p.url.split('#')[0];
    if (!out.has(url)) out.set(url, { title: p.title, url });
  }
  return [...out.values()].slice(0, 3);
}

module.exports = { retrieve, buildMessages, answerQuestion, proposeQueries, standaloneQuestion, turnSources, editionLabel, HISTORY_TURNS };
