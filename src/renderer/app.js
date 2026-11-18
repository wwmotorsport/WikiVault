'use strict';
/* global api */
// UI for Wikivault. All data comes from the main process through `window.api`;
// this file only renders state and forwards what the person does.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let state = null;
let view = null;
let prevView = null;
let currentUrl = null;
let readerReady = false;
let zoom = 1;
let setupDir = null;
let setupFree = null;
let landed = false;
let externalUrl = null;

const reader = $('reader');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------ formatting

function editionName(date) {
  if (!date) return 'Local file';
  const [y, m] = date.split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : date;
}
function bytes(n) {
  if (n == null) return '';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
function duration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return 'less than a minute left';
  const m = Math.round(sec / 60);
  if (m < 60) return `about ${m} min left`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${m % 60} min left`;
}
function when(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - day) / 86400000);
  if (diff === 0) return `today at ${time}`;
  if (diff === -1) return `yesterday at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
const BUSY = ['checking', 'downloading', 'verifying', 'switching', 'moving'];

// ------------------------------------------------------------ views

function showView(next) {
  if (view === next) return;
  if (view && view !== 'setup') prevView = view;
  view = next;
  for (const v of ['setup', 'results', 'reader', 'library', 'golf', 'school', 'map']) $(`view-${v}`).hidden = v !== next;
  if (next !== 'reader') { document.title = 'Wikivault'; closeFind(); }
  if (next === 'library') { renderLibrary(); renderLibraries(); loadModelList(); }
  if (next === 'golf' || state?.golf) renderGolf();
  if (state) { renderSchool(); renderMap(); }
  updateNav();
}

function updateNav() {
  let back = false;
  let fwd = false;
  if (view === 'reader' && readerReady) {
    try { back = reader.canGoBack(); fwd = reader.canGoForward(); } catch { /* not attached yet */ }
  } else if ((view === 'results' || view === 'library' || view === 'school' || view === 'map') && prevView) back = true;
  else if (view === 'golf' && !state?.golf && prevView && prevView !== 'golf') back = true;
  $('nav-back').disabled = !back;
  $('nav-forward').disabled = !fwd;
  const ready = Boolean(state?.engine.ready);
  $('nav-home').disabled = !ready;
  $('nav-random').disabled = !ready;
  $('nav-golf').disabled = !ready;
  $('search-input').disabled = !ready;
  const onArticle = view === 'reader' && currentUrl && state?.engine.origin && currentUrl.startsWith(`${state.engine.origin}/content/`);
  $('ask-pin-row').hidden = !onArticle;
  if (!onArticle) $('ask-pin').checked = false;
}

function goBack() {
  if (view === 'golf') { if (!state?.golf && prevView && prevView !== 'golf') showView(prevView); return; }
  if (view === 'reader') { try { reader.goBack(); } catch { /* nothing to go back to */ } } else if (prevView) showView(prevView);
}

function openUrl(url, { golf = false } = {}) {
  if (!url) return;
  // During a turn of wiki golf the only way to move is a link inside the article.
  if (golfPlaying() && !golf) return;
  $('reader-msg').hidden = true;
  schShowing = schoolUrl(url);
  showView('reader');
  if (reader.getAttribute('src') === url && readerReady) { try { reader.loadURL(url); } catch { reader.src = url; } } else reader.src = url;
}

reader.addEventListener('dom-ready', () => { readerReady = true; updateNav(); });
reader.addEventListener('did-navigate', (e) => {
  currentUrl = e.url;
  // The PDF viewer reports addresses of its own while a book is open; only a real page elsewhere ends that.
  if (!schoolUrl(e.url) && !/^chrome(-extension)?:/.test(e.url)) schShowing = false;
  updateNav(); golfVisit(e.url); renderSchool();
});
reader.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { currentUrl = e.url; updateNav(); } });
reader.addEventListener('page-title-updated', (e) => { if (view === 'reader') document.title = `${e.title} - Wikivault`; });
reader.addEventListener('did-fail-load', (e) => {
  if (!e.isMainFrame || e.errorCode === -3) return;
  const msg = $('reader-msg');
  msg.textContent = 'That page could not be opened from the offline copy. Use search to find the article by name.';
  msg.hidden = false;
});
reader.addEventListener('found-in-page', (e) => {
  const r = e.result;
  $('find-count').textContent = r.matches ? `${r.activeMatchOrdinal} of ${r.matches}` : 'No match';
});

$('nav-back').addEventListener('click', goBack);
$('nav-forward').addEventListener('click', () => { try { reader.goForward(); } catch { /* none */ } });
$('nav-home').addEventListener('click', () => openUrl(state.engine.homeUrl));
$('nav-random').addEventListener('click', () => openUrl(`${state.engine.randomUrl}&t=${Date.now()}`));
$('open-library').addEventListener('click', () => showView(state?.edition?.active ? 'library' : 'setup'));
$('edition-stamp').addEventListener('click', () => showView(state?.edition?.active ? 'library' : 'setup'));

// ------------------------------------------------------------ find and zoom

function openFind() {
  if (view !== 'reader') return;
  $('findbar').hidden = false;
  $('find-input').focus();
  $('find-input').select();
}
function closeFind() {
  if ($('findbar').hidden) return;
  $('findbar').hidden = true;
  $('find-count').textContent = '';
  try { reader.stopFindInPage('clearSelection'); } catch { /* not attached */ }
}
function find(forward = true, fresh = false) {
  const text = $('find-input').value;
  if (!text) { $('find-count').textContent = ''; try { reader.stopFindInPage('clearSelection'); } catch { /* */ } return; }
  try { reader.findInPage(text, { forward, findNext: !fresh }); } catch { /* not attached */ }
}
$('find-input').addEventListener('input', () => find(true, true));
$('find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); find(!e.shiftKey); }
  if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => find(true));
$('find-prev').addEventListener('click', () => find(false));
$('find-close').addEventListener('click', closeFind);

function setZoom(z) {
  zoom = Math.min(2.5, Math.max(0.6, z));
  try { reader.setZoomFactor(zoom); } catch { /* not attached */ }
}

function shortcut(action) {
  if (action === 'find') openFind();
  else if (action === 'search') { if (!golfPlaying()) { $('search-input').focus(); $('search-input').select(); } }
  else if (action === 'back') goBack();
  else if (action === 'forward') { try { reader.goForward(); } catch { /* none */ } }
  else if (action === 'zoom-in') setZoom(zoom + 0.1);
  else if (action === 'zoom-out') setZoom(zoom - 0.1);
  else if (action === 'zoom-reset') setZoom(1);
  else if (action === 'escape') { closeFind(); hideSuggestions(); }
}
api.onShortcut(shortcut);
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  let action = null;
  if (mod && key === 'f') action = 'find';
  else if (mod && key === 'k') action = 'search';
  else if (mod && (key === '=' || key === '+')) action = 'zoom-in';
  else if (mod && key === '-') action = 'zoom-out';
  else if (mod && key === '0') action = 'zoom-reset';
  else if (e.altKey && key === 'arrowleft') action = 'back';
  else if (e.altKey && key === 'arrowright') action = 'forward';
  if (action) { e.preventDefault(); shortcut(action); }
});

// ------------------------------------------------------------ search

const input = $('search-input');
const list = $('suggestions');
let suggestTimer = null;
let suggestSeq = 0;
let selected = -1;
let rows = [];

function hideSuggestions() {
  list.hidden = true;
  selected = -1;
  $('search').setAttribute('aria-expanded', 'false');
}

function renderSuggestions(term, hits) {
  list.replaceChildren();
  rows = hits.map((h) => ({ kind: 'title', ...h }));
  rows.push({ kind: 'fulltext', term });
  rows.forEach((r, i) => {
    const li = el('li', r.kind === 'fulltext' ? 'fulltext' : '');
    li.setAttribute('role', 'option');
    if (r.kind === 'title') li.textContent = r.title;
    else { li.append('Search all article text for ', el('strong', '', term)); }
    li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
    list.append(li);
  });
  selected = -1;
  list.hidden = false;
  $('search').setAttribute('aria-expanded', 'true');
}

function highlight() {
  [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === selected)));
}

function choose(i) {
  const r = rows[i];
  hideSuggestions();
  input.blur();
  if (!r) return;
  if (r.kind === 'title') { input.value = r.title; openUrl(r.url); } else doSearch(r.term);
}

input.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const term = input.value.trim();
  if (!term) return hideSuggestions();
  const seq = ++suggestSeq;
  suggestTimer = setTimeout(async () => {
    try {
      const hits = await api.suggest(term);
      if (seq === suggestSeq && document.activeElement === input) renderSuggestions(term, hits);
    } catch { /* engine restarting */ }
  }, 110);
  return undefined;
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (list.hidden) return;
    e.preventDefault();
    const n = rows.length;
    selected = e.key === 'ArrowDown' ? (selected + 1) % n : (selected - 1 + n) % n;
    highlight();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    suggestSeq += 1;
    clearTimeout(suggestTimer);
    if (!list.hidden && selected >= 0) choose(selected);
    else if (input.value.trim()) { hideSuggestions(); input.blur(); doSearch(input.value.trim()); }
  } else if (e.key === 'Escape') { hideSuggestions(); input.blur(); }
});
input.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });

let searchState = { q: '', shown: 0, total: 0 };

async function doSearch(q, start = 0) {
  showView('results');
  const summary = $('results-summary');
  if (start === 0) { $('results').replaceChildren(); summary.textContent = 'Searching the offline copy'; $('results-more').hidden = true; }
  let res;
  try { res = await api.search(q, start); } catch (err) { summary.textContent = err.message; return; }
  // Later pages come from the engine as it ordered them; the query may have been relaxed on the first.
  if (start === 0) searchState = { q, used: res.usedQuery || q, next: 0, total: res.total, seen: new Set() };
  searchState.next = res.nextStart ?? (start + res.items.length);
  if (!res.total) {
    summary.textContent = `No article in this edition matches “${q}”, even with a word left out. Try fewer or different words.`;
    return;
  }
  if (start === 0) {
    summary.textContent = res.dropped?.length
      ? `No article contains every word of “${q}”. These ${res.total.toLocaleString()} match it without: ${res.dropped.join(', ')}`
      : `${res.total.toLocaleString()} article${res.total === 1 ? '' : 's'} match “${q}”. Articles whose title matches come first.`;
  }
  for (const item of res.items) {
    if (searchState.seen.has(item.path)) continue; // already shown, promoted to the first page
    searchState.seen.add(item.path);
    const li = el('li');
    const title = el('button', 'result-title', item.title || 'Untitled');
    title.addEventListener('click', () => openUrl(item.url));
    const snip = el('p', 'result-snippet');
    for (const part of item.snippet) snip.append(part.hit ? el('mark', '', part.text) : part.text);
    li.append(title, snip);
    if (item.words) li.append(el('div', 'result-meta', `${item.words.toLocaleString()} words`));
    $('results').append(li);
  }
  $('results-more').hidden = searchState.next >= searchState.total || !res.items.length;
}
$('results-more').addEventListener('click', () => doSearch(searchState.used, searchState.next));

// ------------------------------------------------------------ progress block (setup and library)

function progressModel() {
  const e = state.edition;
  const inst = state.engine.installing;
  if (inst) {
    return {
      title: inst.step, pct: inst.total ? inst.downloaded / inst.total : null,
      left: inst.total ? `${bytes(inst.downloaded)} of ${bytes(inst.total)}` : '', right: '', stage: 0, actions: [],
    };
  }
  if (!e) return null;
  const p = e.progress || {};
  const name = editionName(e.pending?.date || e.latest?.date);
  if (e.phase === 'checking') return { title: 'Looking for the newest edition', pct: null, left: '', right: '', stage: 0, actions: [] };
  if (e.phase === 'downloading') {
    const remaining = p.total && p.bytesPerSec > 1000 ? (p.total - p.downloaded) / p.bytesPerSec : null;
    return {
      title: `Downloading the ${name} edition`,
      pct: p.total ? p.downloaded / p.total : null,
      left: [
        p.total ? `${bytes(p.downloaded)} of ${bytes(p.total)}` : bytes(p.downloaded),
        p.connections > 1 ? `${p.connections} connections${p.mirrors > 1 ? ` to ${p.mirrors} mirrors` : ''}` : '',
      ].filter(Boolean).join(', '),
      right: p.retrying || [p.bytesPerSec > 1000 ? `${bytes(p.bytesPerSec)}/s` : '', duration(remaining)].filter(Boolean).join(', ') || p.note || '',
      stage: 0, actions: ['pause', 'cancel'],
    };
  }
  if (e.phase === 'paused' && e.pending) {
    return {
      title: `Download of the ${name} edition is paused`,
      pct: p.total ? p.downloaded / p.total : 0,
      left: p.total ? `${bytes(p.downloaded)} of ${bytes(p.total)}` : bytes(p.downloaded || 0),
      right: 'What has arrived so far is kept', stage: 0, actions: ['resume', 'cancel'],
    };
  }
  if (e.phase === 'moving') {
    return {
      title: 'Moving the new edition into the library',
      pct: p.total ? p.moved / p.total : null,
      left: p.total ? `${bytes(p.moved)} of ${bytes(p.total)}` : '',
      right: 'Wikipedia stays available while this runs', stage: 2, actions: [],
    };
  }
  if (e.phase === 'verifying') {
    return {
      title: p.copy ? 'Checking the copy in the library against the checksum' : 'Checking every byte against the published checksum', verify: true,
      pct: p.total ? p.verified / p.total : null,
      left: p.total ? `${bytes(p.verified)} of ${bytes(p.total)} checked` : '', right: '', stage: p.copy ? 2 : 1, actions: [],
    };
  }
  if (e.phase === 'switching') return { title: 'Opening the new edition', pct: null, left: '', right: '', stage: 2, actions: [] };
  return null;
}

const ACTIONS = {
  pause: ['Pause', () => api.pauseEdition()],
  resume: ['Resume download', () => api.updateEdition()],
  cancel: ['Cancel and delete the partial download', () => api.cancelEdition()],
};

function renderProgress(box, withSteps) {
  const m = progressModel();
  box.hidden = !m;
  if (!m) return false;
  if (!box.firstChild) {
    const meter = el('div', 'meter');
    meter.append(el('i'));
    const detail = el('div', 'progress-detail');
    detail.append(el('span'), el('span'));
    box.append(el('div', 'progress-title'), meter, detail, el('div', 'actions'));
    if (withSteps) {
      const steps = el('ol', 'steps');
      ['Download the edition', 'Verify it against the published checksum', 'Open it and remove the edition it replaces']
        .forEach((t) => steps.append(el('li', '', t)));
      box.append(steps);
    }
  }
  const [title, meter, detail, actions, steps] = box.children;
  title.textContent = m.title;
  meter.className = `meter${m.verify ? ' verify' : ''}${m.pct == null ? ' wait' : ''}`;
  meter.firstChild.style.width = m.pct == null ? '' : `${Math.min(100, m.pct * 100).toFixed(2)}%`;
  detail.children[0].textContent = m.left;
  detail.children[1].textContent = m.right;
  const key = m.actions.join(',');
  if (actions.dataset.key !== key) {
    actions.dataset.key = key;
    actions.replaceChildren(...m.actions.map((a, i) => {
      const b = el('button', a === 'cancel' ? 'btn quiet' : `btn${i === 0 ? ' primary' : ''}`, ACTIONS[a][0]);
      b.addEventListener('click', () => guard(ACTIONS[a][1]));
      return b;
    }));
  }
  if (steps) [...steps.children].forEach((li, i) => { li.className = i < m.stage ? 'done' : i === m.stage ? 'now' : ''; });
  return true;
}

async function guard(fn, errorBox) {
  try { await fn(); } catch (err) {
    if (errorBox) { errorBox.textContent = err.message; errorBox.hidden = false; }
  }
}

// ------------------------------------------------------------ setup view

// The sizes Kiwix publishes, and whether each fits the chosen place.
const FLAVOUR_TEXT = {
  maxi: ['Everything, with images', 'Every article in full, with its pictures and diagrams. The most useful copy, and by far the largest.'],
  nopic: ['Every article, no images', 'The full text of every article. Diagrams, maps and photographs are missing, which matters for how-to and medical topics.'],
  mini: ['Introductions only', 'Just the opening section and fact box of each article. Good for looking things up, not for learning a subject.'],
};
let flavours = null;        // [{ flavour, bytes, known }]
let flavourChoice = null;
let flavourAsked = false;
const KEEP_FREE = 15 * 1024 ** 3; // room Windows itself should keep

/** A plain verdict on one size: does it fit, and will monthly updates fit too. */
function fitVerdict(size, free, onPartition) {
  if (free == null) return { cls: '', text: '', ok: true };
  if (onPartition) return size * 1.05 <= free ? { cls: '', text: 'Fits the partition you created.', ok: true } : { cls: 'no', text: `Does not fit the partition: it needs ${bytes(size)} and the partition has ${bytes(free)}.`, ok: false };
  const left = free - size;
  if (left < KEEP_FREE) return { cls: 'no', text: left < 0 ? `Does not fit: it needs ${bytes(size)} and this drive has ${bytes(free)} free.` : `Too tight: it would leave only ${bytes(left)} free, and Windows needs room to work.`, ok: false };
  if (free - 2 * size < KEEP_FREE) return { cls: 'tight', text: `Fits, leaving ${bytes(left)} free. Monthly updates need ${bytes(size)} more while the old copy is replaced, which this drive does not have to spare. A dedicated partition avoids that.`, ok: true };
  return { cls: '', text: `Fits with room for monthly updates, leaving ${bytes(left)} free.`, ok: true };
}

function renderFlavours(free) {
  const box = $('flavour-list');
  if (!flavours) {
    if (!flavourAsked) {
      flavourAsked = true;
      api.setupFlavours().then((list) => { flavours = list; renderSetup(); }).catch(() => { flavours = []; renderSetup(); });
    }
    return;
  }
  if (!flavours.length) { box.replaceChildren(); $('flavour-help').textContent = ''; return; }
  const verdicts = flavours.map((f) => fitVerdict(f.bytes, free, Boolean(part.done)));
  // Default: the largest that fits with room for updates; failing that, the largest that fits at all.
  if (!flavourChoice || !flavours.some((f) => f.flavour === flavourChoice)) {
    const roomy = flavours.findIndex((f, i) => verdicts[i].ok && !verdicts[i].cls);
    const any = flavours.findIndex((f, i) => verdicts[i].ok);
    flavourChoice = flavours[roomy >= 0 ? roomy : any >= 0 ? any : flavours.length - 1].flavour;
    if (flavourChoice !== state.settings.flavour) api.setFlavour(flavourChoice).catch(() => {});
  }
  const key = JSON.stringify([flavours, free, flavourChoice, Boolean(part.done)]);
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...flavours.map((f, i) => {
      const [name, about] = FLAVOUR_TEXT[f.flavour] || [f.flavour, ''];
      const row = el('label', `flavour${verdicts[i].ok ? '' : ' unfit'}`);
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'flavour'; radio.value = f.flavour; radio.checked = f.flavour === flavourChoice;
      radio.addEventListener('change', () => { flavourChoice = f.flavour; api.setFlavour(f.flavour).then(() => { part.info = null; renderSetup(); }); });
      row.append(radio, el('span', 'f-name', name), el('span', 'f-size', `${f.known ? '' : 'about '}${bytes(f.bytes)}`), el('span', 'f-about', about));
      if (verdicts[i].text) row.append(el('span', `f-fit ${verdicts[i].cls}`, verdicts[i].text));
      return row;
    }));
  }
  const known = flavours.every((f) => f.known);
  $('flavour-help').textContent = `${known ? 'Sizes are those of the newest editions on Kiwix.' : 'Kiwix could not be reached, so these sizes are estimates.'} Images matter most for how-to, medical and identification topics.`;
  const chosen = flavours.find((f) => f.flavour === flavourChoice);
  if (chosen) $('setup-size').textContent = `Plan for about ${bytes(chosen.bytes)}.`;
}

function renderSetup() {
  const e = state.edition;
  const dir = setupDir || state.settings.dataDir || state.suggestedDataDir;
  const free = setupDir ? setupFree : state.freeBytes;
  $('setup-dir').textContent = dir;
  $('setup-free').textContent = free == null ? '' : part.done
    ? `${bytes(free)} set aside for the library on its own partition.`
    : `${bytes(free)} free on this drive. The download needs the edition's full size free, and each update needs that much again until the old edition is removed.`;
  $('setup-login-row').hidden = state.platform !== 'win32';
  renderFlavours(free);
  if (e?.pending?.size) $('setup-size').textContent = `This edition is ${bytes(e.pending.size)}.`;
  const busy = renderProgress($('setup-progress'), true);
  $('setup-form').hidden = busy;
  const err = e?.error || state.engine.error;
  $('setup-error').textContent = err || '';
  $('setup-error').hidden = !err || state.engine.installing != null;
  if (err && !busy) $('setup-start').textContent = 'Try again';
  $('setup-change-dir').disabled = Boolean(part.done);
  renderPartition();
}

$('setup-change-dir').addEventListener('click', () => guard(async () => {
  const picked = await api.chooseDir();
  if (picked) { setupDir = picked.dir; setupFree = picked.freeBytes; renderSetup(); }
}, $('setup-error')));
$('setup-start').addEventListener('click', () => {
  $('setup-error').hidden = true;
  $('setup-start').disabled = true;
  guard(() => api.beginSetup({
    dataDir: setupDir || state.settings.dataDir || state.suggestedDataDir,
    stagingDir: part.done ? part.stagingDir : null,
    autoUpdate: $('setup-auto').checked,
    launchAtLogin: state.platform === 'win32' ? $('setup-login').checked : false,
    setupAnswers: $('setup-answers').checked,
    flavour: flavourChoice || undefined,
  }), $('setup-error')).finally(() => { $('setup-start').disabled = false; });
});
$('setup-use-file').addEventListener('click', () => guard(() => api.useFile(), $('setup-error')));

// ------------------------------------------------------------ dedicated partition (Windows)

const GB = 1024 ** 3;
const part = { info: null, gb: 0, shrinkLimitGb: null, staged: true, busy: false, done: null, stagingDir: null };
const gbOf = (n) => Math.round(n / GB);
const partPlan = () => part.info.plans[part.staged ? 'staged' : 'selfContained'];
/** Largest size on offer: the plan's own limit, tightened by a shrink limit learned from a refused attempt. */
const partMaxGb = () => Math.min(gbOf(partPlan().maxBytes), part.shrinkLimitGb ?? Infinity);

function partitionFacts() {
  const { analysis, driveLetter } = part.info;
  const total = analysis.partitionSize;
  const used = Math.max(0, analysis.volumeSize - analysis.volumeFree);
  const chosen = part.gb * GB;
  const keep = Math.max(0, analysis.volumeFree - chosen);
  const [segUsed, segKeep, segNew] = $('drivebar').children;
  segUsed.style.width = `${(100 * used) / total}%`;
  segKeep.style.width = `${(100 * keep) / total}%`;
  segNew.style.width = `${(100 * chosen) / total}%`;
  $('drivebar').setAttribute('aria-label', `Drive ${driveLetter}: ${gbOf(used)} GB in use, ${gbOf(keep)} GB left free, ${part.gb} GB for Wikipedia`);

  const dl = $('drive-facts');
  dl.replaceChildren();
  const row = (swatch, label, value, live) => {
    const dt = el('dt');
    dt.append(el('span', `swatch ${swatch}`), label);
    dl.append(dt, el('dd', live ? 'live' : '', value));
  };
  row('none', `Drive ${driveLetter}: in total`, `${gbOf(total)} GB`);
  row('used', 'In use now', `${gbOf(used)} GB`);
  row('none', 'Free now', `${gbOf(analysis.volumeFree)} GB`);
  row('new', 'Wikipedia partition', `${part.gb} GB`, true);
  row('keep', `Left free on ${driveLetter}:`, `${gbOf(keep)} GB`, true);
}

