// The stage: grandma, her speech cloud, the picture, the two rooms and the controls.
import * as store from './store.js';
import * as voice from './voice.js';
import { Ears, understand, earsSupported } from './ears.js';
import { StoryRoom } from './story.js';
import * as tea from './tea.js';
import { SWITCH } from './format.js';
import { lookup } from './words.js';
import { initPanels, openSheet, closeSheet, sheetOpen } from './panels.js';

const $ = s => document.querySelector(s);
const body = document.body;
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5l9 7-9 7zM17 5v14"/>',
  again: '<path d="M4 12a8 8 0 1 0 3-6.200M4 4v5h5"/>',
  restart: '<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>',
  turtle: '<path d="M4 15a7 6 0 0 1 14 0zM18 13h2.500a1.500 1.500 0 0 1 0 3H18M7 15v3M15 15v3M3 15h1"/>',
  tea: '<path d="M4 9h12v4a6 6 0 0 1-12 0zM16 10h2a2 2 0 0 1 0 4h-2M3 20h14M8 3v3M12 3v3"/>',
  book: '<path d="M12 6c-2-1.500-5-2-8-1.500v13c3-.5 6 0 8 1.500 2-1.500 5-2 8-1.500v-13c-3-.5-6 0-8 1.500zM12 6v13"/>',
  books: '<path d="M5 4h4v16H5zM11 4h4v16h-4zM16.500 6.500l3.500-1 3 13.500-3.500 1z"/>',
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  cloud: '<path d="M4 6h16v10H10l-4 4v-4H4z"/>',
  aa: '<path d="M3 18l5-12 5 12M5 14h6M15 18v-5a3 3 0 0 1 6 0v5M15 15h6"/>',
  quill: '<path d="M20 4c-8 0-13 5-14 14l-2 2M6 18c5 0 9-2 11-6M10 14h5"/>',
  image: '<path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6"/><circle cx="8" cy="9" r="1.500"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>', send: '<path d="M4 12l16-8-6 16-3-6z"/>',
  pencil: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }
export function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }

// ---------- state ----------
const S = {
  room: 'story', awake: false, speaking: false, speakingText: '', sayId: 0,
  waiting: null, asked: null, pauses: new Set(), cloudMeta: null, tx: { n: 0 }, lastQuestion: '', soundTimer: null,
};
let cfg = store.settings();

const stage = {
  say, pause, listenWait, showPicture, hush,
  glue: () => cfg.glue, waitForMe: () => cfg.waitForMe,
  onPlace: () => { updateControls(); updateTop(); },
  outOfPages: () => setAnswers([['Bring new pages', () => openSheet('texts')]]),
};
const story = new StoryRoom(stage);

// ---------- speaking ----------
function renderCloud(words, lang, meta) {
  const cloud = $('#cloud');
  cloud.hidden = false;
  cloud.classList.toggle('glue', !!meta.glue);
  $('#cloud-dots').hidden = true;
  $('#cloud-lang').textContent = meta.seq ? (lang === 'de' ? 'Deutsch' : 'English') : '';
  $('#cloud-text').innerHTML = words.map((w, i) => `<span class="w" data-i="${i}" data-lang="${lang}">${esc(w)} </span>`).join('');
  S.cloudMeta = { lang, seq: meta.seq || null };
}
let mouthTimer = null;
function flap(word) {
  const m = $('#mouth');
  m.className.baseVal = /[ouöüOUÖÜ]/.test(word || '') && Math.random() < .5 ? 'o' : (Math.random() < .5 ? 'open1' : 'open2');
  clearTimeout(mouthTimer);
  mouthTimer = setTimeout(() => { m.className.baseVal = ''; }, 130);
}
function revealWord(i) {
  const el = $('#cloud-text').children[i];
  if (!el) return;
  $('#cloud-text').querySelector('.now')?.classList.remove('now');
  el.classList.add('on', 'now');
  flap(el.textContent);
}

