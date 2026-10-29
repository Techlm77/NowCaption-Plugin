/* WebRTC track observation and real-time PCM transport. Does not alter Discord's audio output.
 * AudioWorklet per opted-in track with legacy fallback; no audio/transcript persistence.
 */
import { PluginNative } from "@utils/types";

import * as diagnostic from "../core/diagnostics";
import * as profiler from "../core/profiler";
import { BLOCK, MAX_TRACKS, peers, RATE, runtime, slots } from "../core/state";
import { clamp } from "../core/settings";
import type { Slot, WorkerMetrics } from "../core/types";
import { audioBlock, captionChanged, clearLatency } from "./onsetLatency";
import { WORKLET_SOURCE } from "./workletSource";

const Native = VencordNative.pluginHelpers.NowCaption as PluginNative<typeof import("../native")>;
let originalPC: typeof RTCPeerConnection | undefined;
let observedPC: typeof RTCPeerConnection | undefined;
let onTracksChange = () => {};
let onTrackRelease = (_slot: Slot) => {};
let onMessage = (_text: string) => {};
let lastTelemetry = 0;
let lastMetricsPoll = 0;
let lastNativeError = 0;
let workletAvailable = false;
const workletContexts = new WeakSet<AudioContext>();
let observationEnabled = false;
let scopedObservations = 0;
let nextInstanceKey = 1;
const connectionCleanups = new Map<RTCPeerConnection, () => void>();
export function enableObservation() { observationEnabled = true; }
export function disableObservation() { observationEnabled = false; }
export function getScopedObservations() { return scopedObservations; }
export function observeScopedConnection(pc: RTCPeerConnection) {
    if (observationEnabled) { scopedObservations++; diagnostic.info("webrtc","scoped_connection",{count:scopedObservations}); observeConnection(pc); }
}
export let latestNativeMetrics: WorkerMetrics | null = null;