function renderPartition() {
  const box = $('partition');
  const editing = !$('setup-form').hidden;
  box.hidden = !(state.partitionAvailable && editing) && !part.done;
  $('partition-intro').hidden = !$('partition-panel').hidden || Boolean(part.done);
  $('partition-done').hidden = !part.done;
  if (part.done) $('partition-done').textContent = part.done;
  if (!part.info || $('partition-panel').hidden) return;

  const { analysis, edition, driveLetter } = part.info;
  const onBattery = Boolean(state.onBattery);
  const plan = partPlan();
  const maxGb = partMaxGb();
  $('partition-staged').checked = part.staged;
  $('partition-staged').disabled = part.busy;
  $('partition-loading').hidden = true;
  $('partition-body').hidden = false;
  const feasible = plan.feasible && maxGb >= gbOf(plan.minBytes);
  $('partition-controls').hidden = !feasible;
  $('partition-create').hidden = !feasible;

  if (feasible) {
    const min = gbOf(plan.minBytes);
    for (const id of ['partition-range', 'partition-gb']) {
      const node = $(id);
      node.min = min; node.max = maxGb;
      if (document.activeElement !== node) node.value = part.gb;
    }
    const rec = Math.min(gbOf(plan.recommendedBytes), maxGb);
    $('partition-recommended').textContent = `Use recommended (${rec} GB)`;
    $('partition-recommended').title = plan.otherBytes ? `Includes ${gbOf(plan.otherBytes)} GB for Wikibooks and Wikiversity and their updates` : '';
    $('partition-recommended').disabled = part.gb === rec || part.busy;
    const size = `${edition.known ? '' : 'about '}${gbOf(edition.bytes)} GB`;
    $('partition-why').textContent = part.staged
      ? `Recommended: ${rec} GB. That is one edition (this one is ${size}) plus 30% for growth, since the partition cannot borrow space later. The smallest size that works is ${min} GB. On ${driveLetter}:, ${gbOf(plan.reserveBytes)} GB is left free for Windows and another ${gbOf(plan.stagingBytes)} GB for downloading updates.`
      : `Recommended: ${rec} GB. That is room for two editions (this one is ${size}) plus 15% for growth, because each update is verified next to the current edition before the old one is removed. The smallest size that works is ${min} GB, and ${gbOf(plan.reserveBytes)} GB is always left free for Windows.`;
    partitionFacts();
  } else {
    part.gb = 0;
    partitionFacts();
  }

  const notes = [];
  if (!feasible) notes.push(['warn', plan.reason || `Windows can shrink ${driveLetter}: by at most ${maxGb} GB, which is less than the ${gbOf(plan.minBytes)} GB this layout needs.`]);
  if (feasible && plan.otherBytes) notes.push(['', `The recommended size includes ${gbOf(plan.otherBytes)} GB for Wikibooks and Wikiversity, which are kept on the same partition as Wikipedia.`]);
  if (feasible && part.staged) notes.push(['', `Each update needs about ${gbOf(plan.stagingBytes)} GB free on ${driveLetter}: for as long as it takes to download and check. If ${driveLetter}: is too full at that moment, the update waits and your current edition is unaffected.`]);
  if (feasible && onBattery) notes.push(['warn', 'The laptop is on battery power. Plug in the charger before creating the partition if you can; this updates by itself when you do. You can continue on battery, and will be asked to confirm.']);
  if (feasible && !plan.shrinkLimitKnown) notes.push(['', `How far Windows can shrink ${driveLetter}: is measured when you confirm. If it is less than the size you chose, nothing is changed and you can pick a smaller size.`]);
  if (feasible && analysis.bitLocker === 'On') notes.push(['', `${driveLetter}: is protected by BitLocker. The new partition is not encrypted. Wikipedia's content is public, so that is usually fine.`]);
  $('partition-notes').replaceChildren(...notes.map(([cls, text]) => el('li', cls, text)));

  $('partition-busy').hidden = !part.busy;
  // The button is only unavailable while a partition is actually being created.
  $('partition-create').disabled = part.busy;
  syncBatteryConfirm();
  $('partition-cancel').disabled = part.busy;
  $('partition-range').disabled = $('partition-gb').disabled = part.busy;
}

/** Keeps the confirmation in step with the power state, including while it is open. */
function syncBatteryConfirm() {
  const onBattery = Boolean(state?.onBattery);
  $('confirm-battery-row').hidden = !onBattery;
  if (!onBattery) $('confirm-battery').checked = false;
  $('confirm-go').disabled = onBattery && !$('confirm-battery').checked;
}
$('confirm-battery').addEventListener('change', syncBatteryConfirm);

function setPartitionGb(value) {
  const min = gbOf(partPlan().minBytes);
  part.gb = Math.min(partMaxGb(), Math.max(min, Math.round(Number(value) || min)));
  renderPartition();
}

function useRecommended() {
  const plan = partPlan();
  part.gb = plan.feasible ? Math.min(gbOf(plan.recommendedBytes), partMaxGb()) : 0;
  renderPartition();
}
$('partition-staged').addEventListener('change', (e) => { part.staged = e.target.checked; useRecommended(); });

$('partition-open').addEventListener('click', async () => {
  $('partition-panel').hidden = false;
  $('partition-loading').hidden = false;
  $('partition-body').hidden = true;
  $('partition-error').hidden = true;
  renderPartition();
  try {
    part.info = await api.partitionInfo();
    part.shrinkLimitGb = null;
    useRecommended();
  } catch (err) {
    $('partition-loading').textContent = `The drive could not be measured: ${err.message}`;
  }
});
$('partition-cancel').addEventListener('click', () => { $('partition-panel').hidden = true; renderPartition(); });
$('partition-range').addEventListener('input', (e) => setPartitionGb(e.target.value));
$('partition-gb').addEventListener('change', (e) => setPartitionGb(e.target.value));
$('partition-recommended').addEventListener('click', useRecommended);

$('partition-create').addEventListener('click', () => {
  const { analysis, driveLetter } = part.info;
  const total = gbOf(analysis.partitionSize);
  const free = gbOf(analysis.volumeFree);
  $('confirm-title').textContent = `Create a ${part.gb} GB partition for Wikipedia?`;
  $('confirm-list').replaceChildren(...[
    `Drive ${driveLetter}: shrinks from ${total} GB to ${total - part.gb} GB. The files on it stay where they are.`,
    `A new ${part.gb} GB drive named Wikivault is created${analysis.freeLetter ? ` as ${analysis.freeLetter}:` : ''} and formatted. Only this new, empty drive is formatted.`,
    `${driveLetter}: keeps ${free - part.gb} GB free.`,
    ...(part.staged ? [`Each update will be downloaded to ${driveLetter}: first, checked there, and then moved into the new drive.`] : []),
    'Windows will ask for administrator approval.',
    'This can take a few minutes. Keep the laptop plugged in and switched on until it finishes.',
  ].map((t) => el('li', '', t)));
  $('confirm-go').textContent = `Shrink ${driveLetter}: and create the partition`;
  $('confirm-battery').checked = false;
  syncBatteryConfirm();
  $('partition-confirm').showModal();
  $('confirm-cancel').focus();
});
$('confirm-cancel').addEventListener('click', () => $('partition-confirm').close());

$('confirm-go').addEventListener('click', async () => {
  const allowBattery = $('confirm-battery').checked;
  $('partition-confirm').close();
  const errorBox = $('partition-error');
  errorBox.hidden = true;
  part.busy = true;
  renderPartition();
  try {
    const r = await api.createPartition(part.gb * GB, part.staged, allowBattery);
    if (r.created) {
      setupDir = r.dataDir;
      setupFree = r.sizeBytes;
      part.stagingDir = r.stagingDir;
      part.done = `Created drive ${r.driveLetter}: (${gbOf(r.sizeBytes)} GB), named Wikivault. Wikipedia will be stored there.`;
      $('partition-panel').hidden = true;
    } else {
      let text = r.error;
      if (r.code === 'TOO_LARGE' && r.maxBytes != null) {
        part.shrinkLimitGb = Math.floor(r.maxBytes / GB);
        part.info.plans.staged.shrinkLimitKnown = part.info.plans.selfContained.shrinkLimitKnown = true;
        if (partMaxGb() >= gbOf(partPlan().minBytes)) {
          part.gb = Math.min(part.gb, partMaxGb());
          text += ` Nothing was changed. The size has been lowered to ${part.gb} GB; press Create partition to go ahead with that.`;
        } else text += ' Nothing was changed.';
      }
      errorBox.textContent = text;
      errorBox.hidden = false;
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    part.busy = false;
    renderSetup();
  }
});

// ------------------------------------------------------------ moving the library, returning the partition

const maintaining = () => Boolean(state?.maintenance && !state.maintenance.error);
let maintDone = null;

function renderMaintenance() {
  const m = state.maintenance;
  const running = maintaining();
  $('maint').hidden = !running;
  if (running) {
    $('maint-title').textContent = m.step || 'Working';
    const known = m.done != null && m.total;
    $('maint-meter').className = `meter${known ? '' : ' wait'}`;
    $('maint-meter').firstChild.style.width = known ? `${Math.min(100, (100 * m.done) / m.total).toFixed(2)}%` : '';
    $('maint-left').textContent = known ? `${bytes(m.done)} of ${bytes(m.total)}` : '';
  }
  const err = m?.error || '';
  $('maint-error').textContent = err;
  $('maint-error').hidden = !err;
  $('maint-done').textContent = maintDone || '';
  $('maint-done').hidden = !maintDone || running || Boolean(err);

  const p = state.partition;
  const canPartition = Boolean(state.partitionAvailable && state.edition?.active);
  $('lib-partition').hidden = !p && !canPartition;
  const onIt = Boolean(p && state.libraryOnPartition);
  $('revert-open').hidden = !p;
  $('psize-open').hidden = !(canPartition && (onIt || !p));
  $('psize-open').textContent = onIt ? 'Change the size' : 'Give the library its own partition';
  $('psize-open').disabled = running;
  $('part-movein').hidden = !(p && !onIt && state.edition?.active);
  $('part-movein').disabled = running;
  $('lib-partition-meter').hidden = !onIt;
  $('lib-partition-use').hidden = !onIt;
  if (p) {
    $('lib-partition-text').textContent = onIt
      ? `The library has its own partition: drive ${p.driveLetter}:, ${gbOf(p.sizeBytes)} GB. Its size can be changed, or the library can go back to a folder and the space back to ${p.sourceLetter}:.`
      : `Drive ${p.driveLetter}: (${gbOf(p.sizeBytes)} GB) was created for the library but the library does not live on it. Move the library onto it, or return its space to ${p.sourceLetter}:.`;
    $('part-movein').textContent = `Move the library onto drive ${p.driveLetter}:`;
    $('revert-open').textContent = onIt ? 'Stop using the partition' : `Remove drive ${p.driveLetter}:`;
    $('revert-open').disabled = running;
    if (onIt) {
      // How full it is, and what fills it: this is where running out shows before it happens.
      const free = state.freeBytes; const used = Math.max(0, p.sizeBytes - (free || 0));
      $('lib-partition-meter').className = `meter${free != null && free < 0.08 * p.sizeBytes ? ' low' : ''}`;
      $('lib-partition-meter').firstChild.style.width = `${Math.min(100, (100 * used) / p.sizeBytes).toFixed(1)}%`;
      const upd = state.settings.stagingDir ? '' : ` An update of Wikipedia needs about ${bytes((state.edition.active.bytes || 0) * 1.15)} of that while it runs.`;
      $('lib-partition-use').textContent = free == null ? '' : `${bytes(used)} in use, ${bytes(free)} free. The library itself is ${bytes(state.libraryBytes || 0)}.${upd}`;
    }
  } else if (canPartition) {
    $('lib-partition-text').textContent = 'The library is in an ordinary folder, where Windows and other programs can use up the room it needs. It can be given a partition of its own, of a size you choose.';
  }
  const moveBtn = $('move-open');
  if (moveBtn) moveBtn.disabled = running;
}

// ---- move library
const move = { dest: null, free: null };

async function showMoveDest() {
  $('move-dest').textContent = move.dest || 'No folder chosen yet';
  const need = state.libraryBytes || state.edition.active.bytes; // everything that moves: Wikipedia, the other libraries, School and the map
  move.free = move.dest ? await api.freeSpace(move.dest).catch(() => null) : null;
  const short = move.free != null && move.free < need + 2 * GB;
  $('move-free').textContent = move.dest
    ? (move.free == null ? '' : `${bytes(move.free)} free on that drive. The library needs ${bytes(need)}.${short ? ' That is not enough room.' : ''}`)
    : '';
  $('move-go').disabled = !move.dest || short;
}

function openMoveDialog() {
  const a = state.edition.active;
  $('move-text').textContent = `The library (${bytes(a.bytes)}) is copied to the new folder and checked against its checksum. Only when the copy is verified does the app switch to it and remove the copy here. Wikipedia stays available throughout.`;
  const current = state.edition.dataDir;
  move.dest = state.defaultLibraryDir && state.defaultLibraryDir !== current ? state.defaultLibraryDir : null;
  showMoveDest();
  $('move-dialog').showModal();
  $('move-cancel').focus();
}
$('move-choose').addEventListener('click', async () => {
  const picked = await api.chooseDir().catch(() => null);
  if (picked) { move.dest = picked.dir; showMoveDest(); }
});
$('move-cancel').addEventListener('click', () => $('move-dialog').close());
$('move-go').addEventListener('click', async () => {
  $('move-dialog').close();
  maintDone = null;
  renderMaintenance();
  try {
    const r = await api.moveLibrary(move.dest);
    maintDone = `The library now lives in ${r.dataDir}.`;
  } catch { /* shown through the maintenance state */ }
  // Stay on the Library page, where the outcome is shown, whatever the reader did while the library was away.
  showView('library');
  render();
});

// ---- stop using the partition
const revert = { dest: null, status: null };

function syncRevertGo() {
  const onBattery = Boolean(state?.onBattery);
  $('revert-battery-row').hidden = !onBattery;
  if (!onBattery) $('revert-battery').checked = false;
  $('revert-go').disabled = Boolean(revert.blocked) || (onBattery && !$('revert-battery').checked);
}
$('revert-battery').addEventListener('change', syncRevertGo);

async function showRevert() {
  const p = state.partition;
  const st = revert.status;
  const a = state.edition?.active;
  const moving = Boolean(st.libraryOnPartition && a);
  const src = p.sourceLetter;
  $('revert-title').textContent = moving ? 'Stop using the Wikipedia partition?' : `Remove drive ${p.driveLetter}:?`;
  const steps = [];
  if (moving) {
    steps.push(`The library (${bytes(state.libraryBytes || a.bytes)}) is copied to a folder on ${src}: and checked against its checksum. Wikipedia stays available.`);
    steps.push(`Once the copy is verified, the app switches to it and removes the copy on drive ${p.driveLetter}:.`);
  }
  steps.push(`Drive ${p.driveLetter}: is removed and its ${gbOf(p.sizeBytes)} GB is added back to ${src}:. Windows asks for administrator approval.`);
  $('revert-steps').replaceChildren(...steps.map((t) => el('li', '', t)));

  const notes = [];
  revert.blocked = false;
  $('revert-dest-field').hidden = !moving;
  if (moving) {
    $('revert-dest').textContent = revert.dest;
    const free = await api.freeSpace(revert.dest).catch(() => null);
    const all = state.libraryBytes || a.bytes;
    const short = free != null && free < all + 2 * GB;
    $('revert-free').textContent = free == null ? '' : `${bytes(free)} free there now. The library needs ${bytes(all)}.`;
    if (short) { notes.push(['warn', 'There is not enough free space in that folder\'s drive for the library. Choose another folder or free up space first.']); revert.blocked = true; }
    notes.push(['', `After this, updates are downloaded inside the library folder, which needs room for a second edition (about ${bytes(a.bytes * 1.15)}) while an update runs.`]);
  } else if (st.exists === false) {
    notes.push(['warn', `Drive ${p.driveLetter}: was not found. It may already have been removed.`]);
  } else if (!st.mergeable) {
    for (const prob of st.problems) notes.push(['warn', prob]);
    notes.push(['', 'Nothing will be removed until the drive holds nothing but an empty Wikivault folder.']);
    revert.blocked = true;
  }
  notes.push(['', `Only the Wikivault drive is removed. Its name, its position on the disk and its contents are checked first, and nothing is changed if anything else is found on it.`]);
  $('revert-notes').replaceChildren(...notes.map(([cls, text]) => el('li', cls, text)));
  $('revert-go').textContent = moving ? `Move the library and remove drive ${p.driveLetter}:` : `Remove drive ${p.driveLetter}:`;
  syncRevertGo();
}

$('revert-open').addEventListener('click', async () => {
  $('revert-open').disabled = true;
  try {
    revert.status = await api.partitionStatus();
    revert.dest = state.defaultLibraryDir;
    $('revert-battery').checked = false;
    await showRevert();
    $('revert-dialog').showModal();
    $('revert-cancel').focus();
  } catch (err) {
    $('maint-error').textContent = err.message;
    $('maint-error').hidden = false;
  } finally { $('revert-open').disabled = maintaining(); }
});
$('revert-choose').addEventListener('click', async () => {
  const picked = await api.chooseDir().catch(() => null);
  if (picked) { revert.dest = picked.dir; showRevert(); }
});
$('revert-cancel').addEventListener('click', () => $('revert-dialog').close());
$('revert-go').addEventListener('click', async () => {
  const allowBattery = $('revert-battery').checked;
  const moved = Boolean(revert.status.libraryOnPartition && state.edition?.active);
  $('revert-dialog').close();
  maintDone = null;
  renderMaintenance();
  try {
    const r = await api.revertPartition({ toDir: revert.dest, allowBattery });
    maintDone = r.warning || `Drive ${r.removedLetter}: was removed and ${r.sourceLetter}: is ${gbOf(r.sourceSizeAfter)} GB again.${moved ? ` The library is in ${revert.dest}.` : ''}`;
  } catch { /* shown through the maintenance state; the partition stays listed so it can be retried */ }
  render();
});

// ---- a partition for the library: create one later, or change its size
const psize = { plan: null };
const psizePlan = () => (psize.plan ? ($('psize-staged').checked ? psize.plan.plans.staged : psize.plan.plans.selfContained) : null);

function showPsize(reset) {
  const pl = psize.plan; const plan = psizePlan();
  const resize = pl.mode === 'resize';
  const lib = pl.library; const src = pl.source;
  $('psize-title').textContent = resize ? `Change the size of drive ${pl.current.driveLetter}:` : 'Give the library its own partition';
  $('psize-intro').textContent = resize
    ? `Windows cannot stretch a partition towards the drive in front of it, so the partition is made again at the new size. The library waits on ${src}: meanwhile and stays usable throughout.`
    : `A piece of drive ${src}: is set aside as a drive of its own, and the library moves onto it. Windows and other programs can then never use up the room the library needs.`;
  const input = $('psize-gb');
  if (reset && plan.feasible) input.value = String(plan.recommendedBytes / GB);
  input.min = String(plan.minBytes / GB); input.max = String(plan.maxBytes / GB); input.disabled = !plan.feasible;
  const gb = Math.floor(Number(input.value));
  const n = gb * GB;
  const inRange = plan.feasible && Number.isFinite(gb) && n >= plan.minBytes && n <= plan.maxBytes;
  const same = resize && n === pl.current.sizeBytes && $('psize-staged').checked === pl.staged;

  const facts = $('psize-facts'); facts.replaceChildren();
  const parts = [['Wikipedia', lib.wikipedia], ['other libraries', lib.others], ['School', lib.school], ['map, places, addresses and routing', lib.maps]].filter(([, b]) => b > 0).map(([name, b]) => `${name} ${bytes(b)}`);
  fact(facts, 'The library holds', `${bytes(lib.total)}${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`);
  if (resize) fact(facts, `Drive ${pl.current.driveLetter}: now`, `${gbOf(pl.current.sizeBytes)} GB${pl.current.free != null ? `, ${bytes(pl.current.free)} free` : ''}`);
  fact(facts, `Free on ${src}: now`, bytes(pl.sourceFree));
  if (inRange) fact(facts, `Free on ${src}: afterwards`, bytes(pl.freeAfterAll - n));

  $('psize-range').textContent = plan.feasible
    ? `Between ${plan.minBytes / GB} and ${plan.maxBytes / GB} GB. Recommended: ${plan.recommendedBytes / GB} GB, which leaves room for ${$('psize-staged').checked ? 'one edition of Wikipedia and some years of growth' : 'two editions of Wikipedia, so that updates can be downloaded inside it'}, and for a second copy of the map and the other libraries while they update.`
    : '';
  $('psize-recommended').disabled = !plan.feasible;

  const steps = [];
  if (resize) {
    steps.push(`The library (${bytes(lib.total)}) is copied to ${pl.tempDir} and checked. Once the copy is verified the app uses it.`);
    steps.push(`Drive ${pl.current.driveLetter}: is removed and its space returned to ${src}:. Windows asks for administrator approval.`);
    steps.push(`A new partition${inRange ? ` of ${gb} GB` : ''} is made out of ${src}:. Windows asks for approval a second time.`);
    steps.push('The library is copied onto the new partition and checked, and the copy in the folder is removed.');
  } else {
    steps.push(`Drive ${src}: is made smaller${inRange ? ` by ${gb} GB` : ''} and a new drive is made in the space. Only the new, empty drive is formatted. Windows asks for administrator approval.`);
    steps.push(`The library (${bytes(lib.total)}) is copied onto it and checked. Once the copy is verified the app uses it and removes the copy in ${pl.dataDir}.`);
  }
  $('psize-steps').replaceChildren(...steps.map((t) => el('li', '', t)));

  const notes = [];
  let blocked = !inRange || same;
  if (!plan.feasible) notes.push(['warn', plan.reason]);
  else if (!inRange) notes.push(['warn', `Choose a size between ${plan.minBytes / GB} and ${plan.maxBytes / GB} GB.`]);
  else if (same) notes.push(['', 'That is the size the partition has now.']);
  if (resize && !pl.tempOk) { notes.push(['warn', `The library has to wait on ${src}: while the partition is made again, which needs ${bytes(pl.tempNeeded)} free there. There is ${bytes(pl.tempFree)}. Free up space on ${src}:, or remove part of the library first.`]); blocked = true; }
  notes.push(['', resize ? `The library is copied twice, which takes a while for ${bytes(lib.total)}. Keep the laptop plugged in and let it finish. If a step fails, the library stays whole wherever the last finished step put it, and the app says where.` : `Copying ${bytes(lib.total)} takes a while. Keep the laptop plugged in and let it finish. If a step fails, the library stays where it is.`]);
  notes.push(['', 'If Windows turns out to be able to free less than this, the app makes the partition as large as Windows allows, provided that is still enough for the library, and tells you.']);
  $('psize-notes').replaceChildren(...notes.map(([cls, text]) => el('li', cls, text)));
  $('psize-go').textContent = resize ? (inRange ? `Make it ${gb} GB` : 'Change the size') : (inRange ? `Create a ${gb} GB partition` : 'Create the partition');
  const onBattery = Boolean(state?.onBattery);
  $('psize-battery-row').hidden = !onBattery;
  if (!onBattery) $('psize-battery').checked = false;
  $('psize-go').disabled = blocked || (onBattery && !$('psize-battery').checked);
}

$('psize-open').addEventListener('click', async () => {
  $('psize-open').disabled = true;
  $('maint-error').hidden = true;
  try {
    psize.plan = await api.partitionPlan();
    $('psize-staged').checked = psize.plan.mode === 'resize' ? psize.plan.staged : false;
    $('psize-battery').checked = false;
    showPsize(true);
    $('psize-dialog').showModal();
    $('psize-cancel').focus();
  } catch (err) {
    $('maint-error').textContent = err.message;
    $('maint-error').hidden = false;
  } finally { $('psize-open').disabled = maintaining(); }
});
$('psize-gb').addEventListener('input', () => showPsize(false));
$('psize-staged').addEventListener('change', () => showPsize(true));
$('psize-battery').addEventListener('change', () => showPsize(false));
$('psize-recommended').addEventListener('click', () => showPsize(true));
$('psize-cancel').addEventListener('click', () => $('psize-dialog').close());
$('psize-go').addEventListener('click', async () => {
  const opts = { sizeBytes: Math.floor(Number($('psize-gb').value)) * GB, staged: $('psize-staged').checked, allowBattery: $('psize-battery').checked };
  $('psize-dialog').close();
  maintDone = null;
  renderMaintenance();
  try {
    const r = await api.partitionChange(opts);
    maintDone = `${r.was ? `Drive ${r.driveLetter}: is now ${gbOf(r.sizeBytes)} GB (it was ${gbOf(r.was)} GB)` : `The library now has its own partition, drive ${r.driveLetter}:, ${gbOf(r.sizeBytes)} GB`}.${r.adjusted ? ' That is less than you asked for: it is as much as Windows could free.' : ''}`;
  } catch { /* shown through the maintenance state, which says where the library is */ }
  showView('library');
  render();
});
$('part-movein').addEventListener('click', async () => {
  const p = state.partition;
  maintDone = null;
  renderMaintenance();
  try {
    const sep = p.root.includes('\\') ? '\\' : '/';
    const r = await api.moveLibrary(`${p.root.replace(/[\\/]+$/, '')}${sep}Wikivault`);
    maintDone = `The library now lives in ${r.dataDir}.`;
  } catch { /* shown through the maintenance state */ }
  showView('library');
  render();
});

// ------------------------------------------------------------ library view

function fact(dl, label, value, cls) {
  const dd = el('dd', cls || '');
  if (value instanceof Node) dd.append(value); else dd.textContent = value;
  dl.append(el('dt', '', label), dd);
}

function renderLibrary() {
  const e = state.edition;
  if (!e?.active) return;
  const a = e.active;
  $('lib-title').textContent = a.date ? `The ${editionName(a.date)} edition` : a.file;

  const dl = $('lib-facts');
  const key = JSON.stringify([a, state.engine.info, state.engine.version, e.stagingDir, maintaining()]);
  if (dl.dataset.key !== key) {
    dl.dataset.key = key;
    dl.replaceChildren();
    fact(dl, 'Contents', /_nopic_/.test(a.file) ? 'English Wikipedia, full articles without pictures' : /_mini_/.test(a.file) ? 'English Wikipedia, article introductions only' : 'English Wikipedia, full articles with images');
    if (state.engine.info?.articleCount) fact(dl, 'Articles', state.engine.info.articleCount.toLocaleString());
    fact(dl, 'Size on disk', bytes(a.bytes));
    if (a.sha256) fact(dl, 'Integrity', `Matched the published SHA-256 checksum, ${when(a.verifiedAt)}`, 'verified');
    else fact(dl, 'Integrity', 'A file you supplied. It was opened successfully but not compared with a published checksum.');
    const where = el('span', '', `${a.path} `);
    const open = el('button', 'btn small', 'Open folder');
    open.addEventListener('click', () => api.openDataDir());
    const move = el('button', 'btn small', 'Move library');
    move.id = 'move-open';
    move.disabled = maintaining();
    move.addEventListener('click', openMoveDialog);
    where.append(open, ' ', move);
    fact(dl, 'Stored in', where);
    if (e.stagingDir) fact(dl, 'Updates download to', `${e.stagingDir}, then move into the library once verified. An update needs about ${bytes(a.bytes * 1.15)} free there while it runs.`);
  }

  renderMaintenance();
  const busy = renderProgress($('lib-progress'), false);
  const status = $('lib-update-status');
  const actions = $('lib-update-actions');
  let text = '';
  let buttons = [];
  if (busy) text = '';
  else if (e.phase === 'error') { text = ''; buttons = [['Try again', () => api.updateEdition(), true]]; } else if (e.updateAvailable && e.latest) {
    text = `The ${editionName(e.latest.date)} edition is available. Downloading it leaves this edition in place until the new one is verified.`;
    buttons = [[`Download the ${editionName(e.latest.date)} edition`, () => api.updateEdition(), true]];
  } else {
    text = e.lastCheckOk
      ? `This is the newest edition. Last checked ${when(e.lastCheckOk)}.${state.settings.autoUpdate && e.nextCheck ? ` Next check ${when(e.nextCheck)}.` : ''}`
      : 'Wikivault has not been able to check for a newer edition yet. It will try again when there is an internet connection.';
    buttons = [['Check now', () => api.checkEdition(), false]];
  }
  status.textContent = text;
  status.hidden = !text;
  $('lib-error').textContent = e.error || '';
  $('lib-error').hidden = !e.error || busy;
  const akey = buttons.map((b) => b[0]).join('|');
  if (actions.dataset.key !== akey) {
    actions.dataset.key = akey;
    actions.replaceChildren(...buttons.map(([label, fn, primary]) => {
      const b = el('button', `btn${primary ? ' primary' : ''}`, label);
      b.addEventListener('click', () => { b.disabled = true; guard(fn, $('lib-error')).finally(() => { b.disabled = false; }); });
      return b;
    }));
  }

  const s = state.settings;
  $('set-auto').checked = s.autoUpdate;
  setValue('set-connections', s.downloadConnections || 8);
  $('set-login').checked = s.launchAtLogin;
  $('set-login-row').hidden = state.platform !== 'win32';
  $('about-version').textContent = `Version ${state.version}.`;
  renderAi();
}

$('set-auto').addEventListener('change', (e) => api.setSettings({ autoUpdate: e.target.checked }));
$('set-connections').addEventListener('change', (e) => api.setSettings({ downloadConnections: Number(e.target.value) }));
$('set-login').addEventListener('change', (e) => api.setSettings({ launchAtLogin: e.target.checked, keepInTray: e.target.checked }));

function setValue(id, value) {
  const node = $(id);
  if (document.activeElement !== node && node.value !== String(value)) node.value = String(value);
}

function renderAi() {
  const ai = state.ai;
  const s = state.settings.ai;
  $('ai-enabled').checked = s.enabled;
  $('ai-form').hidden = !s.enabled;
  setValue('ai-provider', s.provider);
  setValue('ai-foundry-model', s.foundryModel);
  setValue('ai-base-url', s.baseUrl);
  setValue('ai-model', s.model);
  setValue('ai-context', s.contextChars);
  setValue('ai-length', s.maxAnswerTokens);
  setValue('ai-idle', s.idleMinutes ?? 3);
  renderTune();
  $('ai-foundry').hidden = s.provider !== 'foundry';
  $('ai-custom').hidden = s.provider !== 'custom';

  let text;
  let buttons = [];
  const setup = ['Set up answers', () => api.setupAnswers(), true];
  if (!s.enabled) text = 'Answers are off. Ask shows the best matching passages from the offline copy.';
  else if (ai.resting) {
    text = 'The model is out of memory to keep this computer free. It loads again with your next question, which adds a short wait.';
    buttons = [['Load it now', () => api.prepareAi(), false]];
  }
  else if (ai.state === 'ready') {
    text = `Ready${ai.device ? ` on the ${ai.device}` : ''}, using ${ai.modelId}. Questions are answered on this laptop with no internet.`;
    buttons = [['Reload the model', () => api.prepareAi(), false]];
  } else if (ai.state === 'not-installed') {
    text = 'Foundry Local was not found on this laptop. It is Microsoft\'s free runtime for running models on the NPU. Installing it needs the internet once; if you installed it a moment ago, restart Wikivault.';
    buttons = [[state.platform === 'win32' ? 'Install Foundry Local and the model' : 'Set up answers', () => api.setupAnswers(), true]];
  } else if (ai.state === 'needs-model') {
    text = `Foundry Local is installed, but the model ${s.foundryModel} is not on this laptop yet. Downloading it is a one-time step of a few gigabytes and needs the internet.`;
    buttons = [['Download and load the model', () => api.setupAnswers(), true]];
  } else if (ai.state === 'error') {
    text = 'The local model could not be started.';
    buttons = [['Try again', () => api.prepareAi(), true]];
  } else {
    text = s.provider === 'foundry'
      ? 'Not set up yet. Setting up starts Foundry Local and downloads the model if it is not already on this laptop.'
      : 'Not connected yet.';
    buttons = [setup];
  }
  $('ai-status').textContent = text;
  if (view === 'library') { if (!catalog) loadModelList(); renderBuilds(); }
  $('ai-busy').textContent = ai.tune ? '' : (ai.busy || ''); // tuning shows its own progress under its button
  $('ai-busy').hidden = !ai.busy;
  const err = ai.state === 'error' ? ai.message : '';
  $('ai-error').textContent = err;
  $('ai-error').hidden = !err || Boolean(ai.busy);

  const actions = $('ai-actions');
  const key = `${buttons.map((b) => b[0]).join('|')}#${ai.busy ? 1 : 0}`;
  if (actions.dataset.key !== key) {
    actions.dataset.key = key;
    actions.replaceChildren(...(s.enabled ? buttons : []).map(([label, fn, primary]) => {
      const b = el('button', `btn${primary ? ' primary' : ''}`, label);
      b.disabled = Boolean(ai.busy);
      b.addEventListener('click', () => guard(fn, $('ai-error')));
      return b;
    }));
  }
}

const aiChange = (id, toPatch) => $(id).addEventListener('change', (e) => api.setSettings({ ai: toPatch(e.target) }));
aiChange('ai-enabled', (t) => ({ enabled: t.checked }));
aiChange('ai-provider', (t) => ({ provider: t.value }));
aiChange('ai-foundry-model', (t) => ({ foundryModel: t.value.trim() || 'phi-4-mini' }));
aiChange('ai-base-url', (t) => ({ baseUrl: t.value.trim() }));
aiChange('ai-idle', (t) => ({ idleMinutes: Number(t.value) }));
aiChange('ai-model', (t) => ({ model: t.value.trim() }));
aiChange('ai-context', (t) => ({ contextChars: Number(t.value) }));
aiChange('ai-length', (t) => ({ maxAnswerTokens: Number(t.value) }));

// The models Foundry Local offers for this computer, with each build's measured speed.
let catalog = null;        // { families: [{ alias, builds: [{ id, device, sizeMb, cached }] }], tests: { [id]: result } }
let catalogLoading = false;
let catalogTriedAt = 0;
let shownFamily = null;    // which family the table shows; browsing does not change the model in use
let speedBusy = false;
let lastUsing = null;      // the family last seen in use, so the list can follow a switch

const gb = (mb) => (mb ? `${(mb / 1024).toFixed(1)} GB` : '');
const DEVICE_NAME = { NPU: 'NPU', GPU: 'GPU', CPU: 'CPU' };

function familyOf(nameOrId) {
  const n = String(nameOrId || '').toLowerCase();
  return catalog?.families.find((f) => f.alias.toLowerCase() === n || f.builds.some((x) => x.id.toLowerCase() === n)) || null;
}

async function loadModelList(force = false) {
  if (catalogLoading || (catalog && !force) || !state || state.settings.ai.provider !== 'foundry' || !state.settings.ai.enabled) return;
  if (state.ai.state === 'not-installed' || (!force && Date.now() - catalogTriedAt < 15000)) return;
  catalogLoading = true;
  catalogTriedAt = Date.now();
  try {
    catalog = await api.aiCatalog();
    if (!catalog.families.length) catalog = null;
    if (catalog && !familyOf(shownFamily)) shownFamily = (familyOf(state.ai.modelId) || familyOf(state.settings.ai.foundryModel) || catalog.families[0])?.alias || null;
  } catch { catalog = null; } finally { catalogLoading = false; }
  renderBuilds();
}

/** Builds worth timing for a family: the NPU and GPU ones, and the CPU one only when it is all there is or is already here. */
function buildsToTime(family) {
  const fast = family.builds.filter((x) => x.device !== 'CPU');
  return family.builds.filter((x) => x.device !== 'CPU' || x.cached || !fast.length);
}

function renderBuilds() {
  const table = $('ai-builds');
  const select = $('ai-family');
  const have = Boolean(catalog?.families.length);
  table.hidden = !have;
  $('ai-speed-test').hidden = !have;
  select.disabled = !have || speedBusy;
  if (!have) {
    if (!select.options.length) select.append(new Option(state?.settings.ai.foundryModel || 'phi-4-mini', ''));
    $('ai-speed-note').textContent = state?.ai.state === 'not-installed' ? '' : 'The list of models appears once Foundry Local has started.';
    return;
  }
  const key = catalog.families.map((f) => f.alias).join('|');
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.replaceChildren(...catalog.families.map((f) => {
      const sizes = f.builds.map((x) => x.sizeMb).filter(Boolean);
      const size = sizes.length ? (Math.min(...sizes) === Math.max(...sizes) ? gb(sizes[0]) : `${gb(Math.min(...sizes))} to ${gb(Math.max(...sizes))}`) : '';
      return new Option([f.alias, size, f.devices.join(' / ')].filter(Boolean).join(', '), f.alias);
    }));
  }
  // The list follows the model in use; choosing another entry only browses until a button is pressed.
  const using = familyOf(state.ai.modelId)?.alias || null;
  if (using && using !== lastUsing) { lastUsing = using; shownFamily = using; }
  for (const o of select.options) o.textContent = o.textContent.replace(/ \(in use\)$/, '') + (o.value === using ? ' (in use)' : '');
  if (document.activeElement !== select) select.value = shownFamily || '';
  const family = familyOf(shownFamily) || catalog.families[0];
  const inUse = String(state.ai.modelId || '').toLowerCase();
  const busy = Boolean(state.ai.busy) || speedBusy;
  const best = Object.values(catalog.tests).filter((t) => !t.error && family.builds.some((x) => x.id === t.id)).sort((x, y) => y.tokensPerS - x.tokensPerS)[0];

  table.tBodies[0].replaceChildren(...family.builds.map((build) => {
    const tr = el('tr', build.id.toLowerCase() === inUse ? 'in-use' : '');
    tr.dataset.build = build.id;
    const test = catalog.tests[build.id];
    const speed = el('td', 'speed');
    if (!test) speed.textContent = 'Not timed yet';
    else if (test.error) speed.textContent = `Could not be timed: ${test.error}`;
    else {
      speed.append(el('strong', '', `${test.tokensPerS} tokens a second`), `, first word after ${test.firstS} s`);
      if (best && best.id === build.id && family.builds.filter((x) => catalog.tests[x.id] && !catalog.tests[x.id].error).length > 1) speed.append(' ', el('span', 'tag', 'Fastest here'));
    }
    const action = el('td');
    if (build.id.toLowerCase() === inUse) action.textContent = 'In use';
    else {
      const use = el('button', 'btn small', build.cached ? 'Use' : `Download and use${build.sizeMb ? ` (${gb(build.sizeMb)})` : ''}`);
      use.disabled = busy;
      use.addEventListener('click', () => guard(async () => { await api.useModel(build.id); await loadModelList(true); }, $('ai-error')));
      action.append(use);
      if (build.cached) {
        const remove = el('button', 'btn small', `Remove download${build.sizeMb ? ` (${gb(build.sizeMb)})` : ''}`);
        remove.disabled = busy;
        remove.title = 'Deletes this build\'s files to free disk space. Its timing is kept, and it can be downloaded again.';
        remove.addEventListener('click', () => guard(async () => { await api.removeDownload(build.id); await loadModelList(true); }, $('ai-error')));
        action.append(' ', remove);
      }
    }
    tr.append(el('td', 'build-id', build.id), el('td', '', DEVICE_NAME[build.device] || build.device || 'Unknown'),
      el('td', '', build.cached ? 'On this computer' : gb(build.sizeMb) || 'Not downloaded'), speed, action);
    return tr;
  }));

  const todo = buildsToTime(family);
  const download = todo.filter((x) => !x.cached).reduce((sum, x) => sum + (x.sizeMb || 0), 0);
  const button = $('ai-speed-test');
  button.textContent = todo.length > 1 ? `Find the fastest of these ${todo.length} builds` : 'Time this build';
  button.disabled = busy;
  $('ai-speed-cancel').hidden = !speedBusy;
  if (!speedBusy && !$('ai-speed-note').dataset.result) {
    $('ai-speed-note').textContent = `Each build answers the same test question. ${download ? `This downloads ${gb(download)} first. ` : ''}Wikivault then switches to the fastest one. It takes a few minutes, and answers are unavailable while it runs.`;
  }
}

