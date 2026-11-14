// Grandma's voice. Uses the voices built into the browser and device (free, no key).
// Speaks one breath at a time and reports each word as it is spoken, so the
// speech cloud can type along. If a device gives no word events, timing is estimated.

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Best-first name patterns. Earlier means preferred.
const RANK = {
  de: [
    /seraphina.*(natural|online)/i, /katja.*(natural|online)/i, /amala.*(natural|online)/i,
    /(natural|online).*german \(germany\)/i,
    /petra.*(premium|enhanced)/i, /anna.*(premium|enhanced)/i, /(premium|enhanced)/i,
    /google deutsch/i, /katja/i, /hedda/i, /petra/i, /anna/i, /helena/i, /marlene/i, /vicki/i,
  ],
  en: [
    /sonia.*(natural|online)/i, /libby.*(natural|online)/i, /emma.*(natural|online)/i, /ava.*(natural|online)/i,
    /michelle.*(natural|online)/i, /jenny.*(natural|online)/i, /aria.*(natural|online)/i,
    /serena.*(premium|enhanced)/i, /kate.*(premium|enhanced)/i, /(zoe|ava|allison|samantha|karen|moira).*(premium|enhanced)/i,
    /google uk english female/i, /serena/i, /kate/i, /moira/i, /karen/i, /samantha/i, /hazel/i, /susan/i, /zira/i,
    /female/i,
  ],
};
const MALE = /\b(male|conrad|killian|florian|stefan|markus|yannick|martin|ryan|guy|thomas|daniel|george|david|mark|james|christopher|eric|roger|steffan|andrew|brian|william|arthur|oliver|fred|ralph|albert|reed|rocko|eddy|grandpa|google uk english male|bernd|ralf|klaus|otto|hans|viktor)\b/i;
const NOVELTY = /\b(bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|shelley|sandy|flo|eddy|reed|rocko|grandpa|albert|bahh)\b/i;

export function allVoices() { return synth ? synth.getVoices() : []; }

export function voicesFor(lang) {
  const base = lang.slice(0, 2).toLowerCase();
  return allVoices().filter(v => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base));
}

function score(v, lang) {
  const base = lang.slice(0, 2);
  let s = 0;
  const i = RANK[base].findIndex(re => re.test(v.name));
  s += i >= 0 ? 100 - i * 4 : 20;
  if (MALE.test(v.name)) s -= 60;          // a grandmother is wanted
  if (NOVELTY.test(v.name)) s -= 50;
  const l = (v.lang || '').replace('_', '-');
  if (base === 'de') s += /de-DE/i.test(l) ? 15 : /de-AT/i.test(l) ? 5 : 0;   // a voice from Germany first
  if (base === 'en') s += /en-GB/i.test(l) ? 6 : /en-US/i.test(l) ? 4 : 0;
  if (/multilingual/i.test(v.name) && base === 'en') s -= 2;
  return s;
}

const ranked = new Map();
if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', () => ranked.clear());
export function rankedVoices(lang) {
  const key = lang.slice(0, 2);
  const all = allVoices();
  const hit = ranked.get(key);
  if (hit && hit.n === all.length) return hit.list;
  const list = voicesFor(lang).map(v => ({ v, s: score(v, lang) })).sort((a, b) => b.s - a.s).map(x => x.v);
  ranked.set(key, { n: all.length, list });
  return list;
}

export function pickVoice(lang, wantedName) {
  const list = rankedVoices(lang);
  return list.find(v => v.name === wantedName) || list[0] || null;
}

export function whenVoicesReady(timeout = 2500) {
  return new Promise(res => {
    if (!synth) return res([]);
    if (synth.getVoices().length) return res(synth.getVoices());
    const done = () => { synth.removeEventListener('voiceschanged', done); res(synth.getVoices()); };
    synth.addEventListener('voiceschanged', done);
    setTimeout(done, timeout);
  });
}

// What is written and what is said differ a little: some engines spell out "Mm".
const SAY = {
  en: [[/\bM+m+h?\b/g, 'Hmm'], [/\bA+h+h\b/g, 'Ah'], [/\bO+h+h\b/g, 'Oh'], [/\bH+m+m+\b/g, 'Hmm']],
  de: [[/\bM+m+h?\b/g, 'Hm'], [/\bH+m+m+\b/g, 'Hm'], [/\bA+h+h\b/g, 'Ah']],
};
export function sayable(text, lang) {
  let t = text.replace(/\[[^\]]*\]/g, ' ').replace(/[«»„“”]/g, '"').replace(/\s+/g, ' ').trim();
  for (const [re, to] of SAY[lang.slice(0, 2)] || []) t = t.replace(re, to);
  return t;
}
export const displayWords = text => text.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean);

