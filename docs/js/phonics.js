// The sound corner's knowledge: the German sounds that need practice, how to find example
// words for them (in the story you have heard, and in a built-in list), the contrast pairs for
// the hearing test, and the memory of which sounds are still weak. Pure functions: no browser needed.

// Ordered from quick wins to the hardest. Each sound is a spelling pattern.
// match: spellings to look for in a (lower-case) word. mark: what to highlight. exclude: known exceptions.
// pair: two words that differ in this sound, for the hearing test (null if no clean pair exists).
export const SOUNDS = [
  { id: 'sch', spell: 'sch', title: 'sch', hint: 'Like the English “sh” in “ship”.',
    match: [/sch/], mark: /sch/, words: [['Schule', 'school'], ['Fisch', 'fish'], ['schlafen', 'to sleep']],
    pair: [['Tasche', 'bag'], ['Tasse', 'cup']] },
  { id: 'spst', spell: 'sp- / st-', title: 'sp and st at the start of a word', hint: 'At the start of a word, “s” sounds like “sh”: Spiel is “shpeel”, Stein is “shtine”.',
    match: [/^(sp|st)/], mark: /^(sp|st)/, words: [['Spiel', 'game'], ['Stadt', 'town'], ['Straße', 'street']],
    pair: [['Stein', 'stone'], ['sein', 'to be']] },
  { id: 'z', spell: 'z', title: 'z and tz', hint: 'Like the “ts” at the end of “cats”. Zeit starts with that “ts”.',
    match: [/z/], mark: /tz|z/, words: [['Zimmer', 'room'], ['Katze', 'cat'], ['Zahn', 'tooth']],
    pair: [['Zeit', 'time'], ['seit', 'since']] },
  { id: 'vw', spell: 'v / w', title: 'v and w', hint: 'German “w” is like English “v” (Wasser sounds like “vasser”). German “v” is usually like English “f” (Vater sounds like “fater”).',
    match: [/^[vw]/], mark: /^[vw]/, exclude: [/^(vase|video|vulkan|violin|virus|vitamin|visum|vokal|vanille)/], words: [['Wasser', 'water'], ['wir', 'we'], ['Vater', 'father'], ['Vogel', 'bird']],
    pair: [['Wein', 'wine'], ['fein', 'fine']] },
  { id: 'ss', spell: 's / ß', title: 's, ss and ß', hint: '“s” before a vowel buzzes like English “z” (Sonne, Reise). “ß” and “ss” are a sharp hiss like the “s” in “sun” (heiß, Fuß).',
    match: [/ß/, /ss/, /(?<![sc])s(?=[aeiouäöü])/], mark: /ß|ss|(?<![sc])s(?=[aeiouäöü])/, words: [['Sonne', 'sun'], ['Reise', 'journey'], ['heiß', 'hot']],
    pair: [['reisen', 'to travel'], ['reißen', 'to tear']] },
  { id: 'ie', spell: 'ie', title: 'ie', hint: 'A long “ee”, like in “see”. Hold it a little: Brief, viel.',
    match: [/ie/], mark: /ie/, exclude: [/ien?$/], words: [['Brief', 'letter'], ['viel', 'much, many'], ['Tier', 'animal']],
    pair: [['Miete', 'rent'], ['Mitte', 'middle']] },
  { id: 'ei', spell: 'ei', title: 'ei', hint: 'Like the English word “eye”. German “ei” is not the same as “ie”.',
    match: [/ei/], mark: /ei/, words: [['Zeit', 'time'], ['klein', 'small'], ['Stein', 'stone']],
    pair: [['Wiese', 'meadow'], ['Weise', 'way, manner']] },
  { id: 'eu', spell: 'eu / äu', title: 'eu and äu', hint: 'Like the “oy” in “boy”: neu, heute, Häuser.',
    match: [/eu/, /äu/], mark: /eu|äu/, exclude: [/^museum/], words: [['neu', 'new'], ['heute', 'today'], ['Häuser', 'houses']],
    pair: [['Leute', 'people'], ['Laute', 'sounds']] },
  { id: 'aa', spell: 'aa / ah', title: 'long a (aa, ah)', hint: 'A long “ah”, like in “father”, held a little longer than a short a.',
    match: [/aa/, /ah/], mark: /aa|ah/, words: [['Jahr', 'year'], ['Zahl', 'number'], ['Bahn', 'railway']],
    pair: [['Staat', 'state'], ['Stadt', 'town']] },
  { id: 'ue', spell: 'ü', title: 'ü', hint: 'Say “ee” and, keeping your tongue where it is, round your lips as if you were saying “oo”.',
    match: [/ü/], mark: /ü/, words: [['über', 'over'], ['Tür', 'door'], ['Küche', 'kitchen']],
    pair: [['Bruder', 'brother'], ['Brüder', 'brothers']] },
  { id: 'oe', spell: 'ö', title: 'ö', hint: 'Say “ay” (as in German “e”) and, keeping your tongue where it is, round your lips as if you were saying “oh”.',
    match: [/ö/], mark: /ö/, words: [['schön', 'beautiful'], ['hören', 'to hear'], ['Löwe', 'lion']],
    pair: [['schon', 'already'], ['schön', 'beautiful']] },
  { id: 'ae', spell: 'ä', title: 'ä', hint: 'Almost the same as German “e”: like the “e” in “bed”, or a little longer in Bär.',
    match: [/ä/], mark: /ä/, exclude: [/äu/], words: [['Bär', 'bear'], ['Käse', 'cheese'], ['spät', 'late']], pair: null },
  { id: 'ich', spell: 'ch (ich)', title: 'ch as in ich', hint: 'A soft hiss, made with the middle of the tongue against the roof of the mouth. Like the “h” in “huge”, never a “k”. After e, i, ä, ö, ü and l, n, r.',
    match: [/(?:[eiäöülnr]|[eä]u)ch/], mark: /(?<=[eiäöülnr]|[eä]u)ch/, words: [['ich', 'I'], ['nicht', 'not'], ['Milch', 'milk']],
    pair: [['nicht', 'not'], ['Nacht', 'night']] },
  { id: 'ach', spell: 'ch (ach)', title: 'ch as in ach', hint: 'A raspy sound at the back of the throat, like clearing your throat softly. Like “loch” in Scottish English. After a, o, u, au.',
    match: [/(?<![eä])[aou]ch/], mark: /(?<=(?<![eä])[aou])ch/, words: [['Nacht', 'night'], ['Buch', 'book'], ['auch', 'also']],
    pair: [['Nacht', 'night'], ['Naht', 'seam']] },
  { id: 'r', spell: 'r', title: 'r', hint: 'Not the English “r”. It is made at the back of the throat, like a soft gargle. At the end of a word it is almost just “uh” (Vater).',
    match: [/r/], mark: /r/, words: [['rot', 'red'], ['Bruder', 'brother'], ['Rose', 'rose']], pair: null },
];

