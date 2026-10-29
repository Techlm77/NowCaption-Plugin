/* React owns all visible controls and caption cards. No imperative DOM widget creation.
 * The single root mount is private scaffolding; an upstream React render hook is
 * required before claiming compatibility with Vencord's official plugin rules.
 */
import "./styles.css";

import { findByProps } from "@webpack";
import { React, SelectedChannelStore, createRoot } from "@webpack/common";

import { attachAudio, detachAudio, getScopedObservations, startCapture, stopRecognition } from "../audio/capture";
import { isLevelPreviewOn, startLevelPreview, stopLevelPreview } from "../audio/levelPreview";
import * as diagnostic from "../core/diagnostics";
import { availableBundledFamilies, ensureFontLoaded } from "../core/fonts";
import { clamp, FONTS, fontStack, preferences, savePreferences } from "../core/settings";
import { saveVerifiedProfile } from "../core/speakerProfiles";
import { captionedCount, MAX_CAPTIONED, runtime, slots } from "../core/state";
import type { Slot } from "../core/types";
import { diagnosticSnapshot } from "./diagnosticsPanel";
import { CaptionCard } from "./components/CaptionCard";
import { displayName, likelyName } from "./identity";
import { beginTilePick, cancelTilePick, detachManualTile, isManuallyAttached, tileForSlot, tilePickActive, voiceTileRects } from "./voiceTiles";

const h=(...args:any[]):any=>(React.createElement as any)(...args);
type Tab="speakers"|"appearance"|"diagnostics";
let root:{render:(node:any)=>void;unmount:()=>void}|null=null;
let host:HTMLDivElement|null=null;
let opened=false;
let tab:Tab="speakers";
let message="Join voice, then choose a speaker.";
let sequence=0;
let enableCompatibility=()=>{};
let compatibilityEnabled=()=>false;
export function setCompatibilityFallback(onEnable:()=>void,isEnabled:()=>boolean){enableCompatibility=onEnable;compatibilityEnabled=isEnabled;}
let voiceStore:any;
let lastVisible=true;
let cachedDiagnostic="";
let cachedAt=0;

function redraw() {if(root)root.render(h(App,{sequence:++sequence}));}
export function refreshUI(){redraw();}
export function setMessage(text:string){message=text;redraw();}
export function openManager(next?:Tab){opened=true;if(next)tab=next;redraw();diagnostic.debug("ui","manager_opened");}
export function hideManager(){opened=false;redraw();diagnostic.debug("ui","manager_hidden");}
export function onVoicePage():boolean{
    if(preferences.showEverywhere)return true;
    try {
        if (SelectedChannelStore?.getVoiceChannelId) voiceStore=SelectedChannelStore;
        if (voiceStore===undefined) {
            try {voiceStore=findByProps("getVoiceChannelId")??null;}catch{voiceStore=null;}
        }
        const voiceId=voiceStore?.getVoiceChannelId?.();
        const parts=location.pathname.split("/").filter(Boolean);
        // Discord navigation is authoritative: selecting a text channel must hide
        // the overlay even when SelectedChannelStore still reports the old voice id.
        if (parts[0]==="channels" && parts.length>=3) {
            return !!voiceId && parts[2]===voiceId;
        }
        if(typeof voiceId!=="string"||!voiceId)return false;
        // Non-channel views (search, settings, etc.) should never be obstructed.
        return false;
    }catch{return false;}
}
export function updatePageVisibility(){
    const visible=onVoicePage();
    if(visible!==lastVisible){
        diagnostic.info("navigation",visible?"returned_to_voice_page":"opened_text_channel",{visible});
        if(!visible)opened=false;
    }
    lastVisible=visible;runtime.voicePageVisible=visible;
}
function removeCard(slot:Slot){
    if(!slot.enabled)return;
    slot.enabled=false;
    detachManualTile(slot);
    detachAudio(slot);
    slot.text="";
    diagnostic.info("card","removed",{track:slot.id});
    redraw();
}
export function getActiveCardCount(){return [...slots.values()].filter(s=>s.enabled).length;}
export function getVerifiedCount(){return [...slots.values()].filter(s=>!!s.verifiedUserId).length;}
export function mountUI(){
    if(root)return;
    host=document.createElement("div");
    host.id="nowcaption-react-mount";
    document.body.append(host);
    root=createRoot(host);
    redraw();
    diagnostic.info("ui","react_mounted");
}
export function unmountUI(){
    cancelTilePick();
    root?.unmount();root=null;
    host?.remove();host=null;
    opened=false;lastVisible=true;
    voiceStore=undefined;
    cachedDiagnostic="";cachedAt=0;
    diagnostic.info("ui","react_unmounted");
}

