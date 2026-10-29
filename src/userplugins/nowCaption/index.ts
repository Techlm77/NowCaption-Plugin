/* NowCaption for Vesktop (v19): offline live captions for Discord calls with the speech model v4 of NowCaption
 * (github.com/Techlm77/NowCaption), conservative speaker verification and private diagnostics. Up to MAX_CAPTIONED
 * speakers are captioned at once. This is a userplugin, not an official Vencord plugin.
 */
import { migratePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";

import { attachAudio, detachAudio, disableObservation, enableObservation, getScopedObservations, latestNativeMetrics, observeScopedConnection, patchRTC, pruneDeadTracks, refreshAudio, releaseTrack, resetRecognition, setCaptureCallbacks, stopCapture, unpatchRTC } from "./audio/capture";
import { sampleLevelPreview, stopLevelPreview, syncLevelPreview } from "./audio/levelPreview";
import { beginVoiceCorrelation, sampleVoiceCorrelation, stopVoiceCorrelation } from "./audio/voiceCorrelation";
import { checkVerifiedSources, probeIdentities, resetIdentityLookup, setIdentityCallback, setSpeakerChangedCallback, setVerifiedMemberLeftCallback } from "./audio/voiceIdentity";
import * as diagnostic from "./core/diagnostics";
import * as profiler from "./core/profiler";
import { availableBundledFamilies, disposeFonts, ensureFontLoaded } from "./core/fonts";
import { captionedCount, MAX_CAPTIONED, peers, runtime, slots } from "./core/state";
import { preferences, savePreferences } from "./core/settings";
import { getActiveCardCount, getVerifiedCount, hideManager, mountUI, onVoicePage, openManager, refreshUI, setCompatibilityFallback, setMessage, unmountUI, updatePageVisibility } from "./ui/reactUI";
import { diagnosticSnapshot } from "./ui/diagnosticsPanel";
import { detachManualTile, resetVoiceTiles } from "./ui/voiceTiles";

let timer: number|undefined;
let refreshing=false;
let legacyCapture=false;
async function tick(){
    if(refreshing)return;
    refreshing=true;
    const start=performance.now();
    try{
        updatePageVisibility();pruneDeadTracks();checkVerifiedSources();void probeIdentities();
        syncLevelPreview();sampleLevelPreview();sampleVoiceCorrelation();
        const beforePoll=performance.now();await refreshAudio();
        profiler.sampleStage("poll",performance.now()-beforePoll);
        const beforeRender=performance.now();refreshUI();
        profiler.sampleStage("render",performance.now()-beforeRender);
    }catch{diagnostic.error("lifecycle","refresh_failed");}
    finally{profiler.sampleStage("tick",performance.now()-start);refreshing=false;}
}

const api={
    show:()=>openManager(),hide:hideManager,style:()=>openManager("appearance"),diagnostics:()=>openManager("diagnostics"),
    // Opt-in private fallback ONLY for Discord builds where the scoped patch does
    // not match. Not appropriate for an official Vencord submission.
    enableLegacyCapture:()=>{if(!legacyCapture){legacyCapture=true;patchRTC();diagnostic.warn("webrtc","legacy_capture_enabled");setMessage("Compatibility capture enabled. Rejoin the voice channel to detect streams.");}},
    showEverywhere:(enabled:boolean)=>{preferences.showEverywhere=!!enabled;savePreferences();updatePageVisibility();refreshUI();},
    detailedLogs:(v:boolean)=>diagnostic.setDiagnosticsOptions({detailed:v}),
    consoleLogs:(v:boolean)=>diagnostic.setDiagnosticsOptions({consoleOutput:v}),
    logs:()=>diagnostic.recentEvents(150),profile:()=>diagnosticSnapshot(),
    export:()=>diagnostic.exportDiagnosticJson(diagnosticSnapshot()),
    status:()=>({peers:peers.size,monitorOn:runtime.monitorOn,engineReady:runtime.engineReady,scopedObservations:getScopedObservations(),legacyCapture,
        voicePageVisible:onVoicePage(),activeCards:getActiveCardCount(),verifiedSpeakers:getVerifiedCount(),
        tracks:[...slots.values()].map(s=>({track:s.id,enabled:s.enabled,identity:s.identityStatus??"unknown",sourceKind:s.sourceKind??"voice",sourceOrigin:s.sourceKindOrigin??"unclassified",capture:s.captureMode??"idle"})),
        worker:latestNativeMetrics,audio:profiler.snapshot(),placement:preferences.captionPlacement}),
    add:(id:string)=>{const s=slots.get(id);if(!s)return false;if(!s.enabled&&captionedCount()>=MAX_CAPTIONED){setMessage(`Up to ${MAX_CAPTIONED} speakers can have captions at once`);return false;}s.enabled=true;if(runtime.monitorOn&&runtime.engineReady)void attachAudio(s);refreshUI();return true;},
    remove:(id:string)=>{const s=slots.get(id);if(!s)return false;s.enabled=false;detachAudio(s);s.text="";refreshUI();return true;},
    openSpeakers:()=>openManager("speakers")
};

// Called NowCaptionDiscord up to v18: keep its on/off setting.
migratePluginSettings("NowCaption","NowCaptionDiscord");

export default definePlugin({
    name:"NowCaption",
    description:"Offline live captions for Discord calls (NowCaption speech model v4, up to 4 speakers at once)",
    authors:[{name:"Techlm77",id:0n}],
    // Scoped injection changes only a matched Discord constructor call site.
    // Pattern must be validated against the user's Discord build; no global
    // constructor override occurs unless the private fallback is enabled.
    patches:[{
        find:"RTCPeerConnection",
        replacement:{
            match:/new (?:window\.|globalThis\.)?RTCPeerConnection\(/g,
            replace:"new $self.ScopedPeerConnection("
        }
    }],
    get ScopedPeerConnection(){
        return class NowCaptionObservedConnection extends RTCPeerConnection {
            constructor(...args:ConstructorParameters<typeof RTCPeerConnection>){
                super(...args);
                observeScopedConnection(this);
            }
        };
    },
    start(){
        enableObservation();profiler.reset();beginVoiceCorrelation();
        setCompatibilityFallback(api.enableLegacyCapture,()=>legacyCapture);
        diagnostic.info("lifecycle","started",{version:19});
        diagnostic.info("font","bundle_manifest",{families:availableBundledFamilies().length});
        void ensureFontLoaded(preferences.font);
        setCaptureCallbacks({tracksChange:refreshUI,trackRelease:s=>{s.enabled=false;detachManualTile(s);detachAudio(s);refreshUI();},message:setMessage});
        setVerifiedMemberLeftCallback(s=>releaseTrack(s,"verified_voice_departure"));
        // Someone else now speaks on a verified track: fresh captions, and no tile placement chosen for the old person.
        setSpeakerChangedCallback(s=>{resetRecognition(s);detachManualTile(s);});
        setIdentityCallback(refreshUI);
        mountUI();
        // Polling is retained only for recognition results and voice state.
        timer=window.setInterval(()=>void tick(),120);
        updatePageVisibility();
        (window as any).__nowCaption=api;
        setMessage("Ready · join voice, then start captions");
    },
    stop(){
        if(timer!==undefined)clearInterval(timer);
        timer=undefined;
        unpatchRTC();disableObservation();resetIdentityLookup();
        stopLevelPreview();stopVoiceCorrelation();resetVoiceTiles();stopCapture();unmountUI();
        delete (window as any).__nowCaption;
        disposeFonts();diagnostic.info("lifecycle","stopped");
        diagnostic.dispose();profiler.reset();legacyCapture=false;
    }
});
