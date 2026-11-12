// Worker Whisper : transformers.js + ONNX Runtime Web, en WebAssembly sur le CPU (pas de WebGPU).
// Bibliothèque chargée depuis jsDelivr, à version fixe (GitHub refuse le fichier dans le dépôt : faux positif de son détecteur de secrets).
import { pipeline, env, WhisperTextStreamer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;

const SR = 16000;
let asr = null;

async function load(cfg) {
  if (asr) return;
  const t0 = performance.now();
  env.backends.onnx.wasm.numThreads = cfg.threads;
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', cfg.model, {
    device: 'wasm',
    dtype: cfg.dtype,
    revision: cfg.revision || 'main',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, p.loaded || 0);
        let loaded = 0;
        for (const v of files.values()) loaded += v;
        postMessage({ type: 'load', loaded, total: cfg.totalBytes });
      }
    },
  });
  postMessage({ type: 'ready', loadMs: performance.now() - t0 });
}

// Découpe en fenêtres de 30 s au plus (la taille d'entrée de Whisper), en coupant
// à l'endroit le plus calme entre 18 s et 29 s pour ne pas trancher un mot.
function split(pcm) {
  const maxLen = 29 * SR, minLen = 18 * SR, frame = SR / 50, win = 15;
  const out = [];
  let start = 0;
  while (pcm.length - start > maxLen) {
    const from = start + minLen, to = start + maxLen;
    const n = Math.floor((to - from) / frame);
    const e = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let s = 0;
      const o = from + f * frame;
      for (let i = 0; i < frame; i++) s += pcm[o + i] * pcm[o + i];
      e[f] = s;
    }
    let best = n - win, bestV = Infinity, acc = 0;
    for (let f = 0; f < n; f++) {
      acc += e[f];
      if (f >= win) acc -= e[f - win];
      if (f >= win - 1 && acc <= bestV) { bestV = acc; best = f - win + 1; }
    }
    const cut = from + Math.round((best + win / 2) * frame);
    out.push([start, cut]);
    start = cut;
  }
  out.push([start, pcm.length]);
  return out;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
}

async function transcribe(pcm, cfg) {
  const t0 = performance.now();
  const chunks = split(pcm);
  const texts = [];
  for (let c = 0; c < chunks.length; c++) {
    const [a, b] = chunks[c];
    const seg = pcm.slice(a, b);
    const post = (partial, within) => postMessage({
      type: 'progress',
      done: (a + Math.min(within, b - a)) / pcm.length,
      text: texts.join(' '),
      partial,
      ms: performance.now() - t0,
      window: [c + 1, chunks.length],
    });
    post('', 0);
    if (rms(seg) < 1e-4) continue; // silence numérique : rien à transcrire
    let partial = '';
    let within = 0;
    const streamer = new WhisperTextStreamer(asr.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t) => { partial += t; post(partial.trim(), within); },
      on_chunk_end: (t) => { within = Math.round(t * SR); post(partial.trim(), within); },
    });
    const res = await asr(seg, {
      language: cfg.language,
      task: 'transcribe',
      return_timestamps: true,
      streamer,
    });
    const text = (res.text || '').trim();
    if (text) texts.push(text);
  }
  postMessage({ type: 'done', text: texts.join(' '), ms: performance.now() - t0 });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'run') {
      await load(m.cfg);
      await transcribe(m.pcm, m.cfg);
    }
  } catch (e) {
    postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
