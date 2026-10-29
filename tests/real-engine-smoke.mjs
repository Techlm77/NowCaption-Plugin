// Real speech through the plugin's own recognition worker, the installed sherpa-onnx engine and speech model v4.
// Needs `node scripts/install-engine.mjs` first (CI does this on Windows, macOS and Linux). Not part of `npm test`.
//   node tests/real-engine-smoke.mjs [runtimeRoot]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { getRuntimeRoot, MODEL_DIRECTORY } from "../scripts/runtime-paths.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = process.argv[2] || getRuntimeRoot({ target: "native" });
const reference = "he tells us that at this festive season of the year with christmas and roast beef looming before us similes drawn from eating and its results occur most readily to the mind";

const wav = readFileSync(join(here, "fixtures", "1272-128104-0002.wav"));
let off = 12, data;
while (off < wav.length) {
    const tag = wav.toString("ascii", off, off + 4), size = wav.readUInt32LE(off + 4);
    if (tag === "data") { data = wav.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size;
}
const pcm = new Float32Array(data.length / 2 + 32000); // plus 2 s of silence to flush the last words
for (let i = 0; i < data.length / 2; i++) pcm[i] = data.readInt16LE(2 * i) / 32768;

const source = readFileSync(join(here, "..", "src", "userplugins", "nowCaption", "workerSource.ts"), "utf8");
const addonEntry = createRequire(join(root, "package.json")).resolve("sherpa-onnx-node");
const started = Date.now();
const worker = new Worker(source.match(/String\.raw`([\s\S]*?)`;/)[1], { eval: true, workerData: { addonEntry, model: join(root, "models", MODEL_DIRECTORY) } });
const tracks = ["A1", "A2", "A3", "A4", "A5"];
const text = {};
let readyMs, metrics, acks = 0, expected = 0;
await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out")), 180000);
    worker.on("error", reject);
    worker.on("message", m => {
        if (m.type === "fatal") reject(new Error(m.error));
        if (m.type === "ready") {
            readyMs = Date.now() - started;
            for (const track of tracks) worker.postMessage({ type: "add", track });
            let seq = 0;
            for (let i = 0; i + 640 <= pcm.length; i += 640) for (const track of tracks) {
                const block = pcm.slice(i, i + 640);
                worker.postMessage({ type: "feed", track, seq: ++seq, samples: block.buffer }, [block.buffer]);
                expected++;
            }
        }
        if (m.type === "caption") text[m.track] = m.text;
        if (m.type === "ack" && ++acks === expected) worker.postMessage({ type: "stats" });
        if (m.type === "metrics") { metrics = m; clearTimeout(timeout); resolve(); }
    });
});
await worker.terminate();

const words = s => s.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
const hyp = words(text.A1 ?? ""), ref = words(reference);
const matched = ref.filter((w, i) => hyp[i] === w).length;
console.log(`engine ready in ${readyMs} ms · ${process.platform}/${process.arch}`);
console.log(`A1: ${text.A1}`);
console.log(`decode mean ${metrics.decodeMeanMs} ms, p95 ${metrics.decodeP95Ms} ms per 40 ms block; streams ${metrics.activeStreams}`);
assert(matched / ref.length >= 0.9, `transcript should match the reference (${matched}/${ref.length} words in place)`);
for (const track of ["A2", "A3", "A4"]) assert.equal(text[track], text.A1, `${track} recognised the same speech`);
assert.equal(text.A5, undefined, "a fifth speaker gets no recognizer stream");
assert.equal(metrics.activeStreams, 4);
console.log("PASS real engine: speech model v4 transcribes the reference clip; four streams at once");
