// Reading a book (PDF or text file) in the browser and cutting it into sequences.
// A book is a flat list of sentences: { p: page where it starts, q: paragraph number, t: text }.
// Sequences are always cut at sentence ends, never in the middle of one.
import { SIZES } from './format.js';

const ENDS = /[.!?…:"'“”»«)\]]$/;

// Lines (with page and position) -> paragraphs: [{ t, marks: [[charOffset, page], ...] }]
// A paragraph ends at a line that stops clearly before the right margin and ends with
// punctuation, before an indented or centred line, at a larger gap, or when a page ends on a short line.
export function linesToParas(lines, left, right) {
  const width = Math.max(1, right - left);
  const paras = [];
  let cur = null;
  const push = () => { if (cur && cur.t.trim()) paras.push(cur); cur = null; };
  let prev = null;
  for (const l of lines) {
    const text = l.text.trim();
    if (!text) continue;
    const indented = l.x0 - left > width * 0.04;
    const newPage = prev && prev.page !== l.page;
    const bigGap = prev && !newPage && l.gap > 0 && Math.abs(prev.y - l.y) > l.gap * 1.6;
    const prevShort = prev && (prev.x1 - left) < width * 0.86;
    if (cur && (indented || bigGap || (newPage && prevShort) || (prev && prev.indented && !indented))) push();
    if (!cur) cur = { t: '', marks: [] };
    if (cur.t.endsWith('-') && /^[a-zäöüß]/.test(text)) cur.t = cur.t.slice(0, -1);
    else if (cur.t) cur.t += ' ';
    cur.marks.push([cur.t.length, l.page]);
    cur.t += text;
    const short = (l.x1 - left) < width * 0.86;
    if (short && ENDS.test(text)) push();
    prev = { ...l, indented };
  }
  push();
  return paras;
}

const SPLIT = /(?<=[.!?…]["“”»«'’)]*)\s+(?=["„“«»'‚(]*[A-ZÄÖÜ0-9])/;
export function parasToSents(paras) {
  const sents = [];
  paras.forEach((para, q) => {
    let pos = 0;
    for (const piece of para.t.split(SPLIT)) {
      const t = piece.trim();
      const at = para.t.indexOf(piece, pos); pos = at + piece.length;
      if (!t) continue;
      let p = para.marks[0][1];
      for (const [off, page] of para.marks) { if (off <= at) p = page; else break; }
      sents.push({ p, q, t });
    }
  });
  return sents;
}

export function textToBook(text) {
  const norm = text.replace(/\r/g, '');
  let chunks = norm.split(/\n\s*\n+/);
  if (chunks.length < 5) chunks = norm.split(/\n+/);
  // A text file has no pages, so about 1800 characters count as one page.
  const paras = []; let page = 1, used = 0;
  for (const c of chunks) {
    const t = c.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (used > 0 && used + t.length > 1800) { page++; used = 0; }
    paras.push({ t, marks: [[0, page]] }); used += t.length;
  }
  return { pageCount: page, sents: parasToSents(paras) };
}

export async function pdfToBook(file, onProgress) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const all = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines = rows.map(r => {
      r.parts.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const p of r.parts) {
        if (end !== null && p.x - end > 1.2 && !text.endsWith(' ') && !p.s.startsWith(' ')) text += ' ';
        text += p.s; end = p.x + p.w;
      }
      return { page: n, y: r.y, x0: r.parts[0].x, x1: end ?? r.parts[0].x, text: text.replace(/\s+/g, ' ') };
    }).filter(l => l.text.trim());
    const gaps = []; for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i].y - lines[i - 1].y));
    gaps.sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    lines.forEach(l => { l.gap = gap; });
    all.push(...lines);
    page.cleanup();
    if (onProgress && n % 10 === 0) onProgress(n, doc.numPages);
  }
  // The text column of the whole book: where most lines start and where the long ones end.
  const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };
  const left = pct(all.map(l => l.x0), 0.1), right = pct(all.map(l => l.x1), 0.92);
  let meta = {};
  try { meta = (await doc.getMetadata()).info || {}; } catch { /* no metadata */ }
  return { pageCount: doc.numPages, sents: parasToSents(linesToParas(all, left, right)), title: meta.Title || '', author: meta.Author || '' };
}

export async function fileToBook(file, onProgress) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfToBook(file, onProgress);
  return textToBook(await file.text());
}