let token = 0;
let active = null; // finishes the breath that is being spoken right now

let stopNeural = null; // set by app.js, so that this file does not depend on neural.js
export function onStop(fn) { stopNeural = fn; }
export function stop() {
  token++;
  stopNeural && stopNeural();
  if (active) { const f = active; active = null; f('stopped'); }
  if (synth) { try { synth.cancel(); } catch { /* nothing to cancel */ } }
}

// Speak one breath. Resolves 'end' when finished, 'stopped' if cut off.
// onWord(i) is called with the index of each displayed word as it starts.
export function speak(text, opts = {}) {
  const { lang = 'en-GB', voiceName = '', rate = 1, pitch = 1, onWord, onStart } = opts;
  const my = ++token;
  const shown = displayWords(text);
  const spoken = sayable(text, lang);
  const sw = spoken.split(/\s+/).filter(Boolean);
  // Word starts in the spoken string, to map boundary events to word numbers.
  const starts = []; { let pos = 0; for (const w of sw) { const at = spoken.indexOf(w, pos); starts.push(at); pos = at + w.length; } }
  const total = spoken.length || 1;
  const estMs = Math.max(500, (total * 68 + sw.length * 35) / Math.max(0.3, rate));
  const mapIdx = i => Math.min(shown.length - 1, Math.round(i * (shown.length / Math.max(1, sw.length))));

  return new Promise(resolve => {
    let finished = false, timers = [], gotBoundary = false, last = -1;
    const emit = i => { const k = mapIdx(i); if (k > last && my === token) { for (let j = last + 1; j <= k; j++) onWord && onWord(j); last = k; } };
    const clear = () => { timers.forEach(clearTimeout); timers = []; };
    const finish = how => {
      if (finished) return; finished = true; clear();
      if (active === finish) active = null;
      if (how === 'end' && my === token) emit(sw.length - 1);
      resolve(my === token ? how : 'stopped');
    };
    active = finish;
    const estimate = () => {
      // Type the words on a clock, in case the device sends no word events.
      sw.forEach((w, i) => timers.push(setTimeout(() => { if (!gotBoundary) emit(i); }, (starts[i] / total) * estMs)));
    };
    const voice = pickVoice(lang, voiceName);
    if (!synth || !window.SpeechSynthesisUtterance || !voice || !spoken) {
      // No voice for this language on this device: stay silent but keep the story moving.
      onStart && onStart({ silent: true });
      estimate();
      timers.push(setTimeout(() => finish('end'), estMs + 250));
      return;
    }
    const u = new SpeechSynthesisUtterance(spoken);
    u.voice = voice; u.lang = voice.lang || lang; u.rate = rate; u.pitch = pitch; u.volume = 1;
    let started = false;
    u.onstart = () => {
      if (started) return; started = true;
      onStart && onStart({ silent: false, voice: voice.name });
      estimate();
      timers.push(setTimeout(() => finish('end'), estMs * 2.2 + 5000)); // if the end event never comes
    };
    u.onboundary = e => {
      if (e.name && e.name !== 'word') return;
      gotBoundary = true;
      let i = starts.findIndex((s, k) => e.charIndex >= s && (k === starts.length - 1 || e.charIndex < starts[k + 1]));
      if (i < 0) i = 0;
      emit(i);
    };
    u.onend = () => finish('end');
    u.onerror = e => finish(e.error === 'interrupted' || e.error === 'canceled' ? 'stopped' : 'end');
    // If the engine never starts (sound blocked, or no audio device), go on silently.
    timers.push(setTimeout(() => { if (!started && !finished) { started = true; onStart && onStart({ silent: true }); estimate(); timers.push(setTimeout(() => finish('end'), estMs + 250)); } }, 1800));
    // Only when something is still being said does the engine need a moment to clear it.
    const busy = synth.speaking || synth.pending;
    if (busy) { try { synth.cancel(); } catch { /* fine */ } }
    const go = () => { if (my === token) { try { synth.speak(u); } catch { finish('end'); } } else finish('stopped'); };
    if (busy) setTimeout(go, 40); else go();
    window.__lastUtterance = u; // keeps it from being garbage collected mid-sentence (old Chrome bug)
  });
}

// Phones only let a page speak after a touch. Call this right inside the first tap.
let unlocked = false;
export function unlock() {
  if (unlocked || !synth || !window.SpeechSynthesisUtterance) return;
  unlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch { /* fine */ }
}
// Long remarks are spoken sentence by sentence: some browsers cut off long utterances.
export const sentences = text => text.split(/(?<=[.!?…])\s+/).filter(Boolean);

export function describeVoice(v) {
  if (!v) return 'none';
  return `${v.name} (${v.lang}${v.localService ? ', on this device' : ', online'})`;
}
