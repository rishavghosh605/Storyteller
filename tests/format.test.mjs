// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBatch, textRequest, pictureRequest, claudeInstruction, chatgptInstruction, INSTRUCTIONS_UPDATED, stamp, ago } from '../docs/js/format.js';
import { cut, cursorAfter, textToBook, linesToParas, parasToSents, findChapters } from '../docs/js/book.js';
import { understand } from '../docs/js/ears.js';
import { reply } from '../docs/js/tea.js';

const sample = readFileSync(new URL('../docs/samples/momo-texts-001-003.md', import.meta.url), 'utf8');
const pics = readFileSync(new URL('../docs/samples/momo-pictures-001-003.md', import.meta.url), 'utf8');

test('the sample batch parses cleanly', () => {
  const r = parseBatch(sample);
  assert.equal(r.journey, 'momo');
  assert.deepEqual(r.sequences.map(s => s.n), [1, 2, 3]);
  assert.deepEqual(r.warnings, []);
  const s = r.sequences[0];
  assert.deepEqual(s.pages, [6, 7]);
  assert.equal(s.ref, 'p6-p7');
  assert.ok(s.de.length > 15 && s.en.length > 15);
  assert.ok(s.de.includes(''), 'blank lines are kept as pauses');
  assert.ok(s.de.some(l => l.endsWith('[wait]')));
  assert.equal(s.nouns[0].de, 'die Stadt');
  assert.equal(s.words['schau (schauen)'], 'look');
  assert.ok(s.recap.length > 40);
  assert.ok(Object.keys(r.sequences[2].who).includes('The tourists'));
});

test('picture prompts parse', () => {
  const r = parseBatch(pics);
  assert.deepEqual(r.pictures.map(p => p.n), [1, 2, 3]);
  assert.ok(r.pictures[0].prompt.includes('LABEL CHECK'));
  assert.ok(r.pictures[0].labels.includes("Tempel"));
  assert.deepEqual(r.warnings, []);
});

test('the parser forgives Markdown decoration and code fences', () => {
  const messy = '```\n**=== GRANDMA BATCH ===**\njourney: x\n## === SEQUENCE 7 ===\npages: 3\n**--- DE ---**\nHallo.\n---EN---\nHello.\n=== END ===\n```';
  const r = parseBatch(messy);
  assert.equal(r.sequences.length, 1);
  assert.equal(r.sequences[0].n, 7);
  assert.deepEqual(r.sequences[0].de, ['Hallo.']);
  assert.deepEqual(r.sequences[0].en, ['Hello.']);
});

test('problems are reported', () => {
  assert.ok(parseBatch('hello').warnings.length);
  const r = parseBatch('=== SEQUENCE 1 ===\n--- DE ---\nHallo.\n--- EN ---\nIt is tea time now.\n');
  assert.ok(r.warnings.some(w => /switch word/.test(w)));
});

const book = textToBook(Array.from({ length: 60 }, (_, i) => `Absatz ${i}. ` + 'Wort '.repeat(60)).join('\n\n'));

test('cutting by pages and by paragraphs', () => {
  const a = cut(book, { page: 1, i: 0 }, 'page1', 3);
  assert.equal(a.length, 3);
  assert.deepEqual(a[0].pages, [1, 1]);
  assert.equal(a[1].pages[0], 2);
  assert.ok(a[0].first.startsWith('Absatz 0.'));
  assert.equal(a[1].ref.split('-')[0], String(a[0].next.i), 'sequences follow each other without a gap');
  const b = cut(book, { i: a[2].next.i }, 'paras', 2);
  assert.equal(new Set(book.sents.slice(...b[0].ref.split('-').map((x, k) => +x + k)).map(s => s.q)).size, 3, 'three paragraphs');
  const two = cut(book, { page: 1, i: 0 }, 'page2', 1);
  assert.deepEqual(two[0].pages, [1, 2]);
  const none = cut(null, { page: 12 }, 'page10', 2);
  assert.deepEqual(none.map(r => r.pages), [[12, 21], [22, 31]]);
  const end = cut(book, { i: book.sents.length }, 'page1', 3);
  assert.equal(end.length, 0, 'nothing is left after the last sentence');
});

test('the cursor moves on after an import', () => {
  assert.deepEqual(cursorAfter('10-13', [3, 3], book), { i: 14, page: book.sents[14].p });
  const c = cursorAfter('p6-p7', [6, 7], book);
  assert.equal(c.page, 8);
  assert.equal(book.sents[c.i].p, 8);
  assert.ok(book.sents[c.i - 1].p <= 7);
});

test('lines become paragraphs and sentences with the right page', () => {
  const L = (page, y, x0, x1, text) => ({ page, y, x0, x1, text, gap: 12 });
  const paras = linesToParas([
    L(1, 100, 60, 150, 'ERSTES KAPITEL'),                 // centred title
    L(2, 100, 10, 200, 'Eine volle Zeile die weiter-'),
    L(2, 88, 10, 200, 'geht. Dann kommt ein Satz der'),
    L(3, 100, 10, 200, 'auf der neuen Seite endet. Und'),
    L(3, 88, 10, 90, 'noch einer.'),
    L(3, 76, 10, 200, 'Zweiter Absatz beginnt hier'),
  ], 10, 200);
  assert.deepEqual(paras.map(p => p.t), ['ERSTES KAPITEL', 'Eine volle Zeile die weitergeht. Dann kommt ein Satz der auf der neuen Seite endet. Und noch einer.', 'Zweiter Absatz beginnt hier']);
  const sents = parasToSents(paras);
  assert.deepEqual(sents.map(s => [s.p, s.q, s.t]), [
    [1, 0, 'ERSTES KAPITEL'],
    [2, 1, 'Eine volle Zeile die weitergeht.'],
    [2, 1, 'Dann kommt ein Satz der auf der neuen Seite endet.'],
    [3, 1, 'Und noch einer.'],
    [3, 2, 'Zweiter Absatz beginnt hier'],
  ]);
});