export function setCaptureCallbacks(callbacks: {
    tracksChange: () => void;
    trackRelease: (slot: Slot) => void;
    message: (msg: string) => void;
}) {
    onTracksChange = callbacks.tracksChange;
    onTrackRelease = callbacks.trackRelease;
    onMessage = callbacks.message;
}
function note(text: string) { onMessage(text); }
export function releaseTrack(slot: Slot, reason = "track_ended") {
    // A previous connection can emit delayed events after its A1/A2 ID was reused.
    if (slots.get(slot.id) !== slot) return;
    if (slot.sourceStream && slot.sourceRemovedHandler) {
        slot.sourceStream.removeEventListener("removetrack",slot.sourceRemovedHandler);
    }
    slot.trackCleanup?.();slot.trackCleanup=undefined;
    slot.sourceStream = undefined; slot.sourceRemovedHandler = undefined;slot.sourceAddedHandler=undefined;
    onTrackRelease(slot);
    slots.delete(slot.id);
    profiler.remove(slot.id);
    clearLatency(slot.id);
    diagnostic.info("track", "released", {track:slot.id, reason});
    onTracksChange();
}
export function observeConnection(pc: RTCPeerConnection) {
    if (!observationEnabled || peers.has(pc)) return;
    peers.add(pc);
    diagnostic.info("webrtc", "peer_created", {peers:peers.size});
    const onTrack=(event: RTCTrackEvent) => {
        if (event.track.kind !== "audio") return;
        if ([...slots.values()].some(slot => slot.track === event.track)) return;
        const id = Array.from({length:MAX_TRACKS},(_,i)=>`A${i+1}`).find(x=>!slots.has(x));
        if (!id) { diagnostic.warn("track", "limit_reached", {limit:MAX_TRACKS}); note(`${MAX_TRACKS} incoming audio tracks already detected`); return; }
        const slot: Slot = {
            id, instanceKey:nextInstanceKey++, pc, track:event.track, receiver:event.receiver, enabled:false, label:"", userId:"", text:"", rms:0,
            incoming:new Float32Array(BLOCK), used:0, blockNumber:0
        };
        // Stream audio can be identified only with explicit media metadata.
        // Same peer connection or join order is NOT evidence of stream ownership.
        const announcedStreams = event.streams ?? [];
        const hasVideo = announcedStreams.some(stream => (stream.getVideoTracks?.() ?? []).length > 0);
        const markedAsStream = /(?:screen.?share|go.?live|stream audio|desktop audio)/i.test(event.track.label || "");
        // A camera may have audio AND video in the same MediaStream. Only an
        // explicitly labelled stream can be classified automatically.
        slot.sourceKind = markedAsStream ? "stream" : "voice";
        if (markedAsStream) slot.sourceKindOrigin = "track_label";
        if (hasVideo) diagnostic.info("track","video_in_media_stream",{track:id});
        slots.set(id,slot);
        // Removal of a remote track from its MediaStream does not always fire
        // MediaStreamTrack.ended in Chromium. Observe both lifecycles.
        const stream = event.streams?.find(s => s.getTracks().includes(event.track));
        if (stream) {
            slot.sourceStream = stream;
            slot.sourceRemovedHandler = (event: Event) => {
                if ((event as MediaStreamTrackEvent).track === slot.track) releaseTrack(slot,"stream_removed");
            };
            stream.addEventListener("removetrack",slot.sourceRemovedHandler);
            // Video can arrive AFTER the related audio track.
            const onAdded = (ev: Event) => {
                if ((ev as MediaStreamTrackEvent).track?.kind === "video" && slots.get(slot.id) === slot) {
                    diagnostic.info("track","video_track_observed",{track:slot.id,ownership:"unconfirmed"});
                }
            };
            stream.addEventListener("addtrack",onAdded);
            // 'trackCleanup' is assigned below after 'ended' listeners are installed.
            slot.sourceAddedHandler=onAdded;
        }
        diagnostic.info("track", "detected", {track:id, tracks:slots.size, muted:event.track.muted, sourceKind:slot.sourceKind});
        note(`Incoming User ${id.slice(1)} detected`);
        onTracksChange();
        const ended=()=>releaseTrack(slot,"track_ended");
        const muted=()=>diagnostic.debug("track", "muted", {track:id});
        const unmuted=()=>diagnostic.debug("track", "unmuted", {track:id});
        event.track.addEventListener("ended",ended,{once:true});
        event.track.addEventListener("mute",muted);
        event.track.addEventListener("unmute",unmuted);
        slot.trackCleanup=()=>{
            event.track.removeEventListener("ended",ended);
            event.track.removeEventListener("mute",muted);
            event.track.removeEventListener("unmute",unmuted);
            if (slot.sourceStream && slot.sourceAddedHandler) slot.sourceStream.removeEventListener("addtrack",slot.sourceAddedHandler);
        };
    };
    const onConnectionState=()=>{
        diagnostic.info("webrtc", "connection_state", {state:pc.connectionState});
        if (pc.connectionState === "closed" || pc.connectionState === "failed") {
            for (const slot of [...slots.values()]) if (slot.pc === pc) releaseTrack(slot,`connection_${pc.connectionState}`);
            peers.delete(pc);
            connectionCleanups.get(pc)?.();connectionCleanups.delete(pc);
        }
    };
    pc.addEventListener("track",onTrack);
    pc.addEventListener("connectionstatechange",onConnectionState);
    connectionCleanups.set(pc,()=>{pc.removeEventListener("track",onTrack);pc.removeEventListener("connectionstatechange",onConnectionState);});
}
export function patchRTC() {
    observationEnabled = true;
    if (!window.RTCPeerConnection) { note("WebRTC unavailable"); diagnostic.error("webrtc","unavailable"); return; }
    originalPC = window.RTCPeerConnection;
    class ObservedPC extends originalPC {
        constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); observeConnection(this); }
    }
    observedPC = ObservedPC;
    window.RTCPeerConnection = ObservedPC;
    diagnostic.info("webrtc", "observer_installed");
}

// Only dispose tracks when a browser/SDP lifecycle signal proves that the
// receive track no longer exists. Silence alone never means the speaker left.
export function pruneDeadTracks() {
    for (const slot of [...slots.values()]) {
        if (slot.track.readyState === "ended") { releaseTrack(slot,"track_ended_poll"); continue; }
        if (["closed","failed"].includes(slot.pc.connectionState)) { releaseTrack(slot,`connection_${slot.pc.connectionState}`); continue; }
        try {
            const transceiver = slot.pc.getTransceivers().find(t => t.receiver === slot.receiver);
            if (transceiver && transceiver.currentDirection === "inactive" && slot.pc.signalingState === "stable") {
                slot.inactiveSince ??= performance.now();
                if (performance.now()-slot.inactiveSince >= 4000) releaseTrack(slot,"receiver_inactive");
            } else {
                slot.inactiveSince = undefined;
            }
        } catch { /* SDP state might not be ready */ }
    }
}

