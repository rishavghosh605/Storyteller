// The sound corner: a third room where Grandma practises German sounds with you.
// It does not depend on the story. Examples come from the parts you have heard when they
// can, and from a built-in list when not. What is still weak is remembered (phonics.js).
import * as store from './store.js';
import { SOUNDS, byId, findExamples, highlight, emptyProgress, record, flagBad, strength, level, todayIds, buildTest, heardTarget } from './phonics.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PATH = 'practice/sound-progress.json'; // the name ends in "progress.json": two devices keep the newer one
const LEVEL = { new: 'not tried yet', weak: 'still weak', fair: 'getting there', good: 'good' };

let ctx = null, root = null, progress = emptyProgress();
let run = 0;              // every new action stops what Grandma was doing
let view = { name: 'menu' };
let session = null;       // { ids: [...], i } while "today's sounds" is running
let test = null;          // { qs, i, right, answered }
let rec = null;           // the recording in progress or just finished

export function initPractice(c) { ctx = c; root = $('#practice'); root.onclick = onClick; }

export async function open() {
  progress = { ...emptyProgress(), ...((await store.getJSON(PATH)) || {}) };
  progress.sounds = progress.sounds || {}; progress.bad = progress.bad || [];
  session = null; test = null;
  showMenu();
}
export function close() {
  run++; dropRecording();
  if (root) root.innerHTML = '';
  session = null; test = null;
}
const save = () => store.putJSON(PATH, progress, { lazy: true });
const stale = my => my !== run;

// ---------- Grandma speaks ----------
const sayEn = text => ctx.say(text, 'en', { drill: true });
const sayDe = (w, slow = true) => ctx.say(w, 'de', { drill: true, slow });
const wait = ms => new Promise(r => setTimeout(r, ms));
function stopSpeaking() { run++; ctx.hush(); return run; }

// ---------- menu ----------
function showMenu() {
  view = { name: 'menu' };
  const today = todayIds(progress);
  root.innerHTML = `
    <h2>Sound corner</h2>
    <p class="pr-lead">German sounds, a few minutes at a time. Pick one, or let me choose.</p>
    <div class="pr-actions">
      <button class="btn primary" data-act="today">Today's sounds<small>${today.map(id => esc(byId(id).spell)).join(' · ')}</small></button>
      <button class="btn" data-act="test">Hearing test<small>which word did I say?</small></button>
    </div>
    <div class="pr-grid">${SOUNDS.map(s => { const lv = level(strength(progress, s.id)); return `<button class="pr-chip lv-${lv}" data-act="sound" data-id="${s.id}" title="${LEVEL[lv]}"><b>${esc(s.spell)}</b><small>${LEVEL[lv]}</small></button>`; }).join('')}</div>
    <p class="pr-legend"><i class="lv-new"></i>new <i class="lv-weak"></i>weak <i class="lv-fair"></i>getting there <i class="lv-good"></i>good. What is weak comes back first.</p>`;
}

