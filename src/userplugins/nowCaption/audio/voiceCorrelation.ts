/**
 * Optional correlation between Discord's per-user VoiceActivity events and a
 * *single* locally observed inbound audio track. This is NOT identity proof.
 * Confirmed SSRC→Discord mapping in voiceIdentity.ts always wins.
 *
 * No audio leaves the client; samples here are boolean speaking observations.
 * Ambiguous simultaneous speech never produces an identity suggestion.
 */
import { findByProps } from "@webpack";
import { MediaEngineStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import * as diagnostic from "../core/diagnostics";
import { slots } from "../core/state";
import type { Slot } from "../core/types";

interface Activity { until:number; }
interface Evidence { userId:string; count:number; first:number; last:number; }
const speaking=new Map<string,Activity>();
const evidence=new Map<number,Evidence>();
let listeningEngine:any;
let lookupStore:any;
let voiceStore:any;
let stateStore:any;
let currentUserStore:any;
let lastChannel="";
const MAX_RECENT_MS=500;
const REQUIRED_SAMPLES=10;
const REQUIRED_DURATION_MS=3600;

const isId=(s:unknown):s is string=>typeof s==="string" && /^\d{15,22}$/.test(s);
function present(members:any, id:string) {
    return !!members && (Array.isArray(members) ? members.some((s:any)=>s?.userId===id || s?.user?.id===id) : Object.prototype.hasOwnProperty.call(members,id));
}
function onActivity(id:string, value:number){
    if (!isId(id))return;
    if (!(value>0)) {speaking.delete(id);return;}
    speaking.set(id,{until:performance.now()+MAX_RECENT_MS});
}
/** Only attach to an existing Discord media-engine event API. */
export function beginVoiceCorrelation(){
    try {
        // A findByProps miss scans every webpack module and logs an error: look up once (null = missing).
        if (MediaEngineStore?.getMediaEngine) lookupStore = MediaEngineStore;
        else if (lookupStore === undefined) lookupStore = findByProps("getMediaEngine") ?? null;
        const engine=lookupStore?.getMediaEngine?.();
        if (!engine || typeof engine.on!=="function")return;
        if (engine===listeningEngine)return;
        if (listeningEngine) {
            if(typeof listeningEngine.off==="function")listeningEngine.off("VoiceActivity",onActivity);
            else listeningEngine.removeListener?.("VoiceActivity",onActivity);
        }
        listeningEngine=engine;
        engine.on("VoiceActivity",onActivity);
        diagnostic.info("identity","voice_activity_observer_attached");
    } catch { /* Discord implementation may not expose VoiceActivity */ }
}
export function stopVoiceCorrelation(){
    try {if(typeof listeningEngine?.off==="function")listeningEngine.off("VoiceActivity",onActivity);
        else listeningEngine?.removeListener?.("VoiceActivity",onActivity);}catch{}
    listeningEngine=lookupStore=voiceStore=stateStore=currentUserStore=undefined;
    lastChannel="";speaking.clear();evidence.clear();
    for(const s of slots.values())s.suggestedUserId=undefined;
}

/** A suggestion is never saved as a verified profile or exported as a verified user. */
export function sampleVoiceCorrelation(){
    beginVoiceCorrelation();
    if (!listeningEngine)return;
    const now=performance.now();
    try {
        voiceStore = SelectedChannelStore?.getVoiceChannelId ? SelectedChannelStore : voiceStore;
        stateStore = VoiceStateStore?.getVoiceStatesForChannel ? VoiceStateStore : stateStore;
        if(voiceStore===undefined)voiceStore=findByProps("getVoiceChannelId")??null;
        if(stateStore===undefined)stateStore=findByProps("getVoiceStatesForChannel")??null;
        const channel=voiceStore?.getVoiceChannelId?.();
        if (typeof channel!=="string" || !channel)return;
        if(channel!==lastChannel){
            lastChannel=channel; speaking.clear();evidence.clear();
            for(const s of slots.values())s.suggestedUserId=undefined;
            return;
        }
        const members=stateStore?.getVoiceStatesForChannel?.(channel);
        currentUserStore = UserStore?.getCurrentUser ? UserStore : currentUserStore;
        if(currentUserStore===undefined)currentUserStore=findByProps("getCurrentUser")??null;
        const localId=currentUserStore?.getCurrentUser?.()?.id;
        if(!members)return;
        for(const [id,v] of speaking)if(v.until<now || !present(members,id))speaking.delete(id);
        // Track cleanup is keyed by the *track instance*, not reused A1/A2 ID.
        const alive=new Set([...slots.values()].map(s=>s.instanceKey).filter((v):v is number=>typeof v==="number"));
        for(const k of evidence.keys())if(!alive.has(k))evidence.delete(k);
        for(const slot of slots.values()) {
            if(slot.suggestedUserId&&!present(members,slot.suggestedUserId)) slot.suggestedUserId=undefined;
            if(slot.verifiedUserId || slot.sourceKind==="stream") {slot.suggestedUserId=undefined;continue;}
        }
        const activeUsers=[...speaking.keys()].filter(id=>id!==localId&&present(members,id));
        const activeSlots=[...slots.values()].filter(s=>s.track.readyState==="live" &&
            !s.verifiedUserId && s.sourceKind!=="stream" && !!s.instanceKey &&
            (s.levelRms??0)>=0.018); // use preview RMS only, not stale recognition RMS
        if(activeUsers.length!==1 || activeSlots.length!==1)return;
        const [user]=activeUsers;
        const [slot]=activeSlots;
        // A new active user invalidates an earlier unverified suggestion
        // immediately; keep floating until enough new evidence accumulates.
        if(slot.suggestedUserId && slot.suggestedUserId!==user){
            slot.suggestedUserId=undefined;evidence.delete(slot.instanceKey!);
        }
        if([...slots.values()].some(s=>s!==slot && (s.verifiedUserId===user || s.suggestedUserId===user)))return;
        const key=slot.instanceKey!;
        let e=evidence.get(key);
        if(!e || e.userId!==user || now-e.last>5000){e={userId:user,count:0,first:now,last:now};}
        if (now-e.last>=110 || e.count===0){e.count++;e.last=now;}
        evidence.set(key,e);
        if(e.count>=REQUIRED_SAMPLES && now-e.first>=REQUIRED_DURATION_MS && slot.suggestedUserId!==user){
            slot.suggestedUserId=user;
            diagnostic.info("identity","voice_activity_suggestion",{track:slot.id,verified:false});
        }
    }catch{/* Discord voice stores can be in transition */}
}