export function unpatchRTC() {
    observationEnabled = false;
    if (originalPC && observedPC && window.RTCPeerConnection === observedPC) window.RTCPeerConnection = originalPC;
    originalPC = observedPC = undefined;
    diagnostic.info("webrtc", "observer_removed");
}
export function detachAudio(slot: Slot) {
    if (slot.processor) slot.processor.onaudioprocess = null;
    if (slot.worklet) {
        slot.worklet.port.onmessage = null;
        // Lets the processor end; a disconnected one would otherwise keep running on the audio thread.
        try { slot.worklet.port.postMessage({type:"stop"}); } catch { /* port already closed */ }
    }
    try { slot.source?.disconnect(); } catch { /* already disconnected */ }
    try { slot.processor?.disconnect(); } catch { /* already disconnected */ }
    try { slot.worklet?.disconnect(); } catch { /* already disconnected */ }
    try { slot.silenceGain?.disconnect(); } catch { /* already disconnected */ }
    slot.source = undefined; slot.processor = undefined; slot.worklet=undefined;slot.captureMode=undefined;
    slot.silenceGain = undefined;
    slot.used = 0; slot.rms = 0;
    void Native.remove(slot.id).catch(() => diagnostic.warn("audio", "native_remove_failed", {track:slot.id}));
    diagnostic.info("audio", "detached", {track:slot.id});
}
function sendFrame(slot:Slot, buffer:ArrayBuffer, rms:number) {
    if (!runtime.monitorOn || !runtime.engineReady || !slot.enabled) return;
    slot.rms = rms;
    audioBlock(slot.id,rms);
    const sentAt=performance.now();
    const sequence=++slot.blockNumber;
    profiler.blockSent(slot.id);
    // Try structured-clone PCM first. Legacy Electron IPC bridges may reject
    // ArrayBuffers; fall back to the proven numeric-array format, not a lost frame.
    const frame = new Float32Array(buffer);
    const useBinary = slot.transferMode !== "array";
    void Native.feed(slot.id,useBinary?buffer:Array.from(frame)).then(async accepted=>{
        if (!accepted && useBinary && slot.transferMode !== "binary") {
            slot.transferMode="array";
            diagnostic.warn("audio","binary_ipc_fallback",{track:slot.id});
            accepted=await Native.feed(slot.id,Array.from(frame));
        } else if (accepted && !slot.transferMode) {
            slot.transferMode="binary";
            diagnostic.info("audio","binary_ipc_available",{track:slot.id});
        }
        if (!accepted) {
            profiler.blockRejected(slot.id);
            if(sequence%25===0) diagnostic.warn("audio","feed_rejected",{track:slot.id});
        }
        if(sequence%25===0) profiler.sampleIpc(slot.id,performance.now()-sentAt);
    }).catch(()=>{
        profiler.blockRejected(slot.id);
        if(sequence%25===0) diagnostic.warn("audio","feed_ipc_failed",{track:slot.id});
    });
}

