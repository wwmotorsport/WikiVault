'use strict';
// School: the outline of a teacher guide, read from the text of its pages.
//
// The Core Knowledge teacher guides are regular. Every lesson (or chapter) starts on a page headed
// "Lesson 4", "CHAPTER 4" or "Lesson 4: Title", and inside it every part of the lesson is a heading
// that ends with its time: "Introduce the Chapter 5 minutes", "2. Preview the investigation. 5 MIN",
// "Warm-up 10 min". This file turns those headings into the steps of a guided lesson.
//
// Plain data work: no Electron, no network. Pages are counted from 0 here.

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
/** Small capitals come out of a PDF as "t he c ore l esson". Compare such headings with the spaces taken out. */
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
/** Some fonts in these files have no usable letter table, and their text comes out as noise. */
function readable(s) {
  if (!s || s.length < 3) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.6 || /[!<>/\\*$%&+=]{1}[a-z]|[a-z][!<>/\\*$%+=]/.test(s)) return false;
  // Real titles are made of words that have vowels.
  const words = s.split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
  return words.every((w) => /[aeiouyAEIOUY]/.test(w));
}
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.;:?!])/g, '$1').trim();

const TIMED = /^(.*?)\s*(\d{1,3}(?:\s*[–-]\s*\d{1,3})?)\s*(?:minutes|min|MIN)\b\.?\s*(\(\s*PER DAY\s*\))?$/;
const firstMinutes = (m) => Number(String(m).split(/[–-]/)[0]);

/** The number a page is headed with, when it is the first page of a lesson or chapter. */
function startNumber(text, style) {
  const ls = lines(text).slice(0, 7);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (style === 'math') {
      const m = /^Lesson (\d{1,2}):\s*(.*)$/.exec(l);
      if (m && !ls.some((x) => /^Cool[ -]Down:/i.test(x))) return { n: Number(m[1]), title: m[2] };
    } else {
      // Language arts guides head a lesson "Lesson 4"; history and science guides use capitals, which
      // tells the lesson apart from a materials list that names it.
      const m = style === 'ela' ? (i < 3 ? /^Lesson (\d{1,2})$/.exec(l) : null) : /^(?:LESSON|CHAPTER) (\d{1,2})(?:, PART 1)?$/.exec(l);
      if (m) return { n: Number(m[1]), at: i };
    }
  }
  return null;
}

/**
 * Where each lesson starts. A book that holds several units numbers its chapters from 1 again for
 * each; those are the "parts". Returns [{ from, starts: Map(n -> page) }].
 */
function lessonStarts(pages, style) {
  if (style === 'math') {
    // The running head, "Unit 2 Lesson 5", is in a font that always reads; the lesson's own heading
    // often is not. A lesson that starts on a left-hand page has its first running head one page on.
    const starts = new Map();
    pages.forEach((text, i) => {
      for (const l of lines(text)) {
        const m = /^Unit \d+ Lesson (\d{1,2})(\s+\d+)?$/.exec(l);
        if (!m || starts.has(Number(m[1]))) continue;
        const heading = (t) => lines(t).slice(0, 8).some((x) => /^.{0,2}esson\s*.{0,3}:\s/.test(x)) && !/Cool[ -]Down:/i.test(t.slice(0, 300));
        starts.set(Number(m[1]), i > 0 && heading(pages[i - 1]) && !heading(text) ? i - 1 : i);
      }
    });
    const heading = (t) => lines(t).slice(0, 8).some((x) => /^.{0,2}esson\s*.{0,3}:\s/.test(x)) && !/Cool[ -]Down:/i.test(t.slice(0, 300));
    // A lesson printed under its neighbour's running head (it happens): its own heading still marks it.
    for (let n = 2; starts.size && n < Math.max(...starts.keys()); n++) {
      if (starts.has(n) || !starts.has(n - 1) || !starts.has(n + 1)) continue;
      for (let i = starts.get(n - 1) + 2; i < starts.get(n + 1); i++) if (heading(pages[i])) { starts.set(n, i); break; }
    }
    return starts.size ? [{ from: Math.min(...starts.values()), starts }] : [];
  }
  const parts = [];
  let cur = null;
  let last = 0;
  pages.forEach((text, i) => {
    const s = startNumber(text, style);
    if (!s) return;
    if (cur && s.n > last && s.n <= last + 2) { cur.starts.set(s.n, i); last = s.n; }
    else if (s.n === 1 && (!cur || last >= 2)) { cur = { from: i, starts: new Map([[1, i]]) }; parts.push(cur); last = 1; }
  });
  return parts;
}