async function say(text, lang, meta = {}) {
  const id = ++S.sayId;
  endWait();
  if (!meta.keepAnswers) setAnswers([]);
  cfg = store.settings();
  renderCloud(voice.displayWords(text), lang, meta);
  markTexts(meta, lang);
  S.speaking = true; S.speakingText = text;
  body.classList.add('speaking'); body.classList.remove('listening');
  const de = lang === 'de';
  // A story line is one breath. Her own longer remarks are spoken sentence by sentence.
  const parts = meta.seq ? [text] : voice.sentences(text);
  let r = 'end', offset = 0;
  for (const part of parts) {
    const base = offset;
    r = await voice.speak(part, {
      lang: de ? 'de-DE' : 'en-GB',
      voiceName: de ? cfg.voiceDe : cfg.voiceEn,
      rate: de ? cfg.rateDe * (cfg.slowDe ? 0.72 : 1) : cfg.rateEn,
      pitch: de ? cfg.pitchDe : cfg.pitchEn,
      onWord: i => revealWord(base + i),
      onStart: info => { if (info.silent) silentNote(lang); },
    });
    if (r !== 'end' || id !== S.sayId) { r = 'stopped'; break; }
    offset += voice.displayWords(part).length;
  }
  if (id === S.sayId) {
    S.speaking = false; body.classList.remove('speaking');
    $('#cloud-text').querySelector('.now')?.classList.remove('now');
    if (r === 'end') [...$('#cloud-text').children].forEach(el => el.classList.add('on'));
  }
  return r;
}
let silentTold = {};
function silentNote(lang) {
  if (silentTold[lang]) return; silentTold[lang] = true;
  const has = voice.voicesFor(lang).length > 0;
  toast(has ? 'No sound came out. Tap the page once, then check the volume.' : `This device has no ${lang === 'de' ? 'German' : 'English'} voice, so I show the words without sound. See Settings.`, 6000);
}
function pause(ms) {
  return new Promise(res => {
    const done = () => { clearTimeout(t); S.pauses.delete(done); res(); };
    const t = setTimeout(done, ms);
    S.pauses.add(done);
  });
}
function listenWait(ms) {
  return new Promise(res => {
    let t = null;
    const done = () => { clearTimeout(t); if (S.waiting === done) S.waiting = null; $('#cloud-dots').hidden = true; body.classList.remove('listening'); res(); };
    S.waiting = done;
    if (ms > 0) t = setTimeout(done, ms);
    $('#cloud').hidden = false; $('#cloud-dots').hidden = false; body.classList.add('listening');
  });
}
function endWait() { if (S.waiting) S.waiting(); }
function nudge() { if (S.waiting) { S.waiting(); return true; } return false; }
function hush() {
  S.sayId++;
  voice.stop();
  for (const d of [...S.pauses]) d();
  endWait();
  S.speaking = false; body.classList.remove('speaking');
}

// ---------- the picture ----------
const urls = new Map();
const MIME = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export async function imageURL(path) {
  if (!path) return '';
  const rec = await store.getRec(path);
  if (!rec || rec.deleted) return '';
  const key = path + '|' + rec.mtime;
  if (urls.has(key)) return urls.get(key);
  const type = MIME[path.split('.').pop().toLowerCase()] || 'image/jpeg';
  const url = URL.createObjectURL(new Blob([rec.body], { type }));
  urls.set(key, url);
  return url;
}
let shown = '';
async function showPicture(seq, moment) {
  const paper = $('#paper'), img = $('#picture');
  const t = seq.title || {};
  $('#caption').textContent = [t.de, t.en].filter(Boolean).join('  ·  ');
  const path = await store.imagePath(story.journey.id, seq.n);
  const url = await imageURL(path);
  $('#no-picture').hidden = !!url; img.hidden = !url; paper.classList.toggle('empty', !url);
  if (url && img.getAttribute('src') !== url) img.src = url;
  if (moment && shown !== seq.n + url) { paper.classList.remove('reveal'); void paper.offsetWidth; paper.classList.add('reveal'); }
  shown = seq.n + url;
  return !!url;
}

