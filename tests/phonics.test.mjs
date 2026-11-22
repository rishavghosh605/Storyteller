// Run with: node --test tests/phonics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, byId, matches, highlight, findExamples, emptyProgress, record, flagBad, strength, todayIds, buildTest, heardTarget, level } from '../docs/js/phonics.js';

test('there are 15 sounds with unique ids and plain hints', () => {
  assert.equal(SOUNDS.length, 15);
  assert.equal(new Set(SOUNDS.map(s => s.id)).size, 15);
  for (const s of SOUNDS) { assert.ok(s.hint.length > 20, s.id); assert.ok(s.words.length >= 3, s.id); }
});

test('every built-in example word and every pair word really contains its sound', () => {
  for (const s of SOUNDS) for (const [w] of s.words) assert.ok(matches(s, w) || ['ich', 'ach'].includes(s.id) && /ch/.test(w) || s.id === 'ich' && w === 'ich', `${s.id}: ${w}`);
  for (const s of SOUNDS.filter(x => x.pair)) {
    const [a, b] = s.pair.map(x => x[0]);
    assert.ok(matches(s, a) || matches(s, b), `${s.id}: ${a}/${b}`);
  }
});

test('spelling patterns find the right words and skip the known exceptions', () => {
  const m = (id, w) => matches(byId(id), w);
  assert.ok(m('ie', 'Brief') && !m('ie', 'Familie') && !m('ie', 'Studien'));
  assert.ok(m('spst', 'Stadt') && m('spst', 'sprechen') && !m('spst', 'Lust'));
  assert.ok(m('vw', 'Vater') && m('vw', 'Wasser') && !m('vw', 'Vase') && !m('vw', 'Klavier'));
  assert.ok(m('ich', 'Milch') && m('ich', 'euch') && m('ich', 'nicht') && !m('ich', 'Nacht') && !m('ich', 'Chor') && !m('ich', 'Schule'));
  assert.ok(m('ach', 'Nacht') && m('ach', 'auch') && m('ach', 'Buch') && !m('ach', 'euch') && !m('ach', 'ich'));
  assert.ok(m('ss', 'heiß') && m('ss', 'Reise') && m('ss', 'essen') && !m('ss', 'Stadt'));
  assert.ok(m('eu', 'Häuser') && m('eu', 'heute') && !m('eu', 'Museum'));
  assert.ok(m('ae', 'Mädchen') && !m('ae', 'Häuser'));
  assert.ok(m('z', 'Katze') && m('sch', 'schlafen'));
});

test('the sound is highlighted inside the word', () => {
  assert.deepEqual(highlight('Fisch', byId('sch')), ['Fi', 'sch', '']);
  assert.deepEqual(highlight('Straße', byId('ss')), ['Stra', 'ß', 'e']);
  assert.deepEqual(highlight('schlecht', byId('ich')), ['schle', 'ch', 't']);
  assert.deepEqual(highlight('Nacht', byId('ach')), ['Na', 'ch', 't']);
  assert.deepEqual(highlight('Reise', byId('ss')), ['Rei', 's', 'e']);
  assert.deepEqual(highlight('Stadt', byId('spst')), ['', 'St', 'adt']);
});

test('examples come from the story first and are filled up with built-in words', () => {
  const vocab = [{ w: 'Schau', en: 'look', n: 1, count: 4 }, { w: 'schläft', en: 'sleeps', n: 2, count: 1 }, { w: 'Momo', n: 1, count: 9 }, { w: 'Gasse', en: 'lane', n: 1, count: 1 }];
  const ex = findExamples(byId('sch'), vocab);
  assert.deepEqual(ex.map(e => [e.w, e.story]), [['Schau', true], ['schläft', true], ['Schule', false]]);
  assert.equal(findExamples(byId('sch'), []).length, 3, 'without a story it still has examples');
  assert.deepEqual(findExamples(byId('sch'), vocab, ['schau']).map(e => e.w), ['schläft', 'Schule', 'Fisch'], 'a flagged word is never used');
  assert.equal(findExamples(byId('ss'), vocab).some(e => e.w === 'Momo'), false, 'names are not in word lists, and are never matched');
});

test('the memory of weak sounds', () => {
  let p = emptyProgress();
  assert.equal(strength(p, 'sch'), null);
  assert.deepEqual(todayIds(p), ['sch', 'spst', 'z'], 'a new learner starts with the quick wins');
  p = record(p, 'ue', 'say', false, 1); p = record(p, 'ue', 'say', false, 2);
  p = record(p, 'sch', 'say', true, 3); p = record(p, 'sch', 'hear', true, 3);
  assert.ok(strength(p, 'ue') < 0.5 && level(strength(p, 'ue')) === 'weak');
  assert.equal(level(strength(p, 'sch')), 'fair', 'one success is a good start, not yet good');
  p = record(p, 'sch', 'say', true, 3); p = record(p, 'sch', 'hear', true, 3);
  assert.equal(level(strength(p, 'sch')), 'good', 'a second success makes it good');
  const today = todayIds(p);
  assert.equal(today[0], 'ue', 'the weakest sound comes first');
  assert.ok(today.includes('spst'), 'and one new sound is mixed in');
  assert.equal(today.length, 3);
  p = record(p, 'ue', 'say', true, 4); p = record(p, 'ue', 'say', true, 5); p = record(p, 'ue', 'say', true, 6);
  assert.ok(strength(p, 'ue') > 0.5, 'it recovers when you get it right');
  assert.equal(p.updatedAt, 6);
  p = flagBad(p, 'Schau', 9); p = flagBad(p, 'schau', 10);
  assert.deepEqual(p.bad, ['schau']);
});

test('the hearing test favours weak sounds and never repeats a sound back to back', () => {
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const q = buildTest(emptyProgress(), 8, rng);
  assert.equal(q.length, 8);
  for (let i = 1; i < q.length; i++) assert.notEqual(q[i].id, q[i - 1].id);
  for (const x of q) { assert.equal(x.options.length, 2); assert.ok([0, 1].includes(x.say)); assert.ok(byId(x.id).pair); }
  let p = emptyProgress(); for (let i = 0; i < 4; i++) p = record(p, 'ue', 'hear', false);
  let count = 0; for (let r = 0; r < 200; r++) count += buildTest(p, 6, rng).filter(x => x.id === 'ue').length;
  let base = 0; for (let r = 0; r < 200; r++) base += buildTest(emptyProgress(), 6, rng).filter(x => x.id === 'ue').length;
  assert.ok(count > base, `weak sound appears more often (${count} vs ${base})`);
});

test('the recogniser hint compares words, not sentences', () => {
  assert.ok(heardTarget(['Tasche'], 'Tasche'));
  assert.ok(heardTarget(['die Tasche.', 'Tasse'], 'tasche'));
  assert.ok(!heardTarget(['Tasse'], 'Tasche'));
  assert.ok(!heardTarget([], 'Tasche') && !heardTarget(undefined, 'Tasche'));
});
