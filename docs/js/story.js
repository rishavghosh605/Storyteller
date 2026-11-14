// The story room. It knows only the book's prepared sequences and my place in them.
// Everything she tells here comes word for word from the saved sequence files,
// so the story cannot drift. The only thing other rooms get is view(): a frozen copy.
import * as store from './store.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const other = l => (l === 'de' ? 'en' : 'de');

export const GLUE = {
  toEn: ['Hmm. And now once more, in English.', 'So. Now let me tell you that again, in English, dear.', 'Ahh. And in English, it goes like this.'],
  toDe: ['And now, listen how it sounds in German.', 'Hmm. Now the same in German, nice and slowly.', 'So. And now in German, my dear.'],
  picture: ['Look, dear. I have a picture for this part.', 'Ahh, here. Look at this one first.', 'Hmm, wait. First the picture. Look.'],
  goOn: ['Shall I go on, dear?', 'Hmm. Shall we turn the page?', 'And then? Shall I tell you?'],
  noMore: ['Ahh. That is as far as my pages go, my dear. Bring me new ones, and I will tell you more.'],
  night: [
    'Ahh. And that is enough for tonight, my dear. My eyes are getting heavy, and I think yours are too. The book will keep our page. Sleep well, and dream something lovely.',
    'Hmm. There we stop, little one. I am going to close my eyes now. You close yours too. Good night, my dear. Sleep tight.',
    'So. That was the last one for today. Off to bed with you, and with me. Good night, my dear. I will be right here tomorrow, in my chair.',
    'Oh, I am going now, my dear. This is enough for one evening. Tuck yourself in warm. Have a good night, and sleep well.',
  ],
  again: ['Of course, dear. Once more.', 'Hmm, yes. Listen again.'],
  slower: ['Oh, was I too quick? Slowly now.', 'Yes, yes. Nice and slowly.'],
};

function hello() {
  const h = new Date().getHours();
  if (h < 5) return pick(['Oh, my dear, so late and still awake? Come, sit with me.', 'Ahh, a night owl. Come here, dear.']);
  if (h < 12) return pick(['Good morning, my dear. Come, sit with me.', 'Ahh, there you are. Good morning, dear.']);
  if (h < 18) return pick(['Ahh, there you are, my dear. Come, sit with me.', 'Hello, my dear. I was hoping you would come.']);
  return pick(['Ahh, there you are, my dear. Come, sit with me. The lamp is on.', 'Good evening, my dear. Come, get cosy.']);
}

export class StoryRoom {
  constructor(stage) {
    this.stage = stage;       // { say, pause, listenWait, showPicture, onPlace }
    this.journey = null; this.seqs = []; this.p = { seq: 0, part: 0, line: 0 };
    this.runId = 0; this.playing = false; this.lastLine = null; this.shownPicture = 0;
  }

  async load(id) {
    this.halt();
    this.journey = id ? await store.journey(id) : null;
    this.seqs = []; this.lastLine = null; this.shownPicture = 0;
    if (!this.journey) return;
    await this.refresh();
    this.p = await store.progress(id);
    if (!this.seq(this.p.seq)) this.p = { seq: this.seqs[0]?.n || 0, part: 0, line: 0 };
  }
  async refresh() {
    if (!this.journey) return;
    this.seqs = (await store.sequences(this.journey.id)).filter(s => s.de?.length && s.en?.length);
    if (!this.seq(this.p.seq) && this.seqs.length) {
      // New pages arrived after she had run out: continue with the first new one.
      const next = this.seqs.find(s => s.n >= (this.p.seq || 0));
      if (next) this.p = { seq: next.n, part: 0, line: 0 };
    }
  }

  seq(n) { return this.seqs.find(s => s.n === n); }
  index(n) { return this.seqs.findIndex(s => s.n === n); }
  get current() { return this.seq(this.p.seq); }
  order(seq) {
    const start = this.journey.startLang || 'de';
    return this.index(seq.n) % 2 === 0 ? [start, other(start)] : [other(start), start];
  }
  get atStart() { return this.index(this.p.seq) <= 0 && !this.p.part && !this.p.line; }

  save() {
    if (!this.journey) return;
    store.saveProgress(this.journey.id, this.p);
    this.stage.onPlace?.();
  }

  // What she says when I open the app.
  greeting() {
    const j = this.journey;
    if (!j) return { kind: 'nobook', text: `${hello()} Oh. We have no book yet. Bring me one, and I will tell it to you.` };
    const cur = this.current;
    if (!this.seqs.length) return { kind: 'nopages', text: `${hello()} We have our book, ${j.title}. But I have no pages ready yet. Bring me some pages, and we begin.` };
    if (!cur) return { kind: 'nomore', text: `${hello()} We are in ${j.title}. I have told you all the pages I have, dear. Bring me new ones, and we go on.` };
    if (this.atStart) return { kind: 'fresh', text: `${hello()} We begin a new book, you and I. It is called ${j.title}. ${j.startLang ? 'Shall we start?' : 'Shall I begin in German, or in English?'}` };
    const i = this.index(cur.n);
    const prev = this.seqs[i - 1];
    const mid = this.p.part || this.p.line;
    const where = mid
      ? `We were in the middle of part ${cur.n}${cur.title?.en ? `, ${cur.title.en}` : ''}.`
      : `We are at part ${cur.n}${cur.title?.en ? `, ${cur.title.en}` : ''}.`;
    const short = t => (t.match(/[^.!?]+[.!?]+/g) || [t]).slice(0, 2).join(' ').trim();
    const recap = !mid && prev?.recap ? `Last time: ${short(prev.recap)}` : '';
    return { kind: 'resume', text: `${hello()} We are in ${j.title}. ${where} ${recap} Shall we go on from there?` };
  }

