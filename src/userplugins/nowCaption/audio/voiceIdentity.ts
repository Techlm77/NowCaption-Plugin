/* Verify only with a track SSRC, Discord's own SSRC mapping, and membership.
 * Diagnostics reveal which check failed WITHOUT exposing IDs/SSRCs/names.
 * Reconnection cards are removed only after explicit track termination or
 * sustained absence of a previously verified person in a populated voice store.
 */
import { findByProps } from "@webpack";
import { MediaEngineStore, SelectedChannelStore, VoiceStateStore } from "@webpack/common";

import * as diagnostic from "../core/diagnostics";
import { peers, slots } from "../core/state";
import type { Slot } from "../core/types";
import { loadVerifiedProfile } from "../core/speakerProfiles";

let probing = false;
let lastProbe = 0;
let legacyMapper: any; // undefined: not looked up yet; null: this Discord build has none
const connectionPeers = new WeakMap<object, RTCPeerConnection>();
let channelStore: any;
let voiceStates: any;
let namesChanged = () => {};
let verifiedMemberLeft = (_slot: Slot) => {};
let speakerChanged = (_slot: Slot) => {};
const lastStatus = new Map<string, string>();
export function setIdentityCallback(callback: () => void) { namesChanged = callback; }
export function setVerifiedMemberLeftCallback(callback: (slot: Slot) => void) { verifiedMemberLeft = callback; }
/** Called when the person behind a verified track may have changed (its captions must start again). */
export function setSpeakerChangedCallback(callback: (slot: Slot) => void) { speakerChanged = callback; }
function mark(slot: Slot, status: string) {
    slot.identityStatus = status;
    if (lastStatus.get(slot.id) !== status) {
        lastStatus.set(slot.id, status);
        diagnostic.info("identity", "check", {track:slot.id, status});
    }
}
const isUserId = (id: unknown): id is string => typeof id === "string" && /^\d{15,22}$/.test(id);
function lookup(connection: any, ssrc: number): string | undefined {
    try {
        const id: unknown = connection.getUserIdBySsrc(ssrc);
        return isUserId(id) ? id : undefined;
    } catch { return undefined; } // connection may be reinitializing
}
/** The observed RTCPeerConnection behind a Discord media connection, when Discord keeps it in a
 * property (searched two levels deep). SSRC numbers are only unique within one connection. */
function peerOf(connection: any): RTCPeerConnection | undefined {
    const known = connectionPeers.get(connection);
    if (known || !peers?.size) return known;
    const seen = new Set<unknown>();
    const search = (value: any, depth: number): RTCPeerConnection | undefined => {
        if (!value || typeof value !== "object" || seen.has(value) || typeof value.nodeType === "number") return;
        seen.add(value);
        let children: unknown[];
        try { children = Object.keys(value).slice(0, 60).map(key => value[key]); } catch { return; }
        const direct = children.find(child => peers.has(child as RTCPeerConnection));
        if (direct) return direct as RTCPeerConnection;
        if (depth > 0) for (const child of children) {
            if (child && typeof child === "object" && !Array.isArray(child)) {
                const found = search(child, depth - 1);
                if (found) return found;
            }
        }
    };
    const found = search(connection, 1);
    if (found) connectionPeers.set(connection, found);
    return found;
}
/** A Go Live connection that reports its streamer for any SSRC says nothing about this one. */
const mapsEveryone = (connection: any) => lookup(connection, 0xfffffffe) !== undefined;

/** Discord stores the SSRC lookup on each active MediaEngineConnection,
 * not on MediaEngineStore. A module-wide findByProps is only a legacy fallback.
 * When the track's own connection can be found (by its RTCPeerConnection), only it is asked.
 * Otherwise accept a result only when all candidate connections agree on one valid ID.
 */
