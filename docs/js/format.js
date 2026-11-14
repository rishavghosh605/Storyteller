// The batch file format, the requests the app writes for Claude,
// and the standing instructions for Claude and ChatGPT.
// Pure functions: no browser needed, so they are easy to test.

export const SWITCH = { tea: 'Teatime', story: 'Storytime' };

export const SIZES = {
  paras: { label: '3 to 4 paragraphs', short: '3 to 4 paragraphs' },
  page1: { label: '1 page', pages: 1, short: '1 page' },
  page2: { label: '2 pages', pages: 2, short: '2 pages' },
  page10: { label: '10 pages', pages: 10, short: '10 pages' },
};

export const slug = s => (s || 'book').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'book';
const pad3 = n => String(n).padStart(3, '0');

// ---------- parser ----------
const clean = s => s.replace(/\r/g, '').replace(/^﻿/, '');
const stripDeco = s => s.replace(/^\s*(?:[#>*`]+\s*)+/, '').replace(/[*`]+\s*$/, '').trim();

function parsePairs(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.replace(/^\s*[-*•]\s+/, '').trim();
    if (!l) continue;
    const m = l.match(/^(.+?)\s*(?:=|→|->|:(?=\s))\s*(.+)$/);
    if (m) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}
function bodyLines(lines) {
  // One line is one breath. Blank lines are kept (once) as longer pauses.
  const out = [];
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '').replace(/^\s+/, '');
    if (!l) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
function parseRange(s) {
  const m = String(s || '').match(/(\d+)\s*(?:-|–|to|bis)?\s*(\d+)?/);
  if (!m) return null;
  const a = +m[1], b = m[2] ? +m[2] : a;
  return [Math.min(a, b), Math.max(a, b)];
}

export function parseBatch(text) {
  const res = { journey: '', sequences: [], pictures: [], warnings: [] };
  const lines = clean(text).split('\n');
  let block = null, section = null, buf = [];
  const blocks = [];
  const flush = () => { if (block && section) block.sections[section] = (block.sections[section] || []).concat(buf); buf = []; };
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) continue;
    const line = stripDeco(raw);
    let m;
    if ((m = line.match(/^={2,}\s*(GRANDMA BATCH|SEQUENCE|SEQUENZ|PICTURE|BILD|END|ENDE)\s*#?(\d+)?\s*={0,}$/i))) {
      flush();
      const kind = m[1].toUpperCase();
      if (kind === 'END' || kind === 'ENDE') { block = null; section = null; continue; }
      block = { kind: kind === 'SEQUENZ' ? 'SEQUENCE' : kind === 'BILD' ? 'PICTURE' : kind, n: m[2] ? +m[2] : 0, head: {}, sections: {} };
      section = null; blocks.push(block);
      continue;
    }
    if (!block) continue;
    if ((m = line.match(/^-{2,}\s*([A-Za-zÄÖÜäöü_ ]{2,20}?)\s*-{2,}$/))) {
      flush(); section = m[1].trim().toUpperCase(); continue;
    }
    if (!section) {
      if ((m = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/))) block.head[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    buf.push(raw);
  }
  flush();

  for (const b of blocks) {
    if (b.kind === 'GRANDMA BATCH') { res.journey = b.head.journey || res.journey; continue; }
    if (!b.n) { res.warnings.push(`A ${b.kind.toLowerCase()} block has no number and was skipped.`); continue; }
    const S = b.sections;
    if (b.kind === 'SEQUENCE') {
      const seq = {
        n: b.n,
        ref: b.head.ref || '',
        pages: parseRange(b.head.pages || b.head.page || b.head.seiten),
        title: { de: b.head.title_de || b.head.titel || '', en: b.head.title_en || b.head.title || '' },
        de: bodyLines(S.DE || S.DEUTSCH || S.GERMAN || []),
        en: bodyLines(S.EN || S.ENGLISH || S.ENGLISCH || []),
        nouns: parsePairs(S.NOUNS || S.NOMEN || []).map(([de, en]) => ({ de, en })),
        words: Object.fromEntries(parsePairs(S.WORDS || S['WÖRTER'] || S.GLOSSARY || []).map(([k, v]) => [k.toLowerCase(), v])),
        recap: bodyLines(S.RECAP || []).filter(Boolean).join(' '),
        who: Object.fromEntries(parsePairs(S.WHO || [])),
      };
      if (!seq.de.length) res.warnings.push(`Sequence ${b.n} has no German text.`);
      if (!seq.en.length) res.warnings.push(`Sequence ${b.n} has no English text.`);
      const bad = [...seq.de, ...seq.en].find(l => /tea\s?time|story\s?time/i.test(l));
      if (bad) res.warnings.push(`Sequence ${b.n} uses a switch word inside the story ("${bad.slice(0, 40)}"). Ask Claude to rephrase that line.`);
      res.sequences.push(seq);
    } else if (b.kind === 'PICTURE') {
      const prompt = bodyLines(S.PROMPT || []).join('\n').trim();
      if (!prompt) { res.warnings.push(`Picture ${b.n} has no prompt.`); continue; }
      res.pictures.push({ n: b.n, prompt, labels: (b.head.labels || '').split(/\s*[,;]\s*/).filter(Boolean), layout: b.head.layout || '' });
    }
  }
  const dup = arr => arr.map(x => x.n).filter((n, i, a) => a.indexOf(n) !== i);
  for (const n of new Set(dup(res.sequences))) res.warnings.push(`Sequence ${n} appears twice. The last one is used.`);
  if (!res.sequences.length && !res.pictures.length) res.warnings.push('No sequences or pictures found. The file must contain lines like "=== SEQUENCE 4 ===".');
  return res;
}

// ---------- requests ----------
const quote = s => `«${s}»`;
export function describeRange(r) {
  const [a, b] = r.pages;
  return a === b ? `page ${a}` : `pages ${a} to ${b}`;
}

export function textRequest(journey, ranges, firstN, opts = {}) {
  const lastN = firstN + ranges.length - 1;
  const from = ranges[0].pages[0], to = ranges[ranges.length - 1].pages[1];
  const L = [];
  L.push(`GRANDMA TEXTS for the journey "${journey.title}" (journey id: ${journey.id})`);
  L.push(`Please write ${ranges.length === 1 ? `sequence ${firstN}` : `sequences ${firstN} to ${lastN}`}: ${from === to ? `page ${from}` : `pages ${from} to ${to}`} of the book. Follow your standing instruction.`);
  L.push(`Sequence size: ${SIZES[journey.size]?.short || journey.size}. A page number is the position of the page in the file (the first page of the file is page 1).`);
  L.push('');
  ranges.forEach((r, k) => {
    let l = `SEQUENCE ${firstN + k} | ref ${r.ref} | ${describeRange(r)}`;
    if (r.first) l += ` | starts at ${quote(r.first)} | ends with ${quote(r.last)}`;
    L.push(l);
    if (opts.includeText && r.text) { L.push('SOURCE TEXT:'); L.push(r.text); L.push(''); }
  });
  L.push('');
  L.push(`Give me one file named ${journey.id}-texts-${pad3(firstN)}-${pad3(lastN)}.md.`);
  return L.join('\n');
}

export function pictureRequest(journey, seqs) {
  const a = seqs[0].n, b = seqs[seqs.length - 1].n;
  const L = [];
  L.push(`GRANDMA PICTURES for the journey "${journey.title}" (journey id: ${journey.id})`);
  L.push(`Please write the picture prompts for ${a === b ? `sequence ${a}` : `sequences ${a} to ${b}`}. Follow your standing instruction.`);
  L.push('');
  for (const s of seqs) {
    const pages = s.pages ? (s.pages[0] === s.pages[1] ? `page ${s.pages[0]}` : `pages ${s.pages[0]} to ${s.pages[1]}`) : '';
    const many = s.pages && s.pages[1] > s.pages[0];
    let l = `PICTURE ${s.n} | ${pages} | ${many ? 'collage of four' : 'single picture'}`;
    if (s.title?.en) l += ` | "${s.title.en}"`;
    if (s.nouns?.length) l += ` | nouns: ${s.nouns.map(x => x.de).join(', ')}`;
    L.push(l);
  }
  L.push('');
  L.push(`Give me one file named ${journey.id}-pictures-${pad3(a)}-${pad3(b)}.md.`);
  return L.join('\n');
}

// ---------- standing instructions ----------
export function claudeInstruction() {
  return `STANDING INSTRUCTION: GRANDMA STORYTELLER

You prepare a book so that a warm grandmother can tell it aloud, bit by bit, to one listener who is learning German by listening. The book is attached to this project or chat. This works for any book. I will send you two kinds of short requests: "GRANDMA TEXTS" and "GRANDMA PICTURES". Answer each with exactly one downloadable Markdown file in the format below and nothing else. No preface, no summary after it.

HOW TO READ A REQUEST
Each line "SEQUENCE n | ref ... | page(s) ... | starts at «...» | ends with «...»" is one small piece of the story, called a sequence. Page numbers are positions in the file (page 1 is the first page of the file), not printed page numbers. The two quotes are the exact borders: start with the sentence that begins at the first quote and stop after the sentence that ends with the second. If a request contains "SOURCE TEXT", use that text as the source for the sequence. Copy the "ref" value back unchanged. If you cannot find a passage, say so in one line and write nothing else.

THE TWO TELLINGS
For every sequence you write the same piece of story twice: once in German and once in English. Both are told by the same grandmother, in her own words. Do not copy the book's sentences. Tell what happens in them.

Rules for both languages:
- Stay with the real story. Every event, every person, every important thing and every spoken line of the source appears, in the same order. Add no events, no facts, no explanations of the plot, and nothing from later pages.
- Tell it as if it is happening right now, in front of us. Use the present tense. "Look, there she stands." "Da steht sie."
- One line is one breath. Write each short sentence, or each half of a longer one, on its own line. Leave an empty line where she would pause a little longer.
- She speaks to one person. She says "you", "my dear", "mein Schatz", "Liebes". Not too often.
- She never explains what a word means and never comments on grammar or on the language.
- Never write the words "teatime" or "storytime" in any spelling or language. They are reserved.

German telling (section DE):
- Natural, correct, simple spoken German, as a German grandmother from Germany would tell it. Keep the important words of the book (its nouns, verbs and names), so the listener meets the book's own vocabulary.
- Very short lines: at most about 8 words per line. Main clauses first. Split long sentences.
- Small sounds are welcome, a few per sequence: "Hmm.", "Ach.", "Ach ja.", "Na ja.", "Tja.", "Oh.", "So so."
- At most one small question to the listener per sequence, and only one that needs no real answer, such as "Und weißt du, was dann passiert?". Put [wait] at the end of that line.
- About as long as the source.

English telling (section EN):
- The same content in the same order as the German, so the listener can match them. This is a retelling of the same lines, not a word-for-word translation.
- Short, soft sentences. At most about 12 words per line.
- Here she is most herself. She adds little grandmother extras: small sounds ("Hmm.", "Ahh.", "Oh my.", "Now then.", "Well, well."), a tiny feeling about what happens ("Oh, I like her already."), a small sensory touch that is clearly hers. About one extra for every five or six lines. An extra never adds a story fact and never drifts away from the scene.
- One or two small questions to the listener per sequence, the kind you answer with "hmm" or "and then?". For example "And do you know who lives there, my dear?". Put [wait] at the end of such a line. Never quiz the listener.

HELPERS FOR EVERY SEQUENCE
- title_de and title_en: three to six words, no spoilers.
- NOUNS: the 4 to 8 most important German nouns of this sequence that can be seen and drawn, each with its article and its English meaning. Singular form.
- WORDS: every German word from your DE section that a beginner might not know (verbs in the form you used, adjectives, nouns, particles), each with a short English meaning for this context. Write the word exactly as it appears in your text. Add the dictionary form in brackets where it differs. 20 to 60 entries.
- RECAP: two or three short sentences in English, in the grandmother's voice, that say what happened in this sequence. She uses this later to remind the listener where we are.
- WHO: one line for each person who appears in this sequence: who they are and what they are doing right now. English. Only what is known up to here.

FILE FORMAT FOR "GRANDMA TEXTS"
Use exactly these marker lines. Do not translate or decorate them. No Markdown formatting inside the file.

=== GRANDMA BATCH ===
journey: <journey id from the request>

=== SEQUENCE <n> ===
ref: <ref from the request, unchanged>
pages: <first page>-<last page>
title_de: <short German title>
title_en: <short English title>
--- DE ---
<German telling, one breath per line>
--- EN ---
<English telling, one breath per line>
--- NOUNS ---
der Mond = the moon
--- WORDS ---
schläft (schlafen) = sleeps
--- RECAP ---
<two or three sentences>
--- WHO ---
Name: who this is and what they are doing now

(then the next "=== SEQUENCE <n> ===" block, and so on)

=== END ===

PICTURE PROMPTS ("GRANDMA PICTURES")
For each "PICTURE n" line you write one prompt that I paste into ChatGPT. ChatGPT already has a standing instruction for the drawing style (a very detailed pencil sketch with small German labels), so do not repeat the style. Describe the picture.

- "single picture": one scene, the most telling moment of that sequence.
- "collage of four": one image divided into four panels (2 by 2). Each panel shows one moment of the sequence, in story order: top left, top right, bottom left, bottom right. Describe each panel in its own paragraph that begins "Panel 1 (top left):" and so on.
- Describe concretely what is visible: place, time of day, light, the people (age, build, hair, clothes, posture, expression), the things, and where each sits in the frame (left, right, centre, foreground, background). ChatGPT has not read the book and remembers nothing between prompts. Describe a returning person or place with the same words every time.
- Show only what has happened up to this sequence.
- Write the prompt in English. The label words are German.

Labels and arrows. Image makers often point arrows at the wrong thing. These rules prevent it, so follow them exactly:
1. Few labels: 3 to 5 in a single picture, at most 2 per panel in a collage (at most 8 in total). Use nouns from the sequence's NOUNS list, with their article.
2. Label only things that are large, fully visible and clearly apart from each other. Never label two things that touch or overlap. Never label something tiny or far away.
3. Introduce every label in the same sentence as its object, as one unit, and say where it is. Example: "In the upper right hangs a full moon. Directly beside it, on empty sky, is the handwritten label «der Mond», joined to the moon by one short straight arrow whose tip touches the moon's edge."
4. Every label sits on empty background right next to its own object, closer to it than to any other labelled thing. The arrow is shorter than the label is wide.
5. Arrows never cross each other, never cross another object and never pass through a face.
6. Write each label in « » with exact spelling, article and umlauts. No other text in the picture: no title, no caption, no signature, no speech bubbles.
7. End every prompt with a check list in this form, one line per label:
   LABEL CHECK: «der Mond» -> the full moon, upper right | «die Ruine» -> the stone ruin, centre
   Then the sentence: "If an arrow would not touch its own object, move the label closer to the object instead of drawing a longer arrow."

FILE FORMAT FOR "GRANDMA PICTURES"

=== GRANDMA BATCH ===
journey: <journey id from the request>

=== PICTURE <n> ===
layout: <single or collage>
labels: <the labels, separated by commas>
--- PROMPT ---
<the prompt>

(then the next "=== PICTURE <n> ===" block, and so on)

=== END ===`;
}

export function chatgptInstruction() {
  return `STANDING PICTURE INSTRUCTION (applies to every picture prompt I send in this chat or project)

I will paste one picture prompt at a time. For each prompt, make exactly one image. Do not ask questions first, do not offer variations, do not write a description. Just make the image.

STYLE, always the same:
- A very detailed hand-drawn graphite pencil sketch on warm cream paper, like a page from an old illustrated storybook.
- Pencil only: fine lines, cross-hatching and soft shading. No colour, no ink wash, no photo look, no 3D look.
- Rich detail in the important things, lighter and looser in the background. Generous empty paper around the main things so that labels have room.
- Landscape format, 3:2.
- Gentle and warm in mood, also in darker scenes. Nothing frightening.
- People look the way the prompt describes them. Do not copy the look of any existing illustration or film.

LABELS AND ARROWS, always the same:
- The prompt names a few German labels inside « ». Write exactly these words, letter for letter, with the article and with umlauts (ä, ö, ü, ß). Do not translate them, do not add labels, do not leave one out.
- Lettering: small, neat, upright pencil handwriting, easy to read, all the same size.
- Each label sits on empty paper directly next to its own object and belongs to it alone.
- From each label, draw one short, straight, thin arrow. The arrowhead touches the object the label names. The arrow is shorter than the label is wide.
- No arrow crosses another arrow, another object or a face. If there is no room, move the label closer to its object. Never draw a long arrow across the picture.
- The prompt ends with a "LABEL CHECK" list. Before you draw, place each label according to that list. After drawing, each arrowhead must rest on the object named for it in the list.
- No other writing anywhere: no title, no caption, no signature, no page number, no speech bubbles.

COLLAGE:
- When the prompt says "collage of four", draw one single image divided into four equal panels, 2 by 2, with thin pencil frame lines between them. Panel order: top left, top right, bottom left, bottom right. The same style in all four. Labels stay inside the panel of their object.

If a result has a wrong spelling or an arrow that points at the wrong thing, and I answer "fix labels", redraw the same picture and change only the labels and arrows.`;
}