const END = /^(pausing point|teacher resources|unit assessment|assessment|end-of-unit|culminating|glossary|appendix|activity page|answer key|name date|tm$)/i;

/** The last page of lesson `n`, given where the next one starts. */
function lessonEnd(pages, part, n, nextPartFrom) {
  const start = part.starts.get(n);
  let next = null;
  for (const [k, p] of part.starts) if (k > n && (next == null || p < next)) next = p;
  if (next != null) return next;
  const cap = Math.min(nextPartFrom ?? pages.length, start + 45, pages.length);
  for (let i = start + 1; i < cap; i++) { const l = lines(pages[i])[0] || ''; if (END.test(l) || /^unit \d+ (section|end)/i.test(l)) return i; }
  return cap;
}

const ELA_PARTS = new Set(['reading', 'writing', 'grammar', 'morphology', 'spelling', 'language', 'coreconnections', 'speakingandlistening', 'vocabulary']);

/** Headings that end with a time, in order, between two pages. */
function timedHeadings(pages, from, to, style) {
  const out = [];
  for (let i = from; i < to; i++) {
    const ls = lines(pages[i]);
    if (style === 'ela' && (i === from || ls.slice(0, 6).some((l) => squash(l).startsWith('ataglance')))) continue; // a lesson opens with its aims and a chart that repeats the headings
    for (const l of ls) {
      const m = TIMED.exec(l);
      if (!m || m[1].length < 3 || m[1].length > 110) continue;
      if (/\|/.test(l) || /^(day|week|lesson|chapter)\s+\d/i.test(m[1]) && style !== 'sci') continue;
      out.push({ raw: m[1], minutes: firstMinutes(m[2]), page: i, perDay: Boolean(m[3]) });
    }
  }
  return out;
}

function elaSteps(pages, from, to) {
  // Keep the last place a heading appears: the first is often a chart at the head of the lesson.
  const seen = new Map();
  timedHeadings(pages, from, to, 'ela').forEach((h, k) => seen.set(squash(h.raw), { ...h, k }));
  const heads = [...seen.values()].sort((a, b) => a.page - b.page || a.k - b.k);
  const steps = [];
  let group = null;
  let pending = null;
  const flush = () => { if (pending) steps.push(pending); pending = null; };
  for (const h of heads) {
    const isPart = ELA_PARTS.has(squash(h.raw)) || (h.raw === h.raw.toUpperCase() && /[A-Z]{4}/.test(h.raw));
    if (isPart) {
      flush();
      group = tidy(h.raw.charAt(0) + h.raw.slice(1).toLowerCase());
      pending = { title: group, group: null, minutes: h.minutes, page: h.page }; // stands as a step if nothing follows under it
    } else {
      pending = null;
      steps.push({ title: tidy(h.raw.replace(/^.*\b(Word Work:)/, '$1')), group, minutes: h.minutes, page: h.page });
    }
  }
  flush();
  return steps;
}

function histSteps(pages, from, to) {
  const steps = [];
  let optional = false;
  for (let i = from; i < to; i++) {
    for (const l of lines(pages[i])) {
      if (squash(l) === 'additionalactivities') { optional = true; continue; }
      const m = TIMED.exec(l);
      if (!m || m[1].length < 3 || /\|/.test(l)) continue;
      const key = squash(m[1]);
      if (key === 'thecorelesson') continue;
      const title = key === 'checkforunderstanding' ? 'Check for understanding' : tidy(m[1].replace(/\s*\((?:RI|RL|W|SL|L)\.[^)]*\)\s*$/, ''));
      if (!readable(title)) continue;
      steps.push({ title, group: optional ? 'Additional activities (optional)' : null, optional, minutes: firstMinutes(m[2]), page: i });
    }
  }
  return steps;
}

