// The free-chat room ("tea room").
// It receives a frozen, read-only window onto the story (what has been told so far)
// and returns lines for grandma to say. It has no way to write into the story room:
// nothing said here can ever change the story or the place in it.

const pick = a => a[Math.floor(Math.random() * a.length)];

const LINES = {
  enter: [
    'Ahh, a little tea. Let me put the book down. Now, what is on your mind, my dear?',
    'Hmm, yes, let us rest a moment. The book can wait on the table. Tell me, what are you thinking?',
    'Oh, good idea. My throat was getting dry. So. What would you like to talk about?',
  ],
  hello: ['Hello, my dear. I am right here.', 'Yes, dear, I am listening.'],
  howAreYou: [
    'Oh, I am well, dear. My knees complain a little, but my heart is light when you are here.',
    'Hmm, happy. I have my chair, my tea, and you. What more does an old woman need?',
  ],
  thanks: ['Oh, you are so welcome, my dear.', 'Ahh, it is my joy. Truly.'],
  love: ['Oh, my dear. And I love you. More than all the books on my shelf.', 'Ahh. That warms me better than the tea.'],
  laugh: ['Hee hee. Yes, I had to smile too.', 'Oh, you make me laugh. Good. Laughing is good for us.'],
  tired: ['Then we stop soon, dear. The story will still be here tomorrow. It does not run away.', 'Hmm, your eyes are getting small. Shall we finish for tonight?'],
  night: ['Good night, my dear. Sleep well. I will keep our page.', 'Sleep well, dear one. The book and I will wait for you.'],
  german: [
    'Hmm, you are doing well, dear. You listen, and one day you simply understand. That is how every child learns.',
    'Do not worry about every word. Let it wash over you. The pictures and the English will hold your hand.',
  ],
  name: ['I am your grandma, dear. That is the best name I have.', 'Oh, just Grandma. I have been Grandma for so long that I like it best.'],
  unknown: [
    'Hmm. That is a big question for an old woman, dear. I only know my chair, my tea, and our book. Ask me where we are, or about someone in the story.',
    'Oh, my dear, that I do not know. I can tell you what has happened in our book so far, or what someone in it is doing. Would you like that?',
    'Ahh, I wish I knew. For big questions you may take them to Claude. There is a little button for it. But about our story, ask me anything.',
  ],
  noStory: ['We have not started our book yet, dear. Say the word, and we begin.'],
  spoiler: ['Ahh, no, no. I do not peek ahead, dear. We find out together.'],
};

const say = k => pick(LINES[k]);
export const enterLine = () => say('enter');
export const backLines = ['Good. The cup is empty. Now, where were we? Ah, yes.', 'Hmm, yes. Back to our book. Let me find the page. Here.', 'Ahh, that was nice. Now, glasses on. Here we are.'];

