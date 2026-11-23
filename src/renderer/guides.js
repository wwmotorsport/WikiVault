'use strict';
// The Survival Guides on the Options and Setup page: the collections that can be added, what each is doing, and
// the buttons to add, cancel, remove and open. Shares the page with app.js and uses its helpers ($, el, state, bytes...).

const guidesAsked = new Set();
const guidesMb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** What one collection is doing, in words. */
function guidesPhase(c) {
  const p = c.progress;
  if (c.phase === 'waiting') return 'Waiting for its turn';
  if (c.phase === 'checking') return 'Looking for the newest file';
  if (c.phase === 'downloading') return `Downloading${p && p.total ? ` ${Math.floor((p.received / p.total) * 100)}% of ${guidesMb(p.total)}` : ''}`;
  if (c.phase === 'verifying') return 'Checking the download against the published checksum';
  if (c.phase === 'reading') return 'Opening the collection';
  if (c.phase === 'converting') return p ? `Converting guide ${p.done + 1} of ${p.total}: ${p.title}${p.pages ? ` (page ${p.page} of ${p.pages})` : ''}` : 'Converting';
  return '';
}

/**
 * The Survival Guides box for the More libraries group, or null before the library has a home. The box is made once
 * and brought up to date in place: while a collection is converted the page is repainted several times a second, and
 * a button that was replaced under the pointer would lose the click.
 */
