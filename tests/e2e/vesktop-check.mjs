// End-to-end check against a real Vesktop started with --remote-debugging-port: NowCaption is in the plugin list,
// its settings are on, and real speech goes renderer -> Vesktop's main process -> worker -> speech model v4.
//   node tests/e2e/vesktop-check.mjs <port>
// Discord's login page is enough: plugins are listed there, but don't start until someone logs in.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] || 9222);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let page;
for (let i = 0; i < 180 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page" && /discord\.com/.test(t.url)); }
    catch { /* not up yet */ }
    if (!page) await sleep(1000);
}
assert.ok(page, "Vesktop opened no Discord page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const waiting = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); };
async function evaluate(expression) {
    const m = await new Promise(resolve => {
        const n = ++id; waiting.set(n, resolve);
        ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? JSON.stringify(m.result.exceptionDetails));
    return m.result?.result?.value;
}
for (let i = 0; i < 120; i++) { if (await evaluate("typeof Vencord === 'object' && !!Vencord.Plugins?.plugins")) break; await sleep(1000); }

const listed = await evaluate(`({
    vencord: typeof Vencord === "object",
    plugin: Vencord.Plugins.plugins.NowCaption?.name ?? null,
    userPlugins: Object.keys(Vencord.Plugins.plugins).filter(n => /caption/i.test(n)),
    helper: typeof VencordNative.pluginHelpers.NowCaption === "object"
})`);
console.log("Plugin list:", JSON.stringify(listed));
assert.equal(listed.plugin, "NowCaption", "NowCaption is in Vencord's plugin list");
assert.ok(listed.helper, "Vesktop's main process has NowCaption's engine bridge");

// Speech: the reference clip through the plugin's own bridge, paced like live audio.
const wav = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "1272-128104-0002.wav"));
let off = 12, data;
while (off < wav.length) {
    const tag = wav.toString("ascii", off, off + 4), size = wav.readUInt32LE(off + 4);
    if (tag === "data") { data = wav.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size;
}
const pcm = new Float32Array(data.length / 2 + 32000);
for (let i = 0; i < data.length / 2; i++) pcm[i] = data.readInt16LE(2 * i) / 32768;
const speech = await evaluate(`(async () => {
    const N = VencordNative.pluginHelpers.NowCaption, out = {};
    out.start = await N.start();
    if (!out.start.ok) return out;
    out.adds = [];
    for (const t of ["A1", "A2", "A3", "A4", "A5"]) out.adds.push(await N.add(t));
    const raw = Uint8Array.from(atob(${JSON.stringify(Buffer.from(pcm.buffer).toString("base64"))}), c => c.charCodeAt(0));
    const all = new Float32Array(raw.buffer), captions = [];
    for (let i = 0; i + 640 <= all.length; i += 640) {
        await N.feed("A1", all.slice(i, i + 640).buffer);
        await new Promise(r => setTimeout(r, 20));
        if (i % (640 * 25) === 0) captions.push(...await N.poll());
    }
    await new Promise(r => setTimeout(r, 1500));
    captions.push(...await N.poll());
    out.caption = captions.filter(c => c.track === "A1" && c.text).at(-1)?.text;
    out.errors = captions.filter(c => c.error).map(c => c.error);
    await N.stop();
    return out;
})()`);
console.log("Speech:", JSON.stringify(speech));
assert.ok(speech.start.ok, `engine starts inside Vesktop: ${speech.start.error}`);
assert.deepEqual(speech.adds, [true, true, true, true, false], "four speakers at most");
assert.match(speech.caption ?? "", /festive season of the year with christmas and roast beef/);
ws.close();
console.log("PASS end-to-end: NowCaption listed in Vesktop, engine bridge works, four-speaker limit, real speech");