export const byId = id => SOUNDS.find(s => s.id === id);
const lower = w => String(w || '').toLowerCase();

// Does this word contain the sound's spelling (and is it not a known exception)?
export function matches(sound, word) {
  const w = lower(word);
  if (!w || /^ch/.test(w) && (sound.id === 'ich' || sound.id === 'ach')) return false;
  if (sound.exclude && sound.exclude.some(re => re.test(w))) return false;
  return sound.match.some(re => re.test(w));
}

// [before, marked part, after], so the sound can be shown in bold inside the word.
export function highlight(word, sound) {
  const m = sound.mark.exec(lower(word));
  if (!m) return [word, '', ''];
  return [word.slice(0, m.index), word.slice(m.index, m.index + m[0].length), word.slice(m.index + m[0].length)];
}

// Three example words for a sound: first words from the story you have heard
// (vocab = [{ w, en, n, count }]), then the built-in ones. `bad` are words you flagged as wrong.
export function findExamples(sound, vocab = [], bad = [], total = 3, fromStory = 2) {
  const badSet = new Set(bad.map(lower));
  const seen = new Set();
  const out = [];
  const cands = vocab
    .filter(v => v && v.w && matches(sound, v.w) && !badSet.has(lower(v.w)))
    .map(v => ({ ...v, score: (v.count || 1) * 2 - Math.abs(v.w.length - 5) }))
    .sort((a, b) => b.score - a.score || a.w.localeCompare(b.w));
  for (const c of cands) {
    const k = lower(c.w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ w: c.w, en: c.en || '', story: true, part: c.n || 0 });
    if (out.length >= fromStory) break;
  }
  for (const [w, en] of sound.words) {
    if (out.length >= total) break;
    const k = lower(w);
    if (seen.has(k) || badSet.has(k)) continue;
    seen.add(k);
    out.push({ w, en, story: false });
  }
  return out;
}