const guidesUi = { box: null, status: null, list: null, actions: null, actionsKey: '', rows: new Map(), own: null, ownKey: '', ownLine: null, ownBar: null };
function guidesBox() {
  const g = state.guides;
  if (!g) return null;
  const haveWikipedia = Boolean(state.edition && state.edition.active);
  const act = (label, fn, primary) => {
    const b = el('button', `btn small${primary ? ' primary' : ''}`, label);
    b.addEventListener('click', () => { $('more-error').hidden = true; guard(fn, $('more-error')); });
    return b;
  };
  if (!guidesUi.box) {
    const box = el('div', 'more-lib guides-lib');
    box.dataset.lib = 'guides';
    guidesUi.status = el('p', 'lib-status');
    guidesUi.list = el('ul', 'guides-cols');
    guidesUi.actions = el('div', 'actions');
    box.append(el('h3', '', 'Survival Guides'),
      el('p', '', 'Practical guides to keep on hand: water, first aid and medicine, food, knots, and getting by after a disaster. Each collection is fetched from the Kiwix project as PDF documents and converted on this computer into articles with their pictures and diagrams in place, so that it can be searched like Wikipedia and used by Ask.'),
      guidesUi.status, guidesUi.list, guidesUi.actions, (guidesUi.own = el('div', 'guides-own')),
      el('p', 'small-print', 'Converting takes a few minutes for the small collections and longer for the largest. It can be left to run while you use the app. Reference only: medical guidance in particular does not replace a trained person.'));
    guidesUi.box = box;
  }
  const added = g.collections.filter((c) => c.have).length + (g.own && g.own.books.length ? 1 : 0); // your own books are a collection too
  guidesUi.status.textContent = added ? `${g.articles.toLocaleString('en-US')} articles from ${added} ${added === 1 ? 'collection' : 'collections'}, ${guidesMb(g.bytes)}.` : haveWikipedia ? 'None added yet. Add the collections you want; each can be removed again.' : 'Available once Wikipedia is set up.';
  for (const c of g.collections) {
    const busy = c.phase !== 'idle';
    const p = c.progress;
    const frac = c.phase === 'downloading' && p && p.total ? p.received / p.total : c.phase === 'converting' && p && p.total ? (p.done + (p.pages ? p.page / p.pages : 0)) / p.total : null;
    if (!busy && !c.have && !c.latest && haveWikipedia && !guidesAsked.has(c.id)) { guidesAsked.add(c.id); api.guidesInfo(c.id).catch(() => {}); }
    const size = c.latest && c.latest.bytes ? guidesMb(c.latest.bytes) : `about ${guidesMb(c.approxBytes)}`;
    const kind = busy ? 'busy' : c.have ? 'have' : 'none';
    const key = [kind, frac != null, haveWikipedia, kind === 'none' ? size : '', Boolean(c.have && c.have.old)].join('|');
    let row = guidesUi.rows.get(c.id);
    if (!row || row.key !== key) {
      const li = el('li', '');
      li.dataset.col = c.id;
      const text = el('div', 'guides-col-text');
      const line = el('span', 'guides-col-status');
      text.append(el('b', '', c.name), el('span', '', c.about), line);
      let bar = null;
      if (kind === 'busy' && frac != null) { bar = document.createElement('progress'); bar.max = 1000; text.append(bar); }
      const buttons = el('div', 'guides-col-acts');
      if (kind === 'busy') buttons.append(act('Cancel', () => api.guidesCancel(c.id)));
      else if (kind === 'have') { if (c.have.old) buttons.append(act('Read its scans', () => api.guidesImprove(c.id), true)); buttons.append(act('Remove', () => api.guidesRemove(c.id))); }
      else { const b = act(`Add (${size})`, () => api.guidesAdd(c.id), true); b.disabled = !haveWikipedia; buttons.append(b); }
      li.append(text, buttons);
      if (row) row.li.replaceWith(li); else guidesUi.list.append(li);
      row = { key, li, line, bar };
      guidesUi.rows.set(c.id, row);
    }
    row.line.textContent = busy ? guidesPhase(c)
      : c.have ? `${c.have.guides} ${c.have.guides === 1 ? 'guide' : 'guides'}, ${c.have.articles} ${c.have.articles === 1 ? 'article' : 'articles'}, ${guidesMb(c.have.bytes)}.${c.have.skipped ? ` ${c.have.skipped} could not be converted and ${c.have.skipped === 1 ? 'was' : 'were'} left out.` : ''}${c.have.old ? ' Some of its books are scans whose words have not been read yet, so they cannot be searched.' : ''}`
        : c.error ? `Could not be added: ${c.error}` : `Not added. The download is ${size}.`;
    row.line.classList.toggle('bad', !busy && !c.have && Boolean(c.error));
    if (row.bar && frac != null) row.bar.value = Math.round(frac * 1000);
  }
  const canOpen = g.ready && state.activeLibrary !== 'guides';
  const missing = g.collections.filter((c) => !c.have && c.phase === 'idle');
  const canAll = missing.length > 1 && haveWikipedia;
  const actionsKey = `${canOpen}|${canAll}`;
  if (actionsKey !== guidesUi.actionsKey) {
    guidesUi.actionsKey = actionsKey;
    guidesUi.actions.replaceChildren(...[
      canOpen ? act('Open', async () => { const r = await api.selectLibrary('guides'); openUrl(r.homeUrl); }, true) : null,
      canAll ? act('Add all', async () => { for (const c of state.guides.collections.filter((x) => !x.have && x.phase === 'idle')) await api.guidesAdd(c.id); }) : null,
    ].filter(Boolean));
  }
  guidesUi.actions.hidden = !guidesUi.actions.children.length;

  // Your own books: PDFs, or a folder of page pictures, converted like the rest.
  const own = g.own || { books: [], bytes: 0, phase: 'idle', progress: null, error: null };
  const ownBusy = own.phase !== 'idle';
  const op = own.progress;
  const ownFrac = ownBusy && op && op.total ? (op.done + (op.pages ? op.page / op.pages : 0)) / op.total : null;
  const ownKey = [ownBusy, ownFrac != null, haveWikipedia, own.books.map((b) => `${b.id}:${b.articles}`).join(',')].join('|');
  if (ownKey !== guidesUi.ownKey) {
    guidesUi.ownKey = ownKey;
    const head = el('div', 'guides-own-head');
    const text = el('div', 'guides-col-text');
    guidesUi.ownLine = el('span', 'guides-col-status');
    text.append(el('b', '', 'Your own books'), el('span', '', 'Add books and documents you have as PDF files, or a folder of photographs or scans of pages (JPEG or PNG, named in page order). Scanned pages are read for their words. Nothing you add leaves this computer.'), guidesUi.ownLine);
    guidesUi.ownBar = null;
    if (ownFrac != null) { guidesUi.ownBar = document.createElement('progress'); guidesUi.ownBar.max = 1000; text.append(guidesUi.ownBar); }
    const buttons = el('div', 'guides-col-acts');
    if (ownBusy) buttons.append(act('Cancel', () => api.guidesCancel('mine')));
    const addPdf = act('Add PDFs', () => api.guidesOwnAdd('pdf'), !ownBusy); const addDir = act('Add a folder of page pictures', () => api.guidesOwnAdd('folder'));
    addPdf.disabled = !haveWikipedia; addDir.disabled = !haveWikipedia;
    buttons.append(addPdf, addDir);
    head.append(text, buttons);
    const list = el('ul', 'guides-own-list');
    for (const b of own.books) {
      const li = el('li', '');
      li.dataset.book = b.id;
      li.append(el('span', '', `${b.title} (${b.pages} ${b.pages === 1 ? 'page' : 'pages'}, ${b.articles} ${b.articles === 1 ? 'article' : 'articles'})`));
      const rm = el('button', 'link-btn', 'Remove');
      rm.addEventListener('click', () => { $('more-error').hidden = true; guard(() => api.guidesOwnRemove(b.id), $('more-error')); });
      li.append(rm);
      list.append(li);
    }
    guidesUi.own.replaceChildren(head, list);
  }
  guidesUi.ownLine.textContent = ownBusy ? (op ? `Converting book ${op.done + 1} of ${op.total}: ${op.title}${op.pages ? ` (page ${op.page} of ${op.pages})` : ''}` : 'Getting ready')
    : own.error ? own.error : own.books.length ? `${own.books.length} ${own.books.length === 1 ? 'book' : 'books'} added, ${guidesMb(own.bytes)}.` : 'None added yet.';
  guidesUi.ownLine.classList.toggle('bad', !ownBusy && Boolean(own.error));
  if (guidesUi.ownBar && ownFrac != null) guidesUi.ownBar.value = Math.round(ownFrac * 1000);
  return guidesUi.box;
}