// ---------- a sound ----------
function showSound(id, intro = true) {
  const s = byId(id);
  const my = stopSpeaking();
  dropRecording();
  const examples = findExamples(s, ctx.vocab(), progress.bad);
  view = { name: 'sound', id, examples, target: examples[0]?.w || '' };
  const lv = level(strength(progress, id));
  const where = session ? `<span class="pr-step">${session.i + 1} of ${session.ids.length}</span>` : '';
  root.innerHTML = `
    <div class="pr-top"><button class="btn" data-act="menu">‹ All sounds</button>${where}</div>
    <h2 class="pr-spell">${esc(s.spell)}</h2>
    <p class="pr-hint">${esc(s.hint)} <span class="pr-lv lv-${lv}">${LEVEL[lv]}</span></p>
    <ul class="pr-words">${examples.map(e => wordRow(e, s)).join('')}</ul>
    ${s.pair ? `<div class="pr-pair"><p>Hear the difference</p><div class="row">
      <button class="btn" data-act="say" data-w="${esc(s.pair[0][0])}">▶ ${esc(s.pair[0][0])}<small>${esc(s.pair[0][1])}</small></button><span>or</span>
      <button class="btn" data-act="say" data-w="${esc(s.pair[1][0])}">▶ ${esc(s.pair[1][0])}<small>${esc(s.pair[1][1])}</small></button></div></div>` : ''}
    <div class="pr-turn" id="pr-turn">${turnHTML()}</div>
    <div class="pr-foot"><button class="btn primary" data-act="next">${session && session.i + 1 >= session.ids.length ? 'Finish' : 'Next sound ›'}</button></div>`;
  if (intro) (async () => {
    await wait(250); if (stale(my)) return;
    if ((await sayEn(s.hint)) === 'stopped' || stale(my)) return;
    for (const e of examples) { await wait(350); if (stale(my)) return; if ((await sayDe(e.w)) === 'stopped' || stale(my)) return; }
  })();
}
function wordRow(e, s) {
  const [a, m, b] = highlight(e.w, s);
  return `<li class="pr-word${view.target === e.w ? ' picked' : ''}" data-w="${esc(e.w)}">
    <span class="pr-w">${esc(a)}<b>${esc(m)}</b>${esc(b)}</span>
    <small class="pr-en">${esc(e.en)}${e.story ? ' · from your story' : ''}</small>
    <span class="pr-btns"><button data-act="say" data-w="${esc(e.w)}" title="Hear it">▶</button><button data-act="slow" data-w="${esc(e.w)}" title="Hear it slowly">▶ slow</button><button data-act="pick" data-w="${esc(e.w)}">Say it</button><button class="pr-flag" data-act="flag" data-w="${esc(e.w)}" title="This did not sound right">not right?</button></span>
  </li>`;
}
function turnHTML() {
  const w = view.target;
  if (!w) return '';
  if (rec?.state === 'recording') return `<p>Say <b class="pr-target">${esc(w)}</b> now…</p><div class="row"><button class="btn primary rec-live" data-act="stop">■ Stop</button></div>`;
  if (rec?.state === 'done') return `<p>You said <b class="pr-target">${esc(w)}</b>. Listen to both.</p>
    <div class="row"><button class="btn" data-act="hear-g">▶ Grandma</button><button class="btn" data-act="hear-me">▶ Me</button><button class="btn" data-act="hear-both">▶ Both</button></div>
    <p class="hint" id="pr-hint">${hintText()}</p>
    <p>How did mine sound next to hers?</p>
    <div class="row"><button class="btn primary" data-act="rate" data-ok="1">Close enough</button><button class="btn" data-act="rate" data-ok="0">Not yet</button></div>`;
  if (rec?.state === 'rated') return `<p class="pr-saved">${rec.ok ? 'Good. I will ask less often.' : 'Saved. This sound will come back.'}</p><div class="row"><button class="btn" data-act="rec">● Again</button></div>`;
  return `<p>Your turn: <b class="pr-target">${esc(w)}</b> <small>(tap “Say it” on another word to change it)</small></p><div class="row"><button class="btn primary" data-act="rec">● Record</button></div>`;
}
function renderTurn() { const el = $('#pr-turn'); if (el) el.innerHTML = turnHTML(); document.querySelectorAll('.pr-word').forEach(li => li.classList.toggle('picked', li.dataset.w === view.target)); }

