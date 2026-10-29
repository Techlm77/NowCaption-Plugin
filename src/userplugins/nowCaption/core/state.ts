import type { Slot } from "./types";

export const RATE = 16000;
export const BLOCK = 640;
/** Incoming audio tracks that can be listed and identified (Discord video calls allow 25 people). */
export const MAX_TRACKS = 25;
/** Speakers that can be captioned at the same time. Each one runs its own recognizer stream. */
export const MAX_CAPTIONED = 4;
export const slots = new Map<string, Slot>();
export const peers = new Set<RTCPeerConnection>();
export const runtime = {
    context: null as AudioContext | null,
    engineReady: false,
    monitorOn: false,
    busy: false,
    voicePageVisible: true
};

export function captionedCount(): number {
    let count = 0;
    for (const slot of slots.values()) if (slot.enabled) count++;
    return count;
}
