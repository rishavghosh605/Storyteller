// Books, the workshop (set once, texts, pictures), images and settings.
import * as store from './store.js';
import * as voice from './voice.js';
import { fileToBook, cut, cursorAfter, findChapters } from './book.js';
import { parseBatch, textRequest, pictureRequest, claudeInstruction, chatgptInstruction, SIZES, SWITCH, slug, INSTRUCTIONS_UPDATED, stamp, ago } from './format.js';
import { localAIAvailable } from './tea.js';
import { earsSupported } from './ears.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ctx = null;
let tab = 'books';
let pic = { n: 0, pending: null, pendingURL: '' };
let pendingBook = null;
let shownTab = '';
let openFold = '';
const GROUPS = {
  journey: [['contents', 'Contents'], ['books', 'My books']],
  workshop: [['texts', 'New pages'], ['pictures', 'Make pictures'], ['images', 'Saved pictures'], ['once', 'Set once']],
  settings: [['settings', 'Settings']],
};
const lastIn = {};

export const sheetOpen = () => !$('#sheet').hidden;
export function closeSheet() { $('#sheet').hidden = true; }
export function openSheet(t, opts) {
  tab = t || tab;
  if (opts?.n) pic.n = opts.n;
  ctx.story.pause();
  shownTab = '';
  $('#sheet').hidden = false;
  render();
}
export function initPanels(c) {
  ctx = c;
  // Three groups on top; the pages of a group underneath. A group remembers its last page.
  $('#tabs').onclick = e => { const b = e.target.closest('[data-group]'); if (b) { tab = lastIn[b.dataset.group] || GROUPS[b.dataset.group][0][0]; render(); } };
  $('#subtabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
  $('#sheet-close').onclick = closeSheet;
  $('#sheet').addEventListener('mousedown', e => { if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('paste', e => {
    if (!sheetOpen() || tab !== 'pictures') return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); setPending(f); }
  });
}

const journey = () => ctx.story.journey;
const bookOf = id => store.getJSON(`local/${id}/book.json`);
const storageName = () => ({ browser: 'this browser only', github: 'your GitHub repository', folder: 'your folder' }[store.settings().backend]);

async function render() {
  const group = Object.keys(GROUPS).find(g => GROUPS[g].some(([t]) => t === tab)) || 'journey';
  lastIn[group] = tab;
  document.querySelectorAll('#tabs [data-group]').forEach(b => b.classList.toggle('on', b.dataset.group === group));
  $('#subtabs').innerHTML = GROUPS[group].length > 1 ? GROUPS[group].map(([t, name]) => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${name}</button>`).join('') : '';
  const el = $('#sheet-body');
  const fn = { contents: renderContents, books: renderBooks, once: renderOnce, texts: renderTexts, pictures: renderPictures, images: renderImages, settings: renderSettings }[tab];
  // Stay where you are when the same tab redraws (next prompt, a saved picture). Start at the top on a new tab.
  const keep = tab === shownTab ? el.scrollTop : 0;
  await fn(el);
  el.scrollTop = keep; shownTab = tab;
  ctx.paintIcons(el);
}
const needJourney = el => { el.innerHTML = '<h2>No book yet</h2><p>Choose or add a book first, under <b>My journey, My books</b>.</p>'; };

// ---------- shared: importing a file from Claude ----------
async function importBatch(parsed, raw) {
  const j = journey();
  const book = await bookOf(j.id);
  let cursor = j.cursor || { page: 1, i: 0 };
  for (const s of parsed.sequences) {
    const old = (await store.getJSON(store.jpath(j.id, `seq/${store.pad(s.n)}.json`))) || {};
    await store.saveSequence(j.id, { ...old, ...s });
    const c = cursorAfter(s.ref, s.pages, book);
    if (c && (c.page || 0) >= (cursor.page || 0)) cursor = { ...cursor, ...c };
  }
  for (const p of parsed.pictures) {
    const old = (await store.getJSON(store.jpath(j.id, `seq/${store.pad(p.n)}.json`))) || { n: p.n, de: [], en: [] };
    await store.saveSequence(j.id, { ...old, prompt: p.prompt, labels: p.labels, layout: p.layout });
  }
  j.cursor = cursor;
  if (parsed.sequences.length) j.lastTextsAt = Date.now();
  await store.saveJourney(j);
  const ns = [...parsed.sequences, ...parsed.pictures].map(x => x.n);
  const kind = parsed.sequences.length ? 'texts' : 'pictures';
  const stamp = new Date().toISOString().slice(0, 10);
  await store.put(store.jpath(j.id, `batches/${stamp}-${kind}-${store.pad(Math.min(...ns))}-${store.pad(Math.max(...ns))}.md`), raw);
  await ctx.refresh();
  if (store.settings().backend !== 'browser') store.sync().catch(e => ctx.toast('Saved in this browser, but not yet in ' + storageName() + ': ' + e.message, 7000));
}

function uploader(box, want, onSaved) {
  box.innerHTML = `
    <div class="drop" data-drop>Drop Claude's file here, or
      <label class="btn"><input type="file" accept=".md,.txt,.markdown,text/*" hidden>Choose file</label>
      <button class="btn" data-paste>Paste from clipboard</button>
    </div>
    <details><summary>Or paste Claude's answer as text</summary><textarea class="copybox" data-text placeholder="=== GRANDMA BATCH === …"></textarea><div class="row"><button class="btn" data-read>Read this text</button></div></details>
    <div data-result></div>`;
  const out = box.querySelector('[data-result]');
  const take = text => {
    const parsed = parseBatch(text);
    const j = journey();
    const seqN = parsed.sequences.map(s => s.n), picN = parsed.pictures.map(p => p.n);
    const span = a => a.length ? (a.length === 1 ? `${a[0]}` : `${Math.min(...a)} to ${Math.max(...a)}`) : '';
    const warns = [...parsed.warnings];
    if (parsed.journey && parsed.journey !== j.id) warns.unshift(`This file was made for the journey "${parsed.journey}", but you are in "${j.id}".`);
    if (want === 'texts' && !seqN.length && picN.length) warns.unshift('This file contains picture prompts, not texts. That is fine, they will be saved as prompts.');
    if (want === 'pictures' && seqN.length && !picN.length) warns.unshift('This is the texts file. It holds the story only, no picture prompts. For pictures, copy the request above, paste it into Claude, and bring the file it gives you.');
    const any = seqN.length + picN.length > 0;
    out.innerHTML = `
      ${any ? `<div class="note ok">Found ${seqN.length ? `<b>${seqN.length} ${seqN.length === 1 ? 'sequence' : 'sequences'}</b> (${span(seqN)})` : ''}${seqN.length && picN.length ? ' and ' : ''}${picN.length ? `<b>${picN.length} picture ${picN.length === 1 ? 'prompt' : 'prompts'}</b> (${span(picN)})` : ''}.</div>` : ''}
      ${warns.map(w => `<div class="note warn">${esc(w)}</div>`).join('')}
      ${parsed.sequences.length ? `<details><summary>Look inside</summary>${parsed.sequences.map(s => `<p><b>${s.n}. ${esc(s.title.de)} · ${esc(s.title.en)}</b><br><span class="hint">${s.de.filter(Boolean).length} German lines, ${s.en.filter(Boolean).length} English lines, ${s.nouns.length} nouns, ${Object.keys(s.words).length} word meanings</span></p>`).join('')}</details>` : ''}
      ${any ? `<div class="row"><button class="btn primary" data-save>Save to my journey</button><span class="hint">Goes to ${esc(storageName())}.</span></div>` : ''}`;
    const save = out.querySelector('[data-save]');
    if (save) save.onclick = async () => {
      save.disabled = true; save.textContent = 'Saving…';
      try { await importBatch(parsed, text); ctx.toast(parsed.sequences.length && !parsed.pictures.length ? 'Saved. Grandma has new pages. Pictures are a separate step.' : 'Saved.'); onSaved && onSaved(parsed); }
      catch (e) { out.insertAdjacentHTML('beforeend', `<div class="note warn">${esc(e.message)}</div>`); save.disabled = false; save.textContent = 'Save to my journey'; }
    };
  };
  const file = box.querySelector('input[type=file]');
  file.onchange = async () => { if (file.files[0]) take(await file.files[0].text()); file.value = ''; };
  const drop = box.querySelector('[data-drop]');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) take(await f.text()); };
  box.querySelector('[data-paste]').onclick = async () => {
    try { take(await navigator.clipboard.readText()); } catch { ctx.toast('The browser did not allow reading the clipboard. Open "paste as text" below.'); }
  };
  box.querySelector('[data-read]').onclick = () => take(box.querySelector('[data-text]').value);
}

// ---------- Contents ----------
// Every part of the journey, grouped by the book's chapters. The descriptions are the
// recaps that came with the texts, shown only for parts that were already told.
async function renderContents(el) {
  const j = journey();
  if (!j) return needJourney(el);
  const seqs = ctx.story.seqs;
  if (!seqs.length) { el.innerHTML = `<h2>Contents of “${esc(j.title)}”</h2><p>No parts yet. Bring the first pages under <b>Workshop, New pages</b>.</p>`; return; }
  if (!j.chapters || j.chaptersV !== 2) {
    const book = await bookOf(j.id);
    if (book) { j.chapters = findChapters(book); j.chaptersV = 2; await store.saveJourney(j); }
  }
  const chapters = j.chapters || [];
  const p = ctx.story.p;
  const curIdx = ctx.story.index(p.seq);
  const chapterOf = q => { let c = -1; chapters.forEach((ch, k) => { if (q.pages && ch.page <= q.pages[0]) c = k; }); return c; };
  let html = '', last = null;
  for (const q of seqs) {
    const k = chapters.length ? chapterOf(q) : null;
    if (chapters.length && k !== last) { html += `<h3>${esc(k < 0 ? 'Before the first chapter' : chapters[k].title)}</h3>`; last = k; }
    const i = ctx.story.index(q.n);
    const state = curIdx < 0 || i < curIdx ? 'told' : i === curIdx ? 'now' : 'later';
    const img = await ctx.imageURL(await store.imagePath(j.id, q.n));
    const pages = q.pages ? (q.pages[0] === q.pages[1] ? `p. ${q.pages[0]}` : `pp. ${q.pages[0]} to ${q.pages[1]}`) : '';
    html += `<button class="toc-row ${state}" data-n="${q.n}" title="Hear this part">
      ${img ? `<img class="toc-thumb" src="${img}" alt="">` : '<span class="toc-thumb" data-icon="pencil"></span>'}
      <span><span class="toc-t">${q.n}. ${esc(q.title?.en || 'Part ' + q.n)}<small>${esc(q.title?.de || '')}</small></span>
        ${state !== 'later' && q.recap ? `<span class="toc-d">${esc(q.recap)}</span>` : ''}</span>
      <span class="toc-s">${state === 'now' ? '▶ you are here' : state === 'told' ? '✓ told' : 'not told yet'}${pages ? ' · ' + pages : ''}</span>
    </button>`;
  }
  el.innerHTML = `<h2>Contents of “${esc(j.title)}”</h2>
    <p class="hint">Tap a part to hear it. What a part is about appears once Grandma has told it, so nothing is given away.${chapters.length ? '' : ' Attach the book file under My books to see the chapters here.'}</p>
    <div class="toc">${html}</div>`;
  el.querySelectorAll('.toc-row').forEach(b => { b.onclick = () => ctx.goPart(+b.dataset.n); });
  if (shownTab !== 'contents') requestAnimationFrame(() => el.querySelector('.toc-row.now')?.scrollIntoView({ block: 'center' }));
}

// ---------- Books ----------
async function renderBooks(el) {
  const js = await store.journeys();
  const cur = journey()?.id;
  const cards = [], spines = [];
  for (const j of js) {
    const seqs = (await store.sequences(j.id)).filter(s => s.de?.length && s.en?.length);
    const p = await store.progress(j.id);
    const told = seqs.filter(s => s.n < p.seq).length;
    const hasBook = !!(await store.getRec(`local/${j.id}/book.json`));
    const upTo = Math.max(0, (j.cursor?.page || 1) - 1);
    let added = j.lastTextsAt ? ago(j.lastTextsAt) : '';
    if (!added) {
      // Older journeys: take the date from the newest saved batch file.
      const day = (await store.list(store.jpath(j.id, 'batches/'))).filter(x => /-texts-/.test(x)).map(x => x.split('/').pop().slice(0, 10)).sort().pop();
      if (day) { const d = Math.round((Date.now() - new Date(day + 'T12:00:00').getTime()) / 86400000); added = d <= 0 ? 'today' : d === 1 ? 'yesterday' : ago(Date.now() - d * 86400000); }
    }
    spines.push({ id: j.id, title: j.title, part: seqs.length ? told / seqs.length : 0, book: j.pages ? Math.min(1, upTo / j.pages) : 0, current: j.id === cur });
    cards.push(`<div class="bookcard ${j.id === cur ? 'current' : ''}" data-id="${esc(j.id)}">
      <h3>${esc(j.title)}</h3>
      <div class="meta">${j.author ? esc(j.author) + ' · ' : ''}${told} of ${seqs.length} parts told · pages prepared: ${upTo}${j.pages ? ' of ' + j.pages : ''}</div>
      <div class="bar"><i style="width:${j.pages ? Math.min(100, upTo / j.pages * 100) : 0}%"></i></div>
      ${added ? `<div class="meta">Last pages added ${added}</div>` : ''}
      <div class="row"><label>Sequence size <select data-size>${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${j.size === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
      <div class="row"><label>Begins in <select data-start><option value="">ask me</option><option value="de" ${j.startLang === 'de' ? 'selected' : ''}>German first</option><option value="en" ${j.startLang === 'en' ? 'selected' : ''}>English first</option></select></label></div>
      ${hasBook ? '' : `<div class="note info">The book file is not in this browser. Grandma can still tell what is prepared. To prepare new pages with exact borders, attach it: <label class="btn"><input type="file" accept=".pdf,.txt,application/pdf,text/plain" hidden data-attach>Attach book file</label></div>`}
      <div class="row">${j.id === cur ? '<span class="pill ok">open now</span>' : '<button class="btn primary" data-open>Open this journey</button>'}<span class="spacer"></span><button class="btn danger" data-remove>Remove</button></div>
    </div>`);
  }
  el.innerHTML = `<h2>My books</h2><p class="hint">Every book is a journey. Grandma remembers your place in each one.</p>
    ${spines.length ? `<div class="shelf">${spines.map((b, k) => {
      const hue = [322, 18, 200, 150, 262, 40][[...b.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 6];
      return `<button class="spine ${b.current ? 'current' : ''}" data-spine="${esc(b.id)}" title="${esc(b.title)}: open this journey" style="--hue:${hue}; height:${150 + (k * 37 + b.title.length * 7) % 46}px">
        <span class="ribbon" style="height:${Math.round(14 + b.part * 70)}%" title="How far you have listened"></span>
        <span class="spine-title">${esc(b.title)}</span>
        <span class="spine-fill" style="height:${Math.round(b.book * 100)}%" title="How much of the book is prepared"></span>
      </button>`; }).join('')}<span class="shelf-end"></span></div>
    <p class="hint">The ribbon shows how far you have listened. The darker band at the foot shows how much of the book is prepared.</p>` : ''}
    <div class="books">${cards.join('') || '<p>No books yet.</p>'}</div>
    <div class="step"><h3>Add a book</h3>
      <p class="hint">Any PDF or text file. It is read here in your browser. The book itself is not uploaded anywhere; only your place, your texts and your pictures are saved.</p>
      <div class="row"><label class="btn"><input id="bk-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" hidden>Choose a PDF or text file</label><span id="bk-status" class="hint"></span></div>
      <div id="bk-form" hidden><div class="row"><label>Title <input id="bk-title" type="text" size="28"></label><label>Author <input id="bk-author" type="text" size="20"></label><button id="bk-add" class="btn primary">Start this journey</button></div></div>
    </div>
    <div class="step"><h3>Try it first</h3><p class="hint">Three short parts from the opening of Momo, retold by Grandma, with picture prompts and one example picture. Add your own Momo file afterwards to prepare more pages.</p><button id="bk-sample" class="btn">Load the Momo sample</button></div>`;

  el.querySelectorAll('[data-spine]').forEach(b => { b.onclick = async () => { await ctx.selectJourney(b.dataset.spine); render(); }; });
  el.querySelectorAll('.bookcard').forEach(card => {
    const id = card.dataset.id;
    const upd = async patch => { const j = await store.journey(id); await store.saveJourney({ ...j, ...patch }); if (id === journey()?.id) Object.assign(journey(), patch); };
    card.querySelector('[data-size]').onchange = e => upd({ size: e.target.value });
    card.querySelector('[data-start]').onchange = e => upd({ startLang: e.target.value });
    const open = card.querySelector('[data-open]'); if (open) open.onclick = async () => { await ctx.selectJourney(id); render(); };
    card.querySelector('[data-remove]').onclick = async () => {
      if (!confirm('Remove this journey with its texts, pictures and your place? This cannot be undone.')) return;
      await store.deleteJourney(id);
      if (id === journey()?.id) await ctx.selectJourney((await store.journeys())[0]?.id || '');
      render();
    };
    const att = card.querySelector('[data-attach]');
    if (att) att.onchange = async () => {
      const f = att.files[0]; if (!f) return;
      ctx.toast('Reading the book…', 60000);
      try { const b = await fileToBook(f); await store.putJSON(`local/${id}/book.json`, { pageCount: b.pageCount, sents: b.sents }); await upd({ pages: b.pageCount, chapters: findChapters(b), chaptersV: 2 }); ctx.toast('The book is attached.'); render(); }
      catch (e) { ctx.toast('Could not read this file: ' + e.message, 6000); }
    };
  });
  const file = $('#bk-file');
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    const st = $('#bk-status'); st.textContent = 'Reading the book…';
    try {
      pendingBook = await fileToBook(f, (n, t) => { st.textContent = `Reading page ${n} of ${t}…`; });
      const words = pendingBook.sents.reduce((n, p) => n + p.t.split(/\s+/).length, 0);
      st.textContent = `${pendingBook.pageCount} pages, about ${words.toLocaleString()} words.` + (words < 200 ? ' Very little text was found. If this is a scanned book, the app can only count pages.' : '');
      $('#bk-title').value = pendingBook.title || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      $('#bk-author').value = pendingBook.author || '';
      $('#bk-form').hidden = false;
    } catch (e) { st.textContent = 'Could not read this file: ' + e.message; }
  };
  $('#bk-add').onclick = async () => {
    const title = $('#bk-title').value.trim() || 'My book';
    const id = slug(title);
    const old = await store.journey(id);
    const j = old || { id, title, author: $('#bk-author').value.trim(), size: 'page1', startLang: '', created: Date.now(), cursor: { page: 1, i: 0 } };
    j.pages = pendingBook.pageCount;
    j.chapters = findChapters(pendingBook); j.chaptersV = 2;
    await store.saveJourney(j);
    await store.putJSON(`local/${id}/book.json`, { pageCount: pendingBook.pageCount, sents: pendingBook.sents });
    pendingBook = null;
    await ctx.selectJourney(id);
    ctx.toast(old ? 'The book is attached to your journey.' : 'A new journey. Now bring Grandma the first pages.');
    tab = old ? 'books' : 'once'; render();
  };
  $('#bk-sample').onclick = async () => {
    try {
      const get = async p => { const r = await fetch(p); if (!r.ok) throw new Error(p); return r; };
      const texts = await (await get('samples/momo-texts-001-003.md')).text();
      const pics = await (await get('samples/momo-pictures-001-003.md')).text();
      const svg = await (await get('samples/momo-0001.svg')).blob();
      if (!(await store.journey('momo'))) await store.saveJourney({ id: 'momo', title: 'Momo', author: 'Michael Ende', size: 'page2', startLang: '', created: Date.now(), pages: 682, cursor: { page: 1, i: 0 } });
      await ctx.selectJourney('momo');
      await importBatch(parseBatch(texts), texts);
      await importBatch(parseBatch(pics), pics);
      if (!(await store.imagePath('momo', 1))) await store.put(store.jpath('momo', 'img/0001.svg'), svg);
      await ctx.selectJourney('momo');
      ctx.toast('Momo is ready. Close this and say hello to Grandma.');
      render();
    } catch (e) { ctx.toast('Could not load the sample: ' + e.message, 6000); }
  };
}

// ---------- Set once ----------
function renderOnce(el) {
  const texts = { claude: claudeInstruction(), chatgpt: chatgptInstruction() };
  const copied = store.settings().copied || {};
  // Each instruction shows when it last changed, and whether you already copied this version on this device.
  const tags = which => {
    const mine = copied[which];
    const same = mine && mine.h === stamp(texts[which]);
    return `<span class="pill">updated ${ago(INSTRUCTIONS_UPDATED[which])}</span>` +
      (same ? `<span class="pill ok">you copied this version ${ago(mine.at)}</span>` : mine ? '<span class="pill warn">changed since you copied it: copy it again</span>' : '<span class="pill">not copied on this device yet</span>');
  };
  el.innerHTML = `<h2>Set once</h2>
    <p class="hint">Two standing instructions. You give them once, and they work for every book. If one changes later, copy it again and replace the old one.</p>
    <div class="step"><h3><span class="num">1</span>Claude: the main instruction</h3>
      <p>${tags('claude')}</p>
      <p>In Claude, make a <b>Project</b> for your book. Add the book file to the project, and paste this text as the project's instructions. From then on a short request is enough.</p>
      <textarea class="copybox tall" readonly id="in-claude"></textarea>
      <div class="row"><button class="btn primary" data-copy="claude">Copy the Claude instruction</button></div></div>
    <div class="step"><h3><span class="num">2</span>ChatGPT: the picture instruction</h3>
      <p>${tags('chatgpt')}</p>
      <p>In ChatGPT, make a <b>Project</b> (or keep one chat for this) and paste this text as its instructions, or as the first message. It keeps the style and the labels the same every week.</p>
      <textarea class="copybox tall" readonly id="in-gpt"></textarea>
      <div class="row"><button class="btn primary" data-copy="chatgpt">Copy the ChatGPT instruction</button></div></div>
    <div class="step"><h3>The two switch words</h3>
      <p>Say <b>“${SWITCH.tea}”</b> to put the book down and chat freely with Grandma. Say <b>“${SWITCH.story}”</b> to go back to the book. The round button at the bottom does the same.</p></div>`;
  $('#in-claude').value = texts.claude;
  $('#in-gpt').value = texts.chatgpt;
  el.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = async () => {
      const which = b.dataset.copy;
      await ctx.copy(texts[which], 'Copied. Paste it into the project instructions.');
      store.saveSettings({ copied: { ...(store.settings().copied || {}), [which]: { h: stamp(texts[which]), at: Date.now() } } });
      render();
    };
  });
}

// ---------- Texts ----------
const DEFAULT_COUNT = { paras: 10, page1: 15, page2: 8, page10: 2 };
async function renderTexts(el) {
  const j = journey();
  if (!j) return needJourney(el);
  const book = await bookOf(j.id);
  const seqs = await store.sequences(j.id);
  const withText = seqs.filter(s => s.de?.length);
  const firstN = (withText.length ? Math.max(...withText.map(s => s.n)) : 0) + 1;
  const p = await store.progress(j.id);
  const untold = withText.filter(s => s.n >= (p.seq || 1)).length;
  const noPic = withText.filter(s => !s.prompt).length;
  el.innerHTML = `<h2>New pages for “${esc(j.title)}”</h2>
    <p class="hint">${withText.length} parts are prepared, ${untold} of them not told yet. Pages prepared: ${Math.max(0, (j.cursor?.page || 1) - 1)}${j.pages ? ' of ' + j.pages : ''}.</p>
    ${noPic ? `<div class="note info">${noPic === 1 ? '1 part has' : noPic + ' parts have'} texts but no picture prompt yet. The texts file does not contain pictures. <button class="btn" id="tx-to-pics">Go to Make pictures</button></div>` : ''}
    <div class="step"><h3><span class="num">1</span>Ask Claude for the next pages</h3>
      <div class="row">
        <label>Sequence size <select id="tx-size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${j.size === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label>How many sequences <input id="tx-count" type="number" min="1" max="60" value="${DEFAULT_COUNT[j.size] || 10}"></label>
        <label>Start at page <input id="tx-page" type="number" min="1" value="${j.cursor?.page || 1}"></label>
      </div>
      ${book ? '<label class="check"><input type="checkbox" id="tx-include"> Put the book\'s text into the request (longer, but Claude cannot pick the wrong pages)</label>' : '<div class="note info">The book file is not in this browser, so the request can only name page numbers. Attach the file under <b>My books</b> for exact borders.</div>'}
      <p id="tx-summary"></p>
      <textarea class="copybox" readonly id="tx-request"></textarea>
      <div class="row"><button class="btn primary" id="tx-copy">Copy the request</button><span class="hint">Paste it into your Claude project. Claude answers with one file.</span></div>
    </div>
    <div class="step"><h3><span class="num">2</span>Give Claude's file to Grandma</h3><div id="tx-upload"></div></div>`;
  const build = () => {
    const size = $('#tx-size').value;
    const count = Math.max(1, +$('#tx-count').value || 1);
    const page = Math.max(1, +$('#tx-page').value || 1);
    const cursor = page === (j.cursor?.page || 1) ? (j.cursor || { page }) : { page };
    const ranges = cut(book, cursor, size, count);
    if (!ranges.length) { $('#tx-summary').innerHTML = '<span class="note ok">The whole book is prepared. Nothing is left to ask for.</span>'; $('#tx-request').value = ''; return; }
    const a = ranges[0].pages[0], b = ranges[ranges.length - 1].pages[1];
    $('#tx-summary').innerHTML = `Next: <b>${ranges.length === 1 ? 'sequence ' + firstN : `sequences ${firstN} to ${firstN + ranges.length - 1}`}</b>, ${a === b ? 'page ' + a : `pages ${a} to ${b}`}.`;
    $('#tx-request').value = textRequest({ ...j, size }, ranges, firstN, { includeText: $('#tx-include')?.checked });
  };
  $('#tx-size').onchange = async e => { j.size = e.target.value; await store.saveJourney(j); $('#tx-count').value = DEFAULT_COUNT[j.size] || 10; build(); };
  $('#tx-count').oninput = build; $('#tx-page').oninput = build;
  if ($('#tx-include')) $('#tx-include').onchange = build;
  $('#tx-copy').onclick = () => ctx.copy($('#tx-request').value, 'Copied. Paste it into Claude.');
  if ($('#tx-to-pics')) $('#tx-to-pics').onclick = () => { tab = 'pictures'; render(); };
  build();
  uploader($('#tx-upload'), 'texts', () => render());
}

// ---------- Pictures ----------
async function prepImage(blob) {
  if (/svg/.test(blob.type)) return { blob, ext: 'svg' };
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
    if (out) return { blob: out, ext: 'jpg' };
  } catch { /* keep the original */ }
  return { blob, ext: (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg') };
}
async function saveImage(id, n, blob) {
  const { blob: out, ext } = await prepImage(blob);
  for (const p of await store.list(store.jpath(id, `img/${store.pad(n)}.`))) await store.del(p);
  await store.put(store.jpath(id, `img/${store.pad(n)}.${ext}`), out);
  await ctx.refresh();
  if (store.settings().backend !== 'browser') store.sync().catch(e => ctx.toast('Saved here, but not yet in ' + storageName() + ': ' + e.message, 7000));
}
function setPending(blob) {
  if (pic.pendingURL) URL.revokeObjectURL(pic.pendingURL);
  pic.pending = blob; pic.pendingURL = blob ? URL.createObjectURL(blob) : '';
  const box = $('#pc-preview');
  if (box) { box.innerHTML = blob ? `<img src="${pic.pendingURL}" alt="The pasted picture">` : ''; $('#pc-save').disabled = !blob; }
}
async function clipboardImage() {
  const items = await navigator.clipboard.read();
  for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) return it.getType(t); }
  throw new Error('no image');
}
async function renderPictures(el) {
  const j = journey();
  if (!j) return needJourney(el);
  const seqs = await store.sequences(j.id);
  const noPrompt = seqs.filter(s => s.de?.length && !s.prompt);
  const withPrompt = seqs.filter(s => s.prompt);
  const withText = seqs.filter(s => s.de?.length);
  const hasImg = new Set();
  for (const s of withPrompt) if (await store.imagePath(j.id, s.n)) hasImg.add(s.n);
  if (!withPrompt.find(s => s.n === pic.n)) pic.n = (withPrompt.find(s => !hasImg.has(s.n)) || withPrompt[0])?.n || 0;
  const cur = withPrompt.find(s => s.n === pic.n);
  const idx = withPrompt.indexOf(cur);
  // Asking Claude for prompts is only shown when a part is waiting for one. Otherwise the page is just: copy, paste.
  const ask = noPrompt.length ? `<div class="step"><h3><span class="num">1</span>Ask Claude for picture prompts</h3>
      <p><b>${noPrompt.length === 1 ? `Part ${noPrompt[0].n} has` : `Parts ${noPrompt[0].n} to ${noPrompt[noPrompt.length - 1].n} have`} texts but no picture prompt yet.</b></p>
      <div class="row"><label>Ask for the next <input id="pc-count" type="number" min="1" max="${noPrompt.length}" value="${Math.min(6, noPrompt.length)}"> parts</label></div>
      <textarea class="copybox" readonly id="pc-request"></textarea>
      <div class="row"><button class="btn primary" id="pc-copy">Copy the request</button><span class="hint">Paste it into Claude. It answers with a text file named <b id="pc-file-name"></b>. Give that file here:</span></div>
      <div id="pc-upload"></div>
    </div>` : '';
  const k = noPrompt.length ? 1 : 0; // step numbers shift when there is nothing to ask for
  el.innerHTML = `<h2>Make pictures for “${esc(j.title)}”</h2>
    <p class="hint">${hasImg.size} of ${withPrompt.length} pictures made.</p>
    ${ask}
    ${cur ? `<div class="step"><h3><span class="num">${k + 1}</span>Copy a prompt into ChatGPT</h3>
      <div class="carousel">
        <button class="ctl small" id="pc-prev" ${idx <= 0 ? 'disabled' : ''} title="Previous prompt"><span data-icon="left"></span></button>
        <div class="mid"><p><b>Part ${cur.n}</b>: ${esc(cur.title?.en || '')} <span class="pill ${hasImg.has(cur.n) ? 'ok' : ''}">${hasImg.has(cur.n) ? 'picture saved' : 'no picture yet'}</span></p>
          <textarea class="copybox tall" readonly id="pc-prompt"></textarea></div>
        <button class="ctl small" id="pc-next" ${idx >= withPrompt.length - 1 ? 'disabled' : ''} title="Next prompt"><span data-icon="right"></span></button>
      </div>
      <div class="row"><button class="btn primary" id="pc-copy-prompt">Copy this prompt</button><span class="hint">One prompt, one picture.</span></div>
    </div>
    <div class="step"><h3><span class="num">${k + 2}</span>Paste the finished picture for part ${cur.n}</h3>
      <div class="pastebox">
        <div class="drop" id="pc-drop">Copy the picture in ChatGPT, then press <b>Ctrl+V</b> (or ⌘V) here.
          <button class="btn" id="pc-paste">Paste from clipboard</button>
          <label class="btn"><input type="file" id="pc-file" accept="image/*" hidden>Choose a file</label></div>
        <div id="pc-preview"></div>
        <div class="row"><button class="btn primary" id="pc-save" disabled>Save picture for part ${cur.n}</button></div>
      </div></div>` : ''}
    ${noPrompt.length ? '' : `<p class="hint">${cur ? 'Every part that has texts has its picture prompt.' : 'No picture prompts yet.'} New parts appear here after you add their texts under <b>New pages</b>. <button class="btn" id="pc-to-texts">Go to New pages</button></p>`}`;
  if (noPrompt.length) {
    const build = () => { const t = pictureRequest(j, noPrompt.slice(0, Math.max(1, +$('#pc-count').value || 1))); $('#pc-request').value = t; $('#pc-file-name').textContent = (t.match(/named (\S+\.md)/) || [])[1] || ''; };
    $('#pc-count').oninput = build; build();
    $('#pc-copy').onclick = () => ctx.copy($('#pc-request').value, 'Copied. Paste it into Claude.');
  }
  if ($('#pc-upload')) uploader($('#pc-upload'), 'pictures', () => render());
  if ($('#pc-to-texts')) $('#pc-to-texts').onclick = () => { tab = 'texts'; render(); };
  if (!cur) return;
  $('#pc-prompt').value = cur.prompt;
  $('#pc-copy-prompt').onclick = () => ctx.copy(cur.prompt, 'Copied. Paste it into ChatGPT.');
  const go = d => { const s = withPrompt[idx + d]; if (s) { pic.n = s.n; setPending(null); render(); } };
  $('#pc-prev').onclick = () => go(-1); $('#pc-next').onclick = () => go(1);
  $('#pc-paste').onclick = async () => { try { setPending(await clipboardImage()); } catch { ctx.toast('No picture found in the clipboard. Copy the image first, or press Ctrl+V.'); } };
  $('#pc-file').onchange = e => { if (e.target.files[0]) setPending(e.target.files[0]); };
  const drop = $('#pc-drop');
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) setPending(f); };
  if (pic.pending) setPending(pic.pending);
  $('#pc-save').onclick = async () => {
    if (!pic.pending) return;
    $('#pc-save').disabled = true;
    await saveImage(j.id, cur.n, pic.pending);
    setPending(null);
    ctx.toast(`Picture ${cur.n} is saved.`);
    const next = withPrompt.find(s => s.n > cur.n && !hasImg.has(s.n));
    if (next) pic.n = next.n;
    render();
  };
}

// ---------- Images ----------
async function renderImages(el) {
  const j = journey();
  if (!j) return needJourney(el);
  const seqs = await store.sequences(j.id);
  const paths = await store.list(store.jpath(j.id, 'img/'));
  const tiles = [];
  for (const p of paths) {
    const n = parseInt(p.split('/').pop(), 10);
    const s = seqs.find(x => x.n === n);
    tiles.push(`<div class="tile" data-n="${n}" data-path="${esc(p)}"><img src="${await ctx.imageURL(p)}" alt="Picture ${n}">
      <div class="cap"><b>${n}.</b> ${esc(s?.title?.en || '')}</div>
      <div class="row"><label class="btn"><input type="file" accept="image/*" hidden data-replace>Replace</label><button class="btn" data-paste>Paste</button><button class="btn danger" data-del>Delete</button></div></div>`);
  }
  el.innerHTML = `<h2>Saved pictures for “${esc(j.title)}”</h2><p class="hint">${paths.length} saved. To add pictures, open <b>Make pictures</b>.</p><div class="grid">${tiles.join('') || '<p>No pictures saved yet.</p>'}</div>`;
  el.querySelectorAll('.tile').forEach(t => {
    const n = +t.dataset.n;
    t.querySelector('img').onclick = () => { const lb = $('#lightbox'); lb.querySelector('img').src = t.querySelector('img').src; lb.hidden = false; };
    t.querySelector('[data-replace]').onchange = async e => { if (e.target.files[0]) { await saveImage(j.id, n, e.target.files[0]); ctx.toast(`Picture ${n} is replaced.`); render(); } };
    t.querySelector('[data-paste]').onclick = async () => { try { await saveImage(j.id, n, await clipboardImage()); ctx.toast(`Picture ${n} is replaced.`); render(); } catch { ctx.toast('No picture found in the clipboard.'); } };
    t.querySelector('[data-del]').onclick = async () => { if (!confirm(`Delete picture ${n}?`)) return; await store.del(t.dataset.path); await ctx.refresh(); render(); };
  });
}

// ---------- Settings ----------
async function renderSettings(el) {
  await voice.whenVoicesReady(800);
  const s = store.settings();
  const opts = (lang, chosen) => {
    const list = voice.rankedVoices(lang);
    if (!list.length) return '<option value="">no voice for this language on this device</option>';
    return list.map((v, i) => `<option value="${esc(v.name)}" ${v.name === (chosen || list[0].name) ? 'selected' : ''}>${i === 0 ? '★ ' : ''}${esc(v.name)} (${esc(v.lang)}${v.localService ? '' : ', online'})</option>`).join('');
  };
  const left = store.tokenDaysLeft();
  const tokenNote = left === null ? 'Optional. Enter the date GitHub showed you, and the app warns you two weeks before.' : left <= 0 ? 'This token has expired. Make a new one on GitHub and paste it above.' : `Expires in ${left} day${left === 1 ? '' : 's'}.` + (left <= 14 ? ' Make a new one on GitHub soon and paste it above.' : '');
  const short = n => (n || '').replace(/^Microsoft\s+/, '').replace(/\s+Online \(Natural\).*$/, '').replace(/\s+-\s+.*$/, '') || 'none';
  const pickName = (lang, chosen) => short((voice.pickVoice(lang, chosen) || {}).name);
  const level = ctx.sounds.level();
  const loud = v => (v <= 0 ? 'off' : v < 0.34 ? 'quiet' : v < 0.67 ? 'medium' : 'loud');
  const savedIn = { browser: 'this browser only', github: 'GitHub', folder: 'a folder on this computer' }[s.backend];
  const fold = (id, title, summary, body) => `<details class="fold" data-fold="${id}" ${openFold === id ? 'open' : ''}><summary><b>${title}</b><span>${summary}</span></summary><div class="fold-body">${body}</div></details>`;
  el.innerHTML = `<h2>Settings</h2>
    ${fold('voices', 'Voices', `${esc(pickName('en', s.voiceEn))} · ${esc(pickName('de', s.voiceDe))}`, `
      <div class="kv">
        <label>English</label><div class="row"><select id="st-en">${opts('en', s.voiceEn)}</select><button class="btn" data-test="en">Listen</button></div>
        <label>Speed</label><input id="st-rate-en" type="range" min="0.6" max="1.1" step="0.05" value="${s.rateEn}">
        <label>Depth</label><input id="st-pitch-en" type="range" min="0.6" max="1.2" step="0.05" value="${s.pitchEn}">
        <label>German</label><div class="row"><select id="st-de">${opts('de', s.voiceDe)}</select><button class="btn" data-test="de">Listen</button></div>
        <label>Speed</label><input id="st-rate-de" type="range" min="0.5" max="1.05" step="0.05" value="${s.rateDe}">
      </div>
      <details><summary>Tips for a warmer voice</summary>
        <p>The star marks my pick. Slower and a little deeper sounds more like a grandmother.</p>
        <p><b>Computer:</b> open this page in <b>Microsoft Edge</b>. Its “Online (Natural)” voices are the best free ones: Seraphina, Katja or Amala for German; Sonia, Libby or Emma for English.</p>
        <p><b>iPhone, iPad, Mac:</b> in the system settings under Accessibility, Spoken Content, Voices, download an “Enhanced” or “Premium” voice for German and English. Then reload this page.</p>
        <p><b>Android:</b> install the German voice data in the phone's text-to-speech settings.</p></details>`)}
    ${fold('room', 'The room', `sounds ${loud(level)} · picture ${s.drift ? 'moves gently' : 'stays still'}`, `
      <div class="kv">
        <label>Room sounds</label><div class="row"><input id="st-level" type="range" min="0" max="1" step="0.05" value="${level}"><span class="hint" id="st-level-word">${loud(level)}</span></div>
      </div>
      <p class="hint">A fire, a clock, a page turning, a teacup. All the way left is off.</p>
      <p><label class="check"><input type="checkbox" id="st-drift" ${s.drift ? 'checked' : ''}> The picture moves very slowly while she tells</label></p>`)}
    ${fold('talk', 'Talking with Grandma', `${s.waitForMe ? 'she waits for me' : 'she goes on by herself'} · I speak ${s.micLang.startsWith('de') ? 'German' : 'English'}`, `
      ${earsSupported ? '' : '<div class="note warn">This browser cannot listen. Use Chrome, Edge or Safari for voice. The buttons do everything too.</div>'}
      <div class="row"><label>I speak to her in <select id="st-mic"><option value="en-US" ${s.micLang === 'en-US' ? 'selected' : ''}>English (US)</option><option value="en-GB" ${s.micLang === 'en-GB' ? 'selected' : ''}>English (UK)</option><option value="en-IN" ${s.micLang === 'en-IN' ? 'selected' : ''}>English (India)</option><option value="de-DE" ${s.micLang === 'de-DE' ? 'selected' : ''}>Deutsch</option></select></label></div>
      <p><label class="check"><input type="checkbox" id="st-wait" ${s.waitForMe ? 'checked' : ''}> After each part she waits until I say “and then?”</label></p>
      <p><label class="check"><input type="checkbox" id="st-glue" ${s.glue ? 'checked' : ''}> She says small things between the two tellings</label></p>
      ${localAIAvailable() ? `<p><label class="check"><input type="checkbox" id="st-ai" ${s.localAI ? 'checked' : ''}> In the tea room, let this Chrome's built-in AI answer free questions (experimental)</label></p>` : ''}
      <details><summary>Voice commands and the switch words</summary>
        <p>“${SWITCH.tea}” opens the tea room for free chat. “${SWITCH.story}” goes back to the book.</p>
        <p>With loudspeakers the microphone also hears Grandma, so she ignores most commands while she is speaking. Headphones make voice control much more reliable.</p></details>`)}
    ${fold('saving', 'Saving', `in ${savedIn}${left !== null && left <= 14 ? ' · token expires soon' : ''}`, `
      <p><label class="check"><input type="radio" name="be" value="browser" ${s.backend === 'browser' ? 'checked' : ''}> Only in this browser</label></p>
      <p><label class="check"><input type="radio" name="be" value="github" ${s.backend === 'github' ? 'checked' : ''}> In my GitHub repository (computer and phone stay in step)</label></p>
      <div id="st-gh" ${s.backend === 'github' ? '' : 'hidden'}>
        <div class="kv">
          <label>Owner</label><input id="gh-owner" type="text" value="${esc(s.ghOwner)}" placeholder="your GitHub user name">
          <label>Repository</label><input id="gh-repo" type="text" value="${esc(s.ghRepo)}" placeholder="for example storyteller-library">
          <label>Branch</label><input id="gh-branch" type="text" value="${esc(s.ghBranch)}">
          <label>Token</label><input id="gh-token" type="password" value="${esc(s.ghToken)}" placeholder="github_pat_…" autocomplete="off">
          <label>Token expires</label><div class="row"><input id="gh-expires" type="date" value="${esc((s.ghTokenExpires || '').slice(0, 10))}"><span class="hint">${tokenNote}</span></div>
        </div>
        <details><summary>How to make a token</summary>
          <p>On GitHub, open Settings, Developer settings, and make a <b>fine-grained personal access token</b> for <b>only this one repository</b>, with the permission <b>Contents: Read and write</b>.</p>
          <p>The token stays in this browser on this device and is sent only to api.github.com. Files go to the branch named above, which the app creates. A <b>private</b> repository is best.</p></details>
      </div>
      <p><label class="check"><input type="radio" name="be" value="folder" ${s.backend === 'folder' ? 'checked' : ''} ${window.showDirectoryPicker ? '' : 'disabled'}> In a folder on this computer ${window.showDirectoryPicker ? '' : '(needs Chrome or Edge on a computer)'}</label></p>
      <div id="st-folder" ${s.backend === 'folder' ? '' : 'hidden'}><div class="row"><button class="btn" id="st-pick">Choose the folder</button><span class="hint" id="st-folder-name"></span></div><p class="hint">The browser asks for permission again each time you open the app.</p></div>
      <div class="row"><button class="btn primary" id="st-sync">Save and sync now</button><span id="st-sync-msg" class="hint"></span></div>`)}`;
  // Only one section is open at a time, and the app remembers which.
  el.querySelectorAll('.fold').forEach(d => { d.ontoggle = () => { if (d.open) { openFold = d.dataset.fold; el.querySelectorAll('.fold').forEach(o => { if (o !== d) o.open = false; }); } else if (openFold === d.dataset.fold) openFold = ''; }; });
  const save = patch => { store.saveSettings(patch); ctx.updateControls(); };
  $('#st-en').onchange = e => save({ voiceEn: e.target.value });
  $('#st-de').onchange = e => save({ voiceDe: e.target.value });
  $('#st-rate-en').oninput = e => save({ rateEn: +e.target.value });
  $('#st-pitch-en').oninput = e => save({ pitchEn: +e.target.value });
  $('#st-rate-de').oninput = e => save({ rateDe: +e.target.value });
  el.querySelectorAll('[data-test]').forEach(b => {
    b.onclick = async () => {
      const de = b.dataset.test === 'de', c = store.settings();
      const text = de ? 'Ach ja, mein Schatz. Komm, setz dich zu mir. Ich erzähle dir eine Geschichte.' : 'Ahh, there you are, my dear. Come, sit with me. Let me tell you a story.';
      for (const part of voice.sentences(text)) if (await voice.speak(part, { lang: de ? 'de-DE' : 'en-GB', voiceName: de ? c.voiceDe : c.voiceEn, rate: de ? c.rateDe : c.rateEn, pitch: de ? c.pitchDe : c.pitchEn, onStart: i => { if (i.silent) ctx.toast('No sound: this device has no voice for this language, or sound is blocked.'); } }) !== 'end') break;
    };
  });
  $('#st-mic').onchange = e => { save({ micLang: e.target.value }); if (ctx.ears.on) { ctx.ears.stop(); ctx.setMic(true); } };
  $('#st-wait').onchange = e => save({ waitForMe: e.target.checked });
  $('#st-glue').onchange = e => save({ glue: e.target.checked });
  $('#st-level').oninput = e => {
    const v = +e.target.value;
    save({ soundLevel: v, sounds: v > 0 });
    $('#st-level-word').textContent = loud(v);
    ctx.sounds.unlock(); ctx.sounds.setLevel(); ctx.ambience();
  };
  $('#st-level').onchange = () => ctx.sounds.pageTurn(); // a small sample when you let go
  $('#st-drift').onchange = e => save({ drift: e.target.checked });
  if ($('#st-ai')) $('#st-ai').onchange = e => save({ localAI: e.target.checked });
  el.querySelectorAll('input[name=be]').forEach(r => { r.onchange = () => { save({ backend: r.value }); $('#st-gh').hidden = r.value !== 'github'; $('#st-folder').hidden = r.value !== 'folder'; }; });
  for (const [id, key] of [['gh-owner', 'ghOwner'], ['gh-repo', 'ghRepo'], ['gh-branch', 'ghBranch'], ['gh-token', 'ghToken']]) $('#' + id).onchange = e => save({ [key]: e.target.value.trim() });
  $('#gh-expires').onchange = e => { save({ ghTokenExpires: e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : '' }); render(); };
  $('#st-pick').onclick = async () => { try { $('#st-folder-name').textContent = 'Folder: ' + await store.chooseFolder(); } catch (e) { if (e.name !== 'AbortError') ctx.toast(e.message, 6000); } };
  store.kvGet('folder').then(h => { if (h && $('#st-folder-name')) $('#st-folder-name').textContent = 'Folder: ' + h.name; });
  $('#st-sync').onclick = async () => {
    const msg = $('#st-sync-msg'); msg.textContent = 'Working…';
    try {
      const be = store.settings().backend;
      if (be === 'browser') { msg.textContent = 'Everything is kept in this browser.'; return; }
      if (be === 'github') await store.testGithub();
      await store.sync();
      await ctx.refresh();
      if (!ctx.story.journey) { const js = await store.journeys(); if (js[0]) await ctx.selectJourney(js[0].id); }
      msg.textContent = 'All saved and up to date.';
    } catch (e) { msg.textContent = e.message; }
  };
}