// ---------- recording and comparing ----------
function dropRecording() {
  if (!rec) return;
  try { rec.mr && rec.mr.state !== 'inactive' && (rec.mr.onstop = null, rec.mr.stop()); } catch { /* already stopped */ }
  try { rec.stream && rec.stream.getTracks().forEach(t => t.stop()); } catch { /* no stream */ }
  try { rec.sr && rec.sr.abort(); } catch { /* not running */ }
  clearTimeout(rec.timer);
  if (rec.url) URL.revokeObjectURL(rec.url);
  rec = null;
}
async function startRecording() {
  if (!view.target) return;
  stopSpeaking();
  dropRecording();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { ctx.toast('This browser cannot record. Chrome, Edge and Safari can.', 6000); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { ctx.toast('The microphone is not allowed for this page.', 6000); return; }
  const mine = rec = { state: 'recording', stream, chunks: [], heard: [], target: view.target, id: view.id };
  const mr = mine.mr = new MediaRecorder(stream);
  mr.ondataavailable = e => { if (e.data && e.data.size) mine.chunks.push(e.data); };
  mr.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    if (rec !== mine) return;
    mine.blob = new Blob(mine.chunks, { type: mr.mimeType || 'audio/webm' });
    mine.url = URL.createObjectURL(mine.blob);
    mine.state = 'done';
    renderTurn();
    // the recogniser may need a moment to give its answer
    setTimeout(() => { const h = $('#pr-hint'); if (h && rec === mine) h.innerHTML = hintText(); }, 1200);
  };
  // A recogniser listens at the same time. It is only a hint: it may not be available, or may not hear.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      const sr = mine.sr = new SR();
      sr.lang = 'de-DE'; sr.maxAlternatives = 5; sr.interimResults = false; sr.continuous = false;
      sr.onresult = e => { for (const r of e.results) for (let k = 0; k < r.length; k++) mine.heard.push(r[k].transcript); };
      sr.onend = () => { const h = $('#pr-hint'); if (h && rec === mine) h.innerHTML = hintText(); };
      sr.onerror = () => { /* a hint only */ };
      sr.start();
    } catch { /* a hint only */ }
  }
  mr.start();
  mine.timer = setTimeout(() => stopRecording(), 4500);
  renderTurn();
}
function stopRecording() {
  if (!rec || rec.state !== 'recording') return;
  clearTimeout(rec.timer);
  try { rec.sr && rec.sr.stop(); } catch { /* not running */ }
  try { rec.mr.stop(); } catch { /* already stopped */ }
}
function hintText() {
  if (!rec) return '';
  if (rec.heard.length) {
    return heardTarget(rec.heard, rec.target)
      ? `The computer heard “${esc(rec.heard[0])}”. That is the word. It is only a hint, so trust your ears too.`
      : `The computer heard “${esc(rec.heard[0])}”. That is not quite the word, so listen closely. It is only a hint.`;
  }
  return 'The computer could not tell what I said. Listen to both and judge yourself.';
}
async function hearMine() {
  if (!rec?.url) return;
  const a = new Audio(rec.url);
  await new Promise(res => { a.onended = res; a.onerror = res; a.play().catch(res); });
}
async function playBoth() {
  const my = stopSpeaking();
  if ((await sayDe(view.target)) === 'stopped' || stale(my)) return;
  await wait(300); if (stale(my)) return;
  await hearMine();
}

// ---------- the hearing test ----------
async function startTest(ids) {
  const my = stopSpeaking();
  dropRecording();
  test = { qs: buildTest(progress, 8), i: 0, right: 0, answered: false, results: {} };
  showQuestion(my);
}
function showQuestion() {
  const q = test.qs[test.i];
  view = { name: 'test' };
  test.answered = false;
  root.innerHTML = `
    <div class="pr-top"><button class="btn" data-act="menu">‹ All sounds</button><span class="pr-step">${test.i + 1} of ${test.qs.length}</span></div>
    <h2>Which word did I say?</h2>
    <div class="pr-choices">${q.options.map((o, k) => `<button class="pr-choice" data-act="answer" data-k="${k}"><b>${esc(o.w)}</b><small>${esc(o.en)}</small></button>`).join('')}</div>
    <div class="row"><button class="btn" data-act="again">▶ Hear it again</button></div>
    <p class="pr-saved" id="pr-fb"></p>`;
  const my = ++run; ctx.hush();
  (async () => { await wait(200); if (!stale(my)) sayDe(q.options[q.say].w, false); })();
}
async function answer(k) {
  const q = test.qs[test.i];
  if (test.answered) return;
  test.answered = true;
  const ok = k === q.say;
  progress = record(progress, q.id, 'hear', ok);
  save();
  test.results[q.id] = ok && test.results[q.id] !== false;
  if (ok) test.right++;
  document.querySelectorAll('.pr-choice').forEach((b, i) => { b.classList.add(i === q.say ? 'right' : (i === k ? 'wrong' : 'off')); b.disabled = true; });
  $('#pr-fb').innerHTML = (ok ? 'Yes, that was ' : 'That was ') + `<b>${esc(q.options[q.say].w)}</b>. ` + `<button class="btn primary" data-act="nextq">${test.i + 1 >= test.qs.length ? 'See how it went' : 'Next ›'}</button>`;
  const my = ++run; ctx.hush();
  await wait(150); if (stale(my)) return;
  // she says both words once, so the difference is heard
  for (const o of q.options) { if ((await sayDe(o.w, false)) === 'stopped' || stale(my)) return; await wait(250); }
}
function showTestDone() {
  view = { name: 'done' };
  const weak = Object.entries(test.results).filter(([, ok]) => !ok).map(([id]) => id);
  root.innerHTML = `
    <h2>${test.right} of ${test.qs.length}</h2>
    <p class="pr-lead">${weak.length ? 'These are the sounds to listen to more:' : 'You heard every difference. That is good.'}</p>
    <div class="pr-grid">${weak.map(id => `<button class="pr-chip lv-weak" data-act="sound" data-id="${id}"><b>${esc(byId(id).spell)}</b><small>practise</small></button>`).join('')}</div>
    <div class="pr-actions"><button class="btn primary" data-act="test">Another test</button><button class="btn" data-act="menu">All sounds</button></div>`;
  test = null;
  const my = ++run; ctx.hush();
  sayEn(weak.length ? 'Some of them are close. Listen again and again, dear. That is how the ear learns.' : 'Lovely, dear. Your ears are doing well.');
}

