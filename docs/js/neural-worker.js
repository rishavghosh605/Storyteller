// Runs a neural voice away from the page, so the buttons never freeze while speech is made.
// One worker per engine: Kokoro (English) or Supertonic 3 (German).
const SUPERTONIC = 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/main';
let kokoro = null, supertonic = null;
const styles = new Map();
const tell = (engine, progress) => postMessage({ type: 'progress', engine, progress });

async function load(engine) {
  if (engine === 'kokoro') {
    if (kokoro) return;
    const mod = await import('../vendor/kokoro/kokoro.web.js');
    let best = 0;
    kokoro = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8', device: 'wasm',
      progress_callback: p => { if (p && p.status === 'progress' && /\.onnx/.test(p.file || '') && p.progress > best) { best = p.progress; tell(engine, Math.round(best)); } },
    });
  } else if (engine === 'supertonic') {
    if (supertonic) return;
    const h = await import('../vendor/supertonic/helper.js');
    const dir = SUPERTONIC + '/onnx';
    const step = (name, cur, total) => tell(engine, Math.round(((cur - 1) / total) * 100));
    let made = null;
    // The graphics card is much faster where the browser allows it; otherwise plain WebAssembly.
    if (self.navigator && self.navigator.gpu) { try { made = await h.loadTextToSpeech(dir, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }, step); } catch { made = null; } }
    if (!made) made = await h.loadTextToSpeech(dir, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }, step);
    supertonic = { tts: made.textToSpeech, loadVoiceStyle: h.loadVoiceStyle };
  } else throw new Error('unknown voice engine');
  tell(engine, 100);
}

async function make({ engine, text, voice, speed, lang }) {
  await load(engine);
  if (engine === 'kokoro') {
    const raw = await kokoro.generate(text, { voice, speed });
    return { audio: Float32Array.from(raw.audio), rate: raw.sampling_rate };
  }
  if (!styles.has(voice)) styles.set(voice, await supertonic.loadVoiceStyle([`${SUPERTONIC}/voice_styles/${voice}.json`]));
  const { wav, duration } = await supertonic.tts.call(text, lang, styles.get(voice), 8, speed, 0.2);
  const rate = supertonic.tts.sampleRate;
  return { audio: Float32Array.from(wav).subarray(0, Math.max(1, Math.floor(rate * duration[0]))).slice(), rate };
}

// One job at a time, in the order they arrive.
let queue = Promise.resolve();
self.onmessage = e => {
  const m = e.data;
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') { await load(m.engine); postMessage({ type: 'ready', engine: m.engine }); }
      else if (m.type === 'make') { const { audio, rate } = await make(m); postMessage({ type: 'clip', id: m.id, audio, rate }, [audio.buffer]); }
    } catch (err) {
      postMessage({ type: m.type === 'load' ? 'failed' : 'error', id: m.id, engine: m.engine, message: String((err && err.message) || err) });
    }
  });
};