export function mapAudioSsrc(ssrc: number, kind: "voice" | "stream" = "voice", pc?: RTCPeerConnection):
    { userId?: string; available: boolean; ambiguous: boolean; connections: number; scoped: boolean; fromStream: boolean } {
    const mapped = new Set<string>();
    const fromVoice = new Set<string>(); // found on a normal voice connection, not a Go Live one
    let available = false;
    let connections = 0;
    let scoped = false;
    try {
        const list = MediaEngineStore?.getMediaEngine?.()?.connections;
        const live = list && typeof list[Symbol.iterator] === "function"
            ? [...list as Iterable<any>].filter(c => c && !c.destroyed && typeof c.getUserIdBySsrc === "function")
            : [];
        const own = pc ? live.filter(c => peerOf(c) === pc) : [];
        scoped = own.length > 0;
        for (const connection of scoped ? own : live) {
            const stream = connection.context === "stream";
            if (!scoped && stream && mapsEveryone(connection)) continue; // says nothing about this SSRC
            // Unlabelled Go Live audio looks like voice: a Go Live connection owning this SSRC marks it as stream audio
            // (fromStream), and one owning it for someone else makes the track ambiguous.
            connections++;
            available = true;
            const id = lookup(connection, ssrc);
            if (!id) continue;
            mapped.add(id);
            if (!stream) fromVoice.add(id);
        }
    } catch { /* optional store temporarily unavailable */ }
    // Some older Discord/Vesktop builds expose a singleton connection module.
    if (mapped.size === 0 && !scoped) {
        try {
            if (legacyMapper === undefined) legacyMapper = findByProps("getUserIdBySsrc") ?? null;
        } catch { legacyMapper = null; } // looked up once: a miss scans every module and logs an error
        if (typeof legacyMapper?.getUserIdBySsrc === "function") {
            available = true;
            const id = lookup(legacyMapper, ssrc);
            if (id) { mapped.add(id); fromVoice.add(id); } // the old singleton served voice connections
        }
    }
    return { userId: mapped.size === 1 ? [...mapped][0] : undefined,
        available, ambiguous: mapped.size > 1, connections, scoped, fromStream: mapped.size > 0 && fromVoice.size === 0 };
}
/** SSRCs this receiver played in the last few seconds, newest first. */
function recentSources(receiver: RTCRtpReceiver | undefined): number[] | undefined {
    if (typeof receiver?.getSynchronizationSources !== "function") return undefined;
    try {
        return receiver.getSynchronizationSources()
            .filter(s => Number.isSafeInteger(s.source) && s.source > 0)
            .sort((a, b) => b.timestamp - a.timestamp)
            .map(s => s.source);
    } catch { return undefined; }
}
async function statsSources(receiver: RTCRtpReceiver): Promise<Set<number>> {
    const stats = await receiver.getStats();
    const ssrcs = new Set<number>();
    stats.forEach(report => {
        const r = report as any;
        if (r.type==="inbound-rtp" && (r.kind==="audio" || r.mediaType==="audio") &&
            Number.isSafeInteger(r.ssrc) && r.ssrc>0) ssrcs.add(r.ssrc);
    });
    return ssrcs;
}
/** One unique audio SSRC for the receiver. Stats can keep an old SSRC around after Discord
 * reuses a receiver; then the sources played in the last few seconds decide, if they are all one.
 * `verified`: during a pause nothing has played, so an already verified SSRC that stats still list stands
 * (no one else's audio is arriving to be misattributed). */
function singleSource(receiver: RTCRtpReceiver, fromStats: Set<number>, verified?: number): number | undefined {
    if (fromStats.size === 1) return [...fromStats][0];
    if (fromStats.size < 2) return undefined;
    const recent = recentSources(receiver);
    const played = new Set(recent ?? []);
    if (recent && played.size === 0 && verified !== undefined && fromStats.has(verified)) return verified;
    return played.size === 1 && fromStats.has([...played][0]) ? [...played][0] : undefined;
}
function clearIdentity(slot: Slot, status: string) {
    slot.verifiedUserId=undefined;slot.verifiedSsrc=undefined;
    // The colour and alias came from (or were saved to) the previous person's profile.
    slot.userId="";slot.label="";slot.color=undefined;
    slot.identityMisses=0;slot.identityMissSince=undefined;
    slot.identityEpoch=(slot.identityEpoch??0)+1;
    mark(slot,status);
    diagnostic.info("identity","cleared",{track:slot.id,status});
    speakerChanged(slot);
    namesChanged();
}
/**
 * Cheap check for every UI tick: when Discord reuses a receiver for someone else, the newest
 * played SSRC changes at once, well before the next getStats() probe.
 */