function field(name:string,control:any){return h("label",{className:"nc10-field"},h("span",null,name),control);}
function checkbox(label:string,checked:boolean,onChange:(value:boolean)=>void){
    return h("label",{className:"nc10-check"},h("input",{type:"checkbox",checked,onChange:(e:any)=>onChange(e.target.checked)}),label);
}
function App(_props:{sequence:number}) {
    const ids=[...slots.keys()];
    const [chosen,setChosen]=React.useState("");
    const [colorTarget,setColorTarget]=React.useState("all");
    const [version,setVersion]=React.useState(0);
    const force=()=>{setVersion((v:number)=>v+1);redraw();};
    const selected=ids.includes(chosen)?chosen:ids[0]||"";
    const slot=slots.get(selected);
    const target=slots.get(colorTarget);
    const select=(id:string)=>setChosen(id);

    const toggleCaptions=()=>{
        if(!slot){setMessage("Join a voice channel first");return;}
        if (slot.enabled) {
            removeCard(slot);
            setMessage(`Captions hidden for ${displayName(slot)}`);
        } else {
            if(captionedCount()>=MAX_CAPTIONED){
                setMessage(`Up to ${MAX_CAPTIONED} speakers can have captions at once. Hide someone's captions first.`);
                diagnostic.info("ui","caption_limit_reached",{limit:MAX_CAPTIONED});
                return;
            }
            slot.userId=slot.verifiedUserId??"";
            slot.enabled=true;
            if(runtime.monitorOn&&runtime.engineReady)void attachAudio(slot);
            diagnostic.info("ui","captions_shown",{track:slot.id,verified:!!slot.verifiedUserId});
            setMessage(`Captions enabled for ${displayName(slot)}`);
        }
    };

    const styles=()=>{
        const change=(key:"font"|"fontSize"|"color"|"scrollbars"|"captionMode"|"showEverywhere"|"captionPlacement",value:any)=>{
            (preferences as any)[key]=value;savePreferences();force();
        };
        return h("div",{className:"nc10-panel"},
            field("Text size",h("div",{className:"nc10-slider"},
                h("input",{type:"range",min:12,max:30,value:preferences.fontSize,onChange:(e:any)=>change("fontSize",clamp(Number(e.target.value),12,30))}),
                h("span",null,`${preferences.fontSize}px`))),
            field("Font",h("select",{value:preferences.font,onChange:(e:any)=>{
                change("font",e.target.value);
                void ensureFontLoaded(e.target.value).then(redraw);
                diagnostic.info("ui","font_changed",{font:e.target.value});
            }},...FONTS.map(f=>h("option",{key:f.value,value:f.value},f.label)))),
            h("div",{className:"nc10-font-preview",style:{fontFamily:fontStack(preferences.font)}},"Aa Bb Cc 1234567890"),
            h("small",null,`${availableBundledFamilies().length} offline font families bundled`),
            field("Colour for",h("select",{value:colorTarget,onChange:(e:any)=>setColorTarget(e.target.value)},
                h("option",{value:"all"},"All speakers"),
                ...[...slots.values()].map(s=>h("option",{key:s.id,value:s.id},`${displayName(s)} (${s.id})`)))),
            target?checkbox("Use global colour",!target.color,value=>{
                target.color=value?undefined:preferences.color;
                if(target.verifiedUserId)saveVerifiedProfile(target.verifiedUserId,{color:target.color});force();
            }):null,
            h("input",{type:"color",title:"Caption colour",disabled:!!target&&!target.color,value:target?.color??preferences.color,
                onChange:(e:any)=>{
                    const value=e.target.value;
                    if(target){target.color=value;if(target.verifiedUserId)saveVerifiedProfile(target.verifiedUserId,{color:value});force();}
                    else change("color",value);
                }}),
            field("Caption placement",h("select",{value:preferences.captionPlacement,onChange:(e:any)=>change("captionPlacement",e.target.value)},
                h("option",{value:"tiles"},"On participant tiles (recommended)"),
                h("option",{value:"floating"},"Floating caption windows"))),
            h("small",null,"Tile placement uses verified Discord identities, including when a person streams. If no identity is available, the advanced manual fallback is in Diagnostics."),
            field("Scrollbars",h("select",{value:preferences.scrollbars,onChange:(e:any)=>change("scrollbars",e.target.value)},
                h("option",{value:"hidden"},"Hidden"),h("option",{value:"thin"},"Thin dark"))),
            checkbox("Show over text channels",preferences.showEverywhere,value=>change("showEverywhere",value))
        );
    };
    const speakers=()=>h("div",{className:"nc10-panel"},
        h("button",{className:runtime.monitorOn?"nc10-stop":"nc10-primary",disabled:runtime.busy,
            onClick:()=>{
                if (runtime.monitorOn) {
                    void stopRecognition().then(()=>{stopLevelPreview();setMessage("Captions stopped");redraw();});
                    diagnostic.info("ui","stop_clicked");
                } else {
                    // Start the sound meter from the user's click, then load the ASR.
                    void startLevelPreview();
                    void startCapture().then(redraw);
                    diagnostic.info("ui","start_clicked");
                }
            }}, runtime.busy?"Please wait…":runtime.monitorOn?"Stop captions":"Start captions"),
        h("p",{className:"nc10-capture-status",role:"status"},runtime.monitorOn?"Captions running":"Captions stopped"),
        h("div",{className:"nc10-audio-heading"},
            h("strong",null,`Audio sources · captions ${captionedCount()} of ${MAX_CAPTIONED}`),
            h("button",{className:"nc10-meter-toggle",disabled:runtime.busy,onClick:()=>{
                if(isLevelPreviewOn()){stopLevelPreview();redraw();}
                else void startLevelPreview().then(redraw);
            }},isLevelPreviewOn()?"Stop identifying":"Identify speakers")),
        h("div",{className:"nc10-audio-list",role:"group","aria-label":"Incoming audio tracks"},
            ids.length===0?h("p",{className:"nc10-no-audio"},"Join a voice channel to see incoming audio."):null,
            ...ids.map(id=>{const s=slots.get(id)!;
                const speaking=(s.levelActiveUntil??0)>performance.now();
                return h("button",{type:"button",key:`${s.instanceKey??id}`,className:`nc10-audio-option ${selected===id?"selected":""}`,
                    "aria-pressed":selected===id,onClick:()=>select(id)},
                    h("span",{className:`nc10-activity-dot ${speaking?"speaking":""}`,"aria-hidden":true}),
                    h("span",{className:"nc10-audio-name"},displayName(s)),
                    h("small",null,`${speaking?"Speaking":s.enabled?"Visible":"Select"}${likelyName(s)?` · likely ${likelyName(s)}`:""}`));
            })),
        /* Rare manual fallback: don't clutter the normal verified-user workflow. */
        slot && (!slot.verifiedUserId || isManuallyAttached(slot)) && preferences.captionPlacement==="tiles" ? h("div",{className:"nc10-tile-picker"},
            slot.verifiedUserId ? null : h("button",{type:"button",className:"nc10-primary",disabled:tilePickActive(),onClick:()=>{
                const accepted=beginTilePick(slot,(ok,reason)=>{
                    setMessage(reason);
                    diagnostic.info("tile",ok?"manual_attached":"manual_pick_cancelled",{track:slot.id,success:ok});
                    force();
                });
                setMessage(accepted ? `Now click ${displayName(slot)}'s participant tile in Discord (Esc to cancel).` : "Open the voice-channel grid and choose an incoming track first.");
                force();
            }},"Place on participant tile"),
            isManuallyAttached(slot)?h("button",{type:"button",className:"nc10-secondary",onClick:()=>{
                detachManualTile(slot);setMessage("Manual tile placement cleared");force();
            }},"Clear placement"):null,
            h("small",null,slot.verifiedUserId?"Discord has verified this speaker, so the manual placement is no longer needed.":
                "Unverified audio only: click the matching Discord tile. This manual association resets when voice membership changes.")) : null,
        slot ? field("Audio type",h("select",{value:slot.sourceKind??"voice",onChange:(e:any)=>{
            slot.sourceKind=e.target.value==="stream"?"stream":"voice";
            slot.sourceKindOrigin="manual";
            if (slot.sourceKind!=="stream") {
                slot.linkedVoiceTrackId=undefined;slot.linkedVoiceInstanceKey=undefined;
            }
            diagnostic.info("ui","audio_type_changed",{track:slot.id,type:slot.sourceKind});force();
        }},h("option",{value:"voice"},"Voice"),h("option",{value:"stream"},"Stream audio"))):null,
        slot?.sourceKind==="stream" ? field("Stream belongs to",h("select",{
            value:slot.linkedVoiceTrackId??"",onChange:(e:any)=>{
                slot.linkedVoiceTrackId=e.target.value||undefined;
                slot.linkedVoiceInstanceKey=slot.linkedVoiceTrackId?slots.get(slot.linkedVoiceTrackId)?.instanceKey:undefined;
                diagnostic.info("ui","stream_manual_link_changed",{track:slot.id,linked:!!slot.linkedVoiceTrackId});
                force();
            }},h("option",{value:""},"Unknown / not linked"),
            ...[...slots.values()].filter(other=>other!==slot&&other.sourceKind!=="stream").map(other=>
                h("option",{value:other.id,key:other.id},`${displayName(other)} (manual)`)))):null,
        // Stays clickable at the limit, so keyboard and screen-reader users hear why it can't add another speaker.
        h("button",{disabled:!slot,onClick:toggleCaptions,className:"nc10-secondary",
            title:slot&&!slot.enabled&&captionedCount()>=MAX_CAPTIONED?`Up to ${MAX_CAPTIONED} speakers at once`:undefined},
            slot?.enabled?"Hide captions":"Show captions"),
        slot?h("small",null,slot.verifiedUserId?"Discord identity verified":likelyName(slot)?`Likely ${likelyName(slot)} from voice activity · not verified`:slot.sourceKind==="stream"?"Stream audio identity unverified":"Awaiting Discord identity verification"):null
    );
    const diagnostics=()=>{
        const now=performance.now();
        if(now-cachedAt>900||!cachedDiagnostic){
            cachedAt=now;
            const s:any=diagnosticSnapshot();
            const w=s.recognizerWorker;
            const n=(value:any)=>typeof value==="number"&&Number.isFinite(value)?Math.round(value*100)/100:"N/A";
            cachedDiagnostic=[
                `Engine: ${runtime.engineReady?"ready":"stopped"} · Tracks: ${slots.size} · Cards: ${getActiveCardCount()}`,
                `Scoped RTC observations: ${getScopedObservations()} · Compatibility mode: ${compatibilityEnabled()?"on":"off"}`,
                `Worker CPU: ${n(w?.cpuPercentOneCore)}% of one core · Heap: ${n(w?.heapMiB)} MiB`,
                `Inference avg: ${n(w?.decodeMeanMs)} ms · p95: ${n(w?.decodeP95Ms)} ms`,
                `Queue: ${w?.queueTotal??"N/A"} · Dropped: ${w?.dropped??"N/A"}`,
                `Identify speakers: ${isLevelPreviewOn()?"running":"off"} · Active lights: ${[...slots.values()].filter(s=>(s.levelActiveUntil??0)>now).length}`,
                `Tile caption placement: ${preferences.captionPlacement} · Exact ID: ${[...slots.values()].filter(s=>s.verifiedUserId).length} · Voice-activity suggestions: ${[...slots.values()].filter(s=>s.suggestedUserId&&!s.verifiedUserId).length}`,
                `Tile candidates: ${voiceTileRects().size} · Attached: ${[...slots.values()].filter(s=>s.enabled&&!!tileForSlot(s,slots.values())).length} · Manual: ${[...slots.values()].filter(s=>isManuallyAttached(s)).length}`,
                ...[...slots.values()].map(x=>`${x.id}: ${x.identityStatus??"waiting"} · ${x.sourceKind??"voice"}/${x.sourceKindOrigin??"unclassified"} · ${x.captureMode??"idle"}/${x.transferMode??"pending"}`),
            ].join("\n");
        }
        const opts=diagnostic.getDiagnosticsOptions();
        return h("div",{className:"nc10-panel"},
            h("strong",null,"Performance · live"),h("pre",{className:"nc10-metrics"},cachedDiagnostic),
            h("small",null,"Worker memory excludes some native allocations. Latency estimates start after audio reaches this client."),
            getScopedObservations()===0&&!compatibilityEnabled()?h("button",{className:"nc10-secondary",onClick:()=>{enableCompatibility();redraw();}},"Enable compatibility audio capture"):null,
            getScopedObservations()===0&&!compatibilityEnabled()?h("small",null,"If no tracks appear, enable compatibility capture and rejoin VC. This private fallback temporarily wraps the browser RTC constructor; it must be removed before official review."):null,
            checkbox("Detailed events",opts.detailed,v=>{diagnostic.setDiagnosticsOptions({detailed:v});force();}),
            checkbox("Log to Developer Tools",opts.consoleOutput,v=>{diagnostic.setDiagnosticsOptions({consoleOutput:v});force();}),
            h("div",{className:"nc10-actions"},
                h("button",{onClick:()=>diagnostic.exportDiagnosticJson(diagnosticSnapshot())},"Export JSON"),
                h("button",{onClick:()=>{diagnostic.clearEvents();force();}},"Clear logs")),
            h("strong",null,"Recent events"),
            h("pre",{className:"nc10-events"},diagnostic.recentEvents(30).map(e=>`${e.time.slice(11,19)} ${e.level} ${e.area}.${e.event}`).join("\n"))
        );
    };
    const captioned=[...slots.values()].filter(s=>s.enabled);
    const visible=onVoicePage();
    return h(React.Fragment,null,
        ...captioned.map(s=>{
            // No tile scan while the voice grid isn't on screen.
            const tile=visible && preferences.captionPlacement==="tiles" ? tileForSlot(s,captioned) : undefined;
            return h(CaptionCard,{key:s.instanceKey??`${s.id}:${s.track.id}`,slot:s,visible,tile,onRemove:removeCard});
        }),
        h("aside",{className:"nc10-dock"},
            h("button",{className:"nc10-launcher","aria-expanded":opened,onClick:()=>opened?hideManager():openManager()},"CC · Captions"),
            opened?h("div",{className:`nc10-manager ${tab==="diagnostics"?"nc10-wide":""}`,role:"dialog","aria-label":"NowCaption controls"},
                h("header",{className:"nc10-manager-header"},h("strong",null,"NowCaption"),
                    h("button",{onClick:hideManager,"aria-label":"Close controls"},"×")),
                h("nav",{className:"nc10-tabs",role:"tablist"},
                    ...(["speakers","appearance","diagnostics"] as Tab[]).map(t=>h("button",{key:t,role:"tab","aria-selected":tab===t,className:tab===t?"active":"",onClick:()=>{tab=t;diagnostic.info("ui","tab_changed",{tab:t});redraw();}},t[0].toUpperCase()+t.slice(1)))),
                tab==="speakers"?speakers():tab==="appearance"?styles():diagnostics(),
                h("p",{className:"nc10-message",role:"status"},message)
            ):null
        )
    );
}