const words = t => t.split(/\s+/).filter(Boolean);
const firstWords = (t, n = 6) => words(t).slice(0, n).join(' ');
const lastWords = (t, n = 6) => words(t).slice(-n).join(' ');
const chars = (S, a, b) => { let n = 0; for (let i = a; i <= b; i++) n += S[i].t.length; return n; };

// Cut the next `count` sequences, starting at the journey's cursor.
// Returns ranges: { ref, pages:[a,b], first, last, text, next:{i,page} }.
export function cut(book, cursor, size, count) {
  const out = [];
  const pagesPer = SIZES[size]?.pages || 0;
  const S = book?.sents;
  if (!S?.length) {
    // No book text in this browser: we can only count pages.
    let page = cursor.page || 1;
    const per = pagesPer || 1;
    for (let k = 0; k < count; k++) {
      const b = page + per - 1;
      out.push({ ref: `p${page}-p${b}`, pages: [page, b], next: { page: b + 1 } });
      page = b + 1;
    }
    return out;
  }
  let i = Math.max(0, cursor.i || 0);
  if (!cursor.i && cursor.page > 1) { const k = S.findIndex(x => x.p >= cursor.page); i = k < 0 ? S.length : k; }
  for (let k = 0; k < count && i < S.length; k++) {
    const start = i;
    let end = i;
    if (pagesPer) {
      // Every sentence that begins on these pages. Nearly empty pages (a title) are taken along.
      let lastPage = S[start].p + pagesPer - 1;
      const run = () => { end = start; while (end + 1 < S.length && S[end + 1].p <= lastPage) end++; };
      run();
      let tries = 0;
      while (chars(S, start, end) < 220 * Math.min(pagesPer, 2) && end + 1 < S.length && tries++ < 4) { lastPage++; run(); }
    } else {
      // Three paragraphs, or four if they are short. Very long ones are cut short at about 1500 characters.
      let paras = 1;
      while (end + 1 < S.length) {
        const nextNew = S[end + 1].q !== S[end].q;
        const len = chars(S, start, end);
        if (nextNew && (paras >= 4 || (paras >= 3 && len >= 400) || len >= 1500)) break;
        if (!nextNew && len >= 1800) break;
        if (nextNew) paras++;
        end++;
      }
    }
    let text = '';
    for (let n = start; n <= end; n++) text += (n > start ? (S[n].q !== S[n - 1].q ? '\n' : ' ') : '') + S[n].t;
    out.push({
      ref: `${start}-${end}`,
      pages: [S[start].p, S[end].p],
      first: firstWords(S[start].t),
      last: lastWords(S[end].t),
      text,
      next: { i: end + 1, page: end + 1 < S.length ? S[end + 1].p : book.pageCount + 1 },
    });
    i = end + 1;
  }
  return out;
}

// Where the cursor should stand after a sequence with this ref was imported.
export function cursorAfter(ref, pages, book) {
  const S = book?.sents;
  let m;
  if ((m = String(ref).match(/^(\d+)-(\d+)$/))) {
    const i = +m[2] + 1;
    return { i, page: S?.[i]?.p || (pages ? pages[1] + 1 : 1) };
  }
  const last = pages ? pages[1] : ((m = String(ref).match(/p(\d+)$/)) ? +m[1] : 0);
  if (!last) return null;
  const c = { page: last + 1 };
  if (S?.length) { const k = S.findIndex(x => x.p > last); c.i = k < 0 ? S.length : k; }
  return c;
}

// Chapter headings found in the book itself, for the contents list. No AI needed.
const HEADING = /^(?:(?:\S+\s+){0,2}(?:KAPITEL|CHAPTER|CHAPITRE|CAP[IÍ]TULO|CAPITOLO)\b|(?:KAPITEL|CHAPTER|CHAPITRE|CAP[IÍ]TULO|CAPITOLO)\s+\S+)\s*[:.]?\s*$/i;
const tidy = t => (t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : t).replace(/\s*[:.]\s*$/, '');
export function findChapters(book) {
  const S = book?.sents || [];
  const out = [];
  for (let i = 0; i < S.length; i++) {
    const t = S[i].t.trim();
    if (t.length > 60 || !HEADING.test(t)) continue;
    // The line after "Erstes Kapitel:" is usually the chapter's name.
    const next = S[i + 1];
    const named = next && next.q !== S[i].q && next.t.length < 90 && next.p <= S[i].p + 1 && (!S[i + 2] || S[i + 2].q !== next.q);
    out.push({ page: S[i].p, i, title: tidy(t) + (named ? ': ' + next.t.trim() : '') });
  }
  return out;
}