// ---------- answers under the cloud ----------
function setAnswers(list) {
  const box = $('#answers');
  box.innerHTML = '';
  list.forEach(([label, fn, soft]) => {
    const b = document.createElement('button');
    b.textContent = label; if (soft) b.className = 'soft';
    b.onclick = () => { fn(); };
    box.appendChild(b);
  });
}
function ask(map, buttons) { S.asked = map; setAnswers(buttons); body.classList.add('listening'); }
function clearAsk() { S.asked = null; setAnswers([]); body.classList.remove('listening'); }

async function greet() {
  const g = story.greeting();
  clearAsk();
  const r = await say(g.text, 'en', {});
  if (r === 'stopped') return;
  const begin = () => { clearAsk(); story.play(); };
  const later = () => { clearAsk(); say(pick(['All right, my dear. I am here when you are ready.', 'Hmm, no hurry. Just tell me when.']), 'en', {}); };
  const start = lang => async () => {
    clearAsk();
    story.journey.startLang = lang; await store.saveJourney(story.journey);
    begin();
  };
  if (g.kind === 'nobook') { setAnswers([['Choose a book', () => openSheet('books')]]); return; }
  if (g.kind === 'nopages' || g.kind === 'nomore') { setAnswers([['Bring new pages', () => openSheet('texts')], ['A little tea instead', enterTea, true]]); return; }
  if (g.kind === 'fresh' && !story.journey.startLang) {
    ask({ german: start('de'), english: start('en') }, [['Deutsch zuerst', start('de')], ['English first', start('en')]]);
    return;
  }
  ask({ yes: begin, no: later }, [[g.kind === 'fresh' ? 'Yes, let us start' : 'Yes, go on', begin], ['Not yet', later, true]]);
}

// ---------- rooms ----------
function setRoom(room) {
  S.room = room;
  body.classList.toggle('room-tea', room === 'tea');
  body.classList.toggle('room-story', room === 'story');
  $('#room-label').textContent = room === 'tea' ? SWITCH.story : SWITCH.tea;
  $('#btn-room').querySelector('[data-icon]').innerHTML = icon(room === 'tea' ? 'book' : 'tea');
  $('#btn-room').title = room === 'tea' ? `Back to the story (say "${SWITCH.story}")` : `Put the book down and chat (say "${SWITCH.tea}")`;
  updateTop();
}
async function enterTea() {
  if (S.room === 'tea') return;
  story.pause(); clearAsk();
  setRoom('tea');
  $('#btn-ask-claude').hidden = true;
  await say(tea.enterLine(), 'en', {});
}
async function enterStory() {
  if (S.room === 'story') return;
  hush();
  setRoom('story');
  $('#btn-ask-claude').hidden = true;
  if (!story.current) { greet(); return; }
  const r = await say(pick(tea.backLines), 'en', { glue: true });
  if (r !== 'stopped' && S.room === 'story') story.play();
}
async function teaHear(text) {
  text = text.trim();
  if (!text) return;
  $('#btn-ask-claude').hidden = true;
  const view = story.view(); // read-only copy: the tea room cannot touch the story
  let r = tea.reply(text, view);
  if (!r && cfg.localAI && tea.localAIAvailable()) {
    hush(); $('#cloud').hidden = false; $('#cloud-text').innerHTML = ''; $('#cloud-dots').hidden = false;
    r = await tea.localAIReply(text, view);
    $('#cloud-dots').hidden = true;
  }
  if (!r) { r = tea.unknownLine(); S.lastQuestion = text; $('#btn-ask-claude').hidden = false; }
  if (S.room === 'tea') say(r, 'en', {});
}

