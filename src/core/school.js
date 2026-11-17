'use strict';
// School: a year of lessons laid out week by week from a curriculum registry (assets/school/*.json).
//
// The registry names the publisher's files and says how many lessons each unit has. Everything in
// this file is plain data work with no Electron and no network:
//   buildYear   spreads each subject's lessons over the school year
//   find...     guess the page of a PDF where a lesson, an answer key or a test starts, from its text
//   linksFor    the buttons a day's entry gets: which file, which page
//   searchPages full-text search over the page texts

const fs = require('node:fs');
const path = require('node:path');
const { outline } = require('./school-outline');

// ---------------------------------------------------------------- registry

function fileName(url) {
  const last = new URL(url).pathname.split('/').pop();
  try { return decodeURIComponent(last); } catch { return last; }
}
/** A short, stable name for a file, from the publisher's own file name. */
function fileId(url) {
  return fileName(url).replace(/\.[a-z0-9]+$/i, '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function loadManifest(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!m || !Array.isArray(m.subjects) || !m.grade) throw new Error('Not a curriculum registry.');
  const seen = new Map();
  for (const s of m.subjects) {
    for (const holder of [...s.units, { files: s.extras || [] }]) {
      for (const f of holder.files) {
        f.id = fileId(f.url);
        f.name = fileName(f.url);
        if (seen.has(f.id) && seen.get(f.id) !== f.url) throw new Error(`Two files share the name ${f.id}.`);
        seen.set(f.id, f.url);
      }
    }
  }
  return m;
}

/** Every distinct file in the registry, with the subject and units that use it. */
function allFiles(manifest) {
  const out = new Map();
  for (const s of manifest.subjects) {
    const take = (f, unit) => {
      if (!out.has(f.id)) out.set(f.id, { id: f.id, url: f.url, name: f.name, label: f.label, role: f.role, subject: s.id, subjectName: s.name, units: [], where: unit ? `Unit ${unit.n}: ${unit.title}` : 'For the whole year' });
      const e = out.get(f.id);
      if (unit) { e.units.push(unit.id); if (e.units.length > 1) e.where = `Units ${e.units.map((id) => id.split('-u')[1]).join(', ')}`; }
    };
    for (const u of s.units) for (const f of u.files) take(f, u);
    for (const f of s.extras || []) take(f, null);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- the year

/** The teaching days of one unit, in order. */
function unitSessions(subject, unit) {
  const base = { subject: subject.id, subjectName: subject.name, minutes: subject.minutes, unitId: unit.id, unitN: unit.n, unitTitle: unit.title };
  const out = [];
  const extras = (when) => {
    for (const e of unit.extra || []) {
      if (Boolean(e.before) !== when) continue;
      const tag = e.title.toLowerCase().replace(/[^a-z]+/g, '-');
      for (let k = 1; k <= e.count; k++) out.push({ ...base, id: `${unit.id}:${tag}:${k}`, kind: e.kind, n: k, of: e.count, label: e.count > 1 ? `${e.title} (day ${k} of ${e.count})` : e.title });
    }
  };
  extras(true);
  const p = unit.plan;
  if (p.days) for (let k = 1; k <= p.days; k++) out.push({ ...base, id: `${unit.id}:day:${k}`, kind: 'day', n: k, of: p.days, label: `Day ${k} of ${p.days}` });
  else for (let k = 1; k <= p.lessons; k++) out.push({ ...base, id: `${unit.id}:lesson:${k}`, kind: 'lesson', n: k, of: p.lessons, word: p.word || 'Lesson', label: `${p.word || 'Lesson'} ${k}` });
  extras(false);
  return out;
}

/**
 * Spread each subject's days evenly over the year. A subject with fewer days than the year has
 * school days gets free days in between; one with more gets some double days.
 * The calendar is this app's own arrangement: the publishers give an order, not dates.
 */
function buildYear(manifest, { skip = [] } = {}) {
  const weeksN = manifest.weeks || 36;
  const perWeek = manifest.daysPerWeek || 5;
  const slots = weeksN * perWeek;
  const weeks = Array.from({ length: weeksN }, (_, w) => ({ number: w + 1, semester: w < weeksN / 2 ? 1 : 2, days: Array.from({ length: perWeek }, () => []) }));
  const totals = [];
  for (const s of manifest.subjects) {
    const sessions = s.units.filter((u) => !skip.includes(u.id)).flatMap((u) => unitSessions(s, u));
    sessions.forEach((x, i) => {
      const slot = Math.min(slots - 1, Math.floor((i * slots) / Math.max(sessions.length, 1)));
      weeks[Math.floor(slot / perWeek)].days[slot % perWeek].push(x);
    });
    totals.push({ subject: s.id, name: s.name, sessions: sessions.length, minutes: s.minutes });
  }
  for (const w of weeks) w.summary = weekSummary(manifest, w.days.flat());
  return { weeks, slots, totals };
}

/** "Unit 2, Fractions as Quotients: Lessons 3 to 7" for each subject in a week. */
function weekSummary(manifest, sessions) {
  const out = [];
  for (const s of manifest.subjects) {
    const mine = sessions.filter((x) => x.subject === s.id);
    if (!mine.length) continue;
    const units = [];
    for (const x of mine) {
      let u = units.find((e) => e.unitId === x.unitId);
      if (!u) { u = { unitId: x.unitId, n: x.unitN, title: x.unitTitle, focus: s.units.find((e) => e.id === x.unitId)?.focus || '', parts: [] }; units.push(u); }
      const last = u.parts[u.parts.length - 1];
      if ((x.kind === 'lesson' || x.kind === 'day') && last && last.kind === x.kind && last.to === x.n - 1) last.to = x.n;
      else if (x.kind === 'lesson' || x.kind === 'day') u.parts.push({ kind: x.kind, word: x.kind === 'day' ? 'Day' : x.word, from: x.n, to: x.n });
      else if (!u.parts.some((p) => p.text === x.label.replace(/ \(day \d+ of \d+\)$/, ''))) u.parts.push({ kind: x.kind, text: x.label.replace(/ \(day \d+ of \d+\)$/, '') });
    }
    for (const u of units) u.covers = u.parts.map((p) => p.text || (p.from === p.to ? `${p.word} ${p.from}` : `${p.word}s ${p.from} to ${p.to}`)).join(', ');
    out.push({ subject: s.id, name: s.name, units: units.map(({ unitId, n, title, focus, covers }) => ({ unitId, n, title, focus, covers })) });
  }
  return out;
}

// ---------------------------------------------------------------- finding pages
// These work from the text of each page (top of the page first). They are guesses: a wrong one
// opens the right book a few pages off, and a miss opens the book at its first page.

const HEAD = 260; // how much of the top of a page counts as its heading
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numbered = (word, n) => new RegExp(`\\b${esc(word)}\\s+${n}(?!\\d)`, 'i');
/** A page that names four or more different lessons is a contents page or a pacing chart, not a lesson. */
function isChart(text, word) {
  const found = new Set();
  for (const m of text.matchAll(new RegExp(`\\b${esc(word)}s?\\s+(\\d{1,2})(?!\\d)`, 'gi'))) { found.add(m[1]); if (found.size >= 4) return true; }
  return false;
}

/**
 * The page (counting from 0) where lesson or chapter `n` starts. In a book that holds several units,
 * `part` picks the unit: its lessons start again from 1.
 */
function findLesson(pages, word, n, part = 1) {
  // Three ways a page can name the lesson, strongest first: a line near the top that starts with
  // "Lesson 3" or ends with it (a running head); anywhere in the top of the page; anywhere at all.
  const lineStart = new RegExp(`^${esc(word)}\\s+${n}(?!\\d)`, 'i');
  const lineEnd = new RegExp(`\\b${esc(word)}\\s+${n}$`, 'i');
  const tests = {
    line: (t, k) => { const a = k === n ? lineStart : new RegExp(`^${esc(word)}\\s+${k}(?!\\d)`, 'i'); const z = k === n ? lineEnd : new RegExp(`\\b${esc(word)}\\s+${k}$`, 'i'); return t.split('\n', 8).some((l) => a.test(l.trim()) || z.test(l.trim())); },
    head: (t, k) => numbered(word, k).test(t.slice(0, HEAD)),
    whole: (t, k) => numbered(word, k).test(t),
  };
  const at = (i, k, how) => !isChart(pages[i], word) && tests[how](pages[i], k);
  let from = 0;
  let to = pages.length;
  if (part > 1) {
    // Where each part begins: a page headed "Lesson 1" after a stretch of pages that are not.
    let starts = [];
    for (const how of ['line', 'head']) {
      starts = [];
      let last = -100;
      for (let i = 0; i < pages.length; i++) {
        if (!at(i, 1, how)) continue;
        if (i - last > 12) starts.push(i);
        last = i;
      }
      if (starts.length >= part) break;
    }
    if (starts.length < part) return null;
    from = starts[part - 1];
    to = starts[part] ?? pages.length;
  }
  for (const how of ['line', 'head', 'whole']) {
    for (let i = from; i < to; i++) if (at(i, n, how)) return i;
  }
  return null;
}

/** In a language arts activity book the pages for lesson 4 are numbered 4.1, 4.2 and so on. */
function findActivity(pages, n) {
  const re = new RegExp(`(^|[^\\d.])${n}\\.1(?![\\d.])`);
  for (let i = 0; i < pages.length; i++) if (re.test(pages[i].slice(0, HEAD))) return i;
  for (let i = 0; i < pages.length; i++) if (re.test(pages[i])) return i;
  return null;
}

/** The first page, from `from` on, whose heading has one of the phrases. Earlier phrases are preferred. */
function findHeading(pages, phrases, { from = 0, to = Infinity, word = 'Lesson' } = {}) {
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${esc(phrase)}`, 'i');
    const flat = phrase.toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (let i = Math.max(0, from); i < Math.min(to, pages.length); i++) {
      // Small capitals come out as "P ACING G UIDE": compare with the spaces taken out as well.
      if ((re.test(pages[i].slice(0, HEAD)) || pages[i].slice(0, HEAD).toLowerCase().replace(/[^a-z0-9]+/g, '').includes(flat)) && !isChart(pages[i], word) && !/\.{5,}|(\s\.){5,}/.test(pages[i].slice(0, 600))) return i;
    }
  }
  return null;
}

// ---------------------------------------------------------------- guided lessons

const outlines = new WeakMap();
/** The outline of a teacher guide, worked out once for each set of pages. */
function outlineOf(pages, style) {
  if (!outlines.has(pages)) { let o = []; try { o = outline(pages, style); } catch { o = []; } outlines.set(pages, o); }
  return outlines.get(pages);
}

/**
 * The lesson of the teacher guide that a day of the plan teaches, from the guide's own outline.
 * A science unit planned by days is walked lesson by lesson: a lesson the guide gives two days
 * takes two days of the plan. Returns null when the guide has not been read or has no such lesson.
 */
function lessonOf(session, unit, subject, pagesOf) {
  const teacher = unit.files.find((f) => f.role === 'teacher');
  const pages = teacher && pagesOf(teacher.id);
  if (!pages) return null;
  const part = outlineOf(pages, subject.id)[(unit.part || 1) - 1];
  if (!part) return null;
  if (session.kind === 'lesson') { const l = part.lessons.get(session.n); return l ? { lesson: l, fileId: teacher.id, day: null } : null; }
  if (session.kind !== 'day') return null;
  let k = session.n;
  for (const l of [...part.lessons.values()].sort((a, b) => a.n - b.n)) {
    if (k <= l.days) return { lesson: l, fileId: teacher.id, day: l.days > 1 ? k : null };
    k -= l.days;
  }
  return null;
}

/**
 * A day of the plan as steps to click through. Every step names a book and a page; `links` are the
 * other books the lesson uses. The first step is always "get ready" and the last "check and finish",
 * so a lesson whose inside could not be read still has a beginning, a middle and an end.
 */
function guideFor(session, unit, subject, pagesOf) {
  const links = linksFor(session, unit, subject, pagesOf);
  const found = lessonOf(session, unit, subject, pagesOf);
  const word = session.word || unit.plan.word || 'Lesson';
  const out = { title: session.label, name: '', question: '', minutes: subject.minutes, read: Boolean(found), steps: [], links };
  const main = links[0] || null;
  const step = (title, extra = {}) => out.steps.push({ title, group: null, minutes: null, note: '', fileId: main ? main.fileId : null, page: main ? main.page : null, ...extra });
  const answers = links.find((l) => l.label === 'Answer key');
  if (found) {
    const { lesson, fileId, day } = found;
    out.name = lesson.title;
    out.question = lesson.question;
    if (session.kind === 'day') out.title = `${word} ${lesson.n}${day ? `, day ${day} of ${lesson.days}` : ''}`;
    const mine = lesson.steps.filter((x) => !day || !x.day || x.day === day);
    step('Get ready', { note: day && day > 1 ? 'Look back at where the last session stopped, and set out what today needs.' : 'Read what the lesson is for, and gather what it needs.', fileId, page: lesson.page + 1 });
    if (mine.length) for (const x of mine) step(x.title, { group: x.group, minutes: x.minutes, optional: Boolean(x.optional), fileId, page: x.page + 1 });
    else step('Teach the lesson', { note: 'This guide does not time the parts of its lessons. Work through the lesson from here.', fileId, page: lesson.page + 1 });
  } else if (session.kind === 'assessment' || session.kind === 'review') {
    step(session.kind === 'review' ? 'Review, then give the test' : 'Give the test', { note: 'The pages to hand out follow from here.' });
  } else if (session.kind === 'day' && links[0] && links[0].label === 'Unit assessment') {
    out.title = 'Review and unit assessment';
    step('Review the unit', { note: 'The lessons of this unit are finished. Use this day to go back over what was hard, then give the unit assessment.', page: null });
    step('Give the unit assessment', { note: 'The pages to hand out start here.' });
  } else {
    step('Get ready', { note: 'Read the plan for this day in the teacher guide.' });
    step('Teach the lesson', { note: 'Work through the lesson from the teacher guide, with the student books beside it.' });
  }
  step('Check the work and finish', { kind: 'finish', note: answers ? 'Go over the answers together, then mark the lesson done.' : 'Look over the work together, then mark the lesson done.', fileId: answers ? answers.fileId : main ? main.fileId : null, page: answers ? answers.page : main ? main.page : null });
  return out;
}

/** A reader's chapter: "Chapter 3" at the head of the page, or "Chapter" and "3" on lines of their own. */
function findChapter(pages, n, part = 1) {
  if (part === 1) {
    for (let i = 0; i < pages.length; i++) {
      const ls = pages[i].split('\n', 12).map((l) => l.trim()).filter(Boolean).slice(0, 6);
      const at = ls.indexOf('Chapter');
      if (at >= 0 && ls[at + 1] === String(n)) return i;
    }
  }
  return findLesson(pages, 'Chapter', n, part);
}

/**
 * What a day's entry links to. `pagesOf(fileId)` returns the page texts of a file, or null when it
 * has not been downloaded and read yet. Page numbers in the result count from 1; null means "open
 * at the start".
 */
function linksFor(session, unit, subject, pagesOf) {
  const out = [];
  const file = (role) => unit.files.find((f) => f.role === role);
  const add = (label, f, find) => {
    if (!f) return;
    const pages = pagesOf(f.id);
    let page = null;
    if (pages && find) { try { page = find(pages); } catch { page = null; } }
    out.push({ label, fileId: f.id, ready: Boolean(pages), page: page == null ? null : page + 1 });
  };
  const teacher = file('teacher');
  const student = file('student');
  const reader = file('reader');
  const word = session.word || unit.plan.word || 'Lesson';
  const mine = lessonOf(session, unit, subject, pagesOf);
  // The tests and answers of a unit follow its last lesson. In a book of several units, stop at the next unit.
  const tp = teacher && pagesOf(teacher.id);
  const parts = tp ? outlineOf(tp, subject.id) : [];
  const myPart = parts[(unit.part || 1) - 1];
  const backFrom = myPart && myPart.lessons.size ? Math.max(...[...myPart.lessons.values()].map((l) => l.page)) : null;
  const backTo = unit.part && parts[unit.part] ? parts[unit.part].from : Infinity; // only a book the registry says is shared
  const back = (pages) => (pages === tp && backFrom != null ? backFrom : Math.floor(pages.length * 0.45));
  const answers = (pages) => findHeading(pages, ['answer key', 'answers'], { from: back(pages), to: pages === tp ? backTo : Infinity, word });
  const test = (pages, phrases, from) => findHeading(pages, phrases, { from: pages === tp && backFrom != null ? backFrom : from, to: pages === tp ? backTo : Infinity, word });

  const lessonPage = (p) => (mine ? mine.lesson.page : findLesson(p, word, session.n, unit.part || 1));
  if (session.kind === 'lesson') {
    add('Lesson plan', teacher, lessonPage);
    if (subject.id === 'ela') add('Activity pages', student, (p) => findActivity(p, session.n));
    else add('Student pages', student, (p) => findLesson(p, word, session.n, unit.part || 1));
    add(word === 'Chapter' ? 'Reading' : 'Reader', reader, word === 'Chapter' ? (p) => findChapter(p, session.n, unit.part || 1) : mine && mine.lesson.chapter ? (p) => findChapter(p, mine.lesson.chapter) : null);
    add('Answer key', teacher, answers);
  } else if (session.kind === 'day') {
    if (mine) add('Lesson plan', teacher, lessonPage);
    // Once the guide has been read, a day past its last lesson is the unit's review and assessment.
    if (!mine && myPart && myPart.lessons.size) add('Unit assessment', teacher, (p) => test(p, ['unit assessment'], Math.floor(p.length * 0.3)));
    else if (!mine) add('Teacher guide', teacher, null);
    add('Student pages', student, null);
    add('Reader', reader, mine && mine.lesson.chapter ? (p) => findChapter(p, mine.lesson.chapter) : null);
    add('Answer key', teacher, answers);
  } else if (session.kind === 'assessment') {
    const phrases = /beginning-of-year/i.test(session.label) ? ['beginning-of-year assessment'] : /end-of-year/i.test(session.label) ? ['end-of-year assessment']
      : ['end-of-unit assessment', 'unit assessment', 'assessments', 'assessment'];
    add('The test', teacher, (p) => (/beginning|end-of-year/i.test(session.label) ? findHeading(p, phrases, { from: 0, word }) : test(p, phrases, Math.floor(p.length * 0.3))));
    add('Answer key', teacher, answers);
  } else {
    add('Review and test', teacher, (p) => test(p, ['pausing point', 'unit assessment', 'assessment'], Math.floor(p.length * 0.3)));
    add('Activity pages', student, null);
    add('Answer key', teacher, answers);
  }
  return out;
}

// ---------------------------------------------------------------- search

/**
 * Pages that contain every word of the query. `books` is a list of { id, pages }.
 * Returns the best `limit` as { fileId, page (from 1), score, snippet }.
 */
function searchPages(books, query, { limit = 40 } = {}) {
  const words = [...new Set(String(query || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 8);
  if (!words.length) return [];
  const res = words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}`, 'giu'));
  const hits = [];
  for (const book of books) {
    book.pages.forEach((text, i) => {
      if (!text) return;
      let score = 0;
      let first = -1;
      for (const re of res) {
        re.lastIndex = 0;
        const m = text.match(re);
        if (!m) return;
        score += Math.min(m.length, 6);
        const at = text.search(re);
        if (first < 0 || at < first) first = at;
        if (at < HEAD) score += 4; // in the heading of the page
      }
      if (!score) return;
      const start = Math.max(0, first - 70);
      const snippet = `${start ? '…' : ''}${text.slice(start, start + 220).replace(/\s+/g, ' ').trim()}${start + 220 < text.length ? '…' : ''}`;
      hits.push({ fileId: book.id, page: i + 1, score, snippet });
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit);
}

module.exports = { findChapter, guideFor, lessonOf, loadManifest, allFiles, fileId, fileName, unitSessions, buildYear, weekSummary, findLesson, findActivity, findHeading, isChart, linksFor, searchPages, MANIFEST_DIR: path.join(__dirname, '..', '..', 'assets', 'school') };