$('ai-family').addEventListener('change', (e) => { shownFamily = e.target.value; delete $('ai-speed-note').dataset.result; renderBuilds(); });
$('ai-speed-cancel').addEventListener('click', () => api.cancelSpeedTest());
$('ai-speed-test').addEventListener('click', async () => {
  const family = familyOf(shownFamily);
  if (!family || speedBusy) return;
  const note = $('ai-speed-note');
  speedBusy = true;
  note.dataset.result = '1';
  note.textContent = 'Timing each build. Progress is shown below.';
  renderBuilds();
  try {
    const out = await api.speedTest(buildsToTime(family).map((x) => x.id), true);
    const win = out.results.find((r) => r.id === out.best);
    note.textContent = win
      ? `Fastest here: ${win.id}, on the ${win.device || 'computer'}, at ${win.tokensPerS} tokens a second. ${out.switched ? 'Wikivault now uses it.' : 'Wikivault was already using it.'}${out.removed?.length ? ` The download made only for this test was deleted (${gb(out.freedMb)} freed); its timing is kept.` : ''}`
      : 'None of the builds could be timed. The reasons are in the table.';
  } catch (err) {
    note.textContent = /abort/i.test(err.message) ? 'Stopped. Builds timed so far keep their results.' : `The speed test stopped: ${err.message}`;
  } finally {
    speedBusy = false;
    await loadModelList(true);
    renderBuilds();
  }
});

// "Tune for this computer": a plan first (what will be downloaded), then the run, then what was found.
// The same five steps the tuning code uses; kept in words here so the slider can explain itself.
const TUNE_PREFS = [
  ['Fastest', 25, 3, 20], ['Fast', 15, 5, 30], ['Balanced', 10, 8, 45], ['Thorough', 6, 15, 75], ['Most thorough', 3, 30, 120],
];
function describePreference(value, tunedWith) {
  const [name, tps, first, write] = TUNE_PREFS[value] || TUNE_PREFS[2];
  const lean = value < 2 ? 'A smaller model, less article text and shorter answers.' : value > 2 ? 'A larger model, more article text and longer answers, with more waiting.' : 'A middle course between the two.';
  const stale = tunedWith != null && tunedWith !== value ? ' Tune again to apply this.' : '';
  return `${name}: at least ${tps} tokens a second, the first word within about ${first} s, a full answer within about ${write} s. ${lean}${stale}`;
}
let tuneStage = 'idle'; // idle | plan | running
let tuneResult = null;  // the run just finished, shown without waiting for the next state update
function renderTune() {
  const busy = Boolean(state.ai.busy);
  const pref = Number(state.settings.ai.tunePreference ?? 2);
  const slider = $('ai-tune-pref');
  if (document.activeElement !== slider) slider.value = pref;
  slider.disabled = busy;
  $('ai-tune-pref-text').textContent = describePreference(Number(slider.value), state.settings.ai.tuning?.preference);
  // A run started before this window was opened is still a run.
  const running = tuneStage === 'running' || Boolean(state.ai.tune);
  $('ai-tune').hidden = tuneStage !== 'idle' || running;
  $('ai-tune').disabled = busy;
  $('ai-tune-go').hidden = tuneStage !== 'plan';
  $('ai-tune-cancel').hidden = tuneStage === 'idle' && !running;
  $('ai-tune-cancel').textContent = running ? 'Stop' : 'Cancel';
  // Progress sits directly under the button: what is happening, overall bar, current-step bar, the step itself.
  const run = state.ai.tune;
  $('ai-tune-progress').hidden = !run;
  if (run) {
    $('ai-tune-summary').textContent = run.summary;
    $('ai-tune-overall').value = run.overall;
    const stepBar = $('ai-tune-step');
    if (run.stepFraction == null) stepBar.removeAttribute('value'); else stepBar.value = run.stepFraction;
    $('ai-tune-detail').textContent = run.detail;
  }
  const done = tuneResult || state.settings.ai.tuning;
  const list = $('ai-tune-result');
  list.hidden = tuneStage !== 'idle' || running || !done;
  if (done && list.dataset.at !== done.at) {
    list.dataset.at = done.at;
    list.replaceChildren(...done.reasons.map((r) => el('li', '', r)));
    $('ai-tune').textContent = 'Tune again';
    if (tuneStage === 'idle' && !tuneResult) $('ai-tune-note').textContent = `Tuned on ${new Date(done.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. What was measured and chosen:`;
  }
}
$('ai-tune-pref').addEventListener('input', (e) => { $('ai-tune-pref-text').textContent = describePreference(Number(e.target.value), state.settings.ai.tuning?.preference); });
$('ai-tune-pref').addEventListener('change', (e) => api.setSettings({ ai: { tunePreference: Number(e.target.value) } }));
$('ai-tune').addEventListener('click', () => guard(async () => {
  const plan = await api.tunePlan();
  const size = (mb) => `${(mb / 1024).toFixed(1)} GB`;
  $('ai-tune-note').textContent = plan.custom
    ? 'Tuning asks your model server two test questions and sets the reading budget and answer length to suit its speed. Nothing is downloaded.'
    : [
      plan.devices.length > 1
        ? `Step 1 compares the ${plan.devices.join(', ')} on ${plan.probe}${plan.probeMb ? `, which downloads ${size(plan.probeMb)}` : ', using builds already here'}.`
        : `This computer has one kind of hardware for models (${plan.devices[0] || 'CPU'}).`,
      `Step 2 tries up to three models on the fastest hardware, starting from the size expected to suit it. Each one not already here is a download of ${size(plan.smallestMb)} to ${size(plan.largestMb)}.`,
      'Step 3 measures how the reading budget affects speed and sets it and the answer length.',
      'At the end every model download except the chosen one is deleted; the timings are kept.',
      'It needs the internet, can take 10 to 30 minutes depending on downloads, and answers are unavailable meanwhile. Plug the computer in first.',
    ].join(' ');
  tuneStage = 'plan';
  renderTune();
}, $('ai-error')));
$('ai-tune-cancel').addEventListener('click', () => {
  if (tuneStage === 'running' || state.ai.tune) { api.cancelSpeedTest(); return; }
  tuneStage = 'idle';
  $('ai-tune-note').textContent = 'Measures this computer and chooses the hardware, the model, the reading budget and the answer length to suit it. Each choice can be changed below afterwards.';
  delete $('ai-tune-result').dataset.at;
  renderTune();
});
$('ai-tune-go').addEventListener('click', async () => {
  tuneStage = 'running';
  $('ai-tune-note').textContent = 'Tuning this computer. You can keep reading and searching while it runs.';
  renderTune();
  try {
    tuneResult = await api.tuneRun();
    $('ai-tune-note').textContent = 'Tuning finished. What was measured and chosen:';
  } catch (err) {
    $('ai-tune-note').textContent = /abort/i.test(err.message) ? 'Tuning stopped. Anything already timed keeps its result, and nothing was changed after that point.' : `Tuning stopped: ${err.message}`;
  } finally {
    tuneStage = 'idle';
    state.ai.tune = null; // the run is over; do not wait for the next state update to say so
    delete $('ai-tune-result').dataset.at;
    renderTune();
    await loadModelList(true);
    renderTune();
  }
});

// The agreement shown once, before anything else can be used. It cannot be dismissed with Escape.
$('ack-dialog').addEventListener('cancel', (e) => e.preventDefault());
$('ack-go').addEventListener('click', async () => { await api.acknowledge(); $('ack-dialog').close(); });
$('ack-licence').addEventListener('click', () => api.openNotices('licence').catch(() => {}));
$('about-licence').addEventListener('click', () => guard(() => api.openNotices('licence'), $('about-error')));
$('about-notices').addEventListener('click', () => guard(() => api.openNotices('notices'), $('about-error')));
function renderAgreement() {
  const dialog = $('ack-dialog');
  if (!state.acknowledged && !dialog.open) dialog.showModal();
  if (state.acknowledged && dialog.open) dialog.close();
}

// Changing how much of Wikipedia is kept, after setup.
let libFlavours = null;      // what the main process last reported
let libFlavourKey = null;    // the state that report was asked for
let libFlavourPick = null;   // the size ticked but not yet confirmed
function renderLibraryFlavours() {
  if (view !== 'library' || !state.edition?.active) return;
  const key = `${state.edition.active.file}|${state.settings.flavour}|${state.settings.dataDir}`;
  if (libFlavourKey !== key) {
    libFlavourKey = key;
    libFlavourPick = null;
    api.libraryFlavours().then((info) => { libFlavours = info; renderLibraryFlavours(); }).catch(() => { libFlavours = { options: [] }; renderLibraryFlavours(); });
  }
  const info = libFlavours;
  if (!info) return;
  const box = $('lib-flavours');
  if (!info.options.length) { box.replaceChildren(el('p', 'small-print', 'Kiwix could not be asked for the sizes just now.')); $('lib-flavour-actions').hidden = true; return; }
  const switching = info.wanted !== info.current && info.options.some((o) => o.flavour === info.wanted);
  const ticked = libFlavourPick || info.wanted;
  const paint = JSON.stringify([info, ticked]);
  if (box.dataset.key !== paint) {
    box.dataset.key = paint;
    box.replaceChildren(...info.options.map((f) => {
      const [name, about] = FLAVOUR_TEXT[f.flavour] || [f.flavour, ''];
      const row = el('label', `flavour${f.fits ? '' : ' unfit'}`);
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'lib-flavour'; radio.value = f.flavour; radio.checked = f.flavour === ticked; radio.disabled = !f.fits;
      radio.addEventListener('change', () => { libFlavourPick = f.flavour; $('lib-flavour-error').hidden = true; renderLibraryFlavours(); });
      row.append(radio, el('span', 'f-name', name), el('span', 'f-size', `${f.known ? '' : 'about '}${bytes(f.bytes)}`), el('span', 'f-about', about));
      if (f.current) row.append(el('span', 'f-fit', 'This is the copy on this computer now.'));
      else if (!f.fits) row.append(el('span', 'f-fit no', f.why));
      return row;
    }));
  }
  const pick = info.options.find((o) => o.flavour === ticked);
  const now = info.options.find((o) => o.current);
  const note = $('lib-flavour-note');
  const go = $('lib-flavour-go');
  const keep = $('lib-flavour-keep');
  note.hidden = true;
  go.hidden = true;
  keep.hidden = true;
  if (libFlavourPick && pick && libFlavourPick !== info.wanted) {
    // A size has been ticked and is waiting to be confirmed.
    const name = (FLAVOUR_TEXT[pick.flavour] || [pick.flavour])[0].toLowerCase();
    go.hidden = false;
    if (pick.current) {
      go.textContent = 'Keep the size I have';
      note.textContent = 'The download of the other size is stopped and what it had fetched is deleted.';
    } else {
      go.textContent = `Switch to ${name} (${bytes(pick.bytes)} to download)`;
      note.textContent = `${bytes(pick.bytes)} is downloaded and checked while you keep using the copy you have${now ? ` (${bytes(state.edition.active.bytes)})` : ''}, which is then deleted. ${({ mini: 0, nopic: 1, maxi: 2 }[pick.flavour] ?? 3) < ({ mini: 0, nopic: 1, maxi: 2 }[info.current] ?? 3) ? 'Going to a smaller size removes content: to get it back, the larger size has to be downloaded again.' : 'Progress is shown at the top of this page.'}`;
    }
    note.hidden = false;
  } else if (switching) {
    const name = (FLAVOUR_TEXT[info.wanted] || [info.wanted])[0].toLowerCase();
    note.textContent = `Switching to ${name}. Progress is shown at the top of this page; the copy you have stays in use until the new one is checked.`;
    note.hidden = false;
    keep.hidden = false;
  }
  $('lib-flavour-actions').hidden = go.hidden && keep.hidden;
}
$('lib-flavour-go').addEventListener('click', () => guard(async () => {
  if (!libFlavourPick) return;
  await api.changeFlavour(libFlavourPick);
  libFlavourKey = null;
}, $('lib-flavour-error')));
$('lib-flavour-keep').addEventListener('click', () => guard(async () => {
  if (!libFlavours?.current) return;
  await api.changeFlavour(libFlavours.current);
  libFlavourKey = null;
}, $('lib-flavour-error')));