  halt() { this.runId++; this.playing = false; }

  async play() {
    if (!this.journey) return;
    const my = ++this.runId;
    this.playing = true;
    const live = () => my === this.runId;
    const st = this.stage;
    try {
      while (live()) {
        const seq = this.current;
        if (!seq) { await st.say(pick(GLUE.noMore), 'en', { glue: true }); st.outOfPages?.(); break; }
        const order = this.order(seq);
        st.onPlace?.();
        if (!this.p.part && !this.p.line && this.shownPicture !== seq.n) {
          this.shownPicture = seq.n;
          const has = await st.showPicture(seq, true);
          if (!live()) return;
          if (has && st.glue()) { if (await st.say(pick(GLUE.picture), 'en', { glue: true }) === 'stopped') return; }
          if (has) await st.pause(2200);
          if (!live()) return;
        } else st.showPicture(seq, false);

        for (let part = this.p.part || 0; part < 2 && live(); part++) {
          const lang = order[part];
          if (part === 1 && !this.p.line && st.glue()) {
            await st.pause(500);
            if (await st.say(pick(lang === 'en' ? GLUE.toEn : GLUE.toDe), 'en', { glue: true }) === 'stopped') return;
            await st.pause(400);
          }
          const lines = seq[lang];
          for (let i = this.p.line || 0; i < lines.length && live(); i++) {
            const line = lines[i];
            if (!line) { await st.pause(lang === 'de' ? 950 : 750); continue; }
            this.p = { seq: seq.n, part, line: i }; this.lastLine = { ...this.p }; this.save();
            st.prepare?.(lines.slice(i + 1).find(Boolean), lang);
            const r = await st.say(line, lang, { seq, part, line: i });
            if (r === 'stopped' || !live()) return;
            if (/\[wait\]/i.test(line)) await st.listenWait(6500);
            else await st.pause(lang === 'de' ? 520 : 300);
          }
          if (!live()) return;
          this.p = { seq: seq.n, part: part + 1, line: 0 };
        }
        if (!live()) return;
        // This sequence is told. Move my place to the next one.
        const next = this.seqs[this.index(seq.n) + 1];
        this.p = { seq: next ? next.n : seq.n + 1, part: 0, line: 0 };
        this.save();
        if (st.lastOne?.()) {
          // Bedtime: she finishes the part, says good night and dozes off. No question.
          await st.pause(700);
          await st.say(pick(GLUE.night), 'en', { glue: true });
          if (live()) { this.playing = false; st.sleep?.(); }
          return;
        }
        if (!next) { await st.pause(600); await st.say(pick(GLUE.noMore), 'en', { glue: true }); st.outOfPages?.(); break; }
        await st.pause(500);
        if (await st.say(pick(GLUE.goOn), 'en', { glue: true }) === 'stopped') return;
        await st.listenWait(st.waitForMe() ? 0 : 4000); // 0 = until I answer
      }
    } finally {
      if (live()) { this.playing = false; st.onPlace?.(); }
    }
  }

  pause() { this.halt(); this.stage.hush(); this.stage.onPlace?.(); }

  // Repeat the last sentence, then carry on from there.
  repeatLine() {
    const l = this.lastLine || (this.current ? { ...this.p } : null);
    if (!l) return;
    this.halt(); this.stage.hush();
    this.p = { ...l }; this.shownPicture = l.seq;
    return this.play();
  }

  // Repeat the last sequence: the one being told, or the one just finished.
  repeatSeq() {
    let n = this.p.seq;
    if (!this.p.part && !this.p.line) { const i = this.index(n); const prev = i > 0 ? this.seqs[i - 1] : (i < 0 ? this.seqs[this.seqs.length - 1] : null); if (prev) n = prev.n; }
    if (!this.seq(n)) return;
    this.halt(); this.stage.hush();
    this.p = { seq: n, part: 0, line: 0 }; this.shownPicture = 0; this.save();
    return this.play();
  }

  // "And then?": skip ahead to the next sequence.
  skip() {
    const i = this.index(this.p.seq);
    const next = this.seqs[i + 1];
    if (!next) return false;
    this.halt(); this.stage.hush();
    this.p = { seq: next.n, part: 0, line: 0 }; this.shownPicture = 0; this.save();
    this.play();
    return true;
  }
  goTo(n) {
    if (!this.seq(n)) return;
    this.halt(); this.stage.hush();
    this.p = { seq: n, part: 0, line: 0 }; this.shownPicture = 0; this.save();
  }

  // A frozen copy of what has been told so far. This is all the tea room ever sees.
  view() {
    const started = this.p.part || this.p.line || (this.lastLine && this.lastLine.seq === this.p.seq);
    const told = this.seqs.filter(s => s.n < this.p.seq || (s.n === this.p.seq && started))
      .map(s => ({ n: s.n, title: s.title?.en || '', recap: s.recap || '', who: { ...(s.who || {}) }, nouns: (s.nouns || []).map(x => ({ ...x })), words: { ...(s.words || {}) } }));
    const view = { title: this.journey?.title || 'our book', told, current: told.length ? told[told.length - 1].n : 0, hasMore: !!this.current };
    return deepFreeze(view);
  }
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