async function prepareWorklet(context:AudioContext):Promise<boolean> {
    if (!context.audioWorklet || typeof AudioWorkletNode==="undefined") return false;
    if (workletContexts.has(context)) return true; // already loaded into this context by an earlier start
    const url=URL.createObjectURL(new Blob([WORKLET_SOURCE],{type:"text/javascript"}));
    try {
        await context.audioWorklet.addModule(url);
        workletContexts.add(context);
        diagnostic.info("audio","worklet_loaded");
        return true;
    } catch {
        diagnostic.warn("audio","worklet_unavailable",{fallback:"legacy"});
        return false;
    } finally { URL.revokeObjectURL(url); }
}
export async function attachAudio(slot: Slot) {
    if (!runtime.context || !runtime.engineReady || !runtime.monitorOn || !slot.enabled || slot.processor || slot.worklet) return;
    try {
        const ok = await Native.add(slot.id);
        if (!ok || !slot.enabled || !runtime.monitorOn || slot.track.readyState !== "live") {
            if (ok) void Native.remove(slot.id);
            diagnostic.warn("audio", "attach_skipped", {track:slot.id, ready:runtime.engineReady, live:slot.track.readyState === "live"});
            return;
        }
        const source = runtime.context.createMediaStreamSource(new MediaStream([slot.track]));
        if (workletAvailable) {
            const worklet=new AudioWorkletNode(runtime.context,"nowcaption-capture-v7",{
                // "explicit" makes channelCount apply: stereo (e.g. Go Live) is downmixed, not cut to the left channel.
                numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,
                channelCountMode:"explicit",channelInterpretation:"speakers"
            });
            const gain=runtime.context.createGain();gain.gain.value=0;
            worklet.onprocessorerror=()=>{
                diagnostic.error("audio","worklet_processor_failed",{track:slot.id,fallback:"legacy"});
                workletAvailable=false;
                detachAudio(slot);
                if(runtime.monitorOn && runtime.engineReady && slot.enabled) void attachAudio(slot);
            };
            worklet.port.onmessage=event=>{
                if (event.data?.type!=="pcm" || !(event.data.buffer instanceof ArrayBuffer)) return;
                const started=performance.now();
                sendFrame(slot,event.data.buffer,Number(event.data.rms)||0);
                profiler.sampleCallback(slot.id,performance.now()-started,Number(event.data.rms)||0);
            };
            source.connect(worklet);worklet.connect(gain);gain.connect(runtime.context.destination);
            slot.source=source;slot.worklet=worklet;slot.silenceGain=gain;slot.captureMode="worklet";
            diagnostic.info("audio","attached",{track:slot.id,mode:"worklet",rate:RATE,blockSamples:BLOCK});
            return;
        }
        // Fallback for older Electron/Chromium: same working 640-sample blocks.
        const processor = runtime.context.createScriptProcessor(1024,1,1);
        const gain = runtime.context.createGain();
        gain.gain.value = 0;
        processor.onaudioprocess = event => {
            if (!runtime.monitorOn || !runtime.engineReady || !slot.enabled || slot.track.readyState !== "live") return;
            const started = performance.now();
            const samples = event.inputBuffer.getChannelData(0);
            let energy = 0;
            for (let i=0; i<samples.length;i++) {
                const raw = samples[i];
                const value = Number.isFinite(raw) ? clamp(raw,-1,1) : 0;
                energy += value*value;
                slot.incoming[slot.used++] = value;
                if (slot.used === BLOCK) {
                    const block=slot.incoming.slice();
                    let blockEnergy=0;
                    for(const sample of block) blockEnergy+=sample*sample;
                    sendFrame(slot,block.buffer,Math.sqrt(blockEnergy/BLOCK));
                    slot.used = 0;
                }
            }
            slot.rms = Math.sqrt(energy / samples.length);
            profiler.sampleCallback(slot.id,performance.now()-started,slot.rms);
        };
        source.connect(processor);
        processor.connect(gain);
        gain.connect(runtime.context.destination);
        slot.source = source; slot.processor = processor; slot.silenceGain = gain;slot.captureMode="legacy";
        diagnostic.info("audio", "attached", {track:slot.id, mode:"legacy", rate:RATE, blockSamples:BLOCK});
    } catch(error) {
        diagnostic.error("audio", "attach_failed", {track:slot.id});
        note(`Audio ${slot.id} could not attach; check Developer Tools`);
        console.error("NowCaption audio attachment",error);
        detachAudio(slot);
    }
}
export async function startCapture() {
    if (runtime.busy || runtime.monitorOn) return;
    runtime.busy = true;
    diagnostic.info("engine", "start_requested", {tracks:slots.size});
    try {
        runtime.context ??= new AudioContext({sampleRate:RATE});
        await runtime.context.resume();
        workletAvailable=await prepareWorklet(runtime.context);
        if (runtime.context.sampleRate !== RATE) throw new Error(`Expected ${RATE} Hz; got ${runtime.context.sampleRate} Hz`);
        note("Loading speech model v4…");
        const begin = performance.now();
        const result = await Native.start();
        const loadMs = Math.round(performance.now()-begin);
        if (!result.ok) throw new Error(result.error ?? "Could not load model");
        runtime.engineReady = runtime.monitorOn = true;
        for (const slot of slots.values()) if (slot.enabled) void attachAudio(slot);
        diagnostic.info("engine", "ready", {loadMs, tracks:slots.size});
        note(`NowCaption ready · ${slots.size} incoming audio tracks`);
    } catch(error) {
        diagnostic.error("engine", "start_failed");
        note(`NowCaption couldn't start: ${String(error).slice(0,160)}`);
    } finally { runtime.busy = false; }
}
/** The person behind a track changed: start its captions again, so earlier words never show under a new name. */
export function resetRecognition(slot: Slot) {
    slot.text = ""; slot.segment = undefined; slot.finishedText = undefined;
    if (slot.enabled && runtime.engineReady) {
        void Native.reset(slot.id).catch(() => diagnostic.warn("audio", "native_reset_failed", {track:slot.id}));
    }
}
const MAX_FINISHED = 3000;
export async function refreshAudio() {
    const now = performance.now();
    if (!runtime.monitorOn || runtime.busy) return;
    // Captions polled from before a speaker change belong to the previous person.
    const epochs = new Map([...slots.values()].map(s => [s.id, s.identityEpoch]));
    try {
        for (const change of await Native.poll()) {
            if (change.error) {
                diagnostic.error("engine", "worker_stream_error", {track:change.track});
                // Error details deliberately stay out of exported diagnostics.
                note(`Recognition error on ${change.track}`);
                continue;
            }
            const slot = slots.get(change.track);
            if (slot?.enabled && typeof change.text === "string" && epochs.get(slot.id) === slot.identityEpoch) {
                if (slot.segment !== undefined && change.segment !== slot.segment && slot.text) {
                    // The previous segment is complete: hand its final words to the card, even if a later update
                    // in this same poll replaces slot.text before the card renders.
                    const finished = slot.finishedText ? `${slot.finishedText} ${slot.text}` : slot.text;
                    slot.finishedText = finished.length > MAX_FINISHED ? finished.slice(-MAX_FINISHED) : finished;
                }
                slot.text = change.text;
                slot.segment = change.segment;
                profiler.captionReceived(slot.id);
                const estimate=captionChanged(slot.id);
                if (estimate!==null) diagnostic.debug("latency","onset_to_first_change",{track:slot.id,ms:estimate});
                diagnostic.debug("caption", "updated", {track:slot.id, chars:change.text.length});
            }
        }
    } catch(error) {
        if (now - lastNativeError > 5000) {
            diagnostic.error("engine", "poll_failed");
            lastNativeError = now;
        }
    }
    if (now - lastMetricsPoll > 1800) {
        lastMetricsPoll = now;
        try { latestNativeMetrics = await Native.metrics(); }
        catch { diagnostic.warn("metrics", "native_unavailable"); }
    }
    if (now-lastTelemetry>3000) {
        lastTelemetry = now;
        const active = [...slots.values()].filter(s=>s.enabled).length;
        const audio = profiler.snapshot();
        diagnostic.debug("audio", "periodic_sample", {
            active, tracks:slots.size, pending:latestNativeMetrics?.queueTotal ?? 0,
            dropped:latestNativeMetrics?.dropped ?? 0,
            callbackP95Ms: Math.max(0,...Object.values(audio).map(x=>x.callbackP95Ms)),
            decodeP95Ms:latestNativeMetrics?.decodeP95Ms ?? null
        });
    }
}
/** Stop the ASR and release its audio graph without destroying tracked speakers.
 * The user can restart recognition in the same call. */