// More libraries (Wikibooks, Wikiversity): a switcher in the top bar and a section on the Library page.
const libInfoAsked = new Set();
function libraryName(id) { return id === 'wikipedia' ? 'Wikipedia' : (state.libraries.find((l) => l.id === id)?.name || id); }

function renderLibraries() {
  const libs = state.libraries || [];
  const ready = libs.filter((l) => l.ready);
  const select = $('lib-select');
  select.hidden = !ready.length;
  const key = ['wikipedia', ...ready.map((l) => l.id)].join('|');
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    select.replaceChildren(new Option('Wikipedia', 'wikipedia'), ...ready.map((l) => new Option(l.name, l.id)));
  }
  if (document.activeElement !== select) select.value = state.activeLibrary;
  const where = libraryName(state.activeLibrary);
  $('search-input').placeholder = ready.length ? `Search ${where}` : 'Search this edition';
  $('search-input').setAttribute('aria-label', $('search-input').placeholder);

  if (view !== 'library') return;
  renderLibraryFlavours();
  const haveWikipedia = Boolean(state.edition?.active);
  $('more-libs').replaceChildren(...libs.map((lib) => {
    const box = el('div', 'more-lib');
    box.dataset.lib = lib.id;
    box.append(el('h3', '', lib.name), el('p', '', lib.about));
    const busy = ['checking', 'downloading', 'verifying', 'switching'].includes(lib.phase);
    const status = el('p', 'lib-status');
    const actions = el('div', 'actions');
    const button = (label, fn, primary) => {
      const b = el('button', `btn${primary ? ' primary' : ''}`, label);
      b.addEventListener('click', () => { $('more-error').hidden = true; guard(fn, $('more-error')); });
      actions.append(b);
      return b;
    };
    if (busy) {
      const p = lib.progress;
      const pct = p?.total ? Math.floor((p.received / p.total) * 100) : null;
      status.textContent = lib.phase === 'downloading' ? `Downloading${pct != null ? ` ${pct}%` : ''}${p?.total ? ` of ${bytes(p.total)}` : ''}` : lib.phase === 'verifying' ? 'Checking the download against the published checksum' : lib.phase === 'switching' ? 'Opening it' : 'Looking for the newest edition';
      box.append(status);
      if (pct != null && lib.phase === 'downloading') { const bar = document.createElement('progress'); bar.max = 100; bar.value = pct; box.append(bar); }
      button('Cancel', () => api.extraCancel(lib.id));
    } else if (lib.active) {
      status.textContent = `${lib.active.date ? `${editionName(lib.active.date)} edition` : lib.active.file}, ${bytes(lib.active.bytes)}. ${lib.updateAvailable ? 'A newer edition is available.' : 'Checked for newer editions along with Wikipedia.'}${lib.error ? ` Last problem: ${lib.error}` : ''}`;
      box.append(status);
      if (state.activeLibrary !== lib.id && lib.ready) button('Open', async () => { const r = await api.selectLibrary(lib.id); openUrl(r.homeUrl); }, true);
      if (lib.updateAvailable) button('Download the newer edition', () => api.extraDownload(lib.id));
      button('Remove', () => api.extraRemove(lib.id));
    } else {
      if (!lib.latest && haveWikipedia && !libInfoAsked.has(lib.id)) {
        libInfoAsked.add(lib.id);
        api.extraInfo(lib.id).then((info) => { lib.latest = info; renderLibraries(); }).catch(() => {});
      }
      status.textContent = lib.error ? `Could not be downloaded: ${lib.error}` : !haveWikipedia ? 'Available once Wikipedia is set up.' : lib.latest?.bytes ? `Not downloaded. The newest edition is ${bytes(lib.latest.bytes)}.` : 'Not downloaded.';
      box.append(status);
      const b = button(lib.latest?.bytes ? `Download (${bytes(lib.latest.bytes)})` : 'Download', () => api.extraDownload(lib.id), true);
      b.disabled = !haveWikipedia;
    }
    box.append(actions);
    return box;
  }));
}
$('lib-select').addEventListener('change', (e) => guard(async () => {
  const r = await api.selectLibrary(e.target.value);
  if (!$('ask-new').hidden) newConversation({ focus: false });
  $('results').replaceChildren();
  openUrl(r.homeUrl);
}, null));

// ------------------------------------------------------------ school
// A year of lessons from free curriculum files, laid out week by week. The plan, the files and the
// search index are kept by the main process (src/core/school*.js); this part shows them.
const SCHOOL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
let schTab = 'week';
let schWeekNo = null;     // the week on screen; null follows "where we are"
let schWeek = null;
let schYear = null;
let schHits = null;       // { q, hits } while search results are showing
let schKey = '';
let schLoading = false;
let schShowing = false;   // the reader pane is showing one of the school books
const schoolUrl = (url) => Boolean(url) && /^http:\/\/127\.0\.0\.1:\d+\/f\/[a-z0-9-]+\.pdf/.test(url);
const subjectVar = (id) => `var(--sub-${['ela', 'math', 'hist', 'sci'].includes(id) ? id : 'added'})`;

async function schoolOpen(fileId, page, lesson = false) {
  const r = await api.schoolOpen(fileId, page || 1, lesson);
  $('schoolbar-label').textContent = `${r.label}${page ? `, page ${r.page}` : ''}`;
  openUrl(r.url);
}
function schoolLink(label, link) {
  const b = el('button', 'btn', link.page ? `${label}, p. ${link.page}` : label);
  b.type = 'button';
  b.disabled = !link.here;
  b.title = !link.here ? 'Download the files first' : link.page ? 'Opens at the page this app found for it. If it is a page or two off, turn the page.' : 'Opens at the first page';
  b.addEventListener('click', () => guard(() => { lessonLeave(); return schoolOpen(link.fileId, link.page); }, $('sch-error')));
  return b;
}
function schoolFileButton(f) {
  const b = el('button', 'btn', f.here ? `${f.label} (${bytes(f.bytes)})` : `${f.label} (not downloaded)`);
  b.type = 'button';
  b.disabled = !f.here;
  b.addEventListener('click', () => guard(() => schoolOpen(f.id, 1), $('sch-error')));
  return b;
}

function paintSchoolFiles() {
  const s = state.school;
  const box = $('sch-files');
  const j = s.job;
  const key = JSON.stringify([s.have, s.files, s.bytes, s.indexed, s.added, j && [j.kind, j.done, j.total, j.current], s.error, Boolean(state.edition?.active)]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const kids = [];
  const button = (label, fn, primary) => { const b = el('button', `btn${primary ? ' primary' : ''}`, label); b.type = 'button'; b.id = `sch-${label.toLowerCase().split(' ')[0]}`; b.addEventListener('click', () => { $('sch-error').hidden = true; guard(fn, $('sch-error')); }); return b; };
  if (j) {
    kids.push(el('p', '', j.kind === 'download' ? `Downloading file ${Math.min(j.done + 1, j.total)} of ${j.total}${j.bytes ? ` (${bytes(j.bytes)} so far)` : ''}: ${j.current}` : `Reading the files so they can be searched and opened at the right page: ${j.done} of ${j.total}`));
    kids.push(button('Cancel', () => api.schoolCancel()));
    const bar = document.createElement('progress'); bar.max = Math.max(j.total, 1); bar.value = j.done; kids.push(bar);
  } else if (!s.have) {
    kids.push(el('p', '', `Nothing is downloaded yet. Grade ${s.grade} is ${s.files} PDF files from the ${s.publisher}: teacher guides, student books, readers and tests. Expect a few gigabytes; the real size is shown once they are here.`));
    const b = button(`Download the Grade ${s.grade} files`, () => api.schoolDownload(), true);
    b.id = 'sch-download';
    b.disabled = !state.edition?.active;
    kids.push(b);
  } else if (s.have < s.files) {
    kids.push(el('p', '', `${s.have} of ${s.files} files are here (${bytes(s.bytes)}).${s.error ? ` ${s.error}` : ''}`));
    const b = button('Download the rest', () => api.schoolDownload(), true); b.id = 'sch-download'; kids.push(b);
  } else {
    kids.push(el('p', '', `All ${s.files} files are here (${bytes(s.bytes)})${s.indexed >= s.files ? ' and can be searched' : `; ${s.indexed} have been read for search`}.`));
  }
  box.replaceChildren(...kids);
}

function paintSchoolWeek() {
  const w = schWeek;
  const s = state.school;
  const kids = [];
  const nav = el('div', 'sch-weeknav');
  const step = (label, to, id) => { const b = el('button', 'btn', label); b.type = 'button'; b.id = id; b.disabled = to < 1 || to > w.of; b.addEventListener('click', () => { schWeekNo = to; schoolLoad(true); }); return b; };
  nav.append(step('Earlier week', w.number - 1, 'sch-prev'), el('h2', '', `Week ${w.number} of ${w.of}`), step('Later week', w.number + 1, 'sch-next'), el('span', 'sch-meta', w.semester === 1 ? 'First semester' : 'Second semester'));
  if (w.number !== s.currentWeek) { const here = el('button', 'btn quiet', `Go to week ${s.currentWeek}, where you are`); here.type = 'button'; here.addEventListener('click', () => { schWeekNo = null; schoolLoad(true); }); nav.append(here); }
  nav.append(el('span', 'sch-count', `${s.sessionsDone} of ${s.sessions} days of lessons done`));
  kids.push(nav);

  const covers = el('div', 'sch-covers');
  covers.append(el('h3', '', 'What this week covers'));
  const dl = el('dl');
  for (const sub of w.summary) {
    const dd = el('dd');
    for (const u of sub.units) {
      const line = el('p');
      line.append(el('b', '', `Unit ${u.n}, ${u.title}: `), `${u.covers}.`);
      const look = el('button', 'btn quiet', 'Read about it in the library');
      look.type = 'button';
      look.addEventListener('click', () => { $('search-input').value = u.title; doSearch(u.title); });
      dd.append(line, el('p', 'focus', u.focus), look);
    }
    const dt = el('dt', '', sub.name); dt.style.color = subjectVar(sub.subject);
    dl.append(dt, dd);
  }
  covers.append(dl);
  kids.push(covers);

  w.days.forEach((sessions, i) => {
    const day = el('section', 'sch-day');
    day.append(el('h3', '', SCHOOL_DAYS[i] || `Day ${i + 1}`));
    if (!sessions.length) day.append(el('p', 'sch-free', 'Nothing new today. Use it to catch up or review.'));
    for (const x of sessions) {
      const row = el('div', `sch-row${x.done ? ' done' : ''}`);
      row.style.setProperty('--sub', subjectVar(x.subject));
      row.dataset.session = x.id;
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = x.done; box.dataset.focus = x.id;
      box.setAttribute('aria-label', `Done: ${x.subjectName}, Unit ${x.unitN}, ${x.label}`);
      box.addEventListener('change', () => guard(() => api.schoolDone([x.id], box.checked), $('sch-error')));
      const subject = el('div', 'sch-subject', x.subjectName);
      subject.append(el('small', '', `about ${x.minutes} minutes`));
      const what = el('p', 'sch-what');
      what.append(el('b', '', x.name ? `${x.label}: ${x.name}` : x.label), `. Unit ${x.unitN}: ${x.unitTitle}`);
      const links = el('div', 'sch-links');
      const start = el('button', 'btn primary', x.done ? 'Go through it again' : 'Start lesson');
      start.type = 'button';
      start.dataset.start = x.id;
      start.disabled = !(x.links[0] && x.links[0].here);
      start.title = start.disabled ? 'Download the files first' : 'Step through this lesson with the books open beside the steps';
      start.addEventListener('click', () => guard(() => lessonStart(x.id), $('sch-error')));
      links.append(start, ...x.links.map((l) => schoolLink(l.label, l)));
      row.append(box, subject, what, links);
      if (x.caution && x.n === 1) row.append(el('p', 'sch-caution', x.caution));
      day.append(row);
    }
    kids.push(day);
  });
  const all = w.days.flat();
  if (all.length) {
    const allDone = all.every((x) => x.done);
    const b = el('button', 'btn', allDone ? 'Untick the whole week' : 'Tick the whole week as done');
    b.type = 'button'; b.id = 'sch-week-done';
    b.addEventListener('click', () => guard(() => api.schoolDone(all.map((x) => x.id), !allDone), $('sch-error')));
    kids.push(b);
  }
  $('sch-body').replaceChildren(...kids);
}

function paintSchoolYear() {
  const y = schYear;
  const kids = [el('p', 'small-print', 'The order of the units and lessons is the publisher\'s. The weeks are this app\'s own arrangement: each subject\'s days are spread evenly over 36 weeks of five days. Skip a unit and the rest close up.')];
  for (const sub of y.subjects) {
    const block = el('section', 'sch-subject-block');
    block.style.setProperty('--sub', subjectVar(sub.id));
    const total = y.totals.find((t) => t.subject === sub.id);
    block.append(el('h2', '', sub.name), el('p', 'sch-meta', `${sub.series}. About ${sub.minutes} minutes a day, ${total ? total.sessions : 0} days in the year. ${sub.licence}`));
    const table = el('table', 'sch-units');
    const head = el('tr');
    head.append(el('th', '', 'Unit'), el('th', '', 'What it teaches, and its files'), el('th', '', 'Weeks'), el('th', '', 'Done'), el('th', '', 'Skip'));
    const thead = el('thead'); thead.append(head);
    const tb = el('tbody');
    for (const u of sub.units) {
      const tr = el('tr', u.skipped ? 'skipped' : '');
      tr.dataset.unit = u.id;
      const main = el('td');
      main.append(el('div', 'unit-title', u.title), el('p', 'focus', u.focus));
      if (u.note) main.append(el('p', 'note', u.note));
      if (u.caution) main.append(el('p', 'sch-caution', u.caution));
      const files = el('div', 'sch-unit-files');
      files.append(...u.files.map(schoolFileButton));
      main.append(files);
      const skip = document.createElement('input');
      skip.type = 'checkbox'; skip.checked = u.skipped; skip.dataset.focus = `skip-${u.id}`;
      skip.setAttribute('aria-label', `Skip ${sub.name} unit ${u.n}, ${u.title}`);
      skip.addEventListener('change', () => guard(() => api.schoolSkip(u.id, skip.checked), $('sch-error')));
      const skipCell = el('td'); skipCell.append(skip);
      tr.append(el('td', 'num', String(u.n)), main, el('td', 'num', u.weeks ? (u.weeks[0] === u.weeks[1] ? String(u.weeks[0]) : `${u.weeks[0]} to ${u.weeks[1]}`) : 'skipped'), el('td', 'num', `${u.done} of ${u.days}`), skipCell);
      tb.append(tr);
    }
    table.append(thead, tb);
    block.append(table);
    if (sub.extras.length) {
      const extra = el('div', 'sch-unit-files');
      extra.append(...sub.extras.map(schoolFileButton));
      block.append(el('p', 'sch-meta', 'For the whole year:'), extra);
    }
    kids.push(block);
  }
  $('sch-body').replaceChildren(...kids);
}

function paintSchoolBooks() {
  const y = schYear;
  const kids = [el('p', 'small-print', 'The lessons are free, but a few of them are built on books that are not, and science needs materials. Tick what you have. Nothing here is bought or ordered by the app.')];
  for (const b of y.shopping) {
    const row = el('div', 'sch-buy');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.checked = b.have; box.dataset.focus = `have-${b.id}`;
    box.setAttribute('aria-label', `I have ${b.title}`);
    box.addEventListener('change', () => guard(() => api.schoolHave(b.id, box.checked), $('sch-error')));
    const text = el('div');
    const title = el('p');
    title.append(el('b', '', b.title), el('span', `sch-tag${b.need === 'required' ? ' need' : ''}`, b.need === 'required' ? 'Needed' : 'Optional'));
    text.append(title, el('p', 'who', `${b.by ? `${b.by}. ` : ''}For ${b.for}.`), el('p', '', b.note));
    row.append(box, text);
    kids.push(row);
  }
  kids.push(el('h2', 'sch-h2', 'Books I have added'), el('p', 'small-print', 'PDFs you own, such as a course you bought as a download, can be kept here. They are copied into the library, can be searched with the rest, and move with it. Only add files you have the right to keep; books from stores that lock their e-books cannot be added.'));
  for (const f of y.added) {
    const row = el('div', 'sch-unit-files');
    const remove = el('button', 'btn quiet', 'Remove'); remove.type = 'button';
    remove.addEventListener('click', () => guard(() => api.schoolRemoveBook(f.id), $('sch-error')));
    row.append(schoolFileButton(f), remove);
    kids.push(row);
  }
  const add = el('button', 'btn', 'Add PDF books'); add.type = 'button'; add.id = 'sch-add';
  add.addEventListener('click', () => { $('sch-error').hidden = true; guard(() => api.schoolAddBooks(), $('sch-error')); });
  kids.push(add);
  $('sch-body').replaceChildren(...kids);
}

function paintSchoolHits() {
  const { q, hits } = schHits;
  const kids = [];
  const back = el('button', 'btn quiet', 'Back to the plan'); back.type = 'button';
  back.addEventListener('click', () => { schHits = null; $('sch-q').value = ''; schoolLoad(true); });
  const s = state.school;
  kids.push(el('p', '', hits.length ? `${hits.length === 40 ? 'The best 40 pages' : `${hits.length} ${hits.length === 1 ? 'page' : 'pages'}`} with "${q}" in the school books.` : s.indexed ? `No page of the school books has all of: ${q}.` : 'The school books have not been downloaded and read yet, so there is nothing to search.'), back);
  for (const h of hits) {
    const b = el('button', 'sch-hit'); b.type = 'button';
    b.append(el('b', '', `${h.subjectName}, ${h.where}: ${h.label}, page ${h.page}`), el('span', '', h.snippet));
    b.addEventListener('click', () => guard(() => schoolOpen(h.fileId, h.page), $('sch-error')));
    kids.push(b);
  }
  $('sch-body').replaceChildren(...kids);
}

async function schoolLoad(force) {
  if (schLoading) return;
  schLoading = true;
  try {
    const focus = document.activeElement?.dataset?.focus;
    if (schHits) paintSchoolHits();
    else if (schTab === 'week') { schWeek = await api.schoolWeek(schWeekNo || state.school.currentWeek); paintSchoolWeek(); } else { schYear = await api.schoolOverview(); if (schTab === 'year') paintSchoolYear(); else paintSchoolBooks(); }
    for (const t of document.querySelectorAll('.sch-tab')) t.setAttribute('aria-selected', String(!schHits && t.dataset.tab === schTab));
    if (focus) document.querySelector(`#sch-body [data-focus="${CSS.escape(focus)}"]`)?.focus();
    if (force) $('view-school').scrollTop = 0;
  } catch (err) { $('sch-error').textContent = err.message; $('sch-error').hidden = false; } finally { schLoading = false; }
}

function renderSchool() {
  const s = state?.school;
  $('nav-school').disabled = !s || golfPlaying();
  $('nav-school').setAttribute('aria-pressed', String(view === 'school'));
  $('schoolbar').hidden = !(view === 'reader' && schShowing);
  paintLesson();
  if (!s || view !== 'school') return;
  $('sch-title').textContent = `School: ${s.title}`;
  $('sch-credit').textContent = s.credit;
  paintSchoolFiles();
  // The plan is fetched again when something that changes it has changed, not on every download tick.
  const key = [s.job ? 'busy' : `${s.have}|${s.indexed}`, s.sessionsDone, s.sessions, s.added, schTab].join('|');
  if (key !== schKey) { schKey = key; schoolLoad(false); }
}
for (const t of document.querySelectorAll('.sch-tab')) t.addEventListener('click', () => { schTab = t.dataset.tab; schHits = null; schKey = ''; renderSchool(); });
$('nav-school').addEventListener('click', () => { if (!golfPlaying()) { schKey = ''; showView('school'); } });
$('schoolbar-back').addEventListener('click', () => { lessonLeave(); showView('school'); });
$('sch-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('sch-q').value.trim();
  if (!q) return;
  $('sch-error').hidden = true;
  guard(async () => { schHits = { q, hits: await api.schoolSearch(q) }; await schoolLoad(true); }, $('sch-error'));
});

// ------------------------------------------------------------ map
// An offline map (MapLibre drawing a PMTiles file served by the app itself) and places to find on it.

let mapView = null;        // the MapLibre map, made the first time the view is opened with a map on disk
let mapKey = '';           // the map file that view was made for
let mapOrigin = null;      // the app's own local server
let mapProtocol = null;
let mapSetupOpen = false;
let mapHits = { total: 0, hits: [] };
let mapSelected = null;    // id of the place whose details are open
let mapPopup = null;
let mapAsked = 0;
// The look chosen for the map (dark or not, kinds of feature switched off), kept between runs.
let mapLook = { dark: false, off: [] };
try { mapLook = WikivaultMapStyle.clean(JSON.parse(localStorage.getItem('wikivault-map-look') || '{}')); } catch { /* the default look */ }
const mapStyleFor = (key) => ({
  version: 8,
  glyphs: `${mapOrigin}/m/fonts/{fontstack}/{range}.pbf`,
  sprite: `${mapOrigin}/m/sprites/${WikivaultMapStyle.sprite(mapLook)}`,
  sources: { protomaps: { type: 'vector', url: `pmtiles://${mapOrigin}/m/map.pmtiles?v=${encodeURIComponent(key)}`, attribution: '© OpenStreetMap contributors' } },
  layers: WikivaultMapStyle.layers(basemaps, mapLook),
});

function paintMapLook(m) {
  const box = $('map-look');
  box.hidden = !m.map;
  if (!m.map) return;
  $('map-dark').checked = mapLook.dark;
  const groups = $('map-look-groups');
  if (!groups.children.length) {
    for (const g of WikivaultMapStyle.GROUPS) {
      const label = el('label', 'map-check');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.dataset.group = g.id;
      input.addEventListener('change', () => { mapLook.off = [...groups.querySelectorAll('input')].filter((i) => !i.checked).map((i) => i.dataset.group); mapApplyLook(false); });
      label.append(input, el('span', '', g.name));
      groups.append(label);
    }
  }
  for (const input of groups.querySelectorAll('input')) input.checked = !mapLook.off.includes(input.dataset.group);
}

/** Put the chosen look on the map. Switching kinds on and off touches the layers; day and night need a new style. */
function mapApplyLook(restyle) {
  try { localStorage.setItem('wikivault-map-look', JSON.stringify(mapLook)); } catch { /* not kept, that is all */ }
  $('map-canvas').parentElement.style.background = WikivaultMapStyle.background(mapLook);
  if (!mapView) return;
  if (restyle) {
    $('map-canvas').dataset.ready = '';
    mapView.once('style.load', () => { mapAddOverlays(mapView); $('map-canvas').dataset.ready = '1'; });
    mapView.setStyle(mapStyleFor(mapKey), { diff: false });
    return;
  }
  for (const layer of mapView.getStyle().layers) if (layer.source === 'protomaps' || layer.id === 'background') { const want = WikivaultMapStyle.shown(layer.id, mapLook.off) ? 'visible' : 'none'; if ((mapView.getLayoutProperty(layer.id, 'visibility') || 'visible') !== want) mapView.setLayoutProperty(layer.id, 'visibility', want); }
}

