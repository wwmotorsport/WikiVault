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
  for (const v of ['setup', 'results', 'reader', 'library']) $(`view-${v}`).hidden = v !== next;
  if (next !== 'reader') { document.title = 'Wikivault'; closeFind(); }
  if (next === 'library') { renderLibrary(); loadModelList(); }
  updateNav();
}

function updateNav() {
  let back = false;
  let fwd = false;
  if (view === 'reader' && readerReady) {
    try { back = reader.canGoBack(); fwd = reader.canGoForward(); } catch { /* not attached yet */ }
  } else if ((view === 'results' || view === 'library') && prevView) back = true;
  $('nav-back').disabled = !back;
  $('nav-forward').disabled = !fwd;
  const ready = Boolean(state?.engine.ready);
  $('nav-home').disabled = !ready;
  $('nav-random').disabled = !ready;
  $('search-input').disabled = !ready;
  const onArticle = view === 'reader' && currentUrl && state?.engine.origin && currentUrl.startsWith(`${state.engine.origin}/content/`);
  $('ask-pin-row').hidden = !onArticle;
  if (!onArticle) $('ask-pin').checked = false;
}

function goBack() {
  if (view === 'reader') { try { reader.goBack(); } catch { /* nothing to go back to */ } } else if (prevView) showView(prevView);
}

function openUrl(url) {
  if (!url) return;
  $('reader-msg').hidden = true;
  showView('reader');
  if (reader.getAttribute('src') === url && readerReady) { try { reader.loadURL(url); } catch { reader.src = url; } } else reader.src = url;
}

reader.addEventListener('dom-ready', () => { readerReady = true; updateNav(); });
reader.addEventListener('did-navigate', (e) => { currentUrl = e.url; updateNav(); });
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
  else if (action === 'search') { $('search-input').focus(); $('search-input').select(); }
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

function renderSetup() {
  const e = state.edition;
  const dir = setupDir || state.settings.dataDir || state.suggestedDataDir;
  const free = setupDir ? setupFree : state.freeBytes;
  $('setup-dir').textContent = dir;
  $('setup-free').textContent = free == null ? '' : part.done
    ? `${bytes(free)} set aside for the library on its own partition.`
    : `${bytes(free)} free on this drive. The download needs the edition's full size free, and each update needs that much again until the old edition is removed.`;
  $('setup-login-row').hidden = state.platform !== 'win32';
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
  $('lib-partition').hidden = !p;
  if (p) {
    $('lib-partition-text').textContent = state.libraryOnPartition
      ? `Wikipedia has its own partition: drive ${p.driveLetter}: (${gbOf(p.sizeBytes)} GB). You can move the library back to a folder and return this space to ${p.sourceLetter}:.`
      : `Drive ${p.driveLetter}: (${gbOf(p.sizeBytes)} GB) was created for Wikipedia but the library no longer lives on it. Its space can be returned to ${p.sourceLetter}:.`;
    $('revert-open').textContent = state.libraryOnPartition ? 'Stop using the partition' : `Remove drive ${p.driveLetter}:`;
    $('revert-open').disabled = running;
  }
  const moveBtn = $('move-open');
  if (moveBtn) moveBtn.disabled = running;
}

// ---- move library
const move = { dest: null, free: null };

async function showMoveDest() {
  $('move-dest').textContent = move.dest || 'No folder chosen yet';
  const need = state.edition.active.bytes;
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
    steps.push(`The library (${bytes(a.bytes)}) is copied to a folder on ${src}: and checked against its checksum. Wikipedia stays available.`);
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
    const short = free != null && free < a.bytes + 2 * GB;
    $('revert-free').textContent = free == null ? '' : `${bytes(free)} free there now. The library needs ${bytes(a.bytes)}.`;
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
    fact(dl, 'Contents', 'English Wikipedia, full articles with images');
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

api.onExternalLink(({ url }) => {
  externalUrl = url;
  try { $('external-host').textContent = new URL(url).host; } catch { $('external-host').textContent = url; }
  $('external').hidden = false;
});
$('external-open').addEventListener('click', () => { if (externalUrl) api.openExternal(externalUrl); $('external').hidden = true; });
$('external-dismiss').addEventListener('click', () => { $('external').hidden = true; });
api.onOpenUrl(({ url }) => openUrl(url));

// ------------------------------------------------------------ state

function render() {
  renderAgreement();
  const e = state.edition;
  const active = e?.active;
  $('edition-label').textContent = active ? (active.date ? `${editionName(active.date)} edition` : 'Local edition') : 'No edition yet';
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

  if (!active) {
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
