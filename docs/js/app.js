// The stage: grandma, her speech cloud, the picture, the two rooms and the controls.
import * as store from './store.js';
import * as voice from './voice.js';
import { Ears, understand, earsSupported } from './ears.js';
import { StoryRoom, GLUE } from './story.js';
import * as tea from './tea.js';
import { SWITCH, ago } from './format.js';
import { lookup, matchingLine } from './words.js';
import * as sounds from './sounds.js';
import * as neural from './neural.js';
import * as alive from './alive.js';
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
  more: '<circle cx="6" cy="12" r="1.600" fill="currentColor"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/><circle cx="18" cy="12" r="1.600" fill="currentColor"/>',
  moon: '<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>',
  pencil: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }
export function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }

// ---------- state ----------
const S = {
  room: 'story', awake: false, speaking: false, speakingText: '', sayId: 0,
  waiting: null, asked: null, lastOne: false, pauses: new Set(), cloudMeta: null, tx: { n: 0 }, lastQuestion: '', soundTimer: null,
};
let cfg = store.settings();

const stage = {
  say, pause, listenWait, showPicture, hush, prepare,
  prepareAhead: list => { neural.dropWaiting(); list.forEach(([text, lang]) => prepare(text, lang)); },
  glue: () => cfg.glue, waitForMe: () => cfg.waitForMe,
  onPlace: () => { updateControls(); updateTop(); },
  outOfPages: () => setAnswers([['Bring new pages', () => openSheet('texts')]]),
  lastOne: () => S.lastOne,
  sleep: goToSleep,
  chapterEnd,
};
const story = new StoryRoom(stage);