export function checkVerifiedSources(): void {
    for (const slot of slots.values()) {
        if (!slot.verifiedUserId || slot.verifiedSsrc === undefined) continue;
        const newest = recentSources(slot.receiver)?.[0];
        if (newest !== undefined && newest !== slot.verifiedSsrc) clearIdentity(slot,"ssrc_changed");
    }
}
function memberPresent(members: unknown, id: string): boolean {
    if (Array.isArray(members)) return members.some((m: any) => m?.userId === id || m?.user?.id === id);
    return !!members && typeof members === "object" && Object.prototype.hasOwnProperty.call(members,id);
}
function hasMembers(members: unknown): boolean {
    return Array.isArray(members) ? members.length > 0 : !!members && typeof members === "object" && Object.keys(members).length > 0;
}
function verifyMemberStillPresent(slot: Slot, channelId: string, members: unknown) {
    if (!slot.verifiedUserId) return;
    if (memberPresent(members,slot.verifiedUserId)) {
        slot.identityMisses=0;slot.identityMissSince=undefined;
        mark(slot,"verified");return;
    }
    // Avoid removing cards when the voice-state store is empty/loading.
    if (!channelId || !hasMembers(members)) {
        mark(slot,"voice_membership_unavailable");return;
    }
    const now=performance.now();
    slot.identityMissSince ??= now;
    slot.identityMisses=(slot.identityMisses ?? 0)+1;
    mark(slot,"verified_member_missing");
    if (slot.identityMisses>=4 && now-slot.identityMissSince>=6000) {
        diagnostic.info("identity","verified_member_left",{track:slot.id});
        verifiedMemberLeft(slot);
    }
}
async function identify(slot: Slot, channelId: string, members: unknown): Promise<void> {
    if (slot.track.readyState !== "live") { mark(slot,"track_not_live");return; }
    if (slot.verifiedUserId) {
        // A track/SSRC can be recycled without the browser ending the track.
        // Do not keep showing yesterday's verified name if the owner changes.
        if (slot.receiver) {
            const current = await statsSources(slot.receiver);
            if (slots.get(slot.id)!==slot || !slot.verifiedUserId) return;
            // No inbound audio means nothing new can be misattributed; more than one fails closed.
            const currentSsrc=singleSource(slot.receiver,current,slot.verifiedSsrc);
            if (current.size>1 && currentSsrc===undefined) {clearIdentity(slot,"multiple_audio_ssrc");return;}
            if (currentSsrc!==undefined && currentSsrc!==slot.verifiedSsrc) {clearIdentity(slot,"ssrc_changed");return;}
            if (currentSsrc!==undefined) {
                const mapped = mapAudioSsrc(currentSsrc, slot.sourceKind ?? "voice", slot.pc);
                if (mapped.ambiguous || (mapped.userId && mapped.userId !== slot.verifiedUserId)) {
                    clearIdentity(slot,"ssrc_owner_changed");return;
                }
            }
        }
        verifyMemberStillPresent(slot,channelId,members);
        return;
    }
    if (!slot.receiver) { mark(slot,"receiver_unavailable");return; }
    if (!channelId) { mark(slot,"voice_channel_unavailable");return; }
    if (!voiceStates || !hasMembers(members)) { mark(slot,"voice_states_unavailable");return; }
    // A receiver should have one unique audio SSRC. If multiple, attribution
    // is unsafe, especially if Discord has mixed remote audio.
    const ssrcs=await statsSources(slot.receiver);
    if (slots.get(slot.id)!==slot || slot.verifiedUserId) return;
    const ssrc=singleSource(slot.receiver,ssrcs);
    if (ssrc===undefined) {mark(slot,ssrcs.size ? "multiple_audio_ssrc" : "audio_ssrc_unavailable");return;}
    const result=mapAudioSsrc(ssrc,slot.sourceKind??"voice",slot.pc);
    if (result.ambiguous) {mark(slot,"multiple_ssrc_owners");return;}
    if (!result.available) {mark(slot,"ssrc_mapper_unavailable");return;}
    const reportedUser=result.userId;
    if (!reportedUser) {mark(slot,"ssrc_not_mapped");return;}
    if (!memberPresent(members,reportedUser)) {mark(slot,"mapped_user_not_in_voice");return;}
    if (result.fromStream && slot.sourceKind!=="stream") {
        // Only a Go Live connection knows this SSRC: it's the person's stream audio, not their microphone.
        if (slot.sourceKindOrigin==="manual") {mark(slot,"stream_audio_marked_as_voice");return;}
        slot.sourceKind="stream";slot.sourceKindOrigin="connection";
        diagnostic.info("track","classified_as_stream",{track:slot.id,origin:"connection"});
    }
    // A person may publish BOTH normal VC audio and a separate Go Live audio track.
    // Permit that only when one of the tracks has explicit media-stream evidence.
    // Never map two ordinary voice tracks or the exact same SSRC to one person.
    if ([...slots.values()].some(other=>other!==slot && other.verifiedUserId===reportedUser &&
        (other.verifiedSsrc===ssrc || (other.sourceKind!=="stream" && slot.sourceKind!=="stream")))) {
        mark(slot,"identity_already_in_use");return;
    }
    if (slots.get(slot.id)!==slot) return;
    // Membership may have changed while receiver.getStats() was pending.
    try {
        const newestChannel=channelStore?.getVoiceChannelId?.();
        const newestMembers=newestChannel?voiceStates?.getVoiceStatesForChannel?.(newestChannel):undefined;
        if (newestChannel!==channelId || !memberPresent(newestMembers,reportedUser)) {
            mark(slot,"voice_membership_changed_during_probe");return;
        }
    } catch {mark(slot,"voice_membership_changed_during_probe");return;}
    const oldId=slot.userId;
    slot.verifiedUserId=reportedUser;slot.verifiedSsrc=ssrc;
    if (oldId!==reportedUser) slot.label="";
    slot.userId=reportedUser;
    const profile=loadVerifiedProfile(reportedUser);
    if (profile?.color) slot.color=profile.color;
    if (profile?.label) slot.label=profile.label;
    mark(slot,"verified");
    diagnostic.info("identity","verified",{track:slot.id,method:"rtp_ssrc_media_engine_voice_state",scoped:result.scoped});
    namesChanged();
}
export async function probeIdentities(): Promise<void> {
    const now=performance.now();
    if (probing || now-lastProbe<2500) return;
    lastProbe=now;probing=true;
    try {
        channelStore = SelectedChannelStore?.getVoiceChannelId ? SelectedChannelStore : channelStore;
        voiceStates = VoiceStateStore?.getVoiceStatesForChannel ? VoiceStateStore : voiceStates;
        if (channelStore === undefined) channelStore = findByProps("getVoiceChannelId") ?? null;
        if (voiceStates === undefined) voiceStates = findByProps("getVoiceStatesForChannel") ?? null;
        const channelId=channelStore?.getVoiceChannelId?.();
        const safeChannel=typeof channelId==="string" ? channelId : "";
        const members=safeChannel ? voiceStates?.getVoiceStatesForChannel?.(safeChannel) : undefined;
        for (const slot of slots.values()) {
            try {await identify(slot,safeChannel,members);}
            catch {mark(slot,"identity_lookup_exception");}
        }
    } catch { diagnostic.warn("identity","store_lookup_failed"); }
    finally {probing=false;}
}
export function resetIdentityLookup() {
    legacyMapper=channelStore=voiceStates=undefined;
    namesChanged=()=>{}; verifiedMemberLeft=()=>{}; speakerChanged=()=>{};
    lastProbe=0;lastStatus.clear();
}