const DAY_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function sciSteps(pages, from, to) {
  const steps = [];
  let day = 1;
  let days = 1;
  for (let i = from; i < to; i++) {
    for (const l of lines(pages[i])) {
      const core = /^thecorelesson([a-z]+)days/.exec(squash(l));
      if (core && DAY_WORDS[core[1]]) days = DAY_WORDS[core[1]];
      const m = TIMED.exec(l);
      if (!m) continue;
      const s = /^(\d{1,2})\.\s*(?:Day\s+(\d)\s*:\s*)?(.+)$/.exec(m[1]);
      if (!s) continue;
      if (s[2]) day = Number(s[2]);
      else if (s[1] === '1' && steps.length && steps[steps.length - 1].day === day && days > 1) day += 1;
      steps.push({ title: tidy(s[3]).replace(/\.$/, ''), group: null, minutes: firstMinutes(m[2]), page: i, day });
    }
  }
  days = Math.max(days, ...steps.map((s) => s.day), 1);
  return { steps, days };
}

/**
 * The parts of a maths lesson. Every lesson has the same shape: a warm-up, one to three activities
 * and a lesson synthesis, each headed with its time ("Activity 2 20 min", or "15 min" above
 * "Activity 1"), and a cool-down printed beside the lesson's timeline. Several of these files use
 * fonts whose letters do not all come out ("/arm-up 10 min", "\u0013,ti?itB 5 min"), so a heading
 * is known by its shape and its place in the lesson when its words cannot be read.
 */
function mathSteps(pages, from, to) {
  const heads = [];
  let coolPage = null;
  const minutes = new Map();
  for (let i = from; i < to; i++) {
    const ls = lines(pages[i]);
    const timed = ls.map((l) => { const at = l.search(/(^|\s)\S{0,3} ?min(\s|$)/); return at >= 0 && at <= 24; });
    for (let k = 0; k < ls.length; k++) {
      if (!timed[k]) continue;
      const l = ls[k];
      let near = 0;
      for (let j = Math.max(0, k - 5); j <= Math.min(ls.length - 1, k + 5); j++) if (j !== k && timed[j]) near += 1;
      if (near >= 2) { // the timeline: it lists every part, and the cool-down follows it
        const t = /^(Warm-up|Activity \d|Lesson Synthesis|Cool-down)\s+(\d+) min/.exec(l);
        if (t && !minutes.has(t[1])) minutes.set(t[1], Number(t[2]));
        if (coolPage == null || i <= coolPage + 1) coolPage = i;
        continue;
      }
      const m = /^(?:(\S.{0,20}?) )?(\S{0,3}) ?min$/.exec(l);
      if (!m) continue;
      let name = m[1] || '';
      let mins = /^\d+$/.test(m[2]) ? Number(m[2]) : null;
      if (/^\S{1,3}$/.test(name) && !m[2]) { mins = /^\d+$/.test(name) ? Number(name) : null; name = ''; } // "15 min" alone
      let titleAt = k + 1;
      if (!name) { // "15 min" above the heading
        const next = ls[k + 1] || '';
        if (timed[k + 1] || next.length > 16) continue;
        name = next; titleAt = k + 2;
      }
      if (/ool.?down/i.test(name) || /^.?ool/.test(name)) { coolPage = coolPage ?? i; continue; }
      if (name.split(' ').length > 2) continue;
      const last = heads[heads.length - 1];
      if (last && last.page === i && k - last.line <= 2) continue;
      const title = ls[titleAt] || '';
      heads.push({ page: i, line: k, name, mins, title: readable(title) && title.length <= 70 && !/^(Standards|Student-facing|Instructional|Addressing|Building|Activity|Launch)/.test(title) ? tidy(title) : '' });
    }
  }
  const steps = [];
  let act = 0;
  heads.forEach((h, idx) => {
    let name;
    if (/^Warm-up$/.test(h.name)) name = 'Warm-up';
    else if (/^Activity \d$/.test(h.name)) { act = Number(h.name.slice(-1)); name = h.name; }
    else if (/^Lesson Synthesis$/.test(h.name) || (idx === heads.length - 1 && heads.length >= 3 && (/ /.test(h.name) && h.name.length >= 14))) name = 'Lesson Synthesis';
    else if (idx === 0 && !/ /.test(h.name.trim())) name = 'Warm-up';
    else if (idx === heads.length - 1 && heads.length >= 3 && act >= 1 && !/ \S$/.test(h.name)) name = 'Lesson Synthesis';
    else { act += 1; name = `Activity ${act}`; }
    if (steps.some((x) => x.name === name)) return;
    const label = name === 'Lesson Synthesis' ? 'Lesson synthesis: talk over what was learned' : h.title ? `${name}: ${h.title}` : name;
    steps.push({ name, title: label, group: null, minutes: minutes.get(name) ?? h.mins, page: h.page });
  });
  if (steps.length) steps.push({ name: 'Cool-down', title: 'Cool-down: a short task to check the lesson', group: null, minutes: minutes.get('Cool-down') ?? 5, page: coolPage ?? from });
  return steps.map(({ name, ...rest }) => rest);
}

