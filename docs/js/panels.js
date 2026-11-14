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
  $('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } };
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
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const el = $('#sheet-body');
  const fn = { contents: renderContents, books: renderBooks, once: renderOnce, texts: renderTexts, pictures: renderPictures, images: renderImages, settings: renderSettings }[tab];
  // Stay where you are when the same tab redraws (next prompt, a saved picture). Start at the top on a new tab.
  const keep = tab === shownTab ? el.scrollTop : 0;
  await fn(el);
  el.scrollTop = keep; shownTab = tab;
  ctx.paintIcons(el);
}
const needJourney = el => { el.innerHTML = '<h2>No book yet</h2><p>Choose or add a book first, under <b>Books</b>.</p>'; };

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
    if (want === 'pictures' && seqN.length && !picN.length) warns.unshift('This is the texts file. It holds the story only, no picture prompts. For pictures, copy the request above, paste it into Claude, and bring the file whose name contains "pictures".');
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
  if (!seqs.length) { el.innerHTML = `<h2>Contents of “${esc(j.title)}”</h2><p>No parts yet. Bring the first pages under <b>Texts</b>.</p>`; return; }
  if (!j.chapters) {
    const book = await bookOf(j.id);
    if (book) { j.chapters = findChapters(book); await store.saveJourney(j); }
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
    <p class="hint">Tap a part to hear it. What a part is about appears once Grandma has told it, so nothing is given away.${chapters.length ? '' : ' Attach the book file under Books to see the chapters here.'}</p>
    <div class="toc">${html}</div>`;
  el.querySelectorAll('.toc-row').forEach(b => { b.onclick = () => ctx.goPart(+b.dataset.n); });
  if (shownTab !== 'contents') requestAnimationFrame(() => el.querySelector('.toc-row.now')?.scrollIntoView({ block: 'center' }));
}

// ---------- Books ----------
async function renderBooks(el) {
  const js = await store.journeys();
  const cur = journey()?.id;
  const cards = [];
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
    <div class="books">${cards.join('') || '<p>No books yet.</p>'}</div>
    <div class="step"><h3>Add a book</h3>
      <p class="hint">Any PDF or text file. It is read here in your browser. The book itself is not uploaded anywhere; only your place, your texts and your pictures are saved.</p>
      <div class="row"><label class="btn"><input id="bk-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" hidden>Choose a PDF or text file</label><span id="bk-status" class="hint"></span></div>
      <div id="bk-form" hidden><div class="row"><label>Title <input id="bk-title" type="text" size="28"></label><label>Author <input id="bk-author" type="text" size="20"></label><button id="bk-add" class="btn primary">Start this journey</button></div></div>
    </div>
    <div class="step"><h3>Try it first</h3><p class="hint">Three short parts from the opening of Momo, retold by Grandma, with picture prompts and one example picture. Add your own Momo file afterwards to prepare more pages.</p><button id="bk-sample" class="btn">Load the Momo sample</button></div>`;

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
      try { const b = await fileToBook(f); await store.putJSON(`local/${id}/book.json`, { pageCount: b.pageCount, sents: b.sents }); await upd({ pages: b.pageCount, chapters: findChapters(b) }); ctx.toast('The book is attached.'); render(); }
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
    j.chapters = findChapters(pendingBook);
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
  el.innerHTML = `<h2>Texts for “${esc(j.title)}”</h2>
    <p class="hint">${withText.length} parts are prepared, ${untold} of them not told yet. Pages prepared: ${Math.max(0, (j.cursor?.page || 1) - 1)}${j.pages ? ' of ' + j.pages : ''}.</p>
    ${noPic ? `<div class="note info">${noPic === 1 ? '1 part has' : noPic + ' parts have'} texts but no picture prompt yet. The texts file does not contain pictures. <button class="btn" id="tx-to-pics">Go to Make pictures</button></div>` : ''}
    <div class="step"><h3><span class="num">1</span>Ask Claude for the next pages</h3>
      <div class="row">
        <label>Sequence size <select id="tx-size">${Object.entries(SIZES).map(([k, v]) => `<option value="${k}" ${j.size === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label>How many sequences <input id="tx-count" type="number" min="1" max="60" value="${DEFAULT_COUNT[j.size] || 10}"></label>
        <label>Start at page <input id="tx-page" type="number" min="1" value="${j.cursor?.page || 1}"></label>
      </div>
      ${book ? '<label class="check"><input type="checkbox" id="tx-include"> Put the book\'s text into the request (longer, but Claude cannot pick the wrong pages)</label>' : '<div class="note info">The book file is not in this browser, so the request can only name page numbers. Attach the file under <b>Books</b> for exact borders.</div>'}
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
  el.innerHTML = `<h2>Make pictures for “${esc(j.title)}”</h2>
    <p class="hint">Pictures come in their own file from Claude. The texts file (its name contains “texts”) holds only the story.</p>
    <p class="hint">${withPrompt.length} picture prompts, ${hasImg.size} pictures saved.</p>
    <div class="step"><h3><span class="num">1</span>Ask Claude for picture prompts</h3>
      ${noPrompt.length ? `<p><b>${noPrompt.length === 1 ? `Part ${noPrompt[0].n} has` : `Parts ${noPrompt[0].n} to ${noPrompt[noPrompt.length - 1].n} have`} texts but no picture prompt yet.</b></p>
      <div class="row"><label>Ask for the next <input id="pc-count" type="number" min="1" max="${noPrompt.length}" value="${Math.min(6, noPrompt.length)}"> parts</label></div>
      <textarea class="copybox" readonly id="pc-request"></textarea>
      <div class="row"><button class="btn primary" id="pc-copy">Copy the request</button><span class="hint">Paste it into your Claude project. Claude answers with a second file, named <b id="pc-file-name"></b>. Give that file here:</span></div>
      <div id="pc-upload"></div>` : `<div class="note info"><b>Nothing to copy here yet.</b> Grandma has texts for ${withText.length ? `parts ${withText[0].n} to ${withText[withText.length - 1].n}` : 'no parts'}, and each of them already has a picture prompt.</div>
      <p><b>Did Claude already give you a new texts file?</b> Add it first: open the Texts tab, drop the file into step 2 and press “Save to my journey”. Then come back here, and the request to copy will be waiting.</p>
      <div class="row"><button class="btn primary" id="pc-to-texts">Go to Texts</button></div>
      <details><summary>I have a pictures file from Claude anyway</summary><div id="pc-upload"></div></details>`}
    </div>
    <div class="step"><h3><span class="num">2</span>One prompt at a time into ChatGPT</h3>
      ${cur ? `<div class="carousel">
        <button class="ctl small" id="pc-prev" ${idx <= 0 ? 'disabled' : ''} title="Previous prompt"><span data-icon="left"></span></button>
        <div class="mid"><p><b>Picture ${cur.n}</b> of ${withPrompt[withPrompt.length - 1].n}: ${esc(cur.title?.en || '')} <span class="pill ${hasImg.has(cur.n) ? 'ok' : ''}">${hasImg.has(cur.n) ? 'picture saved' : 'no picture yet'}</span>${cur.layout ? `<span class="pill">${esc(cur.layout)}</span>` : ''}</p>
          <textarea class="copybox tall" readonly id="pc-prompt"></textarea></div>
        <button class="ctl small" id="pc-next" ${idx >= withPrompt.length - 1 ? 'disabled' : ''} title="Next prompt"><span data-icon="right"></span></button>
      </div>
      <div class="row"><button class="btn primary" id="pc-copy-prompt">Copy this prompt</button><span class="hint">Paste it into ChatGPT. One prompt, one picture.</span></div>` : '<p class="hint">No prompts yet. Do step 1 first.</p>'}
    </div>
    ${cur ? `<div class="step"><h3><span class="num">3</span>Paste the finished picture for part ${cur.n}</h3>
      <div class="pastebox">
        <div class="drop" id="pc-drop">Copy the picture in ChatGPT, then press <b>Ctrl+V</b> (or ⌘V) here.
          <button class="btn" id="pc-paste">Paste from clipboard</button>
          <label class="btn"><input type="file" id="pc-file" accept="image/*" hidden>Choose a file</label></div>
        <div id="pc-preview"></div>
        <div class="row"><button class="btn primary" id="pc-save" disabled>Save picture for part ${cur.n}</button><span class="hint">Goes to ${esc(storageName())}.</span></div>
      </div></div>` : ''}`;
  if (noPrompt.length) {
    const build = () => { const t = pictureRequest(j, noPrompt.slice(0, Math.max(1, +$('#pc-count').value || 1))); $('#pc-request').value = t; $('#pc-file-name').textContent = (t.match(/named (\S+\.md)/) || [])[1] || ''; };
    $('#pc-count').oninput = build; build();
    $('#pc-copy').onclick = () => ctx.copy($('#pc-request').value, 'Copied. Paste it into Claude.');
  }
  uploader($('#pc-upload'), 'pictures', () => render());
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
  el.innerHTML = `<h2>Saved pictures for “${esc(j.title)}”</h2><p class="hint">${paths.length} saved. To add pictures, use the <b>Make pictures</b> tab.</p><div class="grid">${tiles.join('') || '<p>No pictures saved yet.</p>'}</div>`;
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
  el.innerHTML = `<h2>Settings</h2>
    <div class="step"><h3>Grandma's voices</h3>
      <p class="hint">These are the free voices of this browser and device. The star marks the one I would pick. Listen and choose the warmest one.</p>
      <div class="kv">
        <label>English</label><div class="row"><select id="st-engine"><option value="browser" ${s.enEngine === 'browser' ? 'selected' : ''}>A voice of this browser</option><option value="kokoro" ${s.enEngine === 'kokoro' ? 'selected' : ''}>Kokoro neural voice (downloads about 90 MB once)</option></select></div>
        <label></label><div class="row"><select id="st-en" ${s.enEngine === 'kokoro' ? 'hidden' : ''}>${opts('en', s.voiceEn)}</select><select id="st-kokoro" ${s.enEngine === 'kokoro' ? '' : 'hidden'}>${voice.KOKORO_VOICES.map(([id, name]) => `<option value="${id}" ${s.kokoroVoice === id ? 'selected' : ''}>${name}</option>`).join('')}</select><button class="btn" data-test="en">Listen</button><span class="hint" id="st-kokoro-msg"></span></div>
        <label>Speed</label><div class="row"><input id="st-rate-en" type="range" min="0.6" max="1.1" step="0.05" value="${s.rateEn}"><span class="hint">slower is more grandmotherly</span></div>
        <label>Depth</label><div class="row"><input id="st-pitch-en" type="range" min="0.6" max="1.2" step="0.05" value="${s.pitchEn}"><span class="hint">a little lower sounds older (browser voices only)</span></div>
        <label>German</label><div class="row"><select id="st-de">${opts('de', s.voiceDe)}</select><button class="btn" data-test="de">Listen</button></div>
        <label>Speed</label><div class="row"><input id="st-rate-de" type="range" min="0.5" max="1.05" step="0.05" value="${s.rateDe}"><span class="hint">the “Slow German” button slows it further</span></div>
      </div>
      <details><summary>How to get better voices for free</summary>
        <p><b>Computer:</b> open this page in <b>Microsoft Edge</b>. Its “Online (Natural)” voices are the best free ones: for German look for Seraphina, Katja or Amala, for English Sonia, Libby or Emma. In Chrome you get “Google Deutsch” and “Google UK English Female”, which are clear but flatter.</p>
        <p><b>iPhone, iPad, Mac:</b> Settings, Accessibility, Spoken Content (or Read &amp; Speak), Voices. Download an “Enhanced” or “Premium” voice for German (Anna or Petra) and for English (Serena, Kate or Samantha). Then reload this page.</p>
        <p><b>Android:</b> the voices come from “Speech Recognition &amp; Synthesis from Google”. Install the German voice data in the phone's text-to-speech settings.</p></details>
    </div>
    <div class="step"><h3>Talking with Grandma</h3>
      ${earsSupported ? '' : '<div class="note warn">This browser cannot listen. Use Chrome, Edge or Safari for voice. The buttons do everything too.</div>'}
      <div class="row"><label>I speak to her in <select id="st-mic"><option value="en-US" ${s.micLang === 'en-US' ? 'selected' : ''}>English (US)</option><option value="en-GB" ${s.micLang === 'en-GB' ? 'selected' : ''}>English (UK)</option><option value="en-IN" ${s.micLang === 'en-IN' ? 'selected' : ''}>English (India)</option><option value="de-DE" ${s.micLang === 'de-DE' ? 'selected' : ''}>Deutsch</option></select></label></div>
      <p><label class="check"><input type="checkbox" id="st-wait" ${s.waitForMe ? 'checked' : ''}> After each part she waits until I say “and then?” (otherwise she goes on by herself)</label></p>
      <p><label class="check"><input type="checkbox" id="st-glue" ${s.glue ? 'checked' : ''}> She says small things between the two tellings (“And now in English, dear.”)</label></p>
      <p class="hint">Switch words: “${SWITCH.tea}” opens the tea room for free chat, “${SWITCH.story}” goes back to the book. With loudspeakers the microphone also hears Grandma, so she ignores most commands while she is speaking. Headphones make voice control much more reliable.</p>
      ${localAIAvailable() ? `<p><label class="check"><input type="checkbox" id="st-ai" ${s.localAI ? 'checked' : ''}> In the tea room, let the small AI built into this Chrome answer free questions (runs on this computer, free, no key; experimental)</label></p>` : ''}
    </div>
    <div class="step"><h3>Where my journeys are saved</h3>
      <p><label class="check"><input type="radio" name="be" value="browser" ${s.backend === 'browser' ? 'checked' : ''}> Only in this browser (nothing to set up, but only on this device)</label></p>
      <p><label class="check"><input type="radio" name="be" value="github" ${s.backend === 'github' ? 'checked' : ''}> In my GitHub repository (works on computer and phone, both stay in step)</label></p>
      <div id="st-gh" ${s.backend === 'github' ? '' : 'hidden'}>
        <div class="kv">
          <label>Owner</label><input id="gh-owner" type="text" value="${esc(s.ghOwner)}" placeholder="your GitHub user name">
          <label>Repository</label><input id="gh-repo" type="text" value="${esc(s.ghRepo)}" placeholder="for example storyteller-library">
          <label>Branch</label><input id="gh-branch" type="text" value="${esc(s.ghBranch)}">
          <label>Token</label><input id="gh-token" type="password" value="${esc(s.ghToken)}" placeholder="github_pat_…" autocomplete="off">
          <label>Token expires</label><div class="row"><input id="gh-expires" type="date" value="${esc((s.ghTokenExpires || '').slice(0, 10))}"><span class="hint">${tokenNote}</span></div>
        </div>
        <p class="hint">Make a <b>fine-grained personal access token</b> on GitHub (Settings, Developer settings) for <b>only this one repository</b>, with the permission <b>Contents: Read and write</b>. The token stays in this browser on this device and is sent only to api.github.com. Files go to the branch named above, which the app creates. A <b>private</b> repository is best, because your texts and pictures are derived from a book.</p>
      </div>
      <p><label class="check"><input type="radio" name="be" value="folder" ${s.backend === 'folder' ? 'checked' : ''} ${window.showDirectoryPicker ? '' : 'disabled'}> In a folder on this computer ${window.showDirectoryPicker ? '' : '(needs Chrome or Edge on a computer)'}</label></p>
      <div id="st-folder" ${s.backend === 'folder' ? '' : 'hidden'}><div class="row"><button class="btn" id="st-pick">Choose the folder</button><span class="hint" id="st-folder-name"></span></div><p class="hint">The browser asks for permission again each time you open the app. A phone cannot use this.</p></div>
      <div class="row"><button class="btn primary" id="st-sync">Save and sync now</button><span id="st-sync-msg" class="hint"></span></div>
    </div>`;
  const save = patch => { store.saveSettings(patch); ctx.updateControls(); };
  $('#st-en').onchange = e => save({ voiceEn: e.target.value });
  const kmsg = () => { const el = $('#st-kokoro-msg'); if (!el) return; const k = voice.kokoro; el.textContent = store.settings().enEngine !== 'kokoro' ? '' : k.state === 'loading' ? `Loading the voice… ${k.progress}%` : k.state === 'ready' ? 'Ready.' : k.state === 'failed' ? 'Could not load (' + k.error + '). The browser voice is used instead.' : 'Press Listen to load it.'; };
  voice.kokoro.onChange = kmsg; kmsg();
  $('#st-engine').onchange = e => { save({ enEngine: e.target.value }); $('#st-en').hidden = e.target.value === 'kokoro'; $('#st-kokoro').hidden = e.target.value !== 'kokoro'; kmsg(); };
  $('#st-kokoro').onchange = e => save({ kokoroVoice: e.target.value });
  $('#st-de').onchange = e => save({ voiceDe: e.target.value });
  $('#st-rate-en').oninput = e => save({ rateEn: +e.target.value });
  $('#st-pitch-en').oninput = e => save({ pitchEn: +e.target.value });
  $('#st-rate-de').oninput = e => save({ rateDe: +e.target.value });
  el.querySelectorAll('[data-test]').forEach(b => {
    b.onclick = async () => {
      const de = b.dataset.test === 'de', c = store.settings();
      const text = de ? 'Ach ja, mein Schatz. Komm, setz dich zu mir. Ich erzähle dir eine Geschichte.' : 'Ahh, there you are, my dear. Come, sit with me. Let me tell you a story.';
      voice.unlockAudio();
      if (!de && c.enEngine === 'kokoro') { try { await voice.kokoroLoad(); } catch { /* the message is shown next to the button */ } }
      for (const part of voice.sentences(text)) if (await voice.speak(part, { lang: de ? 'de-DE' : 'en-GB', voiceName: de ? c.voiceDe : c.voiceEn, rate: de ? c.rateDe : c.rateEn, pitch: de ? c.pitchDe : c.pitchEn, engine: c.enEngine, kokoroVoice: c.kokoroVoice, onStart: i => { if (i.silent) ctx.toast('No sound: this device has no voice for this language, or sound is blocked.'); } }) !== 'end') break;
    };
  });
  $('#st-mic').onchange = e => { save({ micLang: e.target.value }); if (ctx.ears.on) { ctx.ears.stop(); ctx.setMic(true); } };
  $('#st-wait').onchange = e => save({ waitForMe: e.target.checked });
  $('#st-glue').onchange = e => save({ glue: e.target.checked });
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
