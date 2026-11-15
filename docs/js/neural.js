// Optional neural voices that run inside this browser: free, no key, a one-time download.
// Kokoro speaks English, Supertonic 3 speaks German. The work happens in a background
// worker (neural-worker.js). Lines are made ahead of time, so she does not hesitate, and
// her mouth follows the real sound.
import { sayable, displayWords } from './voice.js';

export const ENGINES = {
  kokoro: {
    lang: 'en', name: 'Kokoro', size: 'about 90 MB',
    voices: [['bf_lily', 'Lily (British, gentle)'], ['bf_emma', 'Emma (British)'], ['bf_isabella', 'Isabella (British)'], ['af_heart', 'Heart (American)'], ['af_bella', 'Bella (American, warm)'], ['af_nicole', 'Nicole (American, quiet)']],
  },
  supertonic: {
    lang: 'de', name: 'Supertonic', size: 'a few hundred MB',
    voices: [['F1', 'Woman 1'], ['F2', 'Woman 2'], ['F3', 'Woman 3'], ['F4', 'Woman 4'], ['F5', 'Woman 5']],
  },
};
// A neural voice is saved in Settings as "kokoro:bf_lily" or "supertonic:F2".
export function parse(voiceName) {
  const m = /^(kokoro|supertonic):(.+)$/.exec(voiceName || '');
  return m && ENGINES[m[1]] ? { engine: m[1], voice: m[2] } : null;
}
export function label(voiceName) {
  const n = parse(voiceName); if (!n) return '';
  const v = ENGINES[n.engine].voices.find(x => x[0] === n.voice);
  return `${ENGINES[n.engine].name} ${v ? v[1].replace(/\s*\(.*\)/, '') : n.voice}`;
}

export const state = { kokoro: { state: 'off', progress: 0, error: '' }, supertonic: { state: 'off', progress: 0, error: '' } }; // off | loading | ready | failed
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const tell = () => { for (const fn of listeners) { try { fn(state); } catch { /* listener failed */ } } };

const workers = {}, waiting = new Map(), loading = {}, started = new Set();
let nextId = 1;
function worker(engine) {
  if (workers[engine]) return workers[engine];
  const build = document.querySelector('meta[name=build]')?.content || '';
  const w = new Worker(new URL('./neural-worker.js', import.meta.url).href.split('?')[0] + (build ? '?v=' + build : ''), { type: 'module' });
  w.onmessage = e => {
    const m = e.data, st = state[engine];
    if (m.type === 'start') { started.add(m.id); return; }
    if (m.type === 'progress') { if (st.state !== 'ready') { st.state = 'loading'; st.progress = m.progress; tell(); } }
    else if (m.type === 'ready') { st.state = 'ready'; st.progress = 100; st.error = ''; tell(); loading[engine]?.ok(); whenReady[engine].splice(0).forEach(([t, o]) => prepare(t, o)); }
    else if (m.type === 'failed') { st.state = 'failed'; st.error = m.message; tell(); loading[engine]?.fail(new Error(m.message)); delete loading[engine]; }
    else if (m.type === 'clip') { waiting.get(m.id)?.ok({ audio: m.audio, rate: m.rate }); waiting.delete(m.id); started.delete(m.id); }
    else if (m.type === 'error') { waiting.get(m.id)?.fail(new Error(m.message)); waiting.delete(m.id); started.delete(m.id); }
  };
  w.onerror = e => { const st = state[engine]; st.state = 'failed'; st.error = e.message || 'the voice could not start'; tell(); loading[engine]?.fail(new Error(st.error)); delete loading[engine]; };
  return (workers[engine] = w);
}
export function load(engine) {
  if (loading[engine]) return loading[engine].promise;
  const st = state[engine]; st.state = 'loading'; st.progress = 0; st.error = ''; tell();
  const job = {}; job.promise = new Promise((ok, fail) => { job.ok = ok; job.fail = fail; });
  job.promise.catch(() => {});
  loading[engine] = job;
  worker(engine).postMessage({ type: 'load', engine });
  return job.promise;
}