// ---------- speaking ----------
// Is this German word one of the words written on the picture of this part?
function onPicture(word, seq) {
  if (!seq || !S.hasPicture) return false;
  const w = word.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (w.length < 3) return false;
  const labels = [...(seq.labels || []), ...(seq.nouns || []).map(n => n.de)];
  return labels.some(l => {
    const t = String(l).toLowerCase().replace(/\(.*?\)/g, '').replace(/^(der|die|das|ein|eine)\s+/, '').trim().split(/\s+/)[0] || '';
    if (t.length < 3) return false;
    if (t === w) return true;
    const [a, b] = t.length <= w.length ? [t, w] : [w, t];
    return a.length >= 4 && b.startsWith(a) && b.length - a.length <= 2; // plural and case endings
  });
}
function renderCloud(words, lang, meta) {
  const cloud = $('#cloud');
  cloud.hidden = false;
  cloud.classList.toggle('glue', !!meta.glue);
  $('#cloud-dots').hidden = true;
  $('#cloud-lang').textContent = meta.seq ? (lang === 'de' ? 'Deutsch' : 'English') : '';
  $('#cloud-text').scrollTop = 0;
  const tags = lang === 'de' && meta.seq;
  $('#cloud-text').innerHTML = words.map((w, i) => `<span class="w${tags && onPicture(w, meta.seq) ? ' tag' : ''}" data-i="${i}" data-lang="${lang}">${esc(w)} </span>`).join('');
  S.cloudMeta = { lang, seq: meta.seq || null };
}
let mouthTimer = null;
// With a neural voice her mouth follows the real loudness of the sound, many times a second.
let mouthByLevel = false;
function mouthLevel(v) {
  const m = $('#mouth');
  const want = v < 0.05 ? '' : v < 0.22 ? 'open1' : v < 0.5 ? 'o' : 'open2';
  if (m.className.baseVal !== want) m.className.baseVal = want;
}
function flap(word) {
  if (mouthByLevel) return;
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
  // Long remarks scroll along inside the cloud, so the word being spoken is always in view.
  const box = $('#cloud-text');
  if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight || el.offsetTop < box.scrollTop) box.scrollTop = Math.max(0, el.offsetTop - el.offsetHeight);
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
  alive.spoke(text, meta);
  // While she tells the story, the picture is the stage and she sits small beside it.
  // When she speaks to me directly, she comes forward again.
  if (meta.seq) body.classList.toggle('stage-picture', !!S.hasPicture);
  else if (!meta.glue || meta.toYou) body.classList.remove('stage-picture');
  const de = lang === 'de';
  // A story line is one breath. Her own longer remarks are spoken sentence by sentence.
  const parts = meta.seq ? [text] : voice.sentences(text);
  let r = 'end', offset = 0;
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const base = offset;
    const voiceName = de ? cfg.voiceDe : cfg.voiceEn;
    const rate = de ? cfg.rateDe * (cfg.slowDe ? 0.72 : 1) : cfg.rateEn;
    const n = neural.parse(voiceName);
    r = 'fallback';
    if (n && neural.ENGINES[n.engine].lang === lang) {
      if (k === 0) parts.slice(1).forEach(x => prepare(x, lang)); // her other sentences are made while the first one plays
      if (neural.state[n.engine].state === 'ready' && !S.waitingDots) { S.waitingDots = setTimeout(() => { if (id === S.sayId) $('#cloud-dots').hidden = false; }, 450); }
      r = await neural.speak(part, { ...n, rate, slow: de && cfg.slowDe, onWord: i => revealWord(base + i), onLevel: mouthLevel, onStart: () => { mouthByLevel = true; clearTimeout(S.waitingDots); S.waitingDots = null; $('#cloud-dots').hidden = true; } });
      clearTimeout(S.waitingDots); S.waitingDots = null; mouthByLevel = false;
      if (id === S.sayId) $('#cloud-dots').hidden = true;
    }
    if (r === 'fallback') {
      if (id !== S.sayId) { r = 'stopped'; break; }
      r = await voice.speak(part, {
        lang: de ? 'de-DE' : 'en-GB',
        voiceName: n ? '' : voiceName,
        rate,
        pitch: de ? cfg.pitchDe : cfg.pitchEn,
        onWord: i => revealWord(base + i),
        onStart: info => { if (info.silent) silentNote(lang); },
      });
    }
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
// With a neural voice, coming lines are made while the current one plays, so there is no gap.
function prepare(text, lang) {
  if (!text) return;
  const n = neural.parse(lang === 'de' ? cfg.voiceDe : cfg.voiceEn);
  if (!n || neural.ENGINES[n.engine].lang !== lang) return;
  const rate = lang === 'de' ? cfg.rateDe * (cfg.slowDe ? 0.72 : 1) : cfg.rateEn;
  try { neural.prepare(text, { ...n, rate }); } catch { /* she will make it when needed */ }
}
// Start loading the chosen neural voices, so they are ready by the time she speaks.
function warmVoices() {
  cfg = store.settings();
  for (const name of [cfg.voiceEn, cfg.voiceDe]) { const n = neural.parse(name); if (n && neural.state[n.engine].state === 'off') neural.load(n.engine).catch(() => {}); }
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
  neural.dropWaiting();
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
let turning = 0;
async function showPicture(seq, moment) {
  const paper = $('#paper'), img = $('#picture');
  const t = seq.title || {};
  const caption = [t.de, t.en].filter(Boolean).join('  ·  ');
  const path = await store.imagePath(story.journey.id, seq.n);
  const url = await imageURL(path);
  const key = seq.n + url;
  S.hasPicture = !!url;
  const apply = () => {
    $('#caption').textContent = caption;
    $('#no-picture').hidden = !!url; img.hidden = !url; paper.classList.toggle('empty', !url);
    if (url && img.getAttribute('src') !== url) img.src = url;
  };
  if (moment && shown && shown !== key) {
    // A new part: the old picture turns away like a page, and the new one turns in.
    const my = ++turning;
    paper.classList.remove('turn-in', 'reveal'); paper.classList.add('turn-out');
    sounds.pageTurn();
    $('#grandma').classList.remove('turning'); void $('#grandma').getBoundingClientRect(); $('#grandma').classList.add('turning');
    await sleep(420);
    if (my !== turning) return !!url;
    apply();
    paper.classList.remove('turn-out'); void paper.offsetWidth; paper.classList.add('turn-in');
    setTimeout(() => { if (my === turning) paper.classList.remove('turn-in'); }, 700);
  } else {
    apply();
    if (moment && shown !== key) { paper.classList.remove('reveal'); void paper.offsetWidth; paper.classList.add('reveal'); }
  }
  img.classList.toggle('other-way', seq.n % 2 === 0);
  shown = key;
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
  if (g.kind === 'nobook') { setAnswers([['Choose a book', () => openSheet('books')], ['I already have my journeys', () => openSheet('books'), true]]); return; }
  if (g.kind === 'nopages' || g.kind === 'nomore') { setAnswers([['Bring new pages', () => openSheet('texts')], ['A little tea instead', enterTea, true]]); return; }
  if (g.kind === 'fresh' && !story.journey.startLang) {
    ask({ german: start('de'), english: start('en') }, [['Deutsch zuerst', start('de')], ['English first', start('en')]]);
    return;
  }
  ask({ yes: begin, no: later }, [[g.kind === 'fresh' ? 'Yes, let us start' : 'Yes, go on', begin], ['Not yet', later, true]]);
}

// The keepsake at the end of a chapter: a closing line and all its pictures together.
async function chapterEnd(chapter, parts) {
  const pics = [];
  for (const q of parts) { const url = await imageURL(await store.imagePath(story.journey.id, q.n)); if (url) pics.push({ url, q }); }
  const album = $('#album');
  if (pics.length) {
    $('#album-title').textContent = chapter?.title || 'This chapter';
    $('#album-grid').innerHTML = pics.map(({ url, q }) => `<figure><img src="${url}" alt=""><figcaption>${esc(q.title?.en || '')}</figcaption></figure>`).join('');
    album.hidden = false;
  }
  const r = await say(pick(pics.length ? GLUE.chapter : GLUE.chapterPlain), 'en', { glue: true, toYou: true });
  if (r === 'stopped') { album.hidden = true; return true; }
  await listenWait(cfg.waitForMe ? 0 : 9000);
  album.hidden = true;
  return true; // she has already asked whether to go on
}

// Bedtime: after her good night she dozes off again, and the place is kept.
function goToSleep() {
  S.lastOne = false; S.awake = false;
  clearAsk();
  ambience();
  setTimeout(() => { if (!S.awake) { body.classList.add('asleep'); $('#cloud').hidden = true; } }, 1400);
  updateControls(); updateTop();
  store.sync().catch(() => {});
}
// Jump to any part from the contents list and start telling it.
function goPart(n) {
  if (!story.seq(n)) return;
  closeSheet();
  if (!S.awake) { S.awake = true; body.classList.remove('asleep'); voice.unlock(); sounds.unlock(); neural.unlock(); warmVoices(); ambience(); if (cfg.mic && !ears.on) ears.start(cfg.micLang); }
  if (S.room !== 'story') setRoom('story');
  clearAsk();
  story.goTo(n);
  story.play();
}

// ---------- the room follows the clock ----------
function timeOfDay(h = new Date().getHours()) { return h >= 6 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night'; }
function setTime() {
  const t = timeOfDay();
  if (S.time !== t) { ['morning', 'afternoon', 'evening', 'night'].forEach(x => body.classList.toggle('time-' + x, x === t)); S.time = t; }
  ambience();
}
function ambience() { sounds.ambience(S.awake ? S.room : 'off', S.time || timeOfDay()); }

// ---------- rooms ----------
function setRoom(room) {
  S.room = room;
  alive.stir(5200);
  if (room === 'tea') body.classList.remove('stage-picture');
  body.classList.toggle('room-tea', room === 'tea');
  body.classList.toggle('room-story', room === 'story');
  $('#room-label').textContent = room === 'tea' ? SWITCH.story : SWITCH.tea;
  $('#btn-room').querySelector('[data-icon]').innerHTML = icon(room === 'tea' ? 'book' : 'tea');
  ambience();
  $('#btn-room').title = room === 'tea' ? `Back to the story (say "${SWITCH.story}")` : `Put the book down and chat (say "${SWITCH.tea}")`;
  updateTop();
}
async function enterTea() {
  if (S.room === 'tea') return;
  story.pause(); clearAsk();
  setRoom('tea');
  $('#btn-ask-claude').hidden = true;
  sounds.clink();
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
  if (/\b(my words|word jar|words i (asked|tapped|looked)|meine w(ö|o)rter|vocabulary|vokabeln)\b/i.test(text)) { wordJar(); return; }
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
    case 'bedtime':
      if (S.room !== 'story') return;
      S.lastOne = !S.lastOne; updateControls();
      toast(S.lastOne ? 'This part is the last one for tonight. Then Grandma says good night.' : 'All right, no bedtime yet.');
      return;
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
  alive.stir();
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
    if (['repeat', 'repeatSeq', 'slower', 'faster', 'words', 'bedtime'].includes(cmd)) { act(cmd); return; }
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
  if (hit.meaning) {
    pop.innerHTML = `<b>${esc(hit.word)}</b> = ${esc(hit.meaning)}<small>${esc(hit.source)}</small>`;
  } else {
    // Not in the word list: show how she tells this moment in the other language.
    const inTexts = el.closest('p[data-i]');
    const i = inTexts ? +inTexts.dataset.i : (S.nowLine && seq && S.nowLine.n === seq.n && S.nowLine.lang === lang ? S.nowLine.i : -1);
    const line = i >= 0 ? matchingLine(seq, lang, i) : '';
    hit.context = line;
    pop.innerHTML = line
      ? `<b>${esc(hit.word)}</b><br><span class="pop-line">${esc(line)}</span><small>${lang === 'de' ? 'The same moment in English. Find the word in it.' : 'The same moment in German.'}</small>`
      : `<b>${esc(hit.word)}</b><small>Not in this part's word list. Ask Grandma in the tea room.</small>`;
  }
  place();
  if (hit.meaning || hit.context) keepWord(el, hit, seq);
}

// ---------- the word jar ----------
// Every word I tap for its meaning is kept, with the line it came from.
// It lives in its own file. The tea room reads it; the story never does.
const jarPath = () => store.jpath(story.journey.id, 'words.json');
async function keepWord(el, hit, seq) {
  if (!story.journey) return;
  const lang = el.dataset.lang || 'de';
  const w = el.textContent.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!w) return;
  const line = el.closest('p')?.textContent.trim() || $('#cloud-text').textContent.trim();
  const jar = (await store.getJSON(jarPath())) || [];
  const old = jar.find(x => x.w.toLowerCase() === w.toLowerCase() && x.lang === lang);
  if (old) { old.count = (old.count || 1) + 1; old.at = Date.now(); }
  else jar.push({ w, m: hit.meaning || '', ctx: hit.meaning ? '' : hit.context, lang, n: seq?.n || 0, line, at: Date.now(), seen: 0, count: 1 });
  await store.putJSON(jarPath(), jar, { lazy: true });
}
async function wordJar() {
  if (!story.journey) return;
  if (S.room !== 'tea') { await enterTea(); if (S.room !== 'tea') return; }
  $('#btn-ask-claude').hidden = true;
  const jar = (await store.getJSON(jarPath())) || [];
  if (!jar.length) { say('Your word jar is still empty, my dear. Switch on the meanings and tap a word while I tell. I will keep every one for you.', 'en', {}); return; }
  // Three at a time: the ones we have looked at least, oldest first.
  const few = [...jar].sort((a, b) => (a.seen || 0) - (b.seen || 0) || a.at - b.at).slice(0, 3);
  const steps = [[pick(['Ahh, your words. Let us look at a few.', 'Hmm, yes. Let me take a few out of your jar.']), 'en']];
  few.forEach((x, i) => {
    steps.push([i ? pick(['Here is another of yours.', 'And this one.']) : 'You asked me about this one.', 'en']);
    steps.push([x.w, x.lang]);
    if (x.m) steps.push([`That means: ${x.m}.`, 'en']);
    if (x.line && x.line.split(/\s+/).length > 1) { steps.push(['I said it like this.', 'en']); steps.push([x.line, x.lang]); }
    if (!x.m && x.ctx) { steps.push([x.lang === 'de' ? 'And in English, I told it like this.' : 'And in German, like this.', 'en']); steps.push([x.ctx, x.lang === 'de' ? 'en' : 'de']); }
  });
  steps.push([jar.length > few.length ? `That is enough for now. There are ${jar.length - few.length} more in your jar for another day.` : 'And that is your whole jar, my dear. Well done.', 'en']);
  for (const [text, lang] of steps) {
    const r = await say(text, lang, {});
    if (r === 'stopped' || S.room !== 'tea') return;
    await pause(lang === 'de' ? 500 : 250);
  }
  few.forEach(x => { x.seen = Date.now(); });
  await store.putJSON(jarPath(), jar, { lazy: true });
}

// ---------- chrome ----------
function updateTop() {
  const j = story.journey;
  $('#top-title').textContent = j ? j.title : 'Choose a book';
  const cur = story.current, total = story.seqs.length;
  let place = '';
  if (j && total) place = cur ? `Part ${cur.n} of ${story.seqs[total - 1].n}` : `All ${total} parts told`;
  if (S.room === 'tea') place = 'Tea room · ' + (place || 'free chat');
  $('#top-place').textContent = place; $('#top-place').hidden = !place;
}
function updateControls() {
  cfg = store.settings();
  $('#btn-play').querySelector('[data-icon]').innerHTML = icon(story.playing ? 'pause' : 'play');
  $('#btn-slow').classList.toggle('on', cfg.slowDe);
  $('#btn-night').classList.toggle('on', S.lastOne);
  $('#btn-cloud').classList.toggle('on', cfg.cloud);
  $('#btn-meanings').classList.toggle('on', cfg.meanings);
  $('#btn-mic').classList.toggle('on', cfg.mic && ears.on);
  $('#btn-mic').classList.toggle('live', !!ears.live);
  $('#btn-texts').classList.toggle('on', !$('#texts').hidden);
  // A dot on "More" when something inside it is switched away from its usual state.
  $('#more-dot').hidden = !((cfg.mic && ears.on) || cfg.meanings || cfg.slowDe || S.lastOne || !cfg.cloud);
  body.classList.toggle('no-cloud', !cfg.cloud);
  body.classList.toggle('drift', !!cfg.drift);
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
  const days = store.tokenDaysLeft();
  const tokenSoon = days !== null && days <= 14;
  b.hidden = false; b.classList.toggle('err', !!st.error); b.classList.toggle('warn', !st.error && tokenSoon);
  b.textContent = st.busy ? 'Saving…' : st.error ? 'Not saved: tap'
    : tokenSoon ? (days <= 0 ? 'Token has expired: tap' : `Token expires in ${days} day${days === 1 ? '' : 's'}`)
    : st.last ? `Saved ${ago(st.last)}` : (be === 'github' ? 'Saved to GitHub' : 'Saved to folder');
  b.title = st.error || (be === 'github' ? 'Saved in your GitHub repository' : 'Saved in your folder');
}

async function selectJourney(id) {
  hush(); clearAsk();
  cfg = store.saveSettings({ current: id || '' });
  await story.load(id);
  S.tx.n = 0; shown = '';
  if (story.current) showPicture(story.current, false);
  else { $('#picture').hidden = true; $('#no-picture').hidden = false; $('#caption').textContent = ''; }
  $('#no-picture-text').textContent = story.journey ? 'The picture for this part is not drawn yet.' : 'Here Grandma shows you a picture for every part.';
  $('#no-picture-go').hidden = !story.current;
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
  voice.unlock(); sounds.unlock(); neural.unlock(); warmVoices(); ambience();
  alive.stir(3600);
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
  $('#sync-badge').onclick = () => { if (store.syncState.error || $('#sync-badge').classList.contains('warn')) openSheet('settings'); };
  setInterval(syncBadge, 30000);
  $('#top-place').onclick = () => openSheet('contents');
  $('#btn-night').onclick = () => act('bedtime');
  // The tray stays open while you switch things in it, and closes when you tap anywhere else.
  const tray = on => { $('#more-tray').hidden = !on; $('#btn-more').setAttribute('aria-expanded', String(on)); };
  $('#btn-more').onclick = e => { e.stopPropagation(); tray($('#more-tray').hidden); };
  $('#more-tray').onclick = e => { e.stopPropagation(); if (e.target.closest('#btn-repeat-seq')) tray(false); };
  // A tap outside the open tray only closes it. It does not also press whatever was underneath.
  document.addEventListener('click', e => {
    if ($('#more-tray').hidden || e.target.closest('#more-tray, #btn-more')) return;
    tray(false);
    if (!e.target.closest('#controls')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  const toPicture = () => (story.current ? openSheet('pictures', { n: story.current.n }) : openSheet(story.journey ? 'texts' : 'books'));
  $('#no-picture').onclick = toPicture;
  $('#no-picture').onkeydown = e => { if (e.key === 'Enter') toPicture(); };
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
  document.addEventListener('pointerdown', () => { voice.unlock(); neural.unlock(); }, { once: true });
  voice.onStop(neural.stop);
  $('#picture').onclick = () => { const lb = $('#lightbox'); lb.querySelector('img').src = $('#picture').src; lb.hidden = false; };
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; };
  $('#album').onclick = () => { if (!nudge()) $('#album').hidden = true; };
  $('#btn-jar').onclick = () => wordJar();

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { if (!$('#more-tray').hidden) { $('#more-tray').hidden = true; $('#btn-more').setAttribute('aria-expanded', 'false'); } else if (!$('#lightbox').hidden) $('#lightbox').hidden = true; else if (sheetOpen()) closeSheet(); else if (!$('#texts').hidden) closeTexts(); return; }
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
  const measure = () => { const r = document.documentElement.style; r.setProperty('--ctl-h', $('#controls').offsetHeight + 'px'); r.setProperty('--top-h', $('#top').offsetHeight + 'px'); };
  measure(); window.addEventListener('resize', measure); const ro = new ResizeObserver(measure); ro.observe($('#controls')); ro.observe($('#top'));

  alive.init();

  store.onChange(ev => {
    if (ev.type === 'sync') { syncBadge(); if (ev.pulled) { if (!story.journey) boot(true); else refresh(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.sync().catch(() => {}); });
  window.addEventListener('pagehide', () => { store.sync().catch(() => {}); });
}

async function boot(again) {
  cfg = store.settings();
  const js = await store.journeys();
  const id = js.find(j => j.id === cfg.current)?.id || js[0]?.id || '';
  await selectJourney(id);
  if (again) return;
  setRoom('story'); syncBadge();
  setTime(); setInterval(setTime, 5 * 60000);
  if (cfg.backend !== 'browser') store.sync().catch(() => {});
  voice.whenVoicesReady();
  // If the microphone was allowed before, she can already hear a "hello" while dozing.
  if (cfg.mic && earsSupported && navigator.permissions?.query) {
    try { const p = await navigator.permissions.query({ name: 'microphone' }); if (p.state === 'granted') { ears.start(cfg.micLang); updateControls(); } } catch { /* not supported */ }
  }
}

export const ctx = { greet: () => { if (S.awake) { hush(); greet(); } }, voice, neural, warmVoices, sounds, ambience, goPart, paintIcons, icon, story, selectJourney, refresh, toast, copy, hush, imageURL, say, setMic, updateControls, ears, understand };
wire();
initPanels(ctx);
boot();
window.__grandma = { S, story, store, act, onHeard, teaHear, wake, ears };