// ---------- the memory of weak sounds ----------
// hear / say: a number from 0 to 1 per sound, moved a third of the way towards each new result.
export const emptyProgress = () => ({ v: 1, sounds: {}, bad: [], updatedAt: 0 });
const ALPHA = 0.35;

export function record(p, id, kind, ok, now = Date.now()) {
  const sounds = { ...p.sounds };
  const s = { ...(sounds[id] || {}) };
  const prev = typeof s[kind] === 'number' ? s[kind] : 0.5;
  s[kind] = prev + ALPHA * ((ok ? 1 : 0) - prev);
  s[kind + 'N'] = (s[kind + 'N'] || 0) + 1;
  s.last = now;
  sounds[id] = s;
  return { ...p, sounds, updatedAt: now };
}
export function flagBad(p, word, now = Date.now()) {
  const w = lower(word);
  return p.bad.includes(w) ? p : { ...p, bad: [...p.bad, w], updatedAt: now };
}
// How well a sound is going (the weaker of hearing and saying), or null if never practised.
export function strength(p, id) {
  const s = p.sounds[id];
  if (!s) return null;
  const v = [s.hear, s.say].filter(x => typeof x === 'number');
  return v.length ? Math.min(...v) : null;
}
export const WEAK = 0.7;
export const level = v => (v === null ? 'new' : v < 0.5 ? 'weak' : v < WEAK ? 'fair' : 'good');

// Today's sounds: the weakest first, one new sound in between, then whatever has waited longest.
export function todayIds(p, n = 3) {
  const all = SOUNDS.map(s => ({ id: s.id, st: strength(p, s.id), last: p.sounds[s.id]?.last || 0 }));
  const weak = all.filter(x => x.st !== null && x.st < WEAK).sort((a, b) => a.st - b.st);
  const fresh = all.filter(x => x.st === null);
  const rest = all.filter(x => x.st !== null && x.st >= WEAK).sort((a, b) => a.last - b.last);
  const out = [];
  const add = x => { if (x && !out.includes(x.id) && out.length < n) out.push(x.id); };
  weak.slice(0, Math.max(1, n - 1)).forEach(add);
  add(fresh[0]);
  [...weak, ...fresh, ...rest].forEach(add);
  return out;
}

// ---------- the hearing test ----------
// n questions. Weak sounds come up more often; no sound twice in a row, and rarely twice at all.
export function buildTest(p, n = 8, rng = Math.random) {
  const pool = SOUNDS.filter(s => s.pair);
  const used = new Map();
  const out = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    const w = pool.map(s => {
      if (s.id === last) return 0;
      const hear = typeof p.sounds[s.id]?.hear === 'number' ? p.sounds[s.id].hear : 0.5;
      return (1 + (1 - hear)) * Math.pow(0.25, used.get(s.id) || 0);
    });
    let r = rng() * w.reduce((a, b) => a + b, 0), k = 0;
    for (; k < w.length - 1; k++) { r -= w[k]; if (r <= 0) break; }
    const s = pool[k];
    used.set(s.id, (used.get(s.id) || 0) + 1);
    last = s.id;
    const flip = rng() < 0.5;
    const options = flip ? [s.pair[1], s.pair[0]] : [s.pair[0], s.pair[1]];
    out.push({ id: s.id, options: options.map(([w2, en]) => ({ w: w2, en })), say: rng() < 0.5 ? 0 : 1 });
  }
  return out;
}

// Did the speech recogniser hear the word that was meant? (A hint only: recognisers guess from context.)
export function heardTarget(alternatives, target) {
  const norm = t => lower(t).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const want = lower(target);
  return (alternatives || []).some(a => norm(a).includes(want));
}