export async function stopRecognition(): Promise<void> {
    if (runtime.busy || !runtime.monitorOn) return;
    runtime.busy = true;
    runtime.monitorOn = false;
    runtime.engineReady = false;
    for (const slot of slots.values()) {
        detachAudio(slot);
        slot.text = "";
        slot.segment = undefined;
        slot.finishedText = undefined;
        slot.rms = 0;
        slot.incoming.fill(0);
        slot.used = 0;
    }
    const oldContext=runtime.context;
    runtime.context = null;
    try {
        await Native.stop();
        diagnostic.info("engine", "user_stopped");
    } catch {
        diagnostic.error("engine", "stop_failed");
    } finally {
        try { await oldContext?.close(); } catch { diagnostic.warn("audio", "context_close_failed"); }
        workletAvailable = false;
        latestNativeMetrics = null;
        clearLatency();
        runtime.busy = false;
        note("Captions stopped");
    }
}

export function stopCapture() {
    runtime.monitorOn = runtime.engineReady = runtime.busy = false;
    for (const slot of slots.values()) {
        if (slot.sourceStream && slot.sourceRemovedHandler) {
            slot.sourceStream.removeEventListener("removetrack",slot.sourceRemovedHandler);
        }
        slot.trackCleanup?.();slot.trackCleanup=undefined;
        slot.sourceStream=undefined;slot.sourceRemovedHandler=undefined;slot.sourceAddedHandler=undefined;
        detachAudio(slot);
    }
    for (const cleanup of connectionCleanups.values()) cleanup();
    connectionCleanups.clear();
    slots.clear(); peers.clear();
    scopedObservations=0;
    void Native.stop().catch(()=>diagnostic.warn("engine","stop_failed"));
    void runtime.context?.close(); runtime.context = null;
    latestNativeMetrics = null;
    workletAvailable=false;clearLatency();
    lastTelemetry = lastMetricsPoll = lastNativeError = 0;
    diagnostic.info("engine","stopped");
}
