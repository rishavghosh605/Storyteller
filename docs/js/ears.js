// Grandma's ears: the browser's speech recognition (free, no key).
// Listens continuously while the mic is on and turns what it hears into commands.
import { SWITCH } from './format.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const earsSupported = !!SR;

// Easy for a recogniser, rare in normal talk, never used inside story text.
const TEA = /\b(tea\s?-?times?|tee\s?-?times?|t\s?-?time|teetime|tea\s?-?tim|teezeit|tea\s?-?timing)\b/i;
const STORY = /\b(story\s?-?times?|storey\s?-?time|stori\s?-?time|story\s?-?tim|storytime)\b/i;

const COMMANDS = [
  ['slower', /\b(slower|more slowly|slow down|langsamer)\b/i],
  ['faster', /\b(faster|normal speed|schneller)\b/i],
  ['bedtime', /\b(last one|last part|this is the last|one more and then|then (i|we) (go to )?(sleep|bed)|bedtime|noch eine(n|s)? und dann|letzte(r|s)? teil)\b/i],
  ['repeatSeq', /\b(whole (part|thing) again|(repeat|again) (the )?(sequence|part|page|pages|whole)|from the (start|beginning|top)|von vorne|alles noch ?(ein)?mal)\b/i],
  ['repeat', /\b(again|repeat|once more|say that again|pardon|what did you say|noch ?(ein)?mal|wie bitte|wiederhol\w*)\b/i],
  ['pause', /\b(stop|wait|pause|hold on|one moment|just a moment|moment mal|warte|halt)\b/i],
  ['words', /\b(show|open) (me )?(the )?(text|texts|words)\b/i],
  ['next', /\b(and then|then what|what happens next|go on|keep going|continue|carry on|next|tell me more|more|und dann|weiter|erz(ä|a)hl weiter|hmm+|mm+|mhm+|uh huh|okay|ok)\b/i],
  ['yes', /\b(yes|yeah|yep|yup|sure|please|of course|let's|lets|ja|gern|gerne|klar|bitte|doch)\b/i],
  ['no', /\b(no|nope|not now|not yet|nein|nicht jetzt)\b/i],
  ['german', /\b(german|deutsch)\b/i],
  ['english', /\b(english|englisch)\b/i],
];

export function understand(text) {
  const t = ' ' + text.toLowerCase().replace(/[.,!?;:'"“”„]/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (TEA.test(t)) return 'tea';
  if (STORY.test(t)) return 'story';
  for (const [name, re] of COMMANDS) if (re.test(t)) return name;
  return '';
}
export const isSwitch = text => { const c = understand(text); return c === 'tea' || c === 'story' ? c : ''; };

export class Ears {
  constructor({ onHeard, onInterim, onSound, onState }) {
    this.on = false; this.rec = null; this.lang = 'en-US';
    this.onHeard = onHeard; this.onInterim = onInterim; this.onSound = onSound; this.onState = onState;
    this.lastSwitch = 0; this.fails = 0; this.error = '';
  }
  start(lang) {
    if (!SR) { this.error = 'This browser has no speech recognition. Use the buttons, or try Chrome or Edge.'; this.onState?.(); return false; }
    this.lang = lang || this.lang;
    this.on = true; this.error = '';
    this._begin();
    return true;
  }
  stop() {
    this.on = false;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null; this.onState?.();
  }
  _begin() {
    if (!this.on) return;
    const rec = new SR();
    this.rec = rec;
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
    rec.onstart = () => { this.live = true; this.onState?.(); };
    rec.onspeechstart = () => this.onSound?.();
    rec.onresult = e => {
      this.fails = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = []; for (let k = 0; k < r.length; k++) alts.push(r[k].transcript.trim());
        // Switch words are caught as early as possible, in any alternative.
        const sw = alts.map(isSwitch).find(Boolean);
        if (sw && Date.now() - this.lastSwitch > 2500) {
          this.lastSwitch = Date.now();
          this.onHeard?.(alts[0], sw, true);
          continue;
        }
        if (r.isFinal) { if (alts[0] && Date.now() - this.lastSwitch > 1200) this.onHeard?.(alts[0], understand(alts[0]), false); }
        else this.onInterim?.(alts[0]);
      }
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.error = 'The microphone is not allowed for this page.'; this.on = false; }
      else if (e.error === 'audio-capture') { this.error = 'No microphone was found.'; this.on = false; }
      else if (e.error === 'network') { this.fails++; }
      else if (e.error === 'language-not-supported') { this.error = 'This language is not supported for listening here.'; this.on = false; }
    };
    rec.onend = () => {
      this.live = false; this.onState?.();
      if (!this.on) return;
      if (this.fails > 5) { this.on = false; this.error = 'Listening keeps failing. Check the internet connection, then turn the mic on again.'; this.onState?.(); return; }
      setTimeout(() => this._begin(), this.fails ? 1200 : 250);
    };
    try { rec.start(); } catch { /* it was already running */ }
  }
}
export { SWITCH };