/** The app's own layers over the map: the route, blocked areas, the ends of the route, and places found. */
function mapAddOverlays(map) {
  if (map.getSource('hits')) return;
  const dark = mapLook.dark;
  const empty = { type: 'FeatureCollection', features: [] };
  for (const id of ['blocks', 'route', 'ends', 'hits']) map.addSource(id, { type: 'geojson', data: empty });
  map.addLayer({ id: 'blocks-fill', type: 'fill', source: 'blocks', paint: { 'fill-color': '#d93025', 'fill-opacity': 0.25 } });
  map.addLayer({ id: 'blocks-edge', type: 'line', source: 'blocks', paint: { 'line-color': dark ? '#ff6b5e' : '#b3261e', 'line-width': 2, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'route-case', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#0b0d10' : '#ffffff', 'line-width': 10 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': dark ? '#4da3ff' : '#1a56c4', 'line-width': 6 } });
  map.addLayer({ id: 'hits-dot', type: 'circle', source: 'hits', paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 9, 6], 'circle-color': ['case', ['==', ['get', 'sel'], 1], '#d93025', dark ? '#ffd84a' : '#14304d'], 'circle-stroke-color': dark ? '#0b0d10' : '#ffffff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'hits-name', type: 'symbol', source: 'hits', minzoom: 10, layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': dark ? '#ffe9a6' : '#14304d', 'text-halo-color': dark ? '#0b0d10' : '#ffffff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'ends-dot', type: 'circle', source: 'ends', paint: { 'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'end'], 'from'], '#1e9e6f', dark ? '#f0f2f4' : '#14263b'], 'circle-stroke-color': dark ? '#0b0d10' : '#ffffff', 'circle-stroke-width': 3 } });
  mapDrawHits();
  mapDrawRoute();
}

const mapDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const mapLevelName = (m, zoom) => (m.levels.find((l) => l.zoom === zoom) || { name: `Level ${zoom}` }).name;
const mapRegionNames = (m, ids) => m.regions.filter((r) => ids.includes(r.id)).map((r) => r.name).join(', ');
function mapRegionsPicked(m) {
  const boxes = [...document.querySelectorAll('#map-setup input[name="map-region"]')];
  if (boxes.length) return boxes.filter((b) => b.checked).map((b) => b.value);
  return m.map ? m.map.regions : m.regions.filter((r) => r.default).map((r) => r.id);
}

function paintMapJob(m) {
  const box = $('map-job');
  box.hidden = !m.job;
  if (!m.job) { box.replaceChildren(); return; }
  const j = m.job;
  let title = ''; let detail = ''; let value = null; let max = null;
  if (j.kind === 'measure') { title = 'Measuring the map'; detail = `Reading the index of the world map: ${bytes(j.indexBytes || 0)} so far. No map is downloaded yet.`; }
  if (j.kind === 'map') {
    title = j.stage === 'check' ? 'Checking the map' : j.stage === 'tiles' ? 'Downloading the map' : 'Working out which parts of the world map are needed';
    if (j.stage === 'tiles' && j.total) { value = j.downloaded || 0; max = j.total; detail = `${bytes(j.downloaded || 0)} of ${bytes(j.total)}`; } else if (j.stage === 'index') detail = `${bytes(j.indexBytes || 0)} of the index read.`;
  }
  if (j.kind === 'routing-measure') { title = 'Asking how big the routing data is'; value = j.done || 0; max = j.total || 1; detail = `Square ${Math.min((j.done || 0) + 1, j.total || 1)} of ${j.total || 1}. Nothing is downloaded yet.`; }
  if (j.kind === 'routing') {
    title = 'Downloading the routing data';
    if (j.stage === 'files' && j.bytes) { value = j.downloaded || 0; max = j.bytes; detail = `File ${Math.min((j.done || 0) + 1, j.total)} of ${j.total}. ${bytes(j.downloaded || 0)} of ${bytes(j.bytes)}.`; } else detail = 'Listing the files.';
  }
  if (j.kind === 'overture') {
    const of = j.stage === 'measure' || j.stage === 'list' ? (j.total ? `File ${Math.min((j.done || 0) + 1, j.total)} of ${j.total}.` : '') : '';
    if (j.stage === 'measure') { title = 'Measuring what Overture Maps has'; value = j.done || 0; max = j.total || null; detail = `Reading the summaries of the ${j.what || 'data'} files. ${of} Nothing else is downloaded yet.`; }
    else if (j.stage === 'list') { title = `Finding the ${j.what || 'data'} files`; value = j.done || 0; max = j.total || null; detail = of; }
    else if (j.stage === 'index') { title = 'Building the address index'; value = j.done || 0; max = j.total || 100; detail = 'Sorting the addresses by street. This part needs no connection.'; }
    else { title = j.what === 'addresses' ? 'Fetching the addresses' : 'Fetching more places'; if (j.bytes) { value = j.downloaded || 0; max = j.bytes; } detail = `${bytes(j.downloaded || 0)} of ${bytes(j.bytes || 0)}. ${(j.kept || 0).toLocaleString()} ${j.what === 'addresses' ? 'addresses' : 'places'} kept so far. If this is stopped, it carries on from here next time.`; }
  }
  if (j.kind === 'places') { title = 'Fetching the places'; value = j.done || 0; max = j.total || 1; detail = `Area ${Math.min((j.done || 0) + 1, j.total || 1)} of ${j.total || 1}. ${(j.found || 0).toLocaleString()} places so far. The server is free and shared, so this is done slowly.`; }
  const bar = document.createElement('progress');
  if (max) { bar.max = max; bar.value = value; }
  const stop = el('button', 'btn small', 'Stop');
  stop.type = 'button'; stop.id = 'map-stop';
  stop.addEventListener('click', () => guard(() => api.mapsCancel(), $('map-error')));
  box.replaceChildren(el('p', 'map-job-title', title), bar, el('p', 'small-print', detail), stop);
}

function paintMapSummary(m) {
  const box = $('map-summary');
  const lines = [];
  if (m.map) lines.push(el('p', '', `${mapLevelName(m, m.map.maxZoom)}. ${mapRegionNames(m, m.map.regions)}. ${bytes(m.map.bytes)}, from the world map built on ${mapDay(m.map.built)}.`));
  else lines.push(el('p', '', 'No map is on this computer yet. Choose what to cover, see how big each level of detail would be, and then download.'));
  if (m.places) lines.push(el('p', '', `${m.places.total.toLocaleString()} places, fetched on ${mapDay(m.places.date)}.`));
  else lines.push(el('p', '', 'No places have been fetched yet. They can be fetched with or without the map.'));
  if (m.overture) lines.push(el('p', '', `${m.overture.total.toLocaleString()} more places from Overture Maps (release ${m.overture.release}), shown where OpenStreetMap has none.`));
  if (m.addresses) lines.push(el('p', '', `${m.addresses.addresses.toLocaleString()} addresses on ${m.addresses.streets.toLocaleString()} streets, ${bytes(m.addresses.bytes)}, from Overture Maps release ${m.addresses.release}.`));
  else lines.push(el('p', '', 'No addresses yet, so a street address cannot be searched.'));
  if (m.routing) lines.push(el('p', '', `Routing data for directions: ${bytes(m.routing.bytes)}, fetched on ${mapDay(m.routing.date)}.`));
  else lines.push(el('p', '', 'No routing data yet, so no directions.'));
  const b = el('button', 'btn small', mapSetupOpen ? 'Close' : m.map || m.places ? 'Change or update' : 'Set up the map');
  if (m.map || m.places || m.routing || m.addresses || m.overture) b.textContent = mapSetupOpen ? 'Close' : 'Change or update';
  b.type = 'button'; b.id = 'map-setup-toggle';
  b.setAttribute('aria-expanded', String(mapSetupOpen));
  b.addEventListener('click', () => { mapSetupOpen = !mapSetupOpen; renderMap(); });
  box.replaceChildren(...lines, b);
}

function paintMapSetup(m) {
  const box = $('map-setup');
  box.hidden = !mapSetupOpen;
  if (!mapSetupOpen) { box.replaceChildren(); return; }
  const picked = mapRegionsPicked(m);
  const busy = Boolean(m.job);
  const regions = el('fieldset', 'map-field');
  regions.append(el('legend', '', 'Cover'));
  for (const r of m.regions) {
    const label = el('label', 'map-check');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'map-region'; input.value = r.id; input.checked = picked.includes(r.id); input.disabled = busy;
    input.addEventListener('change', () => renderMap());
    const text = el('span', '', r.name);
    if (r.note) text.append(el('span', 'small-print', ` ${r.note}`));
    label.append(input, text);
    regions.append(label);
  }
  const measured = m.measured && m.measured.regions.join() === picked.join() ? m.measured : null;
  const measure = el('button', measured ? 'btn small' : 'btn primary', measured ? 'Measure again' : 'Measure the sizes');
  measure.type = 'button'; measure.id = 'map-measure'; measure.disabled = busy || !picked.length;
  measure.addEventListener('click', () => guard(() => api.mapsMeasure(picked), $('map-error')));
  const parts = [regions];
  if (measured) {
    const levels = el('fieldset', 'map-field');
    levels.append(el('legend', '', 'Detail'));
    const current = document.querySelector('#map-setup input[name="map-level"]:checked')?.value;
    for (const l of measured.levels) {
      const label = el('label', 'map-level');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'map-level'; input.value = String(l.zoom); input.disabled = busy;
      input.checked = current ? current === String(l.zoom) : m.map ? m.map.maxZoom === l.zoom : false;
      input.addEventListener('change', () => renderMap());
      const text = el('span', 'map-level-text');
      text.append(el('b', '', l.name), el('span', 'map-level-size', bytes(l.bytes)), el('span', 'small-print', l.what));
      label.append(input, text);
      levels.append(label);
    }
    const chosen = Number(document.querySelector('#map-setup input[name="map-level"]:checked')?.value ?? (m.map ? m.map.maxZoom : NaN));
    const level = measured.levels.find((l) => l.zoom === chosen);
    const get = el('button', 'btn primary', level ? `Download this map, ${bytes(level.bytes)}` : 'Choose a level of detail');
    get.type = 'button'; get.id = 'map-download'; get.disabled = busy || !level;
    get.addEventListener('click', () => guard(() => api.mapsDownload(picked, chosen), $('map-error')));
    parts.push(levels, el('p', 'small-print', `Sizes are for the world map built on ${mapDay(measured.build.uploaded)}. ${m.map ? 'The map you have stays in use until the new one is complete.' : ''}`), get, measure);
  } else {
    parts.push(el('p', 'small-print', 'Measuring reads the index of the world map (tens of megabytes) and lists what each level of detail would take. Nothing large is downloaded until you choose.'), measure);
  }
  const placesBox = el('fieldset', 'map-field');
  placesBox.append(el('legend', '', 'Places'));
  placesBox.append(el('p', 'small-print', 'Hospitals, pharmacies, fire and police, water and power works, fuel, food, hardware and other supplies, airfields and towns, for the areas ticked above. Fetching them takes a while and a few hundred megabytes at most.'));
  const getPlaces = el('button', m.places ? 'btn small' : 'btn primary', m.places ? 'Update the places' : 'Fetch the places');
  getPlaces.type = 'button'; getPlaces.id = 'map-places'; getPlaces.disabled = busy || !picked.length;
  getPlaces.addEventListener('click', () => guard(() => api.mapsPlaces(picked), $('map-error')));
  placesBox.append(getPlaces);
  parts.push(placesBox);
  const routeBox = el('fieldset', 'map-field');
  routeBox.append(el('legend', '', 'Directions'));
  routeBox.append(el('p', 'small-print', `Turn-by-turn directions need routing data for the areas ticked above: one file for each square of five degrees. The engine that reads them comes with Wikivault. ${m.routingCredit}`));
  const sized = m.routingMeasured && m.routingMeasured.regions.join() === picked.join() ? m.routingMeasured : null;
  if (sized) routeBox.append(el('p', '', `${sized.files} files, ${bytes(sized.bytes)}.`));
  const routeBtn = el('button', 'btn primary', sized ? `Download the routing data, ${bytes(sized.bytes)}` : m.routing ? 'Measure a newer set of routing data' : 'Measure the routing data');
  routeBtn.type = 'button'; routeBtn.id = sized ? 'map-routing-download' : 'map-routing-measure'; routeBtn.disabled = busy || !picked.length;
  if (m.routing && !sized) routeBtn.className = 'btn small';
  routeBtn.addEventListener('click', () => guard(() => (sized ? api.mapsRoutingDownload(picked) : api.mapsRoutingMeasure(picked)), $('map-error')));
  routeBox.append(routeBtn);
  parts.push(routeBox);
  const ovBox = el('fieldset', 'map-field');
  ovBox.append(el('legend', '', 'Addresses and more places'));
  ovBox.append(el('p', 'small-print', `Street addresses, so that an address can be searched and driven to, and places that OpenStreetMap does not have, for the areas ticked above. Both come from Overture Maps, as large files that download quickly. Only the parts for these areas are fetched. ${m.overtureCredit}`));
  const ovSized = m.overtureMeasured && m.overtureMeasured.regions.join() === picked.join() ? m.overtureMeasured : null;
  const ovKinds = [['addresses', 'Addresses'], ['places', 'More places']];
  const ovWas = Object.fromEntries(ovKinds.map(([k]) => [k, document.getElementById(`map-ov-${k}`) ? document.getElementById(`map-ov-${k}`).checked : true]));
  for (const [k, label] of ovKinds) {
    const row = el('label', 'map-check');
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', id: `map-ov-${k}`, checked: ovWas[k], disabled: busy });
    input.addEventListener('change', () => renderMap());
    const s = ovSized && ovSized[k];
    row.append(input, el('span', '', s ? `${label}: about ${s.rows.toLocaleString()} rows to read, ${bytes(s.bytes)} to download` : label));
    ovBox.append(row);
  }
  const ovPicked = ovKinds.map(([k]) => k).filter((k) => ovWas[k]);
  if (ovSized) {
    const a = ovSized.addresses;
    if (a && ovWas.addresses && a.rows) ovBox.append(el('p', 'small-print', `Release ${ovSized.release}. The address index will take roughly ${bytes(a.rows * 14)} when done, and needs about ${bytes(a.rows * 60)} of working room while it is built. Reading ${a.rows.toLocaleString()} rows takes a while: allow ${Math.max(1, Math.round(a.rows / 150000 / 60))} to ${Math.max(2, Math.round(a.rows / 50000 / 60))} minutes on top of the download.`));
    else ovBox.append(el('p', 'small-print', `Release ${ovSized.release}.`));
  }
  const ovSize = ovSized ? ovPicked.reduce((n, k) => n + (ovSized[k] ? ovSized[k].bytes : 0), 0) : 0;
  const ovBtn = el('button', 'btn primary', ovSized ? `Download, ${bytes(ovSize)}` : m.addresses || m.overture ? 'Measure a newer release' : 'Measure the addresses and places');
  ovBtn.type = 'button'; ovBtn.id = ovSized ? 'map-ov-download' : 'map-ov-measure'; ovBtn.disabled = busy || !picked.length || (ovSized && !ovPicked.length);
  if ((m.addresses || m.overture) && !ovSized) ovBtn.className = 'btn small';
  ovBtn.addEventListener('click', () => guard(() => (ovSized ? api.mapsOvertureDownload(picked, ovPicked) : api.mapsOvertureMeasure(picked)), $('map-error')));
  ovBox.append(ovBtn);
  parts.push(ovBox);
  // Keep the boxes that are ticked: build the new content first, then swap.
  box.replaceChildren(...parts);
}

function paintMapSearch(m) {
  const form = $('map-search');
  const any = m.places || m.overture || m.addresses;
  form.hidden = !any;
  if (!any) return;
  const sel = $('map-cat');
  const key = m.categories.map((c) => `${c.id}:${c.count}:${c.extra}`).join();
  if (sel.dataset.key !== key) {
    const was = sel.value;
    sel.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Any kind' }));
    for (const group of [...new Set(m.categories.map((c) => c.group))]) {
      const og = document.createElement('optgroup'); og.label = group;
      for (const c of m.categories.filter((x) => x.group === group && (x.count || x.extra))) og.append(Object.assign(document.createElement('option'), { value: c.id, textContent: `${c.name} (${c.count.toLocaleString()}${c.extra ? `, and up to ${c.extra.toLocaleString()} more` : ''})` }));
      if (og.children.length) sel.append(og);
    }
    sel.value = was; if (sel.value !== was) sel.value = '';
    sel.dataset.key = key;
  }
  const cat = m.categories.find((c) => c.id === sel.value);
  $('map-cat-note').hidden = !(cat && cat.note);
  $('map-cat-note').textContent = cat && cat.note ? cat.note : '';
}

function mapDetails(h) {
  const box = el('div', 'map-place');
  box.append(el('p', 'map-place-kind', h.kind || ''), el('h3', '', h.n || 'No name recorded'));
  const row = (label, value) => { if (!value) return; const p = el('p', ''); p.append(el('span', 'map-place-label', `${label} `), value); box.append(p); };
  if (h.c === 'address') { box.append(el('p', h.approx ? 'map-approx' : 'small-print', h.d || 'This address is in the address data.')); } else row('Address', h.d);
  row('Telephone', h.p); row('Hours', h.h); row('Run by', h.w);
  if (h.s === 'ov') box.append(el('p', 'small-print', 'From Overture Maps, not OpenStreetMap. It may have moved or closed.'));
  const words = { emergency: 'Emergency room', beds: 'Beds', speciality: 'Speciality', source: 'Fuel', output: 'Output', kind: 'Kind', population: 'Population', drinkable: 'Drinkable', seasonal: 'Seasonal', access: 'Access', diesel: 'Diesel', lpg: 'LPG', e85: 'E85', iata: 'IATA', icao: 'ICAO' };
  for (const [k, v] of Object.entries(h.x || {})) row(words[k] || k, String(v));
  row('Position', `${h.a.toFixed(5)}, ${h.o.toFixed(5)}`);
  if (h.km != null) row('From the middle of the map', `${(h.km * 0.621371).toFixed(1)} miles`);
  if (state?.maps?.routing) {
    const go = el('div', 'map-place-go');
    for (const [which, label] of [['from', 'Directions from here'], ['to', 'Directions to here']]) {
      const b = el('button', 'btn small', label);
      b.type = 'button';
      b.addEventListener('click', () => { mapGo.tab = 'go'; mapSetPoint(which, mapPointOf(h)); if (mapPopup) mapPopup.remove(); });
      go.append(b);
    }
    box.append(go);
  }
  return box;
}

function mapDrawHits() {
  if (!mapView || !mapView.getSource('hits')) return;
  mapView.getSource('hits').setData({ type: 'FeatureCollection', features: mapHits.hits.map((h) => ({ type: 'Feature', id: undefined, properties: { i: h.i, n: h.n || '', sel: h.i === mapSelected ? 1 : 0 }, geometry: { type: 'Point', coordinates: [h.o, h.a] } })) });
}

function mapSelect(id, { fly = true } = {}) {
  const h = mapHits.hits.find((x) => x.i === id);
  if (!h) return;
  mapSelected = id;
  paintMapResults();
  mapDrawHits();
  if (!mapView) return;
  if (mapPopup) mapPopup.remove();
  mapPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px', offset: 10 }).setLngLat([h.o, h.a]).setDOMContent(mapDetails(h)).addTo(mapView);
  mapPopup.on('close', () => { if (mapSelected === id) { mapSelected = null; paintMapResults(); mapDrawHits(); } });
  if (fly) mapView.easeTo({ center: [h.o, h.a], zoom: Math.min(mapView.getMaxZoom(), Math.max(mapView.getZoom(), h.c === 'town' ? 10 : 13)), duration: 600 });
}

function paintMapResults() {
  const box = $('map-results');
  const m = state?.maps;
  if (!m || !(m.places || m.overture || m.addresses) || !mapAsked) { box.replaceChildren(); return; }
  if (!mapHits.hits.length) { box.replaceChildren(el('p', 'small-print', m.addresses ? 'Nothing found. Try fewer words, another kind of place, or an address as number, street, town.' : 'Nothing found. Try fewer words, or another kind of place. Street addresses can be searched once they are fetched, under Change or update.')); return; }
  const head = el('p', 'small-print', mapHits.total > mapHits.hits.length ? `Showing ${mapHits.hits.length} of ${mapHits.total.toLocaleString()}.` : `${mapHits.total.toLocaleString()} found.`);
  const list = el('ul', 'map-hits');
  for (const h of mapHits.hits.slice(0, 60)) {
    const li = el('li', h.i === mapSelected ? 'on' : '');
    const b = el('button', '', '');
    b.type = 'button';
    b.append(el('span', 'map-hit-name', h.n || 'No name recorded'), el('span', 'map-hit-kind', [h.kind, h.km != null ? `${(h.km * 0.621371).toFixed(1)} mi` : ''].filter(Boolean).join(', ')));
    if (h.c === 'address') { if (h.approx) b.append(el('span', 'map-hit-approx', h.how === 'town' ? 'Approximate: the town only' : h.how === 'street' ? 'The street, not a house' : 'Approximate position')); } else if (h.d) b.append(el('span', 'map-hit-addr', h.d));
    b.addEventListener('click', () => mapSelect(h.i));
    li.append(b);
    if (h.i === mapSelected && !mapView) li.append(mapDetails(h));
    list.append(li);
  }
  box.replaceChildren(head, list);
}

/** Ask for places: by words, or, with a kind chosen and no words, those in view and nearest the middle. */
async function mapFind({ moved = false } = {}) {
  const q = $('map-q').value.trim();
  const cat = $('map-cat').value;
  if (!q && !cat) { mapAsked = 0; mapHits = { total: 0, hits: [] }; mapSelected = null; if (mapPopup) { mapPopup.remove(); mapPopup = null; } paintMapResults(); mapDrawHits(); return; }
  if (moved && q) return; // moving the map only refreshes a browse by kind
  const ask = ++mapAsked;
  const o = { q, categories: cat ? [cat] : null, limit: q ? 60 : 400 };
  if (mapView) {
    const c = mapView.getCenter();
    o.around = [c.lng, c.lat];
    if (!q) { o.near = [c.lng, c.lat]; const b = mapView.getBounds(); o.box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; }
  }
  const r = await api.mapsSearch(o);
  if (ask !== mapAsked) return;
  mapHits = r;
  if (!r.hits.some((h) => h.i === mapSelected)) { mapSelected = null; if (mapPopup) { mapPopup.remove(); mapPopup = null; } }
  paintMapResults();
  mapDrawHits();
  if (!moved && q && r.hits.length) mapSelect(r.hits[0].i);
}

// ---- directions

const mapGo = { from: null, to: null, blocks: [], alt: 0, route: null, picking: null, busy: false, tab: 'find' };
const tripMiles = (m) => (m < 160 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} feet` : m < 16093 ? `${(m / 1609.344).toFixed(1)} miles` : `${Math.round(m / 1609.344)} miles`);
const tripTime = (s) => { const min = Math.max(1, Math.round(s / 60)); return min < 60 ? `${min} minutes` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`; };
const mapSpot = (lon, lat) => ({ lon, lat, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });

function mapSetPoint(which, point) {
  mapGo[which] = point;
  $(`map-${which}`).value = point ? point.label : '';
  mapGo.route = null; mapGo.alt = 0;
  paintMapGo();
  mapDrawRoute();
}

/** What was typed, as a point: coordinates, the point already chosen, or the best match among the places and towns. */
/** A found place or address as an end of a route. An address that was not found exactly carries the reason, to warn with. */
function mapPointOf(h, typed = '') {
  if (h.c === 'address') return { lon: h.o, lat: h.a, label: h.n, ...(h.approx ? { approx: h.d } : {}) };
  return { lon: h.o, lat: h.a, label: h.d ? `${h.n}, ${h.d}` : h.n || typed || `${h.a.toFixed(5)}, ${h.o.toFixed(5)}` };
}

async function mapResolve(which) {
  const text = $(`map-${which}`).value.trim();
  if (!text) throw new Error(which === 'from' ? 'Say where you are starting from, or pick the spot on the map.' : 'Say where you are going, or pick the spot on the map.');
  if (mapGo[which] && mapGo[which].label === text) return mapGo[which];
  const c = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(text);
  if (c) return mapSpot(Number(c[2]), Number(c[1]));
  const centre = mapView ? [mapView.getCenter().lng, mapView.getCenter().lat] : null;
  const r = await api.mapsSearch({ q: text, limit: 1, around: centre });
  if (!r.hits.length) throw new Error(state?.maps?.addresses ? `Nothing was found for "${text}". Write an address as number, street, town (350 5th Ave, New York NY), or use a place, coordinates, or pick the spot on the map.` : `Nothing was found for "${text}". Street addresses can be searched once they are fetched, under Change or update. Until then use a place, a town, coordinates, or pick the spot on the map.`);
  return mapPointOf(r.hits[0], text);
}

async function mapRoute({ again = false } = {}) {
  if (mapGo.busy) return;
  mapGo.busy = true; paintMapGo();
  try {
    if (!again) { mapGo.from = await mapResolve('from'); mapGo.to = await mapResolve('to'); $('map-from').value = mapGo.from.label; $('map-to').value = mapGo.to.label; }
    if (!mapGo.from || !mapGo.to) return;
    mapGo.route = await api.mapsRoute({ points: [[mapGo.from.lon, mapGo.from.lat], [mapGo.to.lon, mapGo.to.lat]], mode: $('map-mode').value, alt: mapGo.alt, noMotorways: $('map-nomotor').checked, blocks: mapGo.blocks });
    $('map-error').hidden = true;
    if (mapView && !again) {
      const b = new maplibregl.LngLatBounds();
      for (const c of mapGo.route.coords) b.extend(c);
      mapView.fitBounds(b, { padding: 60, maxZoom: Math.min(mapView.getMaxZoom(), 15), duration: 600 });
    }
  } catch (err) { mapGo.route = null; throw err; } finally { mapGo.busy = false; paintMapGo(); mapDrawRoute(); }
}

