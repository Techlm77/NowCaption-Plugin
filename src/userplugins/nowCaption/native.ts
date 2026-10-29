/* Native IPC boundary (Vesktop's main process). Voice audio is handled transiently, never stored or uploaded.
 * Metadata-only diagnostics are bounded in RAM: no usernames or transcripts.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

import { MAX_CAPTIONED, MAX_TRACKS } from "./core/state";
import type { NativeUpdate, WorkerMetrics } from "./core/types";
import { getRuntimeRoot, MODEL_DIRECTORY } from "./engine/runtimePaths";
import { WORKER_SOURCE } from "./workerSource";

const ROOT = getRuntimeRoot();
const HOME = homedir();
/** Messages reach the screen (and screenshots people share): show ~ instead of the home folder and its user name. */
const shown = (message: string) => HOME.length > 1 ? message.split(HOME).join("~") : message;
const MODEL = join(ROOT, "models", MODEL_DIRECTORY);
const REQUIRED = ["tokens.txt", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"];
const BLOCK = 640;
const MAX_BACKLOG = 50; // 50 blocks of 40 ms: at most 2 s of audio waiting per track
const MAX_UPDATES = 120;
const SAMPLES = 160;

let worker: Worker | null = null;
let ready = false;
let workerError = "Not started";
let updates: NativeUpdate[] = [];
let nextSequence = 1;
let previousStatsRequest = 0;
let startedAt = 0;
let received = 0;
let dropped = 0;
const pending = new Map<string, number>(); // registered tracks -> blocks sent but not yet acknowledged
const resetting = new Set<string>(); // tracks whose captions are ignored until the worker confirms a reset
const sentAt = new Map<number, number>();
const roundtrips: number[] = [];

const EMPTY: WorkerMetrics = {
    running: false, available: false, cpuPercentOneCore: null, heapMiB: null, externalMiB: null,
    workerElu: null, queueTotal: 0, pendingByTrack: {}, decodedBlocks: 0,
    decodeMeanMs: null, decodeP95Ms: null, decodeMaxMs: null,
    roundtripMeanMs: null, roundtripP95Ms: null, dropped: 0, received: 0,
    activeStreams: 0, workerUptimeSeconds: 0,
    cpuSource: "Node process.threadCpuUsage() on the recognizer worker thread; N/A if unsupported",
    memoryLimitations: "V8 worker heap + accounted external only; excludes the renderer and the model's native allocations. The plugin's share of Vesktop's memory can't be isolated."
};
let latest: WorkerMetrics = { ...EMPTY };

const round = (v: number) => Math.round(v * 100) / 100;
const mean = (values: number[]) => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
function p95(values: number[]) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
}
/** A1 ... A{MAX_TRACKS}, as audio/capture.ts names incoming tracks. */
function validTrack(track: unknown): track is string {
    if (typeof track !== "string" || !/^A[1-9]\d?$/.test(track)) return false;
    return Number(track.slice(1)) <= MAX_TRACKS;
}
function push(update: NativeUpdate) {
    // A newer hypothesis for the same track and segment contains the older one: replace it in place, so a slow
    // poll can't push a segment's final words out of the queue.
    if (update.text !== undefined) {
        const i = updates.findIndex(u => u.track === update.track && u.segment === update.segment && u.text !== undefined);
        if (i >= 0) { updates[i] = update; return; }
    }
    updates.push(update);
    if (updates.length > MAX_UPDATES) updates = updates.slice(-MAX_UPDATES);
}
function sample(values: number[], n: number) {
    values.push(n);
    if (values.length > SAMPLES) values.shift();
}
function resetState() {
    updates = [];
    sentAt.clear();
    pending.clear();
    resetting.clear();
    roundtrips.length = 0;
    received = dropped = 0;
    latest = { ...EMPTY };
}
function workerMetrics(): WorkerMetrics {
    latest.running = ready;
    latest.available = true;
    latest.queueTotal = [...pending.values()].reduce((a, b) => a + b, 0);
    latest.pendingByTrack = Object.fromEntries(pending);
    latest.received = received;
    latest.dropped = dropped;
    latest.roundtripMeanMs = mean(roundtrips);
    latest.roundtripP95Ms = p95(roundtrips);
    latest.workerUptimeSeconds = startedAt ? round((performance.now() - startedAt) / 1000) : 0;
    return { ...latest, pendingByTrack: { ...latest.pendingByTrack } };
}

