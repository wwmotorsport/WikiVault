'use strict';
// The pages of the Survival Guides library, as HTML: an article, a guide's contents, and the library's first page.
// Navigation and notices carry the class "noprint" (or "toc"), which is what the passage reader for Ask leaves out.

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const seg = (s) => String(s).split('/').map(encodeURIComponent).join('/');

const CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #f6f4ee; color: #1c2430; font: 17px/1.6 Georgia, "Times New Roman", serif; }
main { max-width: 46em; margin: 0 auto; padding: 18px 22px 60px; background: #fff; min-height: 100vh; box-shadow: 0 0 0 1px #e4e0d6; }
nav.crumbs, .pager, .notice, .src, nav.toc, .pg, summary, .meta, .cards { font-family: "Segoe UI", system-ui, sans-serif; }
nav.crumbs { font-size: 13.5px; color: #5c6773; margin-bottom: 10px; }
a { color: #0b57a4; } a:visited { color: #5b3f9c; }
h1 { font-size: 1.75em; line-height: 1.2; margin: .2em 0 .15em; }
h2 { font-size: 1.32em; line-height: 1.25; margin: 1.5em 0 .4em; padding-bottom: .15em; border-bottom: 1px solid #d9d4c7; }
h3 { font-size: 1.08em; margin: 1.3em 0 .3em; }
p { margin: .55em 0; } ul { margin: .4em 0 .6em; padding-left: 1.3em; } li { margin: .25em 0; }
.meta { font-size: 14px; color: #5c6773; margin: 0 0 1em; }
.notice { font-size: 14px; background: #fff6da; border: 1px solid #e3c96a; border-radius: 6px; padding: 8px 12px; margin: 12px 0; }
figure { margin: 1.1em 0; text-align: center; }
figure img { max-width: 100%; height: auto; border: 1px solid #ddd8cb; background: #fff; }
figure.whole img { box-shadow: 0 1px 5px rgba(0,0,0,.18); }
details.words { font-size: 15px; color: #39424e; margin: -.4em 0 1.4em; } summary { cursor: pointer; font-size: 13.5px; color: #5c6773; }
.pg { float: right; clear: right; margin: .1em 0 .2em 1em; font-size: 12px; } .pg a { color: #7a8591; text-decoration: none; } .pg a:hover { text-decoration: underline; }
nav.toc { font-size: 15px; background: #f3f5f7; border: 1px solid #d8dee4; border-radius: 6px; padding: 10px 14px; margin: 14px 0; }
nav.toc b { display: block; margin-bottom: 4px; } nav.toc ol { margin: 0; padding-left: 1.6em; columns: 2 16em; } nav.toc .here { font-weight: 600; }
.pager { display: flex; justify-content: space-between; gap: 12px; font-size: 14.5px; margin: 26px 0 0; padding-top: 12px; border-top: 1px solid #d9d4c7; }
.src { font-size: 13.5px; color: #5c6773; margin-top: 18px; }
.cards { list-style: none; padding: 0; margin: 10px 0 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(17em, 1fr)); gap: 10px; }
.cards li { margin: 0; border: 1px solid #d8dee4; border-radius: 6px; padding: 10px 12px; background: #fbfcfd; font-size: 15px; }
.cards a { font-weight: 600; text-decoration: none; } .cards a:hover { text-decoration: underline; } .cards span { display: block; color: #5c6773; font-size: 13.5px; margin-top: 2px; }
@media (max-width: 640px) { main { padding: 12px 14px 40px; } body { font-size: 16px; } }
`;

const page = (title, body) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`;

const NOTICE = 'These are reference guides, not professional advice. Medical guidance in particular changes over time and does not replace a trained person: in an emergency, get help if any can be had.';

/** The title an article goes by in search and in Ask. */
const articleTitle = (guide, section) => (section.title && guide.sections.length > 1 ? `${guide.title}: ${section.title}` : guide.title);

/**
 * One article.
 * @param {string} base  the library's address, e.g. http://127.0.0.1:1234/content/guides
 */
function article({ base, col, guide, n, section }) {
  const here = `${base}/${seg(col.id)}/${seg(guide.id)}`;
  const out = [];
  out.push(`<nav class="crumbs noprint"><a href="${base}/">Survival Guides</a> › <a href="${base}/#${esc(col.id)}">${esc(col.name)}</a>${guide.sections.length > 1 ? ` › <a href="${here}/">${esc(guide.title)}</a>` : ''}</nav>`);
  out.push(`<h1>${esc(articleTitle(guide, section))}</h1>`);
  const by = [guide.author && `By ${guide.author}`, guide.sections.length > 1 ? `pages ${section.from} to ${section.to} of ${guide.pages}` : `${guide.pages} ${guide.pages === 1 ? 'page' : 'pages'}`].filter(Boolean).join(' · ');
  out.push(`<p class="meta noprint">${esc(by)}</p>`);
  if (col.caution) out.push(`<p class="notice noprint">${esc(NOTICE)}</p>`);
  let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const b of section.blocks) {
    if (b.t === 'li') { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${esc(b.x.replace(/^(?:[•●▪■◦○∙·▶►➢➤✓✔❖\-–—*]|o(?=\s))\s*/, ''))}</li>`); continue; }
    close();
    if (b.t === 'pb') out.push(`<span class="pg noprint" id="p${b.page}"><a href="${here}/original.pdf#page=${b.page}" title="Open the original at this page">page ${b.page}</a></span>`);
    else if (b.t === 'h') out.push(`<h${b.l}>${esc(b.x)}</h${b.l}>`);
    else if (b.t === 'p') out.push(`<p>${esc(b.x)}</p>`);
    else if (b.t === 'fig') {
      out.push(`<figure><a href="${here}/i/${seg(b.src)}"><img loading="lazy" src="${here}/i/${seg(b.src)}" width="${b.w}" height="${b.h}" alt="${esc((b.x || `Picture from page ${b.page}`).slice(0, 200))}"></a></figure>`);
      if (b.x && b.x.split(/\s+/).length >= 4) out.push(`<p class="words" hidden>${esc(b.x)}</p>`);
    } else if (b.t === 'page') {
      out.push(`<figure class="whole"><a href="${here}/i/${seg(b.src)}"><img loading="lazy" src="${here}/i/${seg(b.src)}" width="${b.w}" height="${b.h}" alt="Page ${b.page}"></a></figure>`);
      if (b.x) out.push(`<details class="words"><summary>The words on page ${b.page}, as read from the scan</summary>${b.x.split('\n').map((t) => `<p>${esc(t)}</p>`).join('')}</details>`);
    }
  }
  close();
  const prev = n > 1 ? guide.sections[n - 2] : null; const next = n < guide.sections.length ? guide.sections[n] : null;
  if (prev || next) out.push(`<div class="pager noprint"><span>${prev ? `← <a href="${here}/${n - 1}">${esc(prev.title || `Pages ${prev.from} to ${prev.to}`)}</a>` : ''}</span><span>${next ? `<a href="${here}/${n + 1}">${esc(next.title || `Pages ${next.from} to ${next.to}`)}</a> →` : ''}</span></div>`);
  out.push(`<p class="src noprint">From the collection “${esc(col.name)}”, gathered by the Kiwix project. <a href="${here}/original.pdf#page=${section.from}">Open the original document</a> to see these pages exactly as they were printed.</p>`);
  return page(articleTitle(guide, section), out.join('\n'));
}

/** The contents of a guide that has more than one article. */
function contents({ base, col, guide }) {
  const here = `${base}/${seg(col.id)}/${seg(guide.id)}`;
  const out = [`<nav class="crumbs noprint"><a href="${base}/">Survival Guides</a> › <a href="${base}/#${esc(col.id)}">${esc(col.name)}</a></nav>`, `<h1>${esc(guide.title)}</h1>`];
  out.push(`<p class="meta">${esc([guide.author && `By ${guide.author}`, `${guide.pages} pages`].filter(Boolean).join(' · '))}</p>`);
  if (guide.about) out.push(`<p>${esc(guide.about)}</p>`);
  if (col.caution) out.push(`<p class="notice noprint">${esc(NOTICE)}</p>`);
  out.push(`<nav class="toc"><b>Contents</b><ol>${guide.sections.map((s, i) => `<li><a href="${here}/${i + 1}">${esc(s.title || `Pages ${s.from} to ${s.to}`)}</a></li>`).join('')}</ol></nav>`);
  out.push(`<p class="src noprint"><a href="${here}/original.pdf">Open the original document</a></p>`);
  return page(guide.title, out.join('\n'));
}

/** The library's first page: every collection and the guides in it. */
function home({ base, cols }) {
  const out = ['<h1>Survival Guides</h1>', '<p>Practical guides to keep on hand: finding and treating water, first aid and medicine, food, knots and what to do after a disaster. Search them from the box at the top, or ask a question with Ask.</p>', `<p class="notice noprint">${esc(NOTICE)}</p>`];
  if (!cols.length) out.push('<p>No collections are here yet. Add them under Options and Setup, More libraries.</p>');
  for (const col of cols) {
    out.push(`<h2 id="${esc(col.id)}">${esc(col.name)}</h2>`);
    if (col.about) out.push(`<p>${esc(col.about)}</p>`);
    out.push(`<ul class="cards">${col.guides.map((g) => `<li><a href="${base}/${seg(col.id)}/${seg(g.id)}/">${esc(g.title)}</a><span>${esc([g.about, g.author, `${g.pages} ${g.pages === 1 ? 'page' : 'pages'}`].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>`);
  }
  return page('Survival Guides', out.join('\n'));
}

module.exports = { article, contents, home, articleTitle, esc, NOTICE };