/** A circle on the ground as a ring of points. */
function mapCircle(lon, lat, radius) {
  const ring = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; ring.push([lon + ((radius * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180))), lat + (radius * Math.sin(a)) / 110540]); }
  return ring;
}

function mapDrawRoute() {
  if (!mapView || !mapView.getSource('route')) return;
  const r = mapGo.route;
  mapView.getSource('route').setData({ type: 'FeatureCollection', features: r ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coords } }] : [] });
  mapView.getSource('blocks').setData({ type: 'FeatureCollection', features: mapGo.blocks.map((b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [mapCircle(b.lon, b.lat, b.radius)] } })) });
  const ends = [];
  if (mapGo.from) ends.push({ type: 'Feature', properties: { end: 'from' }, geometry: { type: 'Point', coordinates: [mapGo.from.lon, mapGo.from.lat] } });
  if (mapGo.to) ends.push({ type: 'Feature', properties: { end: 'to' }, geometry: { type: 'Point', coordinates: [mapGo.to.lon, mapGo.to.lat] } });
  mapView.getSource('ends').setData({ type: 'FeatureCollection', features: ends });
}

function paintMapGo() {
  const m = state?.maps;
  if (!m) return;
  const tabs = $('map-tabs');
  tabs.hidden = !(m.places || m.routing);
  if (!m.routing && mapGo.tab === 'go') mapGo.tab = 'find';
  $('map-tab-find').setAttribute('aria-selected', String(mapGo.tab === 'find'));
  $('map-tab-go').setAttribute('aria-selected', String(mapGo.tab === 'go'));
  $('map-tab-go').disabled = !m.routing;
  $('map-tab-go').title = m.routing ? '' : 'Download the routing data first, under Change or update';
  $('map-pane-find').hidden = mapGo.tab !== 'find';
  $('map-pane-go').hidden = mapGo.tab !== 'go';
  if (mapGo.tab !== 'go') return;
  const sel = $('map-mode');
  if (!sel.children.length) for (const x of m.modes) sel.append(Object.assign(document.createElement('option'), { value: x.id, textContent: x.name }));
  const mode = m.modes.find((x) => x.id === sel.value) || m.modes[0];
  $('map-mode-note').textContent = mode.what;
  $('map-nomotor-row').hidden = !mode.id.startsWith('car');
  $('map-route').disabled = mapGo.busy;
  $('map-route').textContent = mapGo.busy ? 'Working it out' : 'Get directions';
  $('map-route-other').hidden = !mapGo.route;
  $('map-route-clear').hidden = !(mapGo.route || mapGo.from || mapGo.to);
  const note = $('map-pick-note');
  note.hidden = !mapGo.picking;
  note.textContent = mapGo.picking === 'block' ? 'Click the map where the way is blocked. Press Escape to leave it.' : mapGo.picking ? `Click the map to set the ${mapGo.picking === 'from' ? 'start' : 'destination'}. Press Escape to leave it.` : '';
  $('map-canvas').classList.toggle('picking', Boolean(mapGo.picking));
  for (const w of ['from', 'to']) $(`map-${w}-pick`).setAttribute('aria-pressed', String(mapGo.picking === w));
  $('map-block-add').setAttribute('aria-pressed', String(mapGo.picking === 'block'));
  $('map-block-add').disabled = !mapView;
  for (const w of ['from', 'to']) $(`map-${w}-pick`).disabled = !mapView;

  const list = $('map-blocks');
  list.replaceChildren(...mapGo.blocks.map((b, i) => {
    const li = el('li', '');
    const x = el('button', 'btn small', 'Remove');
    x.type = 'button';
    x.addEventListener('click', () => { mapGo.blocks.splice(i, 1); paintMapGo(); mapDrawRoute(); if (mapGo.route) guard(() => mapRoute({ again: true }), $('map-error')); });
    li.append(el('span', '', `${tripMiles(b.radius)} around ${b.lat.toFixed(4)}, ${b.lon.toFixed(4)}`), x);
    return li;
  }));

  const out = $('map-route-out');
  const r = mapGo.route;
  if (!r) { out.replaceChildren(); return; }
  const head = el('div', 'map-route-head');
  head.append(el('p', 'map-route-total', `${tripMiles(r.meters)}, about ${tripTime(r.seconds)}`));
  head.append(el('p', 'small-print', `${(m.modes.find((x) => x.id === r.mode) || mode).name}${r.alt ? `, route ${r.alt + 1} of up to 4` : ''}${mapGo.blocks.length ? `, keeping clear of ${mapGo.blocks.length} blocked ${mapGo.blocks.length === 1 ? 'area' : 'areas'}` : ''}. Times assume open roads.`));
  for (const [which, label] of [['from', 'The start'], ['to', 'The destination']]) if (mapGo[which] && mapGo[which].approx) head.append(el('p', 'map-approx', `${label} is approximate, so the last part of these directions may be off. ${mapGo[which].approx.replace(/^Approximate\. /, '')}`));
  if (!r.named) head.append(el('p', 'small-print', 'Road names are missing: the map on this computer has none for these roads at its level of detail.'));
  const steps = el('ol', 'map-steps');
  r.steps.forEach((st) => {
    const li = el('li', '');
    const b = el('button', '', '');
    b.type = 'button';
    b.append(el('span', 'map-step-text', st.text));
    if (st.meters) b.append(el('span', 'map-step-far', `then ${tripMiles(st.meters)}`));
    b.addEventListener('click', () => { if (mapView) mapView.easeTo({ center: st.at, zoom: Math.min(mapView.getMaxZoom(), Math.max(mapView.getZoom(), 14)), duration: 500 }); });
    li.append(b);
    steps.append(li);
  });
  out.replaceChildren(head, steps);
}

function mapPick(which) { mapGo.picking = mapGo.picking === which ? null : which; paintMapGo(); }
/** A click on the map while a point is being picked. Returns true when the click was used. */
function mapClicked(lngLat) {
  const what = mapGo.picking;
  if (!what) return false;
  mapGo.picking = null;
  if (what === 'block') {
    mapGo.blocks.push({ lon: lngLat.lng, lat: lngLat.lat, radius: Number($('map-block-size').value) });
    paintMapGo(); mapDrawRoute();
    if (mapGo.route) guard(() => mapRoute({ again: true }), $('map-error'));
  } else mapSetPoint(what, mapSpot(lngLat.lng, lngLat.lat));
  return true;
}

$('map-tab-find').addEventListener('click', () => { mapGo.tab = 'find'; mapGo.picking = null; paintMapGo(); });
$('map-tab-go').addEventListener('click', () => { mapGo.tab = 'go'; paintMapGo(); });
$('map-go').addEventListener('submit', (e) => { e.preventDefault(); mapGo.alt = 0; guard(() => mapRoute(), $('map-error')); });
$('map-route-other').addEventListener('click', () => { mapGo.alt = (mapGo.alt + 1) % 4; guard(() => mapRoute({ again: true }), $('map-error')); });
$('map-route-clear').addEventListener('click', () => { mapGo.from = null; mapGo.to = null; mapGo.route = null; mapGo.alt = 0; $('map-from').value = ''; $('map-to').value = ''; paintMapGo(); mapDrawRoute(); });
$('map-from-pick').addEventListener('click', () => mapPick('from'));
$('map-to-pick').addEventListener('click', () => mapPick('to'));
$('map-block-add').addEventListener('click', () => mapPick('block'));
$('map-mode').addEventListener('change', () => { mapGo.alt = 0; paintMapGo(); if (mapGo.route) guard(() => mapRoute({ again: true }), $('map-error')); });
$('map-nomotor').addEventListener('change', () => { if (mapGo.route) guard(() => mapRoute({ again: true }), $('map-error')); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mapGo.picking) { mapGo.picking = null; paintMapGo(); } });

async function mapEnsure(m) {
  const empty = $('map-empty');
  empty.hidden = Boolean(m.map);
  if (!m.map) {
    empty.textContent = m.job && m.job.kind === 'map' ? 'The map is on its way.' : 'The map will be drawn here once it has been downloaded.';
    if (mapView) { mapView.remove(); mapView = null; mapKey = ''; }
    return;
  }
  const key = `${m.map.date}|${m.map.bytes}`;
  if (mapView && mapKey === key) { mapView.resize(); return; }
  if (mapKey === `making|${key}`) return;
  mapKey = `making|${key}`;
  if (!mapOrigin) mapOrigin = await api.mapsOrigin();
  if (mapView) { mapView.remove(); mapView = null; }
  if (!mapProtocol) {
    mapProtocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', mapProtocol.tile);
    maplibregl.setWorkerUrl('../vendor/maplibre/maplibre-gl-csp-worker.js');
  }
  const b = m.map.bounds;
  const map = new maplibregl.Map({
    container: 'map-canvas', attributionControl: false, maxZoom: Math.min(18, m.map.maxZoom + 3), dragRotate: false, pitchWithRotate: false,
    style: mapStyleFor(key),
    bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 24 },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 140 }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
  map.on('load', () => {
    mapAddOverlays(map);
    map.on('click', (e) => { mapClicked(e.lngLat); });
    map.on('click', 'hits-dot', (e) => { if (mapGo.picking) return; const f = e.features && e.features[0]; if (f) mapSelect(f.properties.i, { fly: false }); });
    map.on('mouseenter', 'hits-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'hits-dot', () => { map.getCanvas().style.cursor = ''; });
    $('map-canvas').dataset.ready = '1';
  });
  map.on('moveend', () => { mapFind({ moved: true }).catch(() => {}); });
  mapView = map;
  mapKey = key;
}

function renderMap() {
  const m = state?.maps;
  $('nav-map').disabled = !m || golfPlaying();
  $('nav-map').setAttribute('aria-pressed', String(view === 'map'));
  if (!m || view !== 'map') return;
  $('map-credit').textContent = m.credit;
  if (m.error) { $('map-error').textContent = m.error; $('map-error').hidden = false; }
  paintMapJob(m);
  paintMapSummary(m);
  paintMapSetup(m);
  paintMapLook(m);
  paintMapSearch(m);
  paintMapResults();
  paintMapGo();
  mapEnsure(m).catch((err) => {
    mapKey = '';
    // MapLibre reports a missing graphics context as a long technical record; say it in words.
    const webgl = /webgl/i.test(String(err && err.message));
    $('map-error').textContent = webgl ? 'The map could not be drawn because this computer\'s graphics (WebGL) did not start. Places can still be searched. Updating the graphics driver, or turning off Remote Desktop if it is in use, usually fixes it.' : `The map could not be drawn: ${err.message}`;
    $('map-error').hidden = false;
  });
}

$('nav-map').addEventListener('click', () => { if (!golfPlaying()) showView('map'); });
$('map-dark').addEventListener('change', () => { mapLook.dark = $('map-dark').checked; mapApplyLook(true); });
$('map-canvas').parentElement.style.background = WikivaultMapStyle.background(mapLook);
$('map-search').addEventListener('submit', (e) => { e.preventDefault(); guard(() => mapFind(), $('map-error')); });
$('map-cat').addEventListener('change', () => { renderMap(); guard(() => mapFind(), $('map-error')); });

// ------------------------------------------------------------ guided lessons
// A day of the plan as steps to click through. The steps sit beside the book, which turns to the
// page of each step. The steps come from the teacher guide's own headings (see school-outline.js).

let lessonPlay = null;          // { data, at, finished, timer: { left, tick } | null }
const lessonAt = new Map();     // where each lesson was left, for this run of the app
let lessonShown = '';           // the book and page the reader was last sent to by a lesson

function lessonLeave() {
  if (lessonPlay && lessonPlay.timer) clearInterval(lessonPlay.timer.tick);
  lessonPlay = null;
  lessonShown = '';
  paintLesson();
}
async function lessonStart(id) {
  const data = await api.schoolLesson(id);
  lessonLeave();
  lessonPlay = { data, at: Math.min(lessonAt.get(id) || 0, data.steps.length - 1), finished: false, timer: null };
  await lessonShow();
}
/** Send the reader to a book and page, unless it is already there. */
async function lessonOpen(fileId, page) {
  const key = `${fileId}#${page || 1}`;
  if (lessonShown !== key || view !== 'reader' || !schShowing) { await schoolOpen(fileId, page, true); lessonShown = key; }
}
async function lessonShow() {
  const p = lessonPlay;
  if (!p) return;
  if (p.timer) { clearInterval(p.timer.tick); p.timer = null; }
  lessonAt.set(p.data.id, p.at);
  const step = p.data.steps[p.at];
  const book = step.here ? step : p.data.links.find((l) => l.here);
  if (book) await lessonOpen(book.fileId, book.page);
  paintLesson();
  const next = document.getElementById('lesson-next');
  if (next) next.focus();
}
function lessonTimer(minutes) {
  const p = lessonPlay;
  if (!p) return;
  if (p.timer) { clearInterval(p.timer.tick); p.timer = null; paintLesson(); return; }
  p.timer = { left: minutes * 60, tick: setInterval(() => {
    if (lessonPlay !== p || !p.timer) return;
    p.timer.left -= 1;
    const out = document.getElementById('lesson-clock');
    if (p.timer.left <= 0) { clearInterval(p.timer.tick); p.timer.left = 0; }
    if (out) { out.textContent = lessonClock(p.timer.left); out.classList.toggle('up', p.timer.left === 0); }
  }, 1000) };
  paintLesson();
}
const lessonClock = (s) => (s <= 0 ? 'Time is up' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`);

function paintLesson() {
  const pane = $('lessonpane');
  const on = Boolean(lessonPlay) && view === 'reader' && schShowing;
  pane.hidden = !on;
  $('view-reader').classList.toggle('with-lesson', on);
  if (!on) { pane.replaceChildren(); return; }
  const p = lessonPlay;
  const d = p.data;
  pane.style.setProperty('--sub', subjectVar(d.subject));
  const head = el('header', 'lesson-head');
  head.append(el('p', 'lesson-where', `${d.subjectName}, Unit ${d.unitN}: ${d.unitTitle}`));
  head.append(el('h2', '', d.name ? `${d.title}: ${d.name}` : d.title));
  if (d.question) head.append(el('p', 'lesson-q', d.question));
  head.append(el('p', 'lesson-time', `Week ${d.week}, ${SCHOOL_DAYS[d.day - 1] || `day ${d.day}`}. About ${d.minutes} minutes.`));
  if (d.caution) head.append(el('p', 'sch-caution', d.caution));

  if (p.finished) {
    const done = el('div', 'lesson-now');
    done.append(el('h3', '', 'Lesson done'), el('p', 'lesson-note', 'It is ticked off in the plan.'));
    const nav = el('div', 'lesson-nav');
    if (d.next) {
      const go = el('button', 'btn primary', `Next: ${d.next.subjectName}, ${d.next.label}`);
      go.type = 'button'; go.id = 'lesson-next';
      go.addEventListener('click', () => guard(() => lessonStart(d.next.id), $('lesson-error')));
      nav.append(go);
    }
    const back = el('button', d.next ? 'btn' : 'btn primary', 'Back to the plan');
    back.type = 'button'; if (!d.next) back.id = 'lesson-next';
    back.addEventListener('click', () => { lessonLeave(); showView('school'); });
    nav.append(back);
    done.append(nav, Object.assign(el('p', 'error', ''), { id: 'lesson-error', hidden: true }));
    pane.replaceChildren(head, done);
    return;
  }

  const step = d.steps[p.at];
  const last = p.at === d.steps.length - 1;
  const now = el('div', 'lesson-now');
  now.append(el('p', 'lesson-count', `Step ${p.at + 1} of ${d.steps.length}${step.group ? `, ${step.group}` : ''}`));
  now.append(el('h3', '', step.title));
  if (step.note) now.append(el('p', 'lesson-note', step.note));
  else if (step.page) now.append(el('p', 'lesson-note', `The teacher guide is open at this part, page ${step.page}. Read it through, then do it together.`));
  if (!d.read && p.at === 0) now.append(el('p', 'lesson-note', 'The parts of this lesson could not be read from the guide, so the steps here are general ones.'));
  if (step.minutes) {
    const row = el('div', 'lesson-timer');
    const b = el('button', 'btn small', p.timer ? 'Stop the timer' : `Start a ${step.minutes}-minute timer`);
    b.type = 'button';
    b.addEventListener('click', () => lessonTimer(step.minutes));
    row.append(b);
    if (p.timer) { const c = el('span', `lesson-clock${p.timer.left === 0 ? ' up' : ''}`, lessonClock(p.timer.left)); c.id = 'lesson-clock'; c.setAttribute('role', 'timer'); row.append(c); }
    now.append(row);
  }
  const books = el('div', 'lesson-books');
  books.append(el('p', 'lesson-label', 'Books for this lesson'));
  const seen = new Set();
  const bookButton = (label, fileId, page, here) => {
    const key = `${fileId}#${page || 1}`;
    if (!fileId || seen.has(key)) return;
    seen.add(key);
    const b = el('button', `btn small${lessonShown === key ? ' on' : ''}`, page ? `${label}, p. ${page}` : label);
    b.type = 'button';
    b.disabled = !here;
    b.setAttribute('aria-pressed', String(lessonShown === key));
    b.addEventListener('click', () => guard(async () => { await lessonOpen(fileId, page); paintLesson(); }, $('lesson-error')));
    books.append(b);
  };
  bookButton(step.kind === 'finish' ? 'Answer key' : 'This step in the teacher guide', step.fileId, step.page, step.here);
  for (const l of d.links) bookButton(l.label, l.fileId, l.page, l.here);
  now.append(books);

  const nav = el('div', 'lesson-nav');
  const back = el('button', 'btn', 'Back');
  back.type = 'button'; back.disabled = p.at === 0;
  back.addEventListener('click', () => guard(() => { p.at -= 1; return lessonShow(); }, $('lesson-error')));
  const next = el('button', 'btn primary', last ? 'Finish the lesson' : 'Next step');
  next.type = 'button'; next.id = 'lesson-next';
  next.addEventListener('click', () => guard(async () => {
    if (!last) { p.at += 1; return lessonShow(); }
    await api.schoolDone([d.id], true);
    lessonAt.delete(d.id);
    if (p.timer) { clearInterval(p.timer.tick); p.timer = null; }
    p.finished = true;
    paintLesson();
    const go = document.getElementById('lesson-next');
    if (go) go.focus();
  }, $('lesson-error')));
  nav.append(back, next);
  now.append(nav, Object.assign(el('p', 'error', ''), { id: 'lesson-error', hidden: true }));

  const list = el('ol', 'lesson-steps');
  d.steps.forEach((x, i) => {
    const li = el('li', i === p.at ? 'now' : i < p.at ? 'past' : '');
    const b = el('button', '', '');
    b.type = 'button';
    if (i === p.at) b.setAttribute('aria-current', 'step');
    b.append(el('span', 'lesson-step-title', x.title));
    if (x.minutes) b.append(el('span', 'lesson-step-min', `${x.minutes} min`));
    b.addEventListener('click', () => guard(() => { p.at = i; return lessonShow(); }, $('lesson-error')));
    li.append(b);
    list.append(li);
  });
  const all = el('div', 'lesson-all');
  all.append(el('p', 'lesson-label', 'The whole lesson'), list);
  pane.replaceChildren(head, now, all);
}

// ------------------------------------------------------------ guided tour
// Numbered pins on the buttons along the top, and a card that says what each one does. It opens by
// itself at every start until "Don't show again", and once more the first time a new version runs.
const TOUR_STOPS = [
  [['nav-back', 'nav-forward'], 'Back and forward', 'Step through the pages you have read.'],
  [['nav-home'], 'Home', 'The front page of the library that is open.'],
  [['nav-golf'], 'Wiki golf', 'A game for one to six players: get from one article to another using only the links in between.'],
  [['nav-school'], 'School', 'A year of lessons laid out week by week, with the teacher guides, student books and tests to go with them.'],
  [['nav-map'], 'Map', 'An offline map of the regions you choose, and hospitals, water, fuel, food and other places to find on it.'],
  [['nav-random'], 'Random article', 'Opens an article picked at random.'],
  [['lib-select'], 'Library list', 'Switch between Wikipedia and the other libraries you have downloaded.'],
  [['search'], 'Search', 'Titles appear as you type. Press Enter to search the full text of every article. Ctrl+K jumps here.'],
  [['edition-stamp'], 'Edition', 'Which edition is on this computer. Press it for updates and storage.'],
  [['toggle-ask'], 'Ask', 'Type a question in plain words. The answer is written on this computer and links to the articles it came from.'],
  [['open-library'], 'Library', 'Updates, more libraries, how much of Wikipedia to keep, the answer model and every setting.'],
];
const WHATS_NEW = {
  '0.22.0': [
    'Library: the partition can be managed after setup. Give the library its own partition at any time, or change the size of the one it has.',
    'The Library page shows how full the partition is.',
  ],
  '0.21.0': [
    'Map: street addresses. Fetch them under Change or update, then search an address or get directions to one.',
    'An address that is not in the data is placed between its neighbours on the same street, and the app says the position is approximate.',
    'More places, from Overture Maps, added where OpenStreetMap has none. They come as large files and download quickly.',
  ],
  '0.20.0': [
    'Map: a clearer look. Highways, main roads, streets and tracks each have their own colour and weight, woodland and water stand out, and roads grow heavier as you zoom in.',
    'What the map shows: switch buildings, land use, water, streets, railways, borders, names and symbols on or off, and choose a dark map.',
    'Fixed: downloading the routing data could stop with an error box. A download whose connection is closed now carries on from where it was.',
  ],
  '0.19.0': [
    'Map: Directions. Choose a start and a destination, by name, by coordinates or by clicking the map, and get a route with turn-by-turn steps, by car, bicycle or on foot.',
    'Blocked roads and areas: mark where you cannot go and the route is worked out again around it. There is also a car setting that may use farm and forest tracks.',
    'The routing data is measured before it is downloaded. The routing engine and the Java it needs now come with Wikivault.',
  ],
  '0.18.0': [
    'Map, a new section: an offline map cut from OpenStreetMap for the regions you choose. The app measures how big each level of detail would be before anything is downloaded.',
    'Places: hospitals, pharmacies, fire and police, water and power works, fuel, food, hardware and other supplies, airfields and towns, searchable by name, kind and distance.',
    'Directions, address search and sending maps to a phone are not in this version yet.',
  ],
  '0.17.0': [
    'School: Start lesson. Every day of the plan can now be stepped through, one part of the lesson at a time, with the book open beside the steps at the right page.',
    'The steps, their times and their pages are read from the real teacher guides, and each lesson shows its name in the week.',
    'Lesson, test and answer-key pages are found far more reliably, including in the books that hold several units.',
  ],
  '0.16.0': [
    'School: Grade 5 as a full year of lessons, week by week, from the Core Knowledge Foundation\'s free curriculum.',
    'Teacher guides, student books, readers and tests open inside the app, and all of them can be searched.',
    'A list of the few books and materials the lessons need that are not free, and a place to add PDFs you own.',
  ],
  '0.15.0': [
    'Wiki golf has a clubhouse: saved players with their own characters, records, wins and losses, and handicaps.',
    'This tour. It can be opened again from Library, About.',
    'Links between Wikipedia, Wikibooks and Wikiversity open in the offline copy when that library is downloaded.',
    'How much of Wikipedia is kept can be changed at any time under Library.',
  ],
};
let tourOpened = false;   // opened by itself already in this run
let tourManual = false;
const tourVisible = (id) => { const n = $(id); return Boolean(n) && !n.hidden && n.getClientRects().length > 0; };

function tourPlace() {
  const pins = $('tour-pins');
  const items = [...$('tour-list').children];
  pins.replaceChildren();
  items.forEach((li, i) => {
    const ids = li.dataset.ids.split(',').filter(tourVisible);
    if (!ids.length) return;
    const rects = ids.map((id) => $(id).getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left)); const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top)); const bottom = Math.max(...rects.map((r) => r.bottom));
    const ring = el('div', 'tour-ring');
    Object.assign(ring.style, { left: `${left - 4}px`, top: `${top - 4}px`, width: `${right - left + 8}px`, height: `${bottom - top + 8}px` });
    const pin = el('div', 'tour-pin', String(i + 1));
    Object.assign(pin.style, { left: `${(left + right) / 2}px`, top: `${bottom + 14}px` });
    pins.append(ring, pin);
    const light = (on) => { for (const n of [ring, pin, li]) n.classList.toggle('lit', on); };
    li.onmouseenter = () => light(true);
    li.onmouseleave = () => light(false);
  });
}