test('requests name sequences, pages and borders', () => {
  const j = { id: 'momo', title: 'Momo', size: 'page1' };
  const t = textRequest(j, cut(book, { page: 1, i: 0 }, 'page1', 2), 4);
  assert.match(t, /sequences 4 to 5/);
  assert.match(t, /SEQUENCE 4 \| ref 0-\d+ \| page 1 \| starts at «Absatz 0\./);
  assert.match(textRequest(j, cut(book, { page: 1, i: 0 }, 'page1', 1), 4, { includeText: true }), /SOURCE TEXT:\nAbsatz 0\. Wort/);
  assert.match(t, /momo-texts-004-005\.md/);
  const p = pictureRequest(j, parseBatch(sample).sequences);
  assert.match(p, /PICTURE 1 \| pages 6 to 7 \| panorama of several moments/);
});

test('instructions carry the format and the arrow rules', () => {
  assert.match(claudeInstruction(), /=== SEQUENCE <n> ===/);
  assert.match(claudeInstruction(), /LABEL CHECK/);
  assert.match(chatgptInstruction(), /exactly one image/);
  assert.match(chatgptInstruction(), /watercolour/);
  assert.match(claudeInstruction(), /12 to 24 labels/);
});

test('switch words and commands are understood', () => {
  assert.equal(understand('Teatime'), 'tea');
  assert.equal(understand('okay tea time grandma'), 'tea');
  assert.equal(understand('tee time'), 'tea');
  assert.equal(understand('Storytime!'), 'story');
  assert.equal(understand('story time please'), 'story');
  assert.equal(understand('and then?'), 'next');
  assert.equal(understand('hmm'), 'next');
  assert.equal(understand('say that again'), 'repeat');
  assert.equal(understand('slower please'), 'slower');
  assert.equal(understand('the weather is nice'), '');
  assert.equal(understand('a story about time'), '');
});

test('the tea room answers from what was told, and never looks ahead', () => {
  const seqs = parseBatch(sample).sequences;
  const view = { title: 'Momo', told: seqs.slice(0, 2).map(s => ({ n: s.n, title: s.title.en, recap: s.recap, who: s.who, nouns: s.nouns, words: s.words })), current: 2, hasMore: true };
  assert.match(reply('where are we?', view), /part 2/);
  assert.match(reply('what does Bühne mean', view), /stage/);
  assert.match(reply('how does it end', view), /peek ahead/);
  assert.equal(reply('who are the tourists', view).includes('photo'), false, 'tourists appear only in part 3');
  assert.equal(reply('what is the capital of France', view), null);
});

test('instruction dates are kept up to date', () => {
  // If this fails, an instruction text changed: set its new date in INSTRUCTIONS_UPDATED, then update the stamp here.
  const pinned = { claude: ['wzfew4', '2026-11-14T14:50:00Z'], chatgpt: ['b0fz10', '2026-11-14T14:50:00Z'] };
  assert.deepEqual([stamp(claudeInstruction()), INSTRUCTIONS_UPDATED.claude], pinned.claude);
  assert.deepEqual([stamp(chatgptInstruction()), INSTRUCTIONS_UPDATED.chatgpt], pinned.chatgpt);
  const now = Date.parse('2026-11-14T16:50:00Z');
  assert.equal(ago('2026-11-14T14:50:00Z', now), '2 hours ago');
  assert.equal(ago('2026-11-14T16:49:30Z', now), 'just now');
  assert.equal(ago('2026-11-11T16:50:00Z', now), '3 days ago');
  assert.equal(ago('2026-08-14T16:50:00Z', now), '3 months ago');
});

test('chapters are found in the book itself', () => {
  const S = (p, q, t) => ({ p, q, t });
  const book = { sents: [
    S(1, 0, 'Ein Buch'), S(5, 1, 'ERSTES KAPITEL:'), S(5, 2, 'Eine Stadt und ein Kind'), S(6, 3, 'Es war einmal eine Stadt.'), S(6, 3, 'Sie war groß.'),
    S(30, 9, 'In diesem Kapitel passiert viel, sagte er.'), S(33, 10, 'ZWEITES KAPITEL: Ein Sturm und ein Gewitter'), S(34, 11, 'Es regnet.'), S(40, 12, 'Chapter 2'), S(40, 13, 'It began to rain, and nobody minded at all.'), S(40, 13, 'They walked on.'),
  ] };
  assert.deepEqual(findChapters(book), [
    { page: 5, i: 1, title: 'Erstes Kapitel: Eine Stadt und ein Kind' },
    { page: 33, i: 6, title: 'Zweites Kapitel: Ein Sturm und ein Gewitter' },
    { page: 40, i: 8, title: 'Chapter 2' },
  ]);
  assert.deepEqual(findChapters(null), []);
});
