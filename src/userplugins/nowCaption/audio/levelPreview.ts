/**
 * Opt-in, local-only level meter for matching an unknown WebRTC audio track to
 * a speaking friend. No transcription or waveform leaves this renderer.
 * This is deliberately separate from the ASR capture graph: disabled caption
 * cards can still show their audio activity in the source selector.
 */
import * as diagnostic from "../core/diagnostics";
import { slots } from "../core/state";
import type { Slot } from "../core/types";

type Monitor = {
    slot: Slot;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    silent: GainNode;
    samples: Float32Array<ArrayBuffer>;
};
const monitors = new Map<number, Monitor>();
let context: AudioContext | null = null;
let enabled = false;
let starting: Promise<void> | null = null;
let generation = 0;

export const isLevelPreviewOn = () => enabled;

function dispose(m: Monitor) {
    try { m.source.disconnect(); } catch { /* already stopped */ }
    try { m.analyser.disconnect(); } catch { /* already stopped */ }
    try { m.silent.disconnect(); } catch { /* already stopped */ }
    m.slot.levelRms = 0;
    m.slot.levelActiveUntil = 0;
}

export function syncLevelPreview() {
    if (!enabled || !context) return;
    const current = new Set([...slots.values()].map(slot => slot.instanceKey));
    for (const [key, mon] of monitors) {
        if (!current.has(key) || mon.slot.track.readyState !== "live") {
            dispose(mon);
            monitors.delete(key);
        }
    }
    for (const slot of slots.values()) {
        const key=slot.instanceKey;
        if (!key || monitors.has(key) || slot.track.readyState !== "live") continue;
        try {
            const source=context.createMediaStreamSource(new MediaStream([slot.track]));
            const analyser=context.createAnalyser();
            analyser.fftSize=2048;
            analyser.smoothingTimeConstant=0;
            const silent=context.createGain();
            silent.gain.value=0;
            // Analyser must be part of a live graph on some Chromium versions.
            source.connect(analyser);
            analyser.connect(silent);
            silent.connect(context.destination);
            monitors.set(key,{slot,source,analyser,silent,samples:new Float32Array(analyser.fftSize)});
            diagnostic.debug("meter","attached",{track:slot.id});
        } catch {
            diagnostic.warn("meter","attach_failed",{track:slot.id});
        }
    }
}

export function sampleLevelPreview() {
    if (!enabled) return;
    syncLevelPreview();
    const now=performance.now();
    for (const monitor of monitors.values()) {
        try { monitor.analyser.getFloatTimeDomainData(monitor.samples); }
        catch { continue; }
        let sum=0;
        for (const v of monitor.samples) sum+=v*v;
        const rms=Math.sqrt(sum/monitor.samples.length);
        monitor.slot.levelRms=rms;
        // A short hold prevents single audio-frame gaps making the indicator flicker.
        if (rms>=0.012) monitor.slot.levelActiveUntil=now+380;
    }
}

export function startLevelPreview(): Promise<void> {
    if (enabled) return Promise.resolve();
    if (starting) return starting;
    const ticket=++generation;
    starting=(async()=>{
        let newContext:AudioContext|null=null;
        try {
            newContext = new AudioContext();
            await newContext.resume();
            if(ticket!==generation){void newContext.close().catch(()=>{});return;}
            context=newContext;
            enabled=true;
            syncLevelPreview();
            diagnostic.info("meter","started",{tracks:monitors.size});
        } catch {
            diagnostic.warn("meter","unavailable");
            if (newContext) void newContext.close().catch(()=>{});
        }
    })().finally(()=>{starting=null;});
    return starting;
}

export function stopLevelPreview() {
    generation++;
    enabled=false;
    for (const mon of monitors.values()) dispose(mon);
    monitors.clear();
    const old=context;
    context=null;
    if (old) void old.close().catch(()=>{});
    diagnostic.info("meter","stopped");
}