function openTour({ manual = false } = {}) {
  const dlg = $('tour');
  if (dlg.open) return;
  tourManual = manual;
  const stops = TOUR_STOPS.filter(([ids]) => ids.some(tourVisible));
  $('tour-list').replaceChildren(...stops.map(([ids, name, about], i) => {
    const li = el('li');
    li.dataset.ids = ids.join(',');
    const text = el('span');
    text.append(el('b', '', name), `. ${about}`);
    li.append(el('span', 'tour-num', String(i + 1)), text);
    return li;
  }));
  const fresh = !manual && state.tour?.whatsNew ? WHATS_NEW[state.version] : null;
  $('tour-new').hidden = !fresh;
  if (fresh) {
    $('tour-new-title').textContent = `New in version ${state.version}`;
    $('tour-new-list').replaceChildren(...fresh.map((line) => el('li', '', line)));
  }
  $('tour-never').hidden = manual;
  $('tour-foot').textContent = manual ? '' : 'It opens at each start until you choose "Don\'t show again", and once after each update. It is always under Library, About.';
  dlg.showModal();
  tourPlace();
  $('tour-ok').focus();
}
function closeTour(hide) {
  const dlg = $('tour');
  if (dlg.open) dlg.close();
  if (!tourManual) api.tourDone(hide).catch(() => {});
}
$('tour-ok').addEventListener('click', () => closeTour(undefined));
$('tour-never').addEventListener('click', () => closeTour(true));
$('tour').addEventListener('cancel', (e) => { e.preventDefault(); closeTour(undefined); });
window.addEventListener('resize', () => { if ($('tour').open) tourPlace(); });
$('about-tour').addEventListener('click', () => openTour({ manual: true }));
$('about-tour-auto').addEventListener('change', (e) => api.tourDone(!e.target.checked).catch(() => {}));

/** Open the tour by itself once the main window is in use: agreement accepted, a library open, nothing else in front. */
function maybeTour() {
  if (document.activeElement !== $('about-tour-auto')) $('about-tour-auto').checked = Boolean(state.tour?.auto);
  if (tourOpened || !state.tour?.show || !state.acknowledged || !state.edition?.active || !state.engine?.ready) return;
  if (view === 'setup' || view === null || golfPlaying() || document.querySelector('dialog[open]')) return;
  tourOpened = true;
  openTour();
}

// ------------------------------------------------------------ wiki golf
// The rules, the scorecard and the saved players are kept by the main process (src/core/golf.js,
// golf-store.js). This part draws the 8-bit clubhouse and course, shows the state it is sent,
// reports each page the reader arrives at, and locks the shortcuts during a turn.

// ---- pixel art: every character is 16 x 16, a head of eight rows on a shared body of eight.
// Letters are colours: k outline, c the player's own colour, s skin or fur, h hair, hat or coat.
const G8_BODY = [
  '....kcccccck....',
  '...kcccccccck...',
  '...ksccccccsk.g.',
  '....kcccccck.g..',
  '....kppppppkg...',
  '....kppkkppkg...',
  '....kppk.kpgg...',
  '...kbbbk.kbbbk..',
];
const G8_HEADS = {
  cap: [
    '.....kkkkkk.....',
    '....kcccccck....',
    '...kcccccccckk..',
    '...kkkkkkkkkkk..',
    '...kssssssssk...',
    '...kskssssksk...',
    '...kssssssssk...',
    '....kssssssk....',
  ],
  visor: [
    '.....kkkkkk.....',
    '....khhhhhhk....',
    '..kkwwwwwwwwkk..',
    '..khkkkkkkkkkk..',
    '..khkssssssssk..',
    '..khksksssskk...',
    '...kkssssssssk..',
    '....kkssssskk...',
  ],
  bot: [
    '.......rr.......',
    '.......kk.......',
    '...kkkkkkkkkk...',
    '...kggggggggk...',
    '...kgyyggyygk...',
    '...kggggggggk...',
    '...kgkwkwkwgk...',
    '...kkkkkkkkkk...',
  ],
  owl: [
    '...kk......kk...',
    '...khkkkkkkhk...',
    '...khhhhhhhhk...',
    '...kwwwhhwwwk...',
    '...kwkwhhwkwk...',
    '...kwwwoowwwk...',
    '...khhhoohhhk...',
    '....kkkkkkkk....',
  ],
  fox: [
    '..kk........kk..',
    '..kok......kok..',
    '..koookkkkoook..',
    '..kooooooooook..',
    '..kokooooookok..',
    '..kwwooooooowwk.',
    '...kwwwkkwwwk...',
    '....kkkkkkkk....',
  ],
  astro: [
    '....kkkkkkkk....',
    '...kwwwwwwwwk...',
    '..kwwkkkkkkwwk..',
    '..kwklllsssskwk.',
    '..kwklskssskkwk.',
    '..kwkssssssskwk.',
    '..kwwkkkkkkwwk..',
    '...kkkkkkkkkk...',
  ],
  wizard: [
    '.......kk.......',
    '......khhk......',
    '.....khyhhk.....',
    '....khhhhyhk....',
    '..kkkkkkkkkkkk..',
    '...kskssssksk...',
    '...kwwsssswwk...',
    '....kwwwwwwk....',
  ],
  cat: [
    '..kk........kk..',
    '..khk......khk..',
    '..khhkkkkkkhhk..',
    '..khhhhhhhhhhk..',
    '..khykhhhhkyhk..',
    '..khhhhnnhhhhk..',
    '..khwwhhhhwwhk..',
    '...kkkkkkkkkk...',
  ],
};
const G8_NAMES = { cap: 'Caddie', visor: 'Ace', bot: 'Bot', owl: 'Owl', fox: 'Fox', astro: 'Astro', wizard: 'Wizard', cat: 'Cat' };
const G8_INK = { k: '#101820', w: '#fcfcfc', g: '#9aa7b1', y: '#f2d14b', o: '#e8762c', r: '#e4433b', b: '#5a3a1a', p: '#27324f', n: '#f29bb8', l: '#8fd3ff' };
const G8_LOOK = {
  cap: { s: '#f1c9a5', h: '#5a3a1a' }, visor: { s: '#c68e5b', h: '#2a1a0e' }, bot: { s: '#9aa7b1', h: '#6b7078' }, owl: { s: '#8a5a2b', h: '#8a5a2b' },
  fox: { s: '#e8762c', h: '#e8762c' }, astro: { s: '#f1c9a5', h: '#fcfcfc' }, wizard: { s: '#e8b88f', h: '#5b3cc4' }, cat: { s: '#6b7078', h: '#6b7078' },
};

function g8DrawSprite(ctx, character, colour, x, y, scale = 1) {
  const rows = [...(G8_HEADS[character] || G8_HEADS.cap), ...G8_BODY];
  const look = G8_LOOK[character] || G8_LOOK.cap;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < 16; c++) {
      const ch = rows[r][c];
      if (!ch || ch === '.') continue;
      ctx.fillStyle = ch === 'c' ? (colour || '#e4433b') : ch === 's' ? look.s : ch === 'h' ? look.h : G8_INK[ch] || '#101820';
      ctx.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), scale, scale);
    }
  }
}
function g8Sprite(character, colour) {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  cv.setAttribute('aria-hidden', 'true');
  g8DrawSprite(cv.getContext('2d'), character, colour, 0, 0, 1);
  return cv;
}

// ---- the course: a small picture redrawn for each hole from its number.
function g8Random(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const G8_TEE = { x: 34, y: 84 };
const G8_CUP = { x: 214, y: 70 };
function g8Blob(ctx, cx, cy, rx, ry, colour) {
  ctx.fillStyle = colour;
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01))));
    ctx.fillRect(cx - half, cy + y, half * 2, 1);
  }
}
/** Draw the hole. `players` stand at the tee; `ball` is where the ball is, if it is in the air or at rest. */
function g8DrawScene(ctx, { seed = 1, players = [], ball = null, wave = 0 } = {}) {
  const W = 256; const H = 112; const rnd = g8Random(seed);
  ctx.fillStyle = '#6ec3ff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#a6dcff'; ctx.fillRect(0, 34, W, 12);
  for (let i = 0; i < 3; i++) { // clouds
    const cx = Math.floor(rnd() * 220) + 10; const cy = Math.floor(rnd() * 16) + 6;
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(cx, cy + 3, 26, 5); ctx.fillRect(cx + 4, cy, 12, 4); ctx.fillRect(cx + 14, cy + 1, 8, 3);
  }
  ctx.fillStyle = '#1f7a44'; // far hills
  for (let i = 0; i < 4; i++) { const hx = Math.floor(rnd() * 230); const hw = 30 + Math.floor(rnd() * 40); for (let s = 0; s < 6; s++) ctx.fillRect(hx + s * 3, 44 - s * 2, Math.max(2, hw - s * 6), 2); }
  ctx.fillStyle = '#2f9e4f'; ctx.fillRect(0, 46, W, H - 46); // rough
  for (let x = 8; x < 248; x += 16) { ctx.fillStyle = (x / 16) % 2 ? '#5fd068' : '#52c05c'; ctx.fillRect(x, 58, 16, 44); } // mown fairway
  ctx.fillStyle = '#2f9e4f'; ctx.fillRect(8, 58, 6, 4); ctx.fillRect(8, 98, 6, 4); ctx.fillRect(242, 58, 6, 4); ctx.fillRect(242, 98, 6, 4);
  if (rnd() < 0.5) { const px = 90 + Math.floor(rnd() * 70); g8Blob(ctx, px, 92, 16, 6, '#2a6fd6'); ctx.fillStyle = '#8fd3ff'; ctx.fillRect(px - 8, 90, 6, 1); ctx.fillRect(px + 2, 93, 5, 1); }
  const bunkers = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < bunkers; i++) g8Blob(ctx, 70 + Math.floor(rnd() * 110), 62 + Math.floor(rnd() * 18), 7 + Math.floor(rnd() * 6), 3 + Math.floor(rnd() * 2), '#f2d16b');
  for (let i = 0; i < 7; i++) { // trees along the edges
    const tx = Math.floor(rnd() * 244) + 4; const ty = rnd() < 0.6 ? 44 + Math.floor(rnd() * 8) : 102 + Math.floor(rnd() * 4);
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(tx + 3, ty + 6, 2, 4);
    ctx.fillStyle = '#16603a'; ctx.fillRect(tx + 1, ty, 6, 2); ctx.fillRect(tx, ty + 2, 8, 4);
  }
  g8Blob(ctx, G8_CUP.x, G8_CUP.y + 2, 20, 9, '#9af08a'); // the green
  ctx.fillStyle = '#101820'; ctx.fillRect(G8_CUP.x - 1, G8_CUP.y + 1, 3, 2);
  ctx.fillStyle = '#fcfcfc'; ctx.fillRect(G8_CUP.x, G8_CUP.y - 22, 1, 24);
  ctx.fillStyle = '#e4433b'; const f = wave ? 1 : 0; ctx.fillRect(G8_CUP.x + 1, G8_CUP.y - 22 + f, 9, 3); ctx.fillRect(G8_CUP.x + 1, G8_CUP.y - 19 + f, 6, 2);
  ctx.fillStyle = '#9af08a'; ctx.fillRect(G8_TEE.x - 14, G8_TEE.y - 2, 30, 10); // tee box
  players.forEach((p, i) => g8DrawSprite(ctx, p.character, p.colour, G8_TEE.x - 12 + i * 15, G8_TEE.y - 14 + (i % 2) * 2, 1));
  if (ball) { ctx.fillStyle = 'rgba(16,24,32,.35)'; ctx.fillRect(Math.round(ball.x), Math.round(ball.ground ?? ball.y) + 2, 2, 1); ctx.fillStyle = '#fcfcfc'; ctx.fillRect(Math.round(ball.x), Math.round(ball.y), 2, 2); }
}

let g8Anim = 0;
/** One shot: the ball flies from the tee to the cup, or drops short when the hole was not finished. */
function g8Shot(scene, { holed }) {
  cancelAnimationFrame(g8Anim);
  const ctx = $('golf-scene').getContext('2d');
  const end = holed ? { x: G8_CUP.x, y: G8_CUP.y } : { x: G8_CUP.x - 60, y: G8_CUP.y + 16 };
  const from = { x: G8_TEE.x + 6, y: G8_TEE.y };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { g8DrawScene(ctx, { ...scene, ball: holed ? null : end }); return; }
  const t0 = performance.now(); const ms = 1100;
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const x = from.x + (end.x - from.x) * t;
    const ground = from.y + (end.y - from.y) * t;
    const y = ground - Math.sin(Math.PI * t) * 46;
    g8DrawScene(ctx, { ...scene, ball: t < 1 || !holed ? { x, y, ground } : null, wave: t >= 1 && holed ? 1 : 0 });
    if (t < 1) g8Anim = requestAnimationFrame(frame);
  };
  g8Anim = requestAnimationFrame(frame);
}

// ---- state kept on this side
let golfSeen = null;                  // the phase last acted on, so a change is handled once
let golfTeeing = false;               // between pressing Tee off and the state arriving
let golfPick = [];                    // ids of the players chosen for the next round, in tee order
const golfOpts = { holes: 3, length: 'medium', handicaps: false };
const golfPlaying = () => golfTeeing || state?.golf?.phase === 'playing';
const strokesText = (n) => `${n} ${n === 1 ? 'stroke' : 'strokes'}`;
const toParText = (d) => (d === 0 ? 'level par' : d > 0 ? `${d} over par` : `${-d} under par`);
const toParShort = (d) => (d === 0 ? 'E' : d > 0 ? `+${d}` : String(d));
const hcpText = (h) => (h == null ? 'HCP --' : h === 0 ? 'SCRATCH' : `HCP ${h}`);

function golfVisit(url) {
  if (!state?.golf && !golfTeeing) return;
  api.golfVisit(url).then((what) => {
    // Pages read before the tee shot are not part of the hole, so Back cannot return to them.
    if (what === 'start') { try { reader.clearHistory(); } catch { /* not attached */ } updateNav(); }
  }).catch(() => {});
}
// A page is also recognised by its title, in case its address is spelled another way.
reader.addEventListener('page-title-updated', (e) => {
  if (state?.golf?.phase !== 'playing' && !golfTeeing) return;
  let url = '';
  try { url = reader.getURL(); } catch { return; }
  api.golfTitle(url, e.title).catch(() => {});
});

$('nav-golf').addEventListener('click', () => { if (!golfPlaying()) showView('golf'); });
$('golfbar-return').addEventListener('click', () => showView('golf'));
$('golfbar-target').addEventListener('click', () => {
  const open = $('golfbar-lead').hidden;
  $('golfbar-lead').hidden = !open;
  $('golfbar-target').setAttribute('aria-expanded', String(open));
});

/** A button that asks once more before doing something that cannot be undone. */
function twoStep(button, label, sure, fn) {
  let armed = false;
  button.textContent = label;
  button.addEventListener('click', () => {
    if (!armed) { armed = true; button.textContent = sure; setTimeout(() => { armed = false; button.textContent = label; }, 4000); return; }
    fn();
  });
  return button;
}
twoStep($('golfbar-give-up'), 'Pick up', 'Pick up? Press again', () => api.golfGiveUp());

const g8El = (tag, cls, text) => el(tag, cls, text);
function g8Button(label, fn, kind = '') {
  const b = el('button', `g8-btn${kind ? ` ${kind}` : ''}`, label);
  b.type = 'button';
  b.addEventListener('click', () => guard(fn, $('golf-error')));
  return b;
}
const g8EndRound = () => twoStep(Object.assign(el('button', 'g8-btn quiet'), { type: 'button' }), 'End the round', 'End it? Press again', () => api.golfQuit());
function g8Box(title, ...kids) {
  const box = el('section', 'g8-box');
  if (title) box.append(el('h2', 'g8-h', title));
  box.append(...kids.filter(Boolean));
  return box;
}
const g8Profile = (g, name) => g.profiles.find((p) => p.name === name) || {};
function g8Who(g, name) {
  const span = el('span', 'who');
  const p = g8Profile(g, name);
  span.append(g8Sprite(p.character, p.colour), el('span', '', name));
  return span;
}

