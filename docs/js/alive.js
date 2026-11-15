// The small things that make Grandma look alive: uneven blinking, eyes that move between
// you, the picture and her book, eyebrows on a question, a cat that looks up, and a slight
// sense of depth when the pointer moves. Everything here only changes transforms and
// class names a few times a second, so it costs almost nothing.
const $ = s => document.querySelector(s);
const body = document.body;
const rand = (a, b) => a + Math.random() * (b - a);
const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let eyes, grandma, scene, granny;
let pointer = { x: 0, y: 0 }, glance = null, glanceUntil = 0, nextGlance = 0, lastEyes = '';

// ---------- blinking: every 2 to 6 seconds, sometimes twice ----------
function blink(times = 1) {
  if (!eyes || body.classList.contains('asleep')) return;
  eyes.classList.add('blink');
  setTimeout(() => { eyes.classList.remove('blink'); if (times > 1) setTimeout(() => blink(times - 1), 120); }, 110);
}
function blinkLoop() {
  setTimeout(() => { if (!document.hidden) blink(Math.random() < 0.18 ? 2 : 1); blinkLoop(); }, rand(2200, 6200));
}

// ---------- where she looks ----------
function look() {
  if (!eyes || document.hidden) return;
  const now = performance.now();
  const speaking = body.classList.contains('speaking'), stage = body.classList.contains('stage-picture');
  const tea = body.classList.contains('room-tea'), listening = body.classList.contains('listening');
  // The resting place of her eyes: the picture while she tells with it, otherwise you.
  let base = stage && speaking && !listening ? { x: 3.4, y: -0.4 } : { x: 0, y: 0 };
  // Now and then a short glance: down at her book while telling, or over to you.
  if (now > nextGlance && !listening) {
    if (speaking && !tea) { glance = stage && Math.random() < 0.45 ? { x: 0, y: 0 } : { x: 0.4, y: 3.2 }; glanceUntil = now + rand(450, 900); nextGlance = now + rand(4200, 9000); if (Math.random() < 0.6) blink(); }
    else if (tea && !speaking) { glance = { x: 0.5, y: 2.6 }; glanceUntil = now + rand(700, 1300); nextGlance = now + rand(6000, 12000); } // down at her cup
    else nextGlance = now + 2500;
  }
  if (glance && now < glanceUntil) base = glance; else glance = null;
  const follow = base.x === 0 && base.y === 0 ? 1 : 0.2; // she follows the pointer only when she looks at you
  const x = Math.max(-3.6, Math.min(3.6, base.x + pointer.x * 3 * follow)), y = Math.max(-2.2, Math.min(3.4, base.y + pointer.y * 2.4 * follow));
  const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  if (t !== lastEyes) { eyes.style.transform = t; lastEyes = t; }
}

// ---------- reactions ----------
let browTimer = 0, smileTimer = 0, catTimer = 0;
// Called for every line she says: a question or an exclamation lifts her eyebrows for a moment.
export function spoke(text, meta = {}) {
  if (!grandma) return;
  if (/[?!][”"»]?\s*(\[wait\])?\s*$/i.test(text || '')) {
    clearTimeout(browTimer);
    setTimeout(() => grandma.classList.add('brow-up'), 250);
    browTimer = setTimeout(() => grandma.classList.remove('brow-up'), 1500);
  }
  if (meta.toYou || !meta.seq && !meta.glue) smile();
}
export function smile() {
  if (!grandma) return;
  grandma.classList.add('smile'); clearTimeout(smileTimer);
  smileTimer = setTimeout(() => grandma.classList.remove('smile'), 1800);
}
// The cat opens its eyes and looks up for a few seconds: when you speak, or when the room changes.
export function stir(ms = 4200) {
  if (!grandma || body.classList.contains('asleep')) return;
  grandma.classList.add('cat-awake'); clearTimeout(catTimer);
  catTimer = setTimeout(() => grandma.classList.remove('cat-awake'), ms);
}

export function init() {
  eyes = $('#eyes'); grandma = $('#grandma'); scene = $('#scene'); granny = $('#granny');
  if (!eyes || !grandma) return;
  blinkLoop();
  setInterval(look, 260);
  setInterval(() => { if (!document.hidden && Math.random() < 0.3) stir(rand(1800, 3200)); }, 38000); // the cat stirs by itself now and then
  if (calm) return;
  // Depth: the window and Grandma shift by a few pixels against each other as the pointer moves.
  let frame = 0, at = null;
  window.addEventListener('pointermove', e => {
    at = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      pointer = { x: (at.clientX / window.innerWidth - 0.5) * 2, y: (at.clientY / window.innerHeight - 0.5) * 2 };
      if (at.pointerType === 'mouse') {
        scene.style.setProperty('--px', (pointer.x * 5).toFixed(1) + 'px'); scene.style.setProperty('--py', (pointer.y * 3).toFixed(1) + 'px');
        granny.style.setProperty('--gx', (pointer.x * 2.5).toFixed(1) + 'px');
      }
      look();
    });
  }, { passive: true });
}