// Make the sound for one breath, or fetch it from memory. Called ahead of time for the coming lines.
const clips = new Map();
const speedFor = (engine, rate) => Math.max(0.5, Math.min(1.4, engine === 'supertonic' ? rate * 1.2 : rate));
// Lines asked for while a voice is still loading are remembered and made as soon as it is ready.
const whenReady = { kokoro: [], supertonic: [] };
export function prepare(text, { engine, voice, rate = 1, first = false }) {
  if (state[engine].state !== 'ready') {
    // Not loaded yet: start loading now, and remember the line so it is made the moment the voice is ready.
    if (state[engine].state === 'off') load(engine).catch(() => {});
    if (state[engine].state === 'loading' && !first && whenReady[engine].length < 150) whenReady[engine].push([text, { engine, voice, rate }]);
    return null;
  }
  const lang = ENGINES[engine].lang;
  const spoken = sayable(text, lang);
  if (!spoken) return null;
  const speed = speedFor(engine, rate);
  const key = `${engine}|${voice}|${speed.toFixed(2)}|${spoken}`;
  if (!clips.has(key)) {
    const id = nextId++;
    const job = new Promise((ok, fail) => waiting.set(id, { ok, fail }));
    job.id = id; job.engine = engine;
    job.catch(() => { if (clips.get(key) === job) clips.delete(key); });
    clips.set(key, job);
    worker(engine).postMessage({ type: 'make', id, engine, text: spoken, voice, speed, lang, first });
    if (clips.size > 220) clips.delete(clips.keys().next().value);
  } else if (first && waiting.has(clips.get(key).id) && !started.has(clips.get(key).id)) {
    // She needs this line now, but it is still waiting behind others: make it next.
    // (If it is already being made, it is simply awaited. Starting it again would double the wait.)
    const old = clips.get(key);
    worker(engine).postMessage({ type: 'drop', keep: [...waiting.keys()].filter(i => i !== old.id) });
    clips.delete(key);
    return prepare(text, { engine, voice, rate, first });
  }
  return clips.get(key);
}

// Forget the lines that are still waiting to be made (she was paused, or jumped elsewhere).
export function dropWaiting() { for (const engine of Object.keys(workers)) { whenReady[engine].length = 0; workers[engine].postMessage({ type: 'drop', keep: [] }); } }

let actx = null, source = null, playId = 0, current = null, raf = 0;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!actx && AC) actx = new AC();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
// Call inside the first tap: browsers only allow sound after a touch.
export function unlock() { try { audio(); } catch { /* no audio */ } }
export function stop() {
  playId++;
  cancelAnimationFrame(raf);
  if (source) { try { source.onended = null; source.stop(); } catch { /* already ended */ } source = null; }
  if (current) { const f = current; current = null; f('stopped'); }
}

// Speak one breath with a neural voice. Resolves 'end', 'stopped', or 'fallback'
// (the voice is not ready or failed: the caller then uses a browser voice).
// onLevel(0..1) reports how loud she is right now, many times a second, for her mouth.
// slow: play the clip itself a little slower as well (Slow German), so it is slower whatever the model does.
export function speak(text, { engine, voice, rate = 1, slow = false, onWord, onStart, onLevel }) {
  const my = ++playId;
  const shown = displayWords(text);
  return new Promise(resolve => {
    let done = false, timers = [];
    const finish = how => {
      if (done) return; done = true;
      timers.forEach(clearTimeout); cancelAnimationFrame(raf);
      if (current === finish) current = null;
      onLevel && onLevel(0);
      if (how === 'end' && my === playId) for (let i = 0; i < shown.length; i++) onWord && onWord(i);
      resolve(how);
    };
    current = finish;
    if (state[engine].state !== 'ready') { if (state[engine].state === 'off') load(engine).catch(() => {}); return finish('fallback'); }
    const job = prepare(text, { engine, voice, rate, first: true });
    if (!job) return finish('fallback');
    timers.push(setTimeout(() => finish('fallback'), 25000)); // never leave her silent for ever
    job.then(clip => {
      if (done) return;
      if (my !== playId) return finish('stopped');
      const ctx = audio();
      if (!ctx) return finish('fallback');
      timers.forEach(clearTimeout); timers = [];
      const buf = ctx.createBuffer(1, clip.audio.length, clip.rate);
      buf.getChannelData(0).set(clip.audio);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const play = slow ? 0.86 : 1; src.playbackRate.value = play;
      const meter = ctx.createAnalyser(); meter.fftSize = 512;
      src.connect(meter); meter.connect(ctx.destination);
      source = src;
      src.onended = () => { if (source === src) source = null; finish('end'); };
      onStart && onStart({ silent: false, neural: true, voice: `${engine}:${voice}` });
      // Words appear in step with the clip, by their share of the spoken part of it.
      const data = clip.audio; let a = 0, b = data.length - 1;
      while (a < b && Math.abs(data[a]) < 0.01) a++;
      while (b > a && Math.abs(data[b]) < 0.01) b--;
      const lead = (a / clip.rate) * 1000 / play, span = Math.max(200, ((b - a) / clip.rate) * 1000) / play;
      const total = Math.max(1, shown.reduce((n, w) => n + w.length + 1, 0));
      let pos = 0, last = -1;
      shown.forEach((w, i) => { const at = lead + (pos / total) * span; pos += w.length + 1; timers.push(setTimeout(() => { if (my === playId && i > last) { last = i; onWord && onWord(i); } }, at)); });
      timers.push(setTimeout(() => finish('end'), buf.duration * 1000 / play + 1500));
      if (onLevel) {
        const frame = new Float32Array(meter.fftSize);
        const watch = () => {
          if (done || my !== playId) return;
          meter.getFloatTimeDomainData(frame);
          let sum = 0; for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
          onLevel(Math.min(1, Math.sqrt(sum / frame.length) * 6));
          raf = requestAnimationFrame(watch);
        };
        raf = requestAnimationFrame(watch);
      }
      src.start();
    }).catch(() => finish('fallback'));
  });
}