// ---- the clubhouse: who is playing, the round, and the records
function g8PlayerDialog(player) {
  const dlg = $('golf-player-dialog');
  const club = state.golfClub;
  const draft = { id: player?.id || null, name: player?.name || '', character: player?.character || club.characters[club.players.length % club.characters.length], colour: player?.colour || club.colours[club.players.length % club.colours.length] };
  $('g8-player-title').textContent = player ? player.name : 'New player';
  const body = $('g8-player-body');
  const preview = el('div', 'g8-preview');
  const paintPreview = () => preview.replaceChildren(g8Sprite(draft.character, draft.colour), el('span', '', `${G8_NAMES[draft.character] || ''}`));
  const name = document.createElement('input');
  name.type = 'text'; name.maxLength = 24; name.value = draft.name; name.id = 'g8-name'; name.placeholder = 'NAME';
  name.addEventListener('input', () => { draft.name = name.value; });
  const nameLabel = el('label', 'g8-label', 'Name'); nameLabel.htmlFor = 'g8-name';
  const chars = el('div', 'g8-choices');
  const colours = el('div', 'g8-choices');
  const paintChoices = () => {
    chars.replaceChildren(...club.characters.map((c) => {
      const b = el('button', 'g8-choice'); b.type = 'button'; b.title = G8_NAMES[c] || c; b.setAttribute('aria-label', G8_NAMES[c] || c); b.setAttribute('aria-pressed', String(c === draft.character));
      b.append(g8Sprite(c, draft.colour));
      b.addEventListener('click', () => { draft.character = c; paintChoices(); paintPreview(); });
      return b;
    }));
    colours.replaceChildren(...club.colours.map((c, i) => {
      const b = el('button', 'g8-choice swatch'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', `Colour ${i + 1}`); b.setAttribute('aria-pressed', String(c === draft.colour));
      b.addEventListener('click', () => { draft.colour = c; paintChoices(); paintPreview(); });
      return b;
    }));
  };
  paintChoices(); paintPreview();
  const error = el('p', 'g8-plain bad'); error.hidden = true;
  const actions = el('div', 'g8-actions');
  const save = el('button', 'g8-btn go', player ? 'Save' : 'Add player'); save.type = 'button';
  save.addEventListener('click', () => guard(async () => {
    const id = await api.golfSavePlayer(draft);
    if (!player && golfPick.length < 6 && !golfPick.includes(id)) golfPick.push(id);
    dlg.close();
  }, error));
  const close = el('button', 'g8-btn', 'Cancel'); close.type = 'button'; close.addEventListener('click', () => dlg.close());
  actions.append(save, close);
  if (player) {
    actions.append(twoStep(Object.assign(el('button', 'g8-btn quiet'), { type: 'button' }), 'Remove player', 'Remove and lose the records?', () => guard(async () => {
      await api.golfDeletePlayer(player.id);
      golfPick = golfPick.filter((id) => id !== player.id);
      dlg.close();
    }, error)));
  }
  const kids = [preview, nameLabel, name, el('span', 'g8-label', 'Character'), chars, el('span', 'g8-label', 'Colour'), colours];
  if (player) {
    const s = player.stats;
    const stat = (value, label) => { const d = el('div', 'g8-stat'); d.append(el('b', '', String(value)), el('span', '', label)); return d; };
    const stats = el('div', 'g8-stats');
    stats.append(
      stat(s.rounds, 'Rounds'), stat(`${s.wins}-${s.losses}-${s.ties}`, 'Won-lost-tied'), stat(player.handicap == null ? '-' : player.handicap, 'Handicap'),
      stat(s.perHole == null ? '-' : `${s.perHole > 0 ? '+' : ''}${s.perHole.toFixed(2)}`, 'To par per hole'),
      stat(s.best ? `${toParShort(s.best.toPar)} (${s.best.holes})` : '-', 'Best round (holes)'),
      stat(s.aces, 'Holes in one'), stat(s.eagles + s.birdies, 'Under par holes'), stat(s.pickups, 'Not finished'),
    );
    kids.push(el('span', 'g8-label', 'Record'), stats);
    if (player.rounds.length) {
      const table = el('table', 'g8-table');
      const head = el('tr'); head.append(el('th', '', 'Date'), el('th', '', 'Played in'), el('th', 'num', 'Holes'), el('th', 'num', 'Score'), el('th', 'num', 'Place'));
      const thead = el('thead'); thead.append(head);
      const tb = el('tbody');
      for (const r of player.rounds.slice(0, 10)) {
        const tr = el('tr');
        tr.append(el('td', '', new Date(r.at).toLocaleDateString()), el('td', '', r.library), el('td', 'num', String(r.holes)), el('td', 'num', `${r.strokes} (${toParShort(r.strokes - r.par)})`), el('td', 'num', r.field > 1 ? `${r.place} of ${r.field}` : 'solo'));
        tb.append(tr);
      }
      table.append(thead, tb);
      const wrap = el('div', 'g8-scroll'); wrap.append(table);
      kids.push(el('span', 'g8-label', 'Recent rounds'), wrap);
    }
  }
  kids.push(error, actions);
  body.replaceChildren(...kids);
  dlg.showModal();
  name.focus();
}

function g8Clubhouse() {
  const club = state.golfClub;
  golfPick = golfPick.filter((id) => club.players.some((p) => p.id === id));
  const chosen = golfPick.map((id) => club.players.find((p) => p.id === id));
  const key = JSON.stringify(['club', club.players.map((p) => [p.id, p.name, p.character, p.colour, p.stats.rounds]), golfPick, golfOpts, state.activeLibrary, Boolean(state.engine?.ready)]);
  const card = $('golf-card');
  if (card.dataset.key === key) return;
  card.dataset.key = key;
  cancelAnimationFrame(g8Anim);
  g8DrawScene($('golf-scene').getContext('2d'), { seed: 18, players: chosen });
  $('golf-banner').className = 'g8-banner';
  $('golf-banner').textContent = 'WIKI GOLF';

  const roster = el('div', 'g8-roster');
  for (const p of club.players) {
    const order = golfPick.indexOf(p.id);
    const b = el('button', 'g8-player'); b.type = 'button'; b.dataset.player = p.name;
    b.setAttribute('aria-pressed', String(order >= 0));
    b.title = order >= 0 ? 'Playing. Press to take out of the round.' : 'Press to add to the round.';
    b.append(g8Sprite(p.character, p.colour), el('span', 'g8-name', p.name), el('span', 'g8-sub', `${hcpText(p.handicap)}  W${p.stats.wins} L${p.stats.losses}`));
    if (order >= 0) b.append(el('span', 'g8-order', String(order + 1)));
    b.addEventListener('click', () => {
      if (order >= 0) golfPick.splice(order, 1); else if (golfPick.length < 6) golfPick.push(p.id);
      g8Clubhouse();
    });
    roster.append(b);
  }
  const add = el('button', 'g8-player new', '+ New player'); add.type = 'button'; add.id = 'g8-new';
  add.addEventListener('click', () => g8PlayerDialog(null));
  roster.append(add);
  const edits = el('div', 'g8-edit');
  for (const p of chosen) edits.append(g8Button(`${p.name}: card and look`, () => g8PlayerDialog(state.golfClub.players.find((q) => q.id === p.id)), 'quiet'));
  const playersBox = g8Box('1. Who is playing', el('p', 'g8-plain dim', club.players.length ? 'Press each player in the order they will tee off. Up to six. Players and their records are kept on this computer.' : 'Make a player to begin: a name, a character and a colour. Players and their records are kept on this computer.'), roster, edits);

  const seg = (label, key, options) => {
    const row = el('div', 'g8-opts');
    row.append(el('span', 'g8-label', label));
    for (const [value, text] of options) {
      const b = el('button', 'g8-btn', text); b.type = 'button'; b.setAttribute('aria-pressed', String(golfOpts[key] === value)); b.dataset.opt = `${key}:${value}`;
      b.addEventListener('click', () => { golfOpts[key] = value; g8Clubhouse(); });
      row.append(b);
    }
    return row;
  };
  const anyHcp = chosen.some((p) => p.handicap != null);
  if (chosen.length < 2 || !anyHcp) golfOpts.handicaps = false;
  const hRow = seg('Handicaps', 'handicaps', [[false, 'Off'], [true, 'On']]);
  if (chosen.length < 2 || !anyHcp) for (const b of hRow.querySelectorAll('button')) b.disabled = true;
  const libName = libraryName(state.activeLibrary);
  const start = g8Button('Tee off', () => api.golfStart({ playerIds: golfPick, holes: golfOpts.holes, length: golfOpts.length, handicaps: golfOpts.handicaps }), 'go');
  start.id = 'g8-start';
  start.disabled = !chosen.length || !state.engine?.ready;
  const error = el('p', 'g8-plain bad'); error.id = 'golf-error'; error.hidden = true;
  const startRow = el('div', 'g8-actions'); startRow.append(start, el('span', 'g8-plain dim', `Played in ${libName}.`));
  const roundBox = g8Box('2. The round',
    seg('Holes', 'holes', [[1, '1'], [3, '3'], [6, '6'], [9, '9']]),
    seg('Length', 'length', [['short', 'Short par 3'], ['medium', 'Medium par 4'], ['long', 'Long par 5'], ['mixed', 'Mix']]),
    hRow,
    el('p', 'g8-plain dim', anyHcp && chosen.length > 1 ? 'With handicaps on, weaker players get strokes taken off and the reduced totals decide the winner.' : 'A handicap appears after three rounds; with two or more players it can be used to even out the scores.'),
    error, startRow);

  const table = el('table', 'g8-table');
  const head = el('tr');
  head.append(el('th', '', 'Player'), el('th', 'num', 'Rounds'), el('th', 'num', 'W-L-T'), el('th', 'num', 'HCP'), el('th', 'num', 'Per hole'), el('th', 'num', 'Best'), el('th', 'num', 'Aces'));
  const thead = el('thead'); thead.append(head);
  const tb = el('tbody');
  for (const p of club.players) {
    const s = p.stats;
    const tr = el('tr');
    const who = el('td'); const w = el('span', 'who'); w.append(g8Sprite(p.character, p.colour), el('span', '', p.name)); who.append(w);
    tr.append(who, el('td', 'num', String(s.rounds)), el('td', 'num', `${s.wins}-${s.losses}-${s.ties}`), el('td', 'num', p.handicap == null ? '-' : String(p.handicap)),
      el('td', 'num', s.perHole == null ? '-' : `${s.perHole > 0 ? '+' : ''}${s.perHole.toFixed(2)}`), el('td', 'num', s.best ? toParShort(s.best.toPar) : '-'), el('td', 'num', String(s.aces)));
    tb.append(tr);
  }
  table.append(thead, tb);
  const wrap = el('div', 'g8-scroll'); wrap.append(table);
  const records = club.players.length ? g8Box('Clubhouse records', wrap) : null;

  const how = g8Box('How to play',
    el('p', 'g8-plain', 'Each hole is a start article and a target article. Get from one to the other using only the links inside the articles. Every article you open is a stroke, and the fewest strokes over the round wins.'),
    el('p', 'g8-plain dim', 'Everyone plays the same hole, one after another, on this computer. Search and Ask are switched off during a turn, going back costs a stroke, and the routes are shown once all have played.'),
    g8Button('Back to reading', async () => { if (currentUrl) showView('reader'); else openUrl(state.engine.homeUrl); }, 'quiet'));
  card.replaceChildren(playersBox, roundBox, ...(records ? [records] : []), how);
}

// ---- a round in progress
function g8Scorecard(g) {
  const table = el('table', 'g8-table'); table.id = 'g8-scorecard';
  const head = el('tr');
  head.append(el('th', '', 'Hole'), el('th', '', 'From and to'), el('th', 'num', 'Par'), ...g.players.map((p) => el('th', 'num', p)));
  const thead = el('thead'); thead.append(head);
  const body = el('tbody');
  for (const h of g.scorecard) {
    const tr = el('tr');
    const best = Math.min(...h.strokes);
    const route = el('td', 'g8-path', `${h.from} to ${h.to}`);
    tr.append(el('td', '', String(h.number)), route, el('td', 'num', String(h.par)), ...h.strokes.map((n) => el('td', `num${n === best && g.players.length > 1 ? ' best' : ''}`, String(n))));
    body.append(tr);
  }
  const foot = el('tfoot');
  const by = Object.fromEntries(g.standings.rows.map((r) => [r.name, r]));
  const row = (label, cells, par = '') => { const tr = el('tr'); tr.append(el('th', '', label), el('td', '', ''), el('td', 'num', par), ...cells.map((c) => el('td', 'num', c))); return tr; };
  foot.append(row('Total', g.players.map((p) => String(by[p].strokes)), String(g.standings.par)), row('To par', g.players.map((p) => toParShort(by[p].toPar))));
  if (g.useHandicaps) foot.append(row('Handicap', g.players.map((p) => (by[p].shots ? `-${by[p].shots}` : '0'))), row('Net', g.players.map((p) => String(by[p].net))));
  table.append(thead, body, foot);
  const wrap = el('div', 'g8-scroll'); wrap.append(table);
  return wrap;
}

function g8Round(g) {
  const card = $('golf-card');
  const key = JSON.stringify(['round', g.phase, g.holeNumber, g.player, g.error, g.hole?.start.url, g.live?.strokes]);
  if (card.dataset.key === key) return;
  card.dataset.key = key;
  cancelAnimationFrame(g8Anim);
  const ctx = $('golf-scene').getContext('2d');
  const banner = $('golf-banner');
  banner.className = 'g8-banner small';
  const where = `Hole ${g.holeNumber} of ${g.holeCount}`;
  const seed = g.holeNumber * 7 + g.holeCount;
  const me = g.player ? [g8Profile(g, g.player)] : g.profiles;
  const kids = [];
  const actions = el('div', 'g8-actions');
  const error = el('p', 'g8-plain bad'); error.id = 'golf-error'; error.hidden = true;
  const routeBlock = () => {
    const block = el('div', 'g8-route');
    const from = el('div', 'g8-end'); from.append(el('span', 'g8-end-label', 'From'), el('strong', '', g.hole.start.title));
    const to = el('div', 'g8-end target'); to.append(el('span', 'g8-end-label', 'To the flag'), el('strong', '', g.hole.target.title));
    if (g.hole.target.lead) to.append(el('p', '', g.hole.target.lead));
    block.append(from, to);
    return block;
  };

  if (g.phase === 'layout') {
    g8DrawScene(ctx, { seed, players: g.profiles });
    banner.textContent = g.error ? 'NO HOLE' : `${where.toUpperCase()}`;
    kids.push(el('p', 'g8-kicker', `${where}, in ${g.library}`), el('p', 'g8-big', g.error ? 'The hole could not be laid out' : 'Laying out the hole...'), el('p', `g8-plain${g.error ? ' bad' : ' dim'}`, g.error || 'Choosing a start and a target that can be reached from it.'));
    if (g.error) actions.append(g8Button('Try again', () => api.golfRelay(), 'go'));
    actions.append(g8EndRound());
  } else if (g.phase === 'tee') {
    g8DrawScene(ctx, { seed, players: me, ball: { x: G8_TEE.x + 6, y: G8_TEE.y } });
    banner.textContent = `${where.toUpperCase()}  PAR ${g.hole.par}`;
    kids.push(el('p', 'g8-kicker', `${where}, par ${g.hole.par}, in ${g.library}`), routeBlock());
    const up = el('p', 'g8-up'); up.id = 'g8-up';
    const p = g8Profile(g, g.player);
    up.append(g8Sprite(p.character, p.colour), el('span', '', g.players.length > 1 ? `${g.player}, you are up. Everyone else looks away.` : `${g.player}, you are up.`));
    up.querySelector('canvas').style.cssText = 'width:48px;height:48px;flex:none';
    kids.push(up, el('p', 'g8-plain dim', `Use only the links inside the articles. Every article you open is a stroke, going back included. The hole is over at ${g.hole.limit} strokes, which is also what picking up scores.`));
    actions.append(g8Button('Tee off', async () => {
      golfTeeing = true;
      try { const r = await api.golfTee(); $('golfbar-lead').hidden = true; $('golfbar-target').setAttribute('aria-expanded', 'false'); openUrl(r.url, { golf: true }); } finally { golfTeeing = false; }
    }, 'go'));
    if (g.canRelay) actions.append(g8Button('Lay out a different hole', () => api.golfRelay()));
    actions.append(g8EndRound());
  } else if (g.phase === 'playing') {
    g8DrawScene(ctx, { seed, players: me });
    banner.textContent = `${g.player.toUpperCase()} IS ON THE COURSE`;
    kids.push(el('p', 'g8-kicker', `${where}, par ${g.hole.par}`));
    actions.append(g8Button('Back to the article', () => showView('reader'), 'go'));
  } else if (g.phase === 'done') {
    const d = g.last.strokes - g.hole.par;
    banner.className = 'g8-banner';
    banner.textContent = `${g.last.name.toUpperCase()}${g.last.holed && d <= 0 ? '!' : ''}`;
    g8Shot({ seed, players: me }, { holed: g.last.holed });
    kids.push(el('p', 'g8-kicker', `${where}, par ${g.hole.par}`), el('p', `g8-big${g.last.holed && d < 0 ? ' win' : ''}`, g.last.name));
    kids.push(el('p', 'g8-plain', g.last.holed
      ? `${g.player} reached ${g.hole.target.title} in ${strokesText(g.last.strokes)}, ${toParText(d)}.`
      : `${g.player} did not reach ${g.hole.target.title}. That scores the limit of ${strokesText(g.last.strokes)}.`));
    actions.append(g8Button(g.nextPlayer ? `Pass to ${g.nextPlayer}` : 'See how the hole played', () => api.golfNext(), 'go'), g8EndRound());
  } else if (g.phase === 'summary') {
    g8DrawScene(ctx, { seed, players: g.profiles });
    banner.textContent = `${where.toUpperCase()} PLAYED`;
    kids.push(el('p', 'g8-kicker', `${where}, par ${g.hole.par}`), el('p', 'g8-big', `${g.hole.start.title} to ${g.hole.target.title}`));
    const table = el('table', 'g8-table'); table.id = 'g8-summary';
    const body = el('tbody');
    for (const c of g.cards) {
      const tr = el('tr');
      const who = el('td'); who.append(g8Who(g, c.player));
      tr.append(who, el('td', 'num', String(c.strokes)), el('td', '', c.name), el('td', 'g8-path', c.path.join('  ›  ')));
      body.append(tr);
    }
    table.append(body);
    const wrap = el('div', 'g8-scroll'); wrap.append(table);
    kids.push(wrap, el('p', 'g8-plain dim', `The hole was laid out along ${g.hole.route.join('  ›  ')}.`));
    const st = g.standings;
    if (st.holesPlayed) kids.push(el('p', 'g8-plain', `After ${st.holesPlayed} ${st.holesPlayed === 1 ? 'hole' : 'holes'}: ${st.rows.map((r) => `${r.name} ${r.strokes} (${toParText(r.toPar)})`).join(', ')}.`));
    actions.append(g8Button(g.holeNumber < g.holeCount ? 'Next hole' : 'Final scores', () => api.golfNext(), 'go'), g8EndRound());
  } else if (g.phase === 'finished') {
    const rows = g.standings.rows;
    const winners = rows.filter((r) => r.place === 1).map((r) => r.name);
    const title = g.players.length === 1 ? `${strokesText(rows[0].strokes)}, ${toParText(rows[0].toPar)}`
      : winners.length === 1 ? `${winners[0]} wins` : `${winners.slice(0, -1).join(', ')} and ${winners.at(-1)} share the win`;
    g8DrawScene(ctx, { seed: 18, players: g.players.length === 1 ? g.profiles : winners.map((n) => g8Profile(g, n)), wave: 1 });
    banner.className = 'g8-banner';
    banner.textContent = g.players.length === 1 ? 'ROUND OVER' : winners.length === 1 ? `${winners[0].toUpperCase()} WINS!` : 'A TIE!';
    kids.push(el('p', 'g8-kicker', `${g.holeCount} ${g.holeCount === 1 ? 'hole' : 'holes'} in ${g.library}${g.useHandicaps ? ', with handicaps' : ''}`), el('p', 'g8-big win', title), g8Scorecard(g));
    kids.push(el('p', 'g8-plain dim', 'The round has been added to the clubhouse records.'));
    actions.append(g8Button('Back to the clubhouse', () => api.golfQuit(), 'go'));
  }
  kids.push(error, actions);
  card.replaceChildren(g8Box('', ...kids));
  card.querySelector('.g8-btn.go')?.focus();
}

function renderGolf() {
  const g = state?.golf || null;
  const playing = golfPlaying();
  document.body.classList.toggle('golf-playing', playing);
  for (const id of ['search', 'nav-home', 'nav-random', 'nav-school', 'nav-map', 'lib-select', 'toggle-ask', 'open-library', 'edition-stamp', 'ask']) $(id).inert = playing;
  $('nav-golf').setAttribute('aria-pressed', String(Boolean(g) || view === 'golf'));

  const seen = g ? `${g.holeNumber}:${g.player}:${g.phase}` : null;
  if (seen !== golfSeen) {
    golfSeen = seen;
    if (g && g.phase !== 'playing') showView('golf');
  }

  const bar = $('golfbar');
  bar.hidden = !g || (view === 'golf');
  if (g) {
    const live = g.phase === 'playing';
    for (const id of ['golfbar-route', 'golfbar-strokes', 'golfbar-target', 'golfbar-give-up']) $(id).hidden = !live;
    $('golfbar-return').hidden = live;
    if (live) {
      $('golfbar-hole').textContent = `Hole ${g.holeNumber}/${g.holeCount}  Par ${g.hole.par}`;
      $('golfbar-route').replaceChildren(el('span', '', `${g.player}: to `), el('strong', '', g.hole.target.title));
      $('golfbar-strokes').textContent = `${strokesText(g.live.strokes)} of ${g.hole.limit}`;
      $('golfbar-lead').textContent = g.hole.target.lead || 'No description of this article is available.';
    } else {
      $('golfbar-hole').textContent = g.phase === 'finished' ? 'Wiki golf: the round is finished' : `Wiki golf: hole ${g.holeNumber} of ${g.holeCount} is waiting`;
      $('golfbar-lead').hidden = true;
    }
  }
  if (view !== 'golf' || !state?.golfClub) return;
  if (g) g8Round(g); else g8Clubhouse();
}

// ------------------------------------------------------------ ask panel

const thread = $('ask-thread');
const entries = new Map();
let activeAsk = null;
const emptyState = $('ask-empty').cloneNode(true);

/** Forget the conversation: the model stops seeing earlier turns and the panel is cleared. */
async function newConversation({ focus = true } = {}) {
  await api.resetAsk().catch(() => {});
  entries.clear();
  setAsking(null);
  thread.replaceChildren(emptyState.cloneNode(true));
  $('ask-new').hidden = true;
  $('ask-input').placeholder = 'Ask a question';
  if (focus) $('ask-input').focus();
}
$('ask-new').addEventListener('click', () => newConversation());

$('toggle-ask').addEventListener('click', () => {
  const open = $('ask').hidden;
  $('ask').hidden = !open;
  $('toggle-ask').setAttribute('aria-pressed', String(open));
  if (open) $('ask-input').focus();
});

function inline(text, passages, into) {
  // **bold** and [n] citation markers; everything else is plain text.
  const re = /\*\*([^*]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) into.append(text.slice(last, m.index));
    if (m[1]) into.append(el('strong', '', m[1]));
    else {
      for (const n of m[2].split(',').map((x) => Number(x.trim()))) {
        const p = passages.find((x) => x.n === n);
        if (!p) { into.append(`[${n}]`); continue; }
        const b = el('button', 'cite', String(n));
        b.title = `${p.title}${p.section ? `, ${p.section}` : ''}`;
        b.addEventListener('click', () => openUrl(p.url));
        into.append(b);
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) into.append(text.slice(last));
}

function renderAnswer(box, text, passages) {
  box.replaceChildren();
  let ul = null;
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      if (!ul) { ul = el('ul'); box.append(ul); }
      const li = el('li');
      inline(bullet[1], passages, li);
      ul.append(li);
    } else {
      ul = null;
      const p = el('p');
      inline(line.replace(/^#+\s*/, ''), passages, p);
      box.append(p);
    }
  }
}

function sourceList(passages, withText) {
  const ul = el('ul', 'sources');
  const seen = new Set();
  for (const p of passages) {
    const li = el('li', withText ? 'passage' : '');
    const row = el('div');
    const n = el('button', 'cite', String(p.n));
    const link = el('button', 'source-link');
    link.append(p.title);
    if (p.section) link.append(el('span', '', `, ${p.section}`));
    [n, link].forEach((b) => b.addEventListener('click', () => openUrl(p.url)));
    if (withText) {
      row.append(n, ' ', link);
      li.append(row, el('p', 'passage-text', p.text));
    } else {
      const k = `${p.title}|${p.section}`;
      if (seen.has(k)) continue;
      seen.add(k);
      li.append(n, link);
    }
    ul.append(li);
  }
  return ul;
}

function setAsking(id) {
  activeAsk = id;
  $('ask-send').textContent = id ? 'Stop' : 'Ask';
  $('ask-send').classList.toggle('primary', !id);
}

async function ask(question, retry = false) {
  if (activeAsk || !question) return;
  $('ask-empty')?.remove();
  $('ask-new').hidden = false;
  $('ask-input').placeholder = 'Ask a follow-up, or start a new conversation';
  const box = el('div', 'qa');
  const status = el('p', 'qa-status');
  status.append(el('span', 'dot'), el('span', '', 'Starting'));
  const answer = el('div', 'qa-a');
  box.append(el('p', 'qa-q', question), status, answer);
  thread.append(box);
  thread.scrollTop = thread.scrollHeight;
  const entry = { box, status, answer, text: '', passages: [] };
  try {
    const pinned = !$('ask-pin-row').hidden && $('ask-pin').checked ? currentUrl : null;
    const id = await api.ask(question, pinned, retry);
    entries.set(id, entry);
    setAsking(id);
  } catch (err) {
    status.remove();
    box.append(el('p', 'qa-note', err.message));
  }
}

api.onAskEvent((ev) => {
  const entry = entries.get(ev.id);
  if (!entry) return;
  const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  let showTop = false; // keep the start of this turn in view, for a note the person needs to see
  const finish = () => { entry.status.remove(); entries.delete(ev.id); if (activeAsk === ev.id) setAsking(null); };

  if (ev.type === 'status') entry.status.lastChild.textContent = ev.text;
  else if (ev.type === 'understood') entry.box.firstChild.after(el('p', 'qa-understood', `Understood as: ${ev.text}`));
  else if (ev.type === 'sources') entry.passages = ev.passages;
  else if (ev.type === 'token') {
    entry.text += ev.text;
    entry.status.lastChild.textContent = 'Writing the answer';
    renderAnswer(entry.answer, entry.text, entry.passages);
  } else if (ev.type === 'done') {
    finish();
    if (ev.empty) {
      entry.box.append(el('p', 'qa-note', 'Nothing in this edition matched that question. Name the subject directly, or use the search box to find the article.'));
    } else if (ev.passagesOnly) {
      const notSetUp = ['not-installed', 'needs-model'].includes(ev.aiState);
      const note = el('p', 'qa-note');
      if (notSetUp || state.ai.busy) {
        showTop = true;
        // Not an error: the model simply has not been installed yet. Offer to do it here.
        note.append(state.ai.busy
          ? 'Answers are still being set up, so for now here are the passages from the offline copy that best match the question.'
          : 'Answers are not set up yet, so here are the passages from the offline copy that best match the question. ');
        if (!state.ai.busy) {
          const go = el('button', 'btn small', 'Set up answers');
          const question = entry.box.querySelector('.qa-q').textContent;
          go.addEventListener('click', async () => {
            go.disabled = true;
            note.replaceChildren('Setting up answers. This installs Microsoft Foundry Local if it is missing and downloads the model, a few GB. Progress is shown at the top of this panel.');
            try {
              await api.setupAnswers();
              note.replaceChildren('Answers are ready. Asking again:');
              if (!activeAsk) ask(question, true);
            } catch (err) {
              note.replaceChildren(`Answers could not be set up: ${err.message}`);
            }
          });
          note.append(go);
        }
      } else {
        note.textContent = `${ev.modelNote ? `${ev.modelNote} ` : ''}These are the passages from the offline copy that best match the question.`;
      }
      entry.answer.before(note);
      entry.box.append(sourceList(entry.passages, true));
    } else {
      const text = ev.text || entry.text;
      renderAnswer(entry.answer, text, entry.passages);
      // List the passages the answer actually cites; if it cited none, list what it was given.
      const cited = new Set((text.match(/\[(\d+(?:\s*,\s*\d+)*)\]/g) || []).flatMap((m) => m.slice(1, -1).split(',').map(Number)));
      const used = entry.passages.filter((p) => cited.has(p.n));
      entry.box.append(sourceList(used.length ? used : entry.passages, false));
      const edition = state.edition?.active?.date ? ` from the ${editionName(state.edition.active.date)} edition` : '';
      entry.box.append(el('p', 'qa-foot', `Written on this laptop${ev.device ? ` (${ev.device})` : ''}${edition}. Small local models make mistakes, so check the cited passages. Not professional advice.`));
    }
  } else if (ev.type === 'error') {
    finish();
    entry.box.append(el('p', 'qa-note', ev.message));
    if (entry.passages.length) entry.box.append(sourceList(entry.passages, true));
  } else if (ev.type === 'stopped') {
    finish();
    entry.box.append(el('p', 'qa-foot', 'Stopped.'));
  }
  if (showTop) thread.scrollTop = Math.max(0, entry.box.offsetTop - thread.offsetTop - 8);
  else if (nearBottom) thread.scrollTop = thread.scrollHeight;
});

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (activeAsk) { api.cancelAsk(activeAsk); return; }
  const q = $('ask-input').value.trim();
  if (!q) return;
  $('ask-input').value = '';
  ask(q);
});
$('ask-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ask-form').requestSubmit(); }
});
thread.addEventListener('click', (e) => {
  if (e.target.classList.contains('example')) ask(e.target.textContent);
});

// ------------------------------------------------------------ external links

api.onExternalLink(({ url, hint }) => {
  externalUrl = url;
  try { $('external-host').textContent = new URL(url).host; } catch { $('external-host').textContent = url; }
  $('external-hint').textContent = hint ? ` ${hint}` : '';
  $('external').hidden = false;
});
$('external-open').addEventListener('click', () => { if (externalUrl) api.openExternal(externalUrl); $('external').hidden = true; });
$('external-dismiss').addEventListener('click', () => { $('external').hidden = true; });
api.onOpenUrl(({ url, switched }) => {
  // A link into another downloaded library: the conversation and results belong to the one just left.
  if (switched) { if (!$('ask-new').hidden) newConversation({ focus: false }); $('results').replaceChildren(); }
  $('external').hidden = true;
  openUrl(url);
});

// ------------------------------------------------------------ state

function render() {
  renderAgreement();
  renderLibraries();
  renderGolf();
  renderSchool();
  renderMap();
  maybeTour();
  const e = state.edition;
  const active = e?.active;
  $('edition-label').textContent = active ? (active.date ? `${editionName(active.date)} edition` : 'Local edition') : 'No edition yet';
  const openLib = state.activeLibrary !== 'wikipedia' && (state.libraries || []).find((l) => l.id === state.activeLibrary);
  if (openLib?.active) $('edition-label').textContent = `${openLib.name}, ${openLib.active.date ? `${editionName(openLib.active.date)} edition` : 'local edition'}`;
  const busy = (e && BUSY.includes(e.phase)) || state.engine.installing;
  $('edition-dot').className = `dot ${busy ? 'busy' : e?.error || state.engine.error ? 'bad' : active ? 'ok' : ''}`;
  $('edition-stamp').title = busy ? 'An update is in progress' : active ? 'Stored and verified on this laptop' : 'Nothing downloaded yet';
  $('toggle-ask').disabled = !state.engine.ready;

  const engineErr = active && state.engine.error;
  $('engine-error').textContent = engineErr || '';
  $('engine-error').hidden = !engineErr;

  $('ask-sub').textContent = !state.settings.ai.enabled
    ? 'Shows the passages in the offline copy that best match your question.'
    : state.ai.busy ? `Working on the model: ${state.ai.busy}`
    : state.ai.resting ? 'The model is out of memory to keep this computer free. Your next question loads it again, which adds a short wait.'
    : `Answers are written on this laptop${state.ai.state === 'ready' && state.ai.device ? `, on the ${state.ai.device},` : ''} from articles in the offline copy. Follow-up questions use this conversation, which is forgotten when you start a new one or close the app.`;

  if (!active && maintaining()) {
    // The library is being moved: for a moment there is no edition open. That is not a reason to show the first-run page.
    if (view === 'library') renderLibrary();
  } else if (!active) {
    showView('setup');
    renderSetup();
  } else {
    if (!landed) {
      // First paint with a library present: go to the main page as soon as the engine is up.
      if (state.engine.ready) { landed = true; openUrl(state.engine.homeUrl); } else {
        showView('reader');
        $('reader-msg').textContent = state.engine.error || 'Opening your edition';
        $('reader-msg').hidden = false;
      }
    } else if (view === 'setup') openUrl(state.engine.homeUrl);
    if (view === 'library') renderLibrary();
  }
  if ($('revert-dialog').open) syncRevertGo();
  updateNav();
}

api.onState((s) => { state = s; render(); });
api.onEditionSwitched(({ homeUrl }) => {
  // The engine restarted on a new address, so pages from the old one are gone.
  currentUrl = null;
  $('results').replaceChildren();
  // Links in the old conversation point at the previous edition, so start afresh.
  if (!$('ask-new').hidden) newConversation({ focus: false });
  if (view === 'reader' || view === 'results' || view === 'setup' || !landed) { landed = true; openUrl(homeUrl); }
});

api.getState().then((s) => { state = s; render(); });
