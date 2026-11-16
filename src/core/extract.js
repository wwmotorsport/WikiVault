'use strict';
// Turns an article page from the offline copy into plain-text passages that a
// small local model can read: headings become section labels, references,
// navigation boxes and tables are dropped, and long sections are split.

const { parse } = require('node-html-parser');

const DROP = [
  'script', 'style', 'noscript', 'link', 'meta', 'template', 'math', 'svg', 'audio', 'video',
  'sup.reference', '.reference', 'sup.mw-ref', '.mw-ref', '.mw-references-wrap', '.mw-editsection', '.mw-cite-backlink', '.noprint', '.navbox',
  '.vertical-navbox', '.sidebar', '.sistersitebox', '.reflist', '.references', '.refbegin',
  '.hatnote', '.metadata', '.ambox', '.mbox-small', '.mw-empty-elt', '.toc', '#toc', 'figure',
  '.thumb', '.gallery', '.shortdescription', '.mw-jump-link', '.portalbox', '.authority-control',
];

const SKIP_SECTIONS = new Set([
  'references', 'external links', 'see also', 'further reading', 'notes', 'footnotes',
  'bibliography', 'citations', 'sources', 'notes and references', 'works cited', 'explanatory notes',
]);

const HEADINGS = new Set(['h2', 'h3', 'h4']);
const BLOCKS = new Set(['p', 'li', 'dd', 'dt', 'blockquote', 'pre']);

function clean(text) {
  return String(text)
    .replace(/\[\s*(?:\d+|[a-z]|citation needed|edit|note \d+)\s*\]/gi, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function infoboxText(root, maxChars = 700) {
  const box = root.querySelector('table.infobox');
  if (!box) return '';
  const rows = [];
  for (const tr of box.querySelectorAll('tr')) {
    const th = tr.querySelector('th');
    const td = tr.querySelector('td');
    if (!th || !td) continue;
    const k = clean(th.text);
    const v = clean(td.text);
    if (k && v && k.length < 60 && v.length < 200) rows.push(`${k}: ${v}`);
  }
  let out = '';
  for (const r of rows) {
    if (out.length + r.length > maxChars) break;
    out += (out ? '; ' : '') + r;
  }
  return out;
}

/**
 * @returns {{title:string, chunks:Array<{section:string, anchor:string|null, text:string, lead:boolean}>}}
 */
function extractArticle(html, { chunkChars = 900 } = {}) {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const title = clean(root.querySelector('h1')?.text || root.querySelector('title')?.text || '');
  const body = root.querySelector('#mw-content-text') || root.querySelector('body') || root;

  const facts = infoboxText(body);
  for (const sel of DROP) for (const el of body.querySelectorAll(sel)) el.remove();
  for (const el of body.querySelectorAll('table')) el.remove();

  const sections = [{ section: '', anchor: null, blocks: [], lead: true }];
  let skipping = false;
  let h2 = '';

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      const tag = child.rawTagName ? child.rawTagName.toLowerCase() : '';
      if (tag === 'h1') continue;
      if (HEADINGS.has(tag)) {
        const name = clean(child.text);
        if (!name) continue;
        if (tag === 'h2') { h2 = name; skipping = SKIP_SECTIONS.has(name.toLowerCase()); }
        if (skipping) continue;
        const anchor = child.getAttribute('id') || child.querySelector('[id]')?.getAttribute('id') || null;
        const label = tag === 'h2' || !h2 ? name : `${h2}, ${name}`;
        sections.push({ section: label, anchor, blocks: [], lead: false });
        continue;
      }
      if (BLOCKS.has(tag)) {
        if (skipping) continue;
        const text = clean(child.text);
        if (text.length >= 20) sections[sections.length - 1].blocks.push(text);
        continue;
      }
      walk(child);
    }
  };
  walk(body);

  if (facts) sections[0].blocks.push(`Key facts: ${facts}`);

  const chunks = [];
  for (const s of sections) {
    let buf = '';
    const flush = () => {
      if (buf) chunks.push({ section: s.section, anchor: s.anchor, text: buf, lead: s.lead && !chunks.some((c) => c.lead) });
      buf = '';
    };
    for (let block of s.blocks) {
      // Very long paragraphs are cut at sentence ends so no passage dwarfs the others.
      while (block.length > chunkChars * 1.5) {
        let cut = block.lastIndexOf('. ', chunkChars);
        if (cut < chunkChars * 0.4) cut = chunkChars;
        const piece = block.slice(0, cut + 1).trim();
        block = block.slice(cut + 1).trim();
        if (buf && buf.length + piece.length > chunkChars) flush();
        buf += (buf ? ' ' : '') + piece;
        flush();
      }
      if (buf && buf.length + block.length > chunkChars) flush();
      buf += (buf ? ' ' : '') + block;
    }
    flush();
  }
  return { title, chunks };
}

module.exports = { extractArticle, clean };
