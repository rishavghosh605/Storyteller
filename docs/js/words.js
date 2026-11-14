// Word meanings. First the word list that came with the sequence (it fits the context
// and works offline), then the lists of the other sequences. If the word is in none of
// them, the matching line of the other language is shown, so I can work it out from context.

export const bare = w => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function inSeq(w, seq) {
  if (!seq) return null;
  for (const [k, v] of Object.entries(seq.words || {})) {
    const forms = [k.replace(/\s*\(.*?\)\s*/g, '').trim(), ...(k.match(/\((.*?)\)/)?.[1]?.split(/[,/]/).map(x => x.trim()) || [])];
    if (forms.some(f => f.toLowerCase() === w)) return { word: k, meaning: v, source: 'from this part' };
  }
  for (const n of seq.nouns || []) {
    const plain = n.de.toLowerCase().replace(/^(der|die|das)\s+/, '');
    if (plain === w) return { word: n.de, meaning: n.en, source: 'from this part' };
  }
  return null;
}

export async function lookup(raw, lang, seq, allSeqs = []) {
  const w = bare(raw);
  if (!w) return null;
  if (lang === 'de') {
    const hit = inSeq(w, seq) || allSeqs.map(s => inSeq(w, s)).find(Boolean);
    if (hit) return hit;
  }
  // Not in the lists that came with the story: no guess from a machine.
  // The app then shows the line of the other telling instead (see matchingLine).
  return { word: w, meaning: '', source: '' };
}

// The line of the other language that tells the same moment as line i.
// Both tellings run in the same order, in blocks separated by empty lines,
// but the English one has a few extra lines, so the place is found by proportion.
export function matchingLine(seq, lang, i) {
  const other = lang === 'de' ? 'en' : 'de';
  const from = seq?.[lang] || [], to = seq?.[other] || [];
  if (!from[i] || !to.some(Boolean)) return '';
  const blocks = lines => { const out = [[]]; lines.forEach((l, k) => { if (l) out[out.length - 1].push(k); else if (out[out.length - 1].length) out.push([]); }); return out.filter(b => b.length); };
  const A = blocks(from), B = blocks(to);
  const share = (pos, len, lenTo) => (len <= 1 ? 0 : Math.round(pos * (lenTo - 1) / (len - 1)));
  let k;
  if (A.length === B.length) {
    const b = A.findIndex(x => x.includes(i));
    k = B[b][share(A[b].indexOf(i), A[b].length, B[b].length)];
  } else {
    const fa = A.flat(), fb = B.flat();
    k = fb[share(fa.indexOf(i), fa.length, fb.length)];
  }
  return to[k] ? to[k].replace(/\s*\[[^\]]*\]/g, '').trim() : '';
}
