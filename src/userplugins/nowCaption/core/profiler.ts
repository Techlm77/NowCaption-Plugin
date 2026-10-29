/* Cheap ring-sampled timings: never emit a log per 40-ms audio block. */
import type { TrackStats } from "./types";

class Samples {
    private values: number[] = [];
    private index = 0;
    constructor(private readonly capacity = 120) {}
    add(value: number): void {
        if (!Number.isFinite(value) || value < 0) return;
        if (this.values.length < this.capacity) this.values.push(value);
        else { this.values[this.index] = value; this.index = (this.index + 1) % this.capacity; }
    }
    mean(): number { return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : 0; }
    p95(): number { const sorted = [...this.values].sort((a,b)=>a-b); return sorted[Math.ceil(sorted.length * .95)-1] ?? 0; }
    max(): number { return this.values.length ? Math.max(...this.values) : 0; }
    has(): boolean { return this.values.length > 0; }
    clear(): void { this.values = []; this.index = 0; }
}
class TrackProfiler {
    blocks = 0; samples = 0; rejects = 0; captions = 0; rms = 0;
    callbacks = new Samples(); ipc = new Samples();
    snapshot(): TrackStats {
        const round = (x: number) => Math.round(x * 100) / 100;
        return {
            blocks: this.blocks, samples: this.samples, rms: round(this.rms),
            callbackMeanMs: round(this.callbacks.mean()), callbackMaxMs: round(this.callbacks.max()), callbackP95Ms: round(this.callbacks.p95()),
            ipcMeanMs: this.ipc.has() ? round(this.ipc.mean()) : null,
            ipcP95Ms: this.ipc.has() ? round(this.ipc.p95()) : null,
            rejects: this.rejects, captions: this.captions
        };
    }
}
const tracks = new Map<string, TrackProfiler>();
const stages = { poll: new Samples(160), render: new Samples(160), tick: new Samples(160) };
export function sampleStage(stage: keyof typeof stages, ms: number) { stages[stage].add(ms); }
export function pipelineSnapshot() {
    const round = (x: number) => Math.round(x * 100) / 100;
    return Object.fromEntries(Object.entries(stages).map(([name,values])=>
        [name, {meanMs: round(values.mean()), p95Ms: round(values.p95()), maxMs: round(values.max())}]));
}

function get(id: string) { let p = tracks.get(id); if (!p) tracks.set(id, p = new TrackProfiler()); return p; }
export function sampleCallback(id: string, durationMs: number, rms: number): void {
    const item = get(id); item.callbacks.add(durationMs); item.rms = rms;
}
export function blockSent(id: string): void { get(id).blocks++; get(id).samples += 640; }
// These arrive asynchronously (IPC replies, captions): never recreate stats for a released track,
// or a new track that reuses its A-number would inherit them.
export function blockRejected(id: string): void { const p = tracks.get(id); if (p) p.rejects++; }
export function sampleIpc(id: string, durationMs: number): void { tracks.get(id)?.ipc.add(durationMs); }
export function captionReceived(id: string): void { const p = tracks.get(id); if (p) p.captions++; }
export function snapshot(): Record<string, TrackStats> {
    return Object.fromEntries([...tracks.entries()].map(([id,p]) => [id, p.snapshot()]));
}
export function reset(): void { tracks.clear(); for (const samples of Object.values(stages)) { samples.clear(); } }
export function remove(id: string): void { tracks.delete(id); }