// ---------- commands (voice, buttons and keys all end up here) ----------
function act(cmd) {
  switch (cmd) {
    case 'tea': return enterTea();
    case 'story': return enterStory();
    case 'toggle':
      if (S.room === 'tea') return enterStory();
      if (S.asked?.yes) return S.asked.yes();
      if (story.playing) return story.pause();
      clearAsk(); return story.play();
    case 'next':
      if (S.room === 'tea') return;
      if (S.asked?.yes) return S.asked.yes();
      if (nudge()) return;
      if (story.playing) { if (!story.skip()) toast('That is the last part I have. Bring new pages in the Workshop.'); return; }
      clearAsk(); return story.play();
    case 'yes': if (S.asked?.yes) return S.asked.yes(); if (nudge()) return; if (!story.playing && S.room === 'story') { clearAsk(); story.play(); } return;
    case 'no': if (S.asked?.no) return S.asked.no(); if (S.room === 'story') story.pause(); return;
    case 'pause': if (S.room === 'story') { clearAsk(); story.pause(); } else hush(); return;
    case 'repeat': if (S.room === 'story') { clearAsk(); story.repeatLine(); } return;
    case 'repeatSeq': if (S.room === 'story') { clearAsk(); story.repeatSeq(); } return;
    case 'slower': cfg = store.saveSettings({ slowDe: true }); updateControls(); if (S.room === 'story' && (story.playing || story.lastLine)) story.repeatLine(); return;
    case 'faster': cfg = store.saveSettings({ slowDe: false }); updateControls(); return;
    case 'words': return openTexts();
    case 'german': case 'english': if (S.asked?.[cmd]) S.asked[cmd](); return;
  }
}

