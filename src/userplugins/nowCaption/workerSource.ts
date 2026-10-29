/* The recognizer runs in its own Node worker thread (started by native.ts from this static string).
 * CPU is the worker thread's own CPU; native inference helper threads may be excluded.
 * The V8 heap/external figures exclude the model's native allocations.
 *
 * Each captioned speaker gets one recognizer stream. A stream's hypothesis only grows within a segment, so
 * to keep messages bounded in long calls the worker resets the stream into a new segment in a pause once the
 * passage is long, and the renderer keeps the earlier text. (Resetting keeps memory flat over hours; creating
 * new streams instead grows it, because old ones are only freed by garbage collection.)
 */

export const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');

const RATE = 16000;
const MAX_STREAMS = 4;            // speakers captioned at once
const PRIME_SECONDS = 0.96;       // silence before a new stream's audio, as the NowCaption app does
const SEGMENT_CHARS = 600;        // start a new segment in a pause once the passage is this long...
const PAUSE_SECONDS = 1.2;        // ...and the audio has been silent, with nothing new recognised, this long
const SILENCE_RMS = 0.01;         // about -40 dBFS: below this a block counts as silence
const HARD_CHARS = 4000;          // during non-stop talk, any short pause will do once it's this long
const HARD_PAUSE_SECONDS = 0.4;
const MAX_CHARS = 8000;           // audio that never pauses (music, a stream) starts a new segment anyway
const TIMINGS = 160;

const streams = new Map();        // track -> { stream, text, segment, fed, changedAt, soundAt } (positions in samples)
const decodeTimes = [];
let recognizer;
let decodedBlocks = 0;
let dropped = 0;
let cpuPrevious = typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null;
let cpuTime = performance.now();

const round = n => Math.round(n * 100) / 100;

function newStream() {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: RATE, samples: new Float32Array(Math.round(PRIME_SECONDS * RATE)) });
  return stream;
}

function startSegment(item) {
  recognizer.reset(item.stream);
  item.stream.acceptWaveform({ sampleRate: RATE, samples: new Float32Array(Math.round(PRIME_SECONDS * RATE)) });
  item.text = '';
  item.segment++;
  item.changedAt = item.soundAt = item.fed;
}

function stats() {
  const memory = process.memoryUsage();
  const now = performance.now();
  let cpu = null;
  if (typeof process.threadCpuUsage === 'function') {
    const current = process.threadCpuUsage();
    if (cpuPrevious && now > cpuTime) {
      cpu = Math.max(0, (current.user - cpuPrevious.user + current.system - cpuPrevious.system) / ((now - cpuTime) * 1000) * 100);
    }
    cpuPrevious = current;
  }
  cpuTime = now;
  const sorted = [...decodeTimes].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
  parentPort.postMessage({
    type: 'metrics', cpuPercentOneCore: cpu === null ? null : round(cpu),
    heapMiB: round(memory.heapUsed / 1048576), externalMiB: round(memory.external / 1048576),
    decodedBlocks, dropped, activeStreams: streams.size,
    decodeMeanMs: decodeTimes.length ? round(decodeTimes.reduce((a, b) => a + b, 0) / decodeTimes.length) : null,
    decodeP95Ms: p95 === null ? null : round(p95),
    decodeMaxMs: decodeTimes.length ? round(Math.max(...decodeTimes)) : null
  });
}

function feed(track, buffer) {
  const item = streams.get(track);
  if (!item) { dropped++; return 0; }
  const started = performance.now();
  const samples = new Float32Array(buffer);
  item.stream.acceptWaveform({ sampleRate: RATE, samples });
  item.fed += samples.length;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (Math.sqrt(energy / samples.length) >= SILENCE_RMS) item.soundAt = item.fed;
  let decoded = false;
  while (recognizer.isReady(item.stream)) { recognizer.decode(item.stream); decoded = true; }
  if (decoded) {
    const result = recognizer.getResult(item.stream);
    const text = (Array.isArray(result.tokens) ? result.tokens.join('') : result.text || '').trim();
    if (text !== item.text) {
      item.text = text;
      item.changedAt = item.fed;
      parentPort.postMessage({ type: 'caption', track, text, segment: item.segment });
    }
  }
  // A pause needs real silence too: text can stay unchanged while a long word is still being spoken.
  const quiet = (item.fed - Math.max(item.changedAt, item.soundAt)) / RATE;
  const long = item.text.length >= SEGMENT_CHARS && quiet >= PAUSE_SECONDS;
  const veryLong = item.text.length >= HARD_CHARS && quiet >= HARD_PAUSE_SECONDS;
  // The renderer keeps this segment's text; the next caption arrives with the new segment number.
  if (long || veryLong || item.text.length >= MAX_CHARS) startSegment(item);
  decodedBlocks++;
  const ms = performance.now() - started;
  decodeTimes.push(ms);
  if (decodeTimes.length > TIMINGS) decodeTimes.shift();
  return ms;
}

try {
  const sherpa = require(workerData.addonEntry);
  const model = workerData.model;
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: model + '/encoder.int8.onnx', decoder: model + '/decoder.int8.onnx', joiner: model + '/joiner.int8.onnx' },
      tokens: model + '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0
    },
    decodingMethod: 'greedy_search', enableEndpoint: false
  });
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  parentPort.postMessage({ type: 'fatal', error: String(error && error.stack || error) });
  process.exitCode = 1;
}

parentPort.on('message', msg => {
  if (!recognizer) return;
  if (msg.type === 'stats') { stats(); return; }
  try {
    if (msg.type === 'add') {
      if (!streams.has(msg.track) && streams.size < MAX_STREAMS) {
        streams.set(msg.track, { stream: newStream(), text: '', segment: 1, fed: 0, changedAt: 0, soundAt: 0 });
      }
    } else if (msg.type === 'remove') {
      streams.delete(msg.track);
    } else if (msg.type === 'reset') {
      // Someone else now speaks on this track: forget what the stream heard so far.
      const item = streams.get(msg.track);
      if (item) startSegment(item);
      parentPort.postMessage({ type: 'resetDone', track: msg.track });
    } else if (msg.type === 'feed') {
      const processedMs = feed(msg.track, msg.samples);
      parentPort.postMessage({ type: 'ack', track: msg.track, seq: msg.seq, processedMs });
    }
  } catch (error) {
    parentPort.postMessage({ type: 'streamError', track: msg.track || '?', error: String(error && error.stack || error) });
    if (msg.type === 'feed') parentPort.postMessage({ type: 'ack', track: msg.track, seq: msg.seq, processedMs: 0 });
  }
});
`;
