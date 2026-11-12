// Worker sherpa-onnx : Zipformer transducteur en flux, exécuté en WebAssembly (1 fil, CPU).
// Le module sherpa-onnx-wasm-web est compilé depuis les sources de sherpa-onnx (cible « web »).
importScripts('../vendor/sherpa/sherpa-onnx-wasm-web.js', '../vendor/sherpa/sherpa-onnx-asr.js');

const CACHE = 'stt-demo-modeles-v1';
let recognizer = null;
let Module = null;

async function fetchWithProgress(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { /* navigation privée : pas de cache */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer());
      onBytes(buf.length);
      return buf;
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement impossible (${resp.status}) : ${url}`);
  const reader = resp.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(value.length);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  if (cache) {
    try { await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })); }
    catch (e) { /* quota : on continue sans cache */ }
  }
  return buf;
}

async function load(cfg) {
  if (recognizer) return;
  const t0 = performance.now();
  Module = await SherpaOnnx({
    locateFile: (f) => new URL('../vendor/sherpa/' + f, self.location.href).href,
    print: () => {},
    printErr: () => {},
  });
  let loaded = 0;
  const onBytes = (n) => {
    loaded += n;
    postMessage({ type: 'load', loaded, total: cfg.totalBytes });
  };
  for (const name of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
    const buf = await fetchWithProgress(cfg.base + name, onBytes);
    Module.FS.writeFile('/' + name, buf);
  }
  postMessage({ type: 'status', text: 'Initialisation du modèle' });
  recognizer = createOnlineRecognizer(Module, {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: '/encoder.onnx', decoder: '/decoder.onnx', joiner: '/joiner.onnx' },
      tokens: '/tokens.txt',
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: '',
      bpeVocab: '',
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 300,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ruleFsts: '',
    ruleFars: '',
  });
  postMessage({ type: 'ready', loadMs: performance.now() - t0 });
}

function transcribe(pcm) {
  const sr = 16000;
  const t0 = performance.now();
  const stream = recognizer.createStream();
  const done = [];
  const block = sr / 2; // blocs de 0,5 s, comme le ferait un micro
  let lastPost = 0;
  const current = () => (recognizer.getResult(stream).text || '').trim();
  const drain = () => {
    while (recognizer.isReady(stream)) recognizer.decode(stream);
  };
  for (let i = 0; i < pcm.length; i += block) {
    stream.acceptWaveform(sr, pcm.subarray(i, Math.min(i + block, pcm.length)));
    drain();
    let partial = current();
    if (recognizer.isEndpoint(stream)) {
      if (partial) done.push(partial);
      recognizer.reset(stream);
      partial = '';
    }
    const now = performance.now();
    if (now - lastPost > 100) {
      lastPost = now;
      postMessage({
        type: 'progress',
        done: Math.min(i + block, pcm.length) / pcm.length,
        text: done.join(' '),
        partial,
        ms: now - t0,
      });
    }
  }
  // Fin du flux : un peu de silence pour vider le contexte du modèle.
  stream.acceptWaveform(sr, new Float32Array(sr * 0.8));
  stream.inputFinished();
  drain();
  const tail = current();
  if (tail) done.push(tail);
  stream.free();
  postMessage({ type: 'done', text: done.join(' '), ms: performance.now() - t0 });
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'run') {
      await load(m.cfg);
      transcribe(m.pcm);
    }
  } catch (e) {
    postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