// ---------- clicks ----------
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, w = b.dataset.w;
  switch (act) {
    case 'menu': stopSpeaking(); dropRecording(); session = null; test = null; showMenu(); break;
    case 'sound': session = null; showSound(b.dataset.id); break;
    case 'today': { const ids = todayIds(progress); session = { ids, i: 0 }; showSound(ids[0]); break; }
    case 'next': {
      if (session) { session.i++; if (session.i >= session.ids.length) { const done = session.ids; session = null; showSession(done); } else showSound(session.ids[session.i]); }
      else { const k = SOUNDS.findIndex(s => s.id === view.id); showSound(SOUNDS[(k + 1) % SOUNDS.length].id); }
      break;
    }
    case 'test': startTest(); break;
    case 'answer': answer(+b.dataset.k); break;
    case 'again': { const q = test.qs[test.i]; const my = stopSpeaking(); sayDe(q.options[q.say].w, false); break; }
    case 'nextq': test.i++; if (test.i >= test.qs.length) showTestDone(); else showQuestion(); break;
    case 'say': { stopSpeaking(); sayDe(w, false); break; }
    case 'slow': { stopSpeaking(); sayDe(w, true); break; }
    case 'pick': dropRecording(); view.target = w; renderTurn(); stopSpeaking(); sayDe(w, true); break;
    case 'flag': {
      progress = flagBad(progress, w); save();
      ctx.toast('Thank you. I will not use that word again.');
      showSound(view.id, false);
      break;
    }
    case 'rec': startRecording(); break;
    case 'stop': stopRecording(); break;
    case 'hear-g': { stopSpeaking(); sayDe(view.target, true); break; }
    case 'hear-me': stopSpeaking(); hearMine(); break;
    case 'hear-both': playBoth(); break;
    case 'rate': {
      if (!rec || rec.state !== 'done') break;
      const ok = b.dataset.ok === '1';
      progress = record(progress, rec.id, 'say', ok); save();
      rec.state = 'rated'; rec.ok = ok;
      renderTurn();
      break;
    }
  }
}
function showSession(ids) {
  view = { name: 'done' };
  root.innerHTML = `
    <h2>That is enough for now</h2>
    <p class="pr-lead">Today you worked on:</p>
    <div class="pr-grid">${ids.map(id => { const lv = level(strength(progress, id)); return `<button class="pr-chip lv-${lv}" data-act="sound" data-id="${id}"><b>${esc(byId(id).spell)}</b><small>${LEVEL[lv]}</small></button>`; }).join('')}</div>
    <div class="pr-actions"><button class="btn primary" data-act="test">Hearing test</button><button class="btn" data-act="menu">All sounds</button></div>`;
  stopSpeaking();
  sayEn('Well done, dear. A little every day is better than a lot once. Shall we test your ears?');
}