export async function start(_event: unknown): Promise<{ ok: boolean; error?: string; }> {
    if (worker && ready) return { ok: true };
    if (worker) return { ok: false, error: workerError };
    const missing = REQUIRED.filter(file => !existsSync(join(MODEL, file)));
    if (missing.length) {
        return { ok: false, error: shown(`Speech model v4 isn't installed in ${MODEL} (missing ${missing.join(", ")}). Run the engine installer (see README).`) };
    }
    let addonEntry: string;
    try { addonEntry = createRequire(join(ROOT, "package.json")).resolve("sherpa-onnx-node"); } catch {
        return { ok: false, error: shown(`The speech engine (sherpa-onnx-node) isn't installed in ${ROOT}. Run the engine installer (see README).`) };
    }

    ready = false;
    workerError = "Loading model";
    resetState();
    startedAt = performance.now();
    const instance = new Worker(WORKER_SOURCE, { eval: true, workerData: { addonEntry, model: MODEL } });
    worker = instance;
    return new Promise(resolve => {
        let settled = false;
        const finish = (ok: boolean, error?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(ok ? { ok: true } : { ok: false, error });
        };
        const timeout = setTimeout(() => {
            workerError = "Loading the speech model timed out";
            finish(false, workerError);
            void instance.terminate();
        }, 45000);
        instance.on("message", msg => {
            if (msg.type === "ready") {
                ready = true;
                workerError = "";
                finish(true);
            } else if (msg.type === "fatal") {
                workerError = shown(String(msg.error));
                push({ track: "system", error: workerError });
                finish(false, workerError);
                void instance.terminate();
            } else if (msg.type === "ack") {
                const sequence = Number(msg.seq);
                const at = sentAt.get(sequence);
                if (at !== undefined) {
                    sample(roundtrips, performance.now() - at);
                    sentAt.delete(sequence);
                }
                // Late acknowledgements for a removed track are harmless.
                const queued = pending.get(msg.track);
                if (queued !== undefined) pending.set(msg.track, Math.max(0, queued - 1));
            } else if (msg.type === "caption") {
                if (pending.has(msg.track) && !resetting.has(msg.track)) push({ track: msg.track, text: msg.text, segment: msg.segment });
            } else if (msg.type === "resetDone") {
                resetting.delete(msg.track);
            } else if (msg.type === "streamError") {
                push({ track: msg.track, error: shown(String(msg.error)) });
            } else if (msg.type === "metrics") {
                for (const field of ["cpuPercentOneCore", "heapMiB", "externalMiB", "decodedBlocks", "decodeMeanMs", "decodeP95Ms", "decodeMaxMs", "activeStreams"] as const) {
                    if (typeof msg[field] === "number" || msg[field] === null) (latest as any)[field] = msg[field];
                }
            }
        });
        instance.on("error", err => {
            workerError = shown(String(err));
            ready = false;
            push({ track: "system", error: workerError });
            finish(false, workerError);
        });
        instance.on("exit", code => {
            if (worker === instance) worker = null;
            ready = false;
            if (code !== 0) {
                workerError = `Recognition worker exited with code ${code}`;
                push({ track: "system", error: workerError });
            }
            sentAt.clear();
            pending.clear();
            finish(false, workerError);
        });
    });
}

/** Registers a captioned track. At most MAX_CAPTIONED at once; the renderer enforces the same limit. */
export function add(_event: unknown, track: string): boolean {
    if (!worker || !ready || !validTrack(track)) return false;
    if (!pending.has(track) && pending.size >= MAX_CAPTIONED) return false;
    if (!pending.has(track)) {
        worker.postMessage({ type: "add", track });
        pending.set(track, 0);
    }
    return true;
}

export function feed(_event: unknown, track: string, samples: number[] | ArrayBuffer | Float32Array): boolean {
    if (!worker || !ready || !validTrack(track)) return false;
    let pcm: Float32Array<ArrayBuffer>;
    try {
        if (Array.isArray(samples)) pcm = Float32Array.from(samples);
        else if (samples instanceof ArrayBuffer) pcm = new Float32Array(samples);
        else if (ArrayBuffer.isView(samples)) pcm = new Float32Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer);
        else return false;
    } catch { return false; }
    if (pcm.length !== BLOCK || !pcm.every(n => Number.isFinite(n) && Math.abs(n) <= 1.01)) return false;
    const queued = pending.get(track);
    if (queued === undefined || queued >= MAX_BACKLOG) { dropped++; return false; }
    const sequence = nextSequence++;
    pending.set(track, queued + 1);
    sentAt.set(sequence, performance.now());
    received++;
    // Transfer the buffer to the worker instead of copying it.
    worker.postMessage({ type: "feed", track, samples: pcm.buffer, seq: sequence }, [pcm.buffer]);
    return true;
}

/** The person behind a track changed: drop its queued captions and restart its recognizer stream. */
export function reset(_event: unknown, track: string): boolean {
    if (!worker || !ready || !validTrack(track) || !pending.has(track)) return false;
    updates = updates.filter(u => u.track !== track);
    resetting.add(track);
    worker.postMessage({ type: "reset", track });
    return true;
}

export function remove(_event: unknown, track: string): boolean {
    if (!validTrack(track)) return false;
    pending.delete(track);
    resetting.delete(track);
    worker?.postMessage({ type: "remove", track });
    return true;
}

export function poll(_event: unknown): NativeUpdate[] {
    const list = updates;
    updates = [];
    return list;
}

export function metrics(_event: unknown): WorkerMetrics {
    const now = performance.now();
    if (worker && ready && now - previousStatsRequest > 1700) {
        previousStatsRequest = now;
        worker.postMessage({ type: "stats" });
    }
    return workerMetrics();
}

export async function stop(_event: unknown): Promise<boolean> {
    const old = worker;
    worker = null;
    ready = false;
    startedAt = 0;
    resetState();
    if (old) await old.terminate();
    return true;
}
