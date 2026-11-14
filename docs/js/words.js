// Word meanings. First the word list that came with the sequence (it fits the context
// and works offline), then the other sequences, then a free online dictionary.
const CACHE_KEY = 'grandma.dict';
let cache = null;
function load() { if (!cache) { try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; } } return cache; }

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
  const key = `${lang}:${w}`;
  const c = load();
  if (c[key]) return { word: w, meaning: c[key], source: 'online dictionary (saved)' };
  try {
    const pair = lang === 'de' ? 'de|en' : 'en|de';
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(w)}&langpair=${pair}`);
    const j = await r.json();
    const m = (j?.responseData?.translatedText || '').trim();
    if (m && m.toLowerCase() !== w) {
      c[key] = m; try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* full */ }
      return { word: w, meaning: m, source: 'online dictionary (MyMemory), may not fit the context' };
    }
  } catch { /* offline */ }
  return { word: w, meaning: '', source: 'No meaning found. Ask Grandma in the tea room, or Claude.' };
}
