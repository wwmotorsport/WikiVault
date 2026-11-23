'use strict';
// Makes a PDF out of photographs or scans of pages (JPEG files), one picture to a page, so that a folder of page
// pictures can go through the same conversion as any other book. The pictures are put in as they are, not drawn
// again; a photograph taken with the camera turned is shown the right way up by turning its page.

/** What a JPEG says of itself: size in pixels, how many colour channels, and how far to turn it to stand upright. */
function jpegInfo(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2; let rotate = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xFF) { i += 1; continue; }
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (marker === 0xE1 && len > 16 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      // The camera's note of which way up it was held (tag 0x0112).
      const t = i + 10; const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)); const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      try {
        const dir = t + u32(t + 4); const n = u16(dir);
        for (let k = 0; k < n && dir + 2 + k * 12 + 12 <= i + 2 + len; k += 1) {
          const e = dir + 2 + k * 12;
          if (u16(e) === 0x0112) { rotate = { 3: 180, 6: 90, 8: 270 }[u16(e + 8)] || 0; break; }
        }
      } catch { rotate = 0; }
    }
    if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), components: buf[i + 9], rotate };
    }
    if (marker === 0xDA) break;
    i += 2 + len;
  }
  return null;
}

/**
 * @param {Buffer[]} jpegs  the pages, in order
 * @returns {{pdf: Buffer, pages: number, left: number}}  `left`: pictures that could not be used (not JPEG, or of a kind PDFs do not hold)
 */
function pdfFromJpegs(jpegs) {
  const objs = []; // each: Buffer of the object's body (between "n 0 obj" and "endobj")
  const add = (body) => { objs.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objs.length; };
  add(''); add(''); // 1: catalog, 2: pages, filled in at the end
  const kids = []; let left = 0;
  for (const data of jpegs) {
    const info = jpegInfo(data);
    if (!info || !info.w || !info.h || (info.components !== 1 && info.components !== 3)) { left += 1; continue; }
    // A page 8.5 inches wide (or tall, for a picture lying on its side), the picture filling it.
    const wide = 612; const tall = Math.round((612 * info.h) / info.w * 100) / 100;
    const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace /${info.components === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    const draw = `q ${wide} 0 0 ${tall} 0 0 cm /Im0 Do Q`;
    const content = add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wide} ${tall}] /Rotate ${info.rotate} /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1');
  objs[1] = Buffer.from(`<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`, 'latin1');
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = []; let at = parts[0].length;
  objs.forEach((body, i) => {
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(at); at += piece.length; parts.push(piece);
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return { pdf: Buffer.concat(parts), pages: kids.length, left };
}

/** File names in the order a person would put them: "page 2" before "page 10". */
const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

module.exports = { pdfFromJpegs, jpegInfo, byName };