const norm = s => ' ' + s.toLowerCase().replace(/[.,!?;:"“”„']/g, ' ').replace(/\s+/g, ' ').trim() + ' ';

const STOP = new Set(['the', 'a', 'an', 'old', 'little', 'big', 'der', 'die', 'das', 'mr', 'mrs']);
function findPerson(q, who) {
  // Longest names first, so "Old Beppo" is found before "Beppo".
  // A single word of a name only counts if it is a proper name (capitalised, not "The").
  return Object.keys(who).sort((a, b) => b.length - a.length).find(n => {
    const full = n.toLowerCase().replace(/^the /, '');
    if (q.includes(' ' + full + ' ')) return true;
    return n.split(/\s+/).some(part => /^\p{Lu}/u.test(part) && part.length > 2 && !STOP.has(part.toLowerCase()) && q.includes(' ' + part.toLowerCase() + ' '));
  });
}

// view: { title, told: [{n, title, recap, who, nouns, words}], current, total, hasMore }
export function reply(text, view) {
  const q = norm(text);
  const told = view.told || [];
  const last = told[told.length - 1];
  const who = Object.assign({}, ...told.map(s => s.who || {}));

  if (/\b(what happens (next|later|in the end)|how does it end|the ending|wie geht es aus|what will happen)\b/.test(q)) return say('spoiler');

  if (/\b(where are we|where were we|recap|remind me|what happened|what has happened|what was it about|so far|summary|summarise|summarize|wo sind wir|was ist passiert|worum geht)\b/.test(q)) {
    if (!last) return say('noStory');
    if (/\b(so far|everything|whole|from the (start|beginning)|bisher|alles)\b/.test(q) && told.length > 1) {
      const few = told.slice(-4).map(s => s.recap).filter(Boolean).join(' ');
      return `Hmm, let me think back. ${few} And that is where we are now, dear.`;
    }
    return `We are in ${view.title}, dear, at part ${last.n}${last.title ? `, "${last.title}"` : ''}. ${last.recap || 'I told you that part just now.'}`;
  }

  if (/\b(who is|who are|who was|what is .* doing|what does .* do|what about|where is|tell me about|wer ist|was macht)\b/.test(q) || findPerson(q, who)) {
    const name = findPerson(q, who);
    if (name) return `${name}? Hmm. ${who[name]}`;
    const names = Object.keys(who);
    if (/\bwho\b|\bwer\b/.test(q) && names.length) return `So far we have met ${names.slice(0, 6).join(', ')}. Ask me about any of them, dear.`;
  }

  let m;
  if ((m = q.match(/\bwhat (?:does|is|means?) (?:the word )?(.+?) (?:mean|means|in english)\b/) || q.match(/\bwas hei(?:ß|ss)t (.+?) \b/) || q.match(/\bmeaning of (.+?) \b/))) {
    const w = m[1].trim().replace(/^(der|die|das|ein|eine) /, '');
    for (const s of [...told].reverse()) {
      const hit = Object.entries(s.words || {}).find(([k]) => k === w || k.replace(/\s*\(.*\)/, '') === w);
      if (hit) return `"${hit[0]}"? That means: ${hit[1]}.`;
      const noun = (s.nouns || []).find(x => x.de.toLowerCase().replace(/^(der|die|das) /, '') === w);
      if (noun) return `"${noun.de}"? That is ${noun.en}, dear.`;
    }
    return `Hmm, "${w}". I am not sure I used that word yet, dear. You can turn on "word meanings" and tap it in the text.`;
  }

  if (/\b(how (much|many|far)|how long|wie (viel|weit))\b/.test(q) && /\b(left|more|far|read|book|story|parts?|noch)\b/.test(q)) {
    if (!last) return say('noStory');
    return `We have shared ${told.length} ${told.length === 1 ? 'part' : 'parts'} so far, dear. ${view.hasMore ? 'And I have more pages ready for you.' : 'I have no more pages ready after this. You will have to bring me some.'}`;
  }

  if (/\b(ha ?ha|hehe|lol|funny|that's funny|lustig)\b/.test(q)) return say('laugh');
  if (/\b(good ?night|sleep well|gute nacht|going to bed|bedtime)\b/.test(q)) return say('night');
  if (/\b(tired|sleepy|exhausted|m(ü|u)de)\b/.test(q)) return say('tired');
  if (/\b(thank you|thanks|danke)\b/.test(q)) return say('thanks');
  if (/\b(love you|hab dich lieb|liebe dich)\b/.test(q)) return say('love');
  if (/\b(how are you|how do you feel|wie geht es dir|wie gehts)\b/.test(q)) return say('howAreYou');
  if (/\b(your name|who are you|wie hei(ß|ss)t du)\b/.test(q)) return say('name');
  if (/\b(german|deutsch|learning|understand|difficult|hard|schwer)\b/.test(q)) return say('german');
  if (/\b(hello|hi|hey|hallo|grandma|oma|good (morning|evening))\b/.test(q)) return say('hello');
  return null; // not understood here
}

export const unknownLine = () => say('unknown');

// A ready question for Claude, for things grandma cannot answer herself.
export function askClaudeText(question, view) {
  const told = (view.told || []).map(s => `Part ${s.n}: ${s.recap}`).join('\n');
  return `You are the warm grandmother who is telling me the book "${view.title}". We have only reached part ${view.current}. Answer my question the way she would: short, soft sentences, a little "hmm" or "ahh". Do not reveal anything that happens after part ${view.current}.

What we have told so far:
${told || '(nothing yet)'}

My question: ${question}`;
}

// Optional: the small language model built into some desktop Chrome versions.
// It runs on the device, costs nothing and needs no key. Off unless switched on in Settings.
export function localAIAvailable() { return typeof window !== 'undefined' && 'LanguageModel' in window; }

export async function localAIReply(question, view) {
  if (!localAIAvailable()) return null;
  try {
    const ok = await window.LanguageModel.availability();
    if (ok === 'unavailable') return null;
    const told = (view.told || []).slice(-8).map(s => `Part ${s.n}: ${s.recap}`).join('\n');
    const session = await window.LanguageModel.create({
      initialPrompts: [{
        role: 'system',
        content: `You are a warm grandmother chatting over tea with your grandchild. You are in the middle of telling them the book "${view.title}". Answer in at most three short, soft sentences. You may begin with a small sound like "Hmm" or "Ahh". Only use what is listed below about the story. Never reveal or guess what happens later. Never use lists or formatting.\n\nThe story so far:\n${told || '(not started yet)'}`,
      }],
    });
    const out = await session.prompt(question);
    session.destroy?.();
    return String(out || '').replace(/[*_#`]/g, '').trim() || null;
  } catch {
    return null;
  }
}