function isEcho(text) {
  // Is the microphone just hearing grandma herself?
  const a = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (!a.length) return true;
  const b = new Set(S.speakingText.toLowerCase().split(/\W+/));
  return a.filter(w => b.has(w)).length / a.length >= 0.5;
}
let heardTimer = null;
function showHeard(text) {
  const el = $('#heard');
  el.textContent = '“' + text + '”'; el.hidden = false;
  clearTimeout(heardTimer); heardTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
function onHeard(text, cmd) {
  clearTimeout(S.soundTimer);
  showHeard(text);
  if (!S.awake) { wake(); return; }
  if (cmd === 'tea' || cmd === 'story') { act(cmd); return; }
  if (sheetOpen()) return;
  if (S.speaking) {
    // While she speaks, only a few safe commands count, and never her own echo.
    if (isEcho(text)) return;
    if (S.room === 'story' && ['pause', 'repeat', 'repeatSeq', 'slower'].includes(cmd)) act(cmd);
    return;
  }
  if (S.room === 'tea') { teaHear(text); return; }
  if (S.asked) { const k = cmd === 'next' ? 'yes' : cmd; if (S.asked[k]) { S.asked[k](); return; } }
  if (S.waiting) {
    if (cmd === 'pause' || cmd === 'no') { story.pause(); return; }
    if (['repeat', 'repeatSeq', 'slower', 'faster', 'words'].includes(cmd)) { act(cmd); return; }
    nudge(); return; // "hmm", "and then?", or anything else: she goes on
  }
  if (cmd) act(cmd);
}
function onSound() {
  if (!S.awake) { wake(); return; }
  // A "hmm" often produces no words at all. If I made a sound while she waits, she goes on.
  if (S.waiting && !S.speaking && !S.asked) { clearTimeout(S.soundTimer); S.soundTimer = setTimeout(() => { if (S.waiting && !S.asked) nudge(); }, 1600); }
}

const ears = new Ears({ onHeard, onSound, onInterim: t => showHeard(t), onState: () => updateControls() });
function setMic(on) {
  cfg = store.saveSettings({ mic: on });
  if (on) {
    if (!earsSupported) { toast('This browser cannot listen. Chrome, Edge and Safari can. The buttons do everything too.', 6000); cfg = store.saveSettings({ mic: false }); }
    else ears.start(cfg.micLang);
  } else ears.stop();
  updateControls();
}

// ---------- read along ----------
function txAllowed() {
  const cur = story.index(story.p.seq);
  return story.seqs.filter((s, i) => cur < 0 || i <= cur);
}
function openTexts() {
  const allowed = txAllowed();
  if (!S.tx.n || !allowed.find(s => s.n === S.tx.n)) S.tx.n = story.current?.n || allowed[allowed.length - 1]?.n || 0;
  $('#texts').hidden = false;
  renderTexts(); updateControls();
}
function closeTexts() { $('#texts').hidden = true; updateControls(); }
function wordsHTML(line, lang) {
  return voice.displayWords(line).map(w => `<span class="w" data-lang="${lang}">${esc(w)}</span>`).join(' ');
}
function renderTexts() {
  if ($('#texts').hidden) return;
  const allowed = txAllowed();
  const seq = allowed.find(s => s.n === S.tx.n);
  const bodyEl = $('#tx-body');
  if (!seq) {
    $('#tx-num').textContent = ''; $('#tx-name').textContent = '';
    bodyEl.innerHTML = '<div class="tx-empty">Nothing has been told yet. The texts appear here as Grandma tells them.</div>';
    $('#tx-prev').disabled = $('#tx-next').disabled = true;
    return;
  }
  const i = allowed.indexOf(seq);
  $('#tx-prev').disabled = i <= 0; $('#tx-next').disabled = i >= allowed.length - 1;
  $('#tx-num').textContent = `Part ${seq.n}` + (seq.pages ? `  ·  ${seq.pages[0] === seq.pages[1] ? 'page ' + seq.pages[0] : 'pages ' + seq.pages[0] + ' to ' + seq.pages[1]}` : '');
  $('#tx-name').textContent = [seq.title?.de, seq.title?.en].filter(Boolean).join(' · ');
  const first = story.order(seq)[0];
  const sides = cfg.swapSides ? ['en', 'de'] : ['de', 'en'];
  bodyEl.innerHTML = sides.map(lang => `<div class="tx-col" data-lang="${lang}"><h3>${lang === 'de' ? 'Deutsch' : 'English'}<em>${first === lang ? 'told first' : 'told second'}</em></h3>${
    seq[lang].map((l, k) => l ? `<p data-i="${k}">${wordsHTML(l, lang)}</p>` : '<p class="gap"></p>').join('')}</div>`).join('');
  bodyEl.dataset.n = seq.n;
  if (S.nowLine && S.nowLine.n === seq.n) markNow(S.nowLine.lang, S.nowLine.i);
}
function markNow(lang, i) {
  const bodyEl = $('#tx-body');
  bodyEl.querySelector('p.now')?.classList.remove('now');
  const p = bodyEl.querySelector(`.tx-col[data-lang="${lang}"] p[data-i="${i}"]`);
  if (p) { p.classList.add('now'); p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function markTexts(meta, lang) {
  if (!meta.seq) return;
  S.nowLine = { n: meta.seq.n, lang, i: meta.line };
  if ($('#texts').hidden) return;
  if (S.tx.followed !== false && S.tx.n !== meta.seq.n) { S.tx.n = meta.seq.n; renderTexts(); }
  if (S.tx.n === meta.seq.n) markNow(lang, meta.line);
}
function jumpTo(n, lang, i) {
  const seq = story.seq(n); if (!seq) return;
  if (S.room !== 'story') setRoom('story');
  clearAsk(); story.halt(); hush();
  story.p = { seq: n, part: story.order(seq).indexOf(lang), line: i }; story.shownPicture = n;
  story.play();
}

// ---------- word meanings ----------
async function showMeaning(el, n) {
  const pop = $('#pop');
  const lang = el.dataset.lang || 'de';
  const r = el.getBoundingClientRect();
  pop.hidden = false; pop.innerHTML = `<b>${esc(el.textContent.trim())}</b><br>…`;
  const place = () => { pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px'; pop.style.top = (r.top > 120 ? r.top - pop.offsetHeight - 8 : r.bottom + 8) + 'px'; };
  place();
  const seq = story.seq(n) || story.current;
  const hit = await lookup(el.textContent, lang, seq, story.seqs);
  if (!hit) { pop.hidden = true; return; }
  pop.innerHTML = `<b>${esc(hit.word)}</b>${hit.meaning ? ' = ' + esc(hit.meaning) : ''}<small>${esc(hit.source)}</small>`;
  place();
}

// ---------- chrome ----------
function updateTop() {
  const j = story.journey;
  $('#top-title').textContent = j ? j.title : 'Choose a book';
  const cur = story.current, total = story.seqs.length;
  let place = '';
  if (j && total) place = cur ? `Part ${cur.n} of ${story.seqs[total - 1].n}` : `All ${total} parts told`;
  if (S.room === 'tea') place = 'Tea room · ' + (place || 'free chat');
  $('#top-place').textContent = place;
}
function updateControls() {
  cfg = store.settings();
  $('#btn-play').querySelector('[data-icon]').innerHTML = icon(story.playing ? 'pause' : 'play');
  $('#btn-slow').classList.toggle('on', cfg.slowDe);
  $('#btn-cloud').classList.toggle('on', cfg.cloud);
  $('#btn-meanings').classList.toggle('on', cfg.meanings);
  $('#btn-mic').classList.toggle('on', cfg.mic && ears.on);
  $('#btn-mic').classList.toggle('live', !!ears.live);
  $('#btn-texts').classList.toggle('on', !$('#texts').hidden);
  body.classList.toggle('no-cloud', !cfg.cloud);
  body.classList.toggle('meanings', cfg.meanings);
  if (ears.error) { toast(ears.error, 6000); ears.error = ''; }
}
let toastTimer = null;
export function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
export async function copy(text, okMsg = 'Copied.') {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch { toast('Could not copy. Select the text and copy it by hand.'); }
    ta.remove();
  }
}
function syncBadge() {
  const b = $('#sync-badge'), st = store.syncState, be = store.settings().backend;
  if (be === 'browser') { b.hidden = true; return; }
  b.hidden = false; b.classList.toggle('err', !!st.error);
  b.textContent = st.busy ? 'Saving…' : st.error ? 'Not saved: tap' : (be === 'github' ? 'Saved to GitHub' : 'Saved to folder');
  b.title = st.error || '';
}

async function selectJourney(id) {
  hush(); clearAsk();
  cfg = store.saveSettings({ current: id || '' });
  await story.load(id);
  S.tx.n = 0; shown = '';
  if (story.current) showPicture(story.current, false);
  else { $('#picture').hidden = true; $('#no-picture').hidden = false; $('#caption').textContent = ''; }
  $('#no-picture-text').textContent = story.journey ? 'The picture for this part is not drawn yet.' : 'Here Grandma shows you a picture for every part.';
  updateTop(); updateControls(); renderTexts();
}
async function refresh() {
  // New sequences or pictures were saved: let the story room see them.
  const wasPlaying = story.playing;
  await story.refresh();
  if (!wasPlaying && story.current) showPicture(story.current, false);
  updateTop(); renderTexts();
}

async function wake() {
  if (S.awake) return;
  S.awake = true;
  voice.unlock();
  body.classList.remove('asleep');
  await voice.whenVoicesReady();
  if (cfg.mic && !ears.on) ears.start(cfg.micLang);
  updateControls();
  greet();
}

// ---------- wiring ----------
function wire() {
  paintIcons();
  $('#wake').onclick = wake;
  $('#btn-play').onclick = () => act('toggle');
  $('#btn-next').onclick = () => act('next');
  $('#btn-repeat').onclick = () => act('repeat');
  $('#btn-repeat-seq').onclick = () => act('repeatSeq');
  $('#btn-slow').onclick = () => { cfg = store.saveSettings({ slowDe: !cfg.slowDe }); updateControls(); toast(cfg.slowDe ? 'German is slower now.' : 'German at her normal pace.'); };
  $('#btn-room').onclick = () => act(S.room === 'tea' ? 'story' : 'tea');
  $('#btn-mic').onclick = () => setMic(!(cfg.mic && ears.on));
  $('#btn-cloud').onclick = () => { cfg = store.saveSettings({ cloud: !cfg.cloud }); updateControls(); };
  $('#btn-meanings').onclick = () => { cfg = store.saveSettings({ meanings: !cfg.meanings }); updateControls(); toast(cfg.meanings ? 'Tap any word to see what it means.' : 'Word meanings are off.'); };
  $('#btn-texts').onclick = () => ($('#texts').hidden ? openTexts() : closeTexts());
  $('#btn-books').onclick = () => openSheet('books');
  $('#btn-workshop').onclick = () => openSheet('texts');
  $('#btn-images').onclick = () => openSheet('images');
  $('#btn-settings').onclick = () => openSheet('settings');
  $('#sync-badge').onclick = () => { if (store.syncState.error) openSheet('settings'); };
  $('#tea-form').onsubmit = e => { e.preventDefault(); const v = $('#tea-input').value; $('#tea-input').value = ''; teaHear(v); };
  $('#btn-ask-claude').onclick = () => copy(tea.askClaudeText(S.lastQuestion, story.view()), 'Copied. Paste it into Claude.');

  $('#tx-close').onclick = closeTexts;
  $('#tx-swap').onclick = () => { cfg = store.saveSettings({ swapSides: !cfg.swapSides }); renderTexts(); };
  const step = d => { const a = txAllowed(); const i = a.findIndex(s => s.n === S.tx.n) + d; if (a[i]) { S.tx.n = a[i].n; S.tx.followed = a[i].n === story.p.seq ? true : false; renderTexts(); } };
  $('#tx-prev').onclick = () => step(-1);
  $('#tx-next').onclick = () => step(1);
  $('#tx-body').onclick = e => {
    const w = e.target.closest('.w');
    if (w && cfg.meanings) { showMeaning(w, S.tx.n); e.stopPropagation(); return; }
    const p = e.target.closest('p[data-i]');
    if (p) jumpTo(S.tx.n, p.parentElement.dataset.lang, +p.dataset.i);
  };
  $('#cloud-text').onclick = e => { const w = e.target.closest('.w'); if (w && cfg.meanings) { showMeaning(w, S.cloudMeta?.seq?.n); e.stopPropagation(); } };
  document.addEventListener('click', () => { $('#pop').hidden = true; });
  document.addEventListener('pointerdown', () => voice.unlock(), { once: true });
  $('#picture').onclick = () => { const lb = $('#lightbox'); lb.querySelector('img').src = $('#picture').src; lb.hidden = false; };
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; };

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { if (!$('#lightbox').hidden) $('#lightbox').hidden = true; else if (sheetOpen()) closeSheet(); else if (!$('#texts').hidden) closeTexts(); return; }
    if (sheetOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!S.awake) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); wake(); } return; }
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); act('toggle'); }
    else if (k === 'arrowright') act('next');
    else if (k === 'arrowleft') act('repeat');
    else if (k === 't') $('#btn-texts').click();
    else if (k === 'c') $('#btn-cloud').click();
    else if (k === 'm') $('#btn-mic').click();
  });

  // The read-along panel always ends above the control bar.
  const measure = () => document.documentElement.style.setProperty('--ctl-h', $('#controls').offsetHeight + 'px');
  measure(); window.addEventListener('resize', measure); new ResizeObserver(measure).observe($('#controls'));

  // Her eyes follow you a little.
  const eyes = $('#eyes');
  window.addEventListener('pointermove', e => {
    const r = $('#grandma').getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth, dy = (e.clientY - (r.top + r.height * .42)) / window.innerHeight;
    eyes.style.transform = `translate(${Math.max(-3, Math.min(3, dx * 8))}px, ${Math.max(-2, Math.min(2.5, dy * 6))}px)`;
  }, { passive: true });

  store.onChange(ev => {
    if (ev.type === 'sync') { syncBadge(); if (ev.pulled) { if (!story.journey) boot(true); else refresh(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.sync().catch(() => {}); });
}

async function boot(again) {
  cfg = store.settings();
  const js = await store.journeys();
  const id = js.find(j => j.id === cfg.current)?.id || js[0]?.id || '';
  await selectJourney(id);
  if (again) return;
  setRoom('story'); syncBadge();
  if (cfg.backend !== 'browser') store.sync().catch(() => {});
  voice.whenVoicesReady();
  // If the microphone was allowed before, she can already hear a "hello" while dozing.
  if (cfg.mic && earsSupported && navigator.permissions?.query) {
    try { const p = await navigator.permissions.query({ name: 'microphone' }); if (p.state === 'granted') { ears.start(cfg.micLang); updateControls(); } } catch { /* not supported */ }
  }
}

export const ctx = { paintIcons, icon, story, selectJourney, refresh, toast, copy, hush, imageURL, say, setMic, updateControls, ears, understand };
wire();
initPanels(ctx);
boot();
window.__grandma = { S, story, store, act, onHeard, teaHear, wake, ears };
