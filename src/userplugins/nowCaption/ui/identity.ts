import { UserStore } from "@webpack/common";

import { slots } from "../core/state";
import type { Slot } from "../core/types";

export function fallbackName(id: string): string {
    const n = Number(id.replace(/^A/, ""));
    return `User ${Number.isFinite(n) && n > 0 ? n : "?"}`;
}

function discordName(userId: string): string | undefined {
    try {
        const user: any = UserStore?.getUser?.(userId);
        if (typeof user?.globalName === "string" && user.globalName) return user.globalName;
        if (typeof user?.username === "string" && user.username) return user.username;
    } catch { /* Discord store may be changing */ }
    return undefined;
}

/** Only a verified identity (Discord's own SSRC mapping) names a speaker. */
function knownDiscordName(slot: Slot): string | undefined {
    if (!slot.verifiedUserId) return undefined;
    // Prefer Discord's current name over stale manual aliases from older builds.
    return discordName(slot.verifiedUserId) ?? (slot.label.trim() || undefined);
}

/** The voice-activity guess for an unverified track, for display marked as "likely" only. */
export function likelyName(slot: Slot): string | undefined {
    if (slot.verifiedUserId || !slot.suggestedUserId) return undefined;
    return discordName(slot.suggestedUserId);
}

/** Never infer a person's identity from A1/A2 join order or from voice activity. */
export function displayName(slot: Slot): string {
    const verifiedName = knownDiscordName(slot);
    if (slot.sourceKind === "stream") {
        if (verifiedName) return `${verifiedName}'s Stream`;
        if (slot.label.trim()) return slot.label.trim();
        // An explicit manual link is displayed as a manual, unverified association.
        const linked = slot.linkedVoiceTrackId && slots.get(slot.linkedVoiceTrackId);
        if (linked && linked !== slot && linked.sourceKind !== "stream" && linked.instanceKey === slot.linkedVoiceInstanceKey) {
            return `${knownDiscordName(linked) || linked.label.trim() || fallbackName(linked.id)}'s Stream`;
        }
        return `Stream ${slot.id.slice(1)}`;
    }
    return verifiedName || slot.label.trim() || fallbackName(slot.id);
}

/** displayName plus a clearly marked guess, e.g. "User 2 (likely Alex)". */
export function speakerTitle(slot: Slot): string {
    const likely = likelyName(slot);
    return likely ? `${displayName(slot)} (likely ${likely})` : displayName(slot);
}