function titleOf(pages, start, style, n) {
  const ls = lines(pages[start]);
  const out = { title: '', question: '' };
  if (style === 'math') {
    const m = ls.map((l) => /^Lesson \d{1,2}:\s*(.+)$/.exec(l)).find(Boolean);
    if (m && readable(m[1])) out.title = tidy(m[1]);
    else {
      // The same title is printed, in a font that reads, on the cool-down sheet at the back.
      const re = new RegExp(`^Lesson ${n}:\\s*(.+)$`);
      for (let i = pages.length - 1; i > start; i--) { const t = lines(pages[i]).slice(0, 3).map((l) => re.exec(l)).find(Boolean); if (t && readable(t[1])) { out.title = tidy(t[1]); break; } }
    }
    return out;
  }
  const at = ls.findIndex((l) => /^(?:lesson|chapter)\s+\d{1,2}(,\s*part\s+1)?$/i.test(l));
  const rest = ls.slice(at + 1, at + 8);
  const q = rest.findIndex((l) => /^(the )?(big|driving|lesson) question:/i.test(l));
  if (q >= 0) {
    let text = rest[q].replace(/^(the )?(big|driving|lesson) question:\s*/i, '');
    for (let k = q + 1; k < rest.length && !/[?.]$/.test(text) && text.length < 220; k++) text += ` ${rest[k]}`;
    out.question = tidy(text);
    if (style !== 'ela') out.title = tidy(rest.slice(0, q).join(' '));
  } else if (style === 'sci' && rest[0] && readable(rest[0])) out.title = tidy(rest[0]);
  if (out.title.length > 90 || !readable(out.title)) out.title = '';
  return out;
}

/** "LESSON 4, PART 2 / Including People's Ideas": each part is a step. */
function partSteps(pages, from, to, n) {
  const steps = [];
  const re = new RegExp(`^lesson\\s+${n},\\s*part\\s+(\\d)$`, 'i');
  for (let i = from; i < to; i++) {
    const ls = lines(pages[i]).slice(0, 4);
    const at = ls.findIndex((l) => re.test(l));
    if (at < 0) continue;
    const title = ls[at + 1] && readable(ls[at + 1]) ? `: ${tidy(ls[at + 1])}` : '';
    steps.push({ title: `Part ${re.exec(ls[at])[1]}${title}`, group: null, minutes: null, page: i });
  }
  return steps;
}

/**
 * The outline of a teacher guide: for each part of the book, its lessons with their first page,
 * title, big question and timed steps. `style` is 'ela', 'math', 'hist' or 'sci'.
 */
function outline(pages, style) {
  const parts = lessonStarts(pages, style);
  return parts.map((part, pi) => {
    const lessons = new Map();
    for (const n of [...part.starts.keys()].sort((a, b) => a - b)) {
      const from = part.starts.get(n);
      const to = lessonEnd(pages, part, n, parts[pi + 1]?.from);
      const base = { n, page: from, end: to, days: 1, chapter: null, ...titleOf(pages, from, style, n) };
      for (let i = from; i < to && base.chapter == null; i++) { const c = /\bChapter\s+(\d{1,2})\b(?!\s*min)/.exec(pages[i]); if (c) base.chapter = Number(c[1]); }
      if (style === 'sci') Object.assign(base, sciSteps(pages, from, to));
      else base.steps = style === 'math' ? mathSteps(pages, from, to) : style === 'hist' ? histSteps(pages, from, to) : elaSteps(pages, from, to);
      if (!base.steps.length) base.steps = partSteps(pages, from, to, n);
      lessons.set(n, base);
    }
    return { from: part.from, lessons };
  });
}

module.exports = { outline, lessonStarts, readable, squash };
