/* Optional tester-facing metrics. Export requires a deliberate click.
 * No recordings, transcripts, Discord IDs or username values included.
 */
import { latestNativeMetrics } from "../audio/capture";
import { isLevelPreviewOn } from "../audio/levelPreview";
import { latencySnapshot } from "../audio/onsetLatency";
import * as diagnostic from "../core/diagnostics";
import * as profiler from "../core/profiler";
import { peers, runtime, slots } from "../core/state";
import { preferences } from "../core/settings";
import { tileCaptionRect } from "./tileGeometry";
import { placementState, tileScanStats, voiceTileRects } from "./voiceTiles";

function status(): object {
    return {
        nowCaptionPlugin: "voice-tiles-v19", speechModel: "v4", recordedAt:new Date().toISOString(),
        privacy: "Metadata only. No audio, transcripts, usernames, Discord IDs or authentication information.",
        notes: {
            latency: "Audio energy onset to first changed partial caption is an estimate (renderer clock), not acoustic end-to-end latency. Network and decoder buffering precede capture.",
            cpu: "Single inference-worker thread CPU % relative to ONE logical core when process.threadCpuUsage is supported. Does not include renderer/IPC or helper threads.",
            memory: "Recognizer worker V8 heap and accounted external. Native ONNX allocations may be omitted; shared Vesktop RSS is intentionally not reported as plugin RAM.",
            transport: "AudioWorklet emits 640-sample transferable PCM blocks when available; native worker receives transferable Float32Array buffers. Legacy fallback supported."
        },
        capture: { monitorOn:runtime.monitorOn,engineReady:runtime.engineReady,
            voicePageVisible:runtime.voicePageVisible, peerConnections:peers.size,
            detectedTracks:slots.size, levelPreviewOn:isLevelPreviewOn(), speakingTracks:[...slots.values()].filter(s=>(s.levelActiveUntil??0)>performance.now()).length, visibleCards:[...slots.values()].filter(x=>x.enabled).length },
        tilePlacement: (()=>{
            const rects=voiceTileRects();
            const linked=[...slots.values()].filter(s=>s.enabled).map(s=>{
                const placement=placementState(s);
                const rect=placement.tile;
                const geometry=rect ? tileCaptionRect(rect,preferences.fontSize,innerWidth,innerHeight) : undefined;
                const reason=preferences.captionPlacement!=="tiles" ? "placement_floating" :
                    !runtime.voicePageVisible ? "not_on_voice_page" : !rect ? placement.reason :
                    !geometry ? "three_rows_do_not_fit" : "attached";
                return {track:s.id,identitySource:placement.source,reason,
                    tileFound:!!rect,geometryFits:!!geometry,
                    tileWidth:rect?Math.round(rect.width):null,tileHeight:rect?Math.round(rect.height):null,
                    requiredRows:3,requiredHeight:Math.ceil(preferences.fontSize*1.55)*3+8};
            });
            return {mode:preferences.captionPlacement,participantTilesFound:rects.size,
                scan:tileScanStats(),
                anchored:linked.filter(x=>x.reason==="attached").length,
                tracks:linked};
        })(),
        tracks:profiler.snapshot(),
        voiceIdentity: Object.fromEntries([...slots.values()].map(s=>[s.id,{verified:Boolean(s.verifiedUserId),identityStatus:s.identityStatus || "waiting",captureMode:s.captureMode||"unattached",transport:s.transferMode||"unknown"}])),
        onsetToFirstCaptionEstimate:latencySnapshot(),
        rendererPipeline:profiler.pipelineSnapshot(),
        recognizerWorker:latestNativeMetrics,
        options:diagnostic.getDiagnosticsOptions(),
        events:diagnostic.recentEvents(600)
    };
}
export function diagnosticSnapshot() { return status(); }
