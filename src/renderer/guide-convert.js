'use strict';
// The converter of the Survival Guides. It runs in a window of its own that is never shown: it is handed one PDF at
// a time, reads each page's text and layout, draws the pages that have pictures, cuts the pictures out as image
// files, and hands every page back. It has no access to files or to the network, and nothing inside a PDF is run.
/* global pdfjsLib, WikivaultGuideLayout */

const PAGE_MS = 90000;      // a page that takes longer than this to draw is kept as text only
const MAX_SIDE = 1500;      // pixels: the widest a drawn page is made
const READ_SIDE = 2300;     // pixels: the longer side of a scanned page drawn to have its words read (about 200 dots to the inch)
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('took too long')), ms))]);
const blobOf = (canvas, type, quality) => new Promise((ok) => canvas.toBlob(ok, type, quality));

async function picture(canvas, box, scale, { whole }) {
  let src = canvas;
  if (box) {
    const x = Math.max(0, Math.floor(box[0] * scale)); const y = Math.max(0, Math.floor(box[1] * scale));
    const w = Math.min(canvas.width - x, Math.ceil((box[2] - box[0]) * scale)); const h = Math.min(canvas.height - y, Math.ceil((box[3] - box[1]) * scale));
    if (w < 8 || h < 8) return null;
    src = document.createElement('canvas'); src.width = w; src.height = h;
    src.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  }
  const blob = await blobOf(src, 'image/webp', whole ? 0.6 : 0.78);
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: src.width, h: src.height };
}

/** The PDF's own table of contents, as titles with the page each begins on (the top level only). */
async function outlineOf(doc) {
  const out = [];
  let items = null;
  try { items = await doc.getOutline(); } catch { items = null; }
  for (const it of (items || []).slice(0, 400)) {
    try {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) continue;
      const index = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : Number(dest[0]);
      if (Number.isInteger(index) && it.title) out.push({ title: String(it.title).slice(0, 160), page: index + 1 });
    } catch { /* an entry that points nowhere */ }
  }
  return out;
}

async function convertOne(job) {
  const doc = await pdfjsLib.getDocument({ data: job.data, isEvalSupported: false, enableXfa: false, stopAtErrors: false, verbosity: 0 }).promise;
  try {
    const outline = await outlineOf(doc);
    for (let n = 1; n <= doc.numPages; n += 1) {
      const out = { id: job.id, n, total: doc.numPages, images: [] };
      let page = null;
      try {
        page = await doc.getPage(n);
        const view = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = tc.items.filter((it) => it.str).map((it) => { const t = pdfjsLib.Util.transform(view.transform, it.transform); return { s: it.str, x: t[4], base: t[5], w: it.width, size: Math.hypot(t[2], t[3]) || it.height || 10 }; });
        const ops = await page.getOperatorList();
        const plan = WikivaultGuideLayout.plan({ w: view.width, h: view.height, items, marks: WikivaultGuideLayout.marks(ops.fnArray, ops.argsArray, pdfjsLib.OPS, view.transform) });
        Object.assign(out, { w: Math.round(view.width), h: Math.round(view.height), whole: plan.whole, scan: plan.scan, paras: plan.paras, figs: plan.figs, words: plan.words });
        if (plan.whole || plan.figs.length) {
          try {
            // A scanned page with no words behind it is drawn large, so that its words can be read from the picture.
            const toRead = Boolean(job.ocr) && plan.whole && plan.words < 8;
            const shown = Math.min(plan.whole ? 1.7 : 2, MAX_SIDE / Math.max(view.width, view.height));
            const scale = toRead ? Math.max(shown, Math.min(3.4, READ_SIDE / Math.max(view.width, view.height))) : shown;
            const vp = page.getViewport({ scale });
            let canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            await withTimeout(page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise, PAGE_MS);
            if (toRead) {
              const blob = await blobOf(canvas, 'image/jpeg', 0.9);
              if (blob) out.ocr = new Uint8Array(await blob.arrayBuffer());
              if (scale > shown * 1.05) { // the picture that is kept is the size it is shown at
                const small = document.createElement('canvas'); small.width = Math.ceil(view.width * shown); small.height = Math.ceil(view.height * shown);
                const sctx = small.getContext('2d', { alpha: false }); sctx.imageSmoothingQuality = 'high';
                sctx.drawImage(canvas, 0, 0, small.width, small.height);
                canvas.width = 0; canvas.height = 0; canvas = small;
              }
            }
            const name = `p${String(n).padStart(4, '0')}`;
            if (plan.whole) {
              const img = await picture(canvas, null, shown, { whole: true });
              if (img) { out.img = { name: `${name}.webp`, w: img.w, h: img.h }; out.images.push({ name: out.img.name, bytes: img.bytes }); }
            } else {
              for (const [i, f] of plan.figs.entries()) {
                const img = await picture(canvas, f.box, scale, { whole: false });
                if (img) { f.img = { name: `${name}-${i + 1}.webp`, w: img.w, h: img.h }; out.images.push({ name: f.img.name, bytes: img.bytes }); }
              }
            }
            canvas.width = 0; canvas.height = 0;
          } catch (err) { out.note = `page ${n} could not be drawn (${err.message}); its text is kept`; }
        }
      } catch (err) {
        Object.assign(out, { w: 612, h: 792, whole: false, scan: false, paras: [], figs: [], words: 0, note: `page ${n} could not be read (${err.message})` });
      } finally { try { if (page) page.cleanup(); } catch { /* nothing to clean */ } }
      const reply = await window.convert.page(out);
      if (reply && reply.stop) return { id: job.id, stopped: true };
    }
    let title = '';
    try { const md = await doc.getMetadata(); title = String((md && md.info && md.info.Title) || '').slice(0, 200); } catch { title = ''; }
    return { id: job.id, pages: doc.numPages, outline, title };
  } finally { try { await doc.destroy(); } catch { /* already gone */ } }
}

(async () => {
  for (;;) {
    const job = await window.convert.next();
    if (!job) break;
    let result;
    try { result = await convertOne(job); } catch (err) { result = { id: job.id, error: String(err && err.message ? err.message : err).slice(0, 300) }; }
    await window.convert.done(result);
  }
})();
