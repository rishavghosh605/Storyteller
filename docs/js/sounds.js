// Quiet room sounds, made in the browser (no sound files): a fire,
// a page turning, a teacup, a bird in the morning. A slider in Settings sets how loud, down to off.
import { settings } from './store.js';

let ctx = null, master = null, fireGain = null, fireTimer = null, birdTimer = null, running = '';
// How loud the room is: 0 (off) to 1. An older "off" switch still counts as off.
export const level = () => { const s = settings(); return s.sounds === false ? 0 : Math.max(0, Math.min(1, +s.soundLevel || 0)); };
const on = () => level() > 0;
// Called when the slider moves: the room gets louder or quieter at once.
export function setLevel() { if (master && ctx) master.gain.setTargetAtTime(level() * 1.8, ctx.currentTime, 0.08); }

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = level() * 1.8; master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Call inside the first tap: browsers only allow sound after a touch.
export function unlock() { try { audio(); } catch { /* no audio on this device */ } }

function noise(seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w; }
  return buf;
}
function burst({ dur = 0.05, type = 'highpass', freq = 2000, to = null, gain = 0.05, q = 1 }) {
  if (!audio() || !on()) return;
  const src = ctx.createBufferSource(); src.buffer = noise(dur + 0.02, false);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + Math.min(0.03, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(); src.stop(ctx.currentTime + dur + 0.03);
}
function ping(freq, dur, gain, type = 'sine', bendTo = 0) {
  if (!audio() || !on()) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, ctx.currentTime + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.02);
}

export function pageTurn() { burst({ dur: 0.34, type: 'bandpass', freq: 700, to: 3400, gain: 0.05, q: 0.8 }); }
export function clink() { ping(2350, 0.5, 0.035); setTimeout(() => ping(3120, 0.42, 0.022), 55); }
function chirp() { ping(2900 + Math.random() * 700, 0.09, 0.012, 'sine', 4300); setTimeout(() => ping(3300 + Math.random() * 500, 0.07, 0.01, 'sine', 4600), 130); }

function stopAll() {
  clearTimeout(fireTimer); clearTimeout(birdTimer);
  fireTimer = birdTimer = null;
  if (fireGain) { const g = fireGain; fireGain = null; try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(() => g.disconnect(), 1500); } catch { /* gone */ } }
}
// room: 'story' (a fire), 'tea' (quiet), 'off'. time: morning | afternoon | evening | night.
export function ambience(room, time) {
  const want = on() && room !== 'off' ? `${room}|${time}` : '';
  if (want === running) return;
  stopAll(); running = want;
  if (!want || !audio()) return;
  if (room === 'story') {
    const src = ctx.createBufferSource(); src.buffer = noise(4, true); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    fireGain = ctx.createGain(); fireGain.gain.value = 0; fireGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.2);
    src.connect(f); f.connect(fireGain); fireGain.connect(master); src.start();
    // No crackle: short crackles sound like a ticking clock. The fire only swells and settles slowly.
    const swell = () => { if (fireGain) { fireGain.gain.setTargetAtTime(0.035 + Math.random() * 0.03, ctx.currentTime, 1.6); fireTimer = setTimeout(swell, 2500 + Math.random() * 3500); } };
    fireTimer = setTimeout(swell, 3000);
  }
  if (time === 'morning') { const bird = () => { if (!document.hidden) chirp(); birdTimer = setTimeout(bird, 7000 + Math.random() * 16000); }; birdTimer = setTimeout(bird, 3000); }
}
