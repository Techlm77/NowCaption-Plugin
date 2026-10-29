/** A1, A2, ... in the order Discord's audio tracks arrive (up to MAX_TRACKS). */
export type TrackId = `A${number}`;

export interface Layout { x: number; y: number; width?: number; height?: number; }
export interface Preferences {
    captionMode: "steady" | "immediate";
    fontSize: number;
    font: string;
    color: string;
    scrollbars: "hidden" | "thin";
    showEverywhere: boolean;
    captionPlacement: "tiles" | "floating";
}
export interface Slot {
    id: string;
    /** Stable for this particular browser track, not for a reused A1/A2 slot. */
    instanceKey?: number;
    pc: RTCPeerConnection;
    track: MediaStreamTrack;
    enabled: boolean;
    label: string;
    userId: string;
    text: string;
    /** Recognizer segment: the worker starts a new one in a pause once a passage gets long. */
    segment?: number;
    /** Final text of segments that ended since the card last rendered (the card adds it to its history). */
    finishedText?: string;
    /** Bumped when the person behind this track may have changed: captions start again from nothing. */
    identityEpoch?: number;
    rms: number;
    /** Lightweight visual-only RMS, never forwarded to the native recognizer. */
    levelRms?: number;
    levelActiveUntil?: number;
    incoming: Float32Array;
    used: number;
    blockNumber: number;
    receiver?: RTCRtpReceiver;
    verifiedUserId?: string;
    verifiedSsrc?: number;
    /** Temporary correlation suggestion, NOT a verified Discord identity. */
    suggestedUserId?: string;
    identityStatus?: string;
    /** Only marked stream when the media stream includes video or track metadata explicitly says so. */
    sourceKind?: "voice" | "stream";
    /** Stream attribution provenance; video in the same stream alone is insufficient. */
    sourceKindOrigin?: "track_label" | "manual" | "connection";
    /** Manually linked to a voice source, never interpreted as verified Discord identity. */
    linkedVoiceTrackId?: string;
    linkedVoiceInstanceKey?: number;
    inactiveSince?: number;
    identityMisses?: number;
    identityMissSince?: number;
    sourceStream?: MediaStream;
    sourceRemovedHandler?: EventListener;
    sourceAddedHandler?: EventListener;
    trackCleanup?: () => void;
    worklet?: AudioWorkletNode;
    captureMode?: "worklet" | "legacy";
    transferMode?: "binary" | "array";
    source?: MediaStreamAudioSourceNode;
    processor?: ScriptProcessorNode;
    silenceGain?: GainNode;
    color?: string;
}
export type NativeUpdate = {
    track: string;
    /** The current segment's whole hypothesis (it only grows or is corrected within a segment). */
    text?: string;
    segment?: number;
    error?: string;
};
export type TrackStats = {
    blocks: number;
    samples: number;
    rms: number;
    /** Lightweight visual-only RMS, never forwarded to the native recognizer. */
    levelRms?: number;
    levelActiveUntil?: number;
    callbackMeanMs: number;
    callbackMaxMs: number;
    callbackP95Ms: number;
    ipcMeanMs: number | null;
    ipcP95Ms: number | null;
    rejects: number;
    captions: number;
};
export interface WorkerMetrics {
    running: boolean;
    available: boolean;
    cpuPercentOneCore: number | null;
    heapMiB: number | null;
    externalMiB: number | null;
    workerElu: number | null;
    queueTotal: number;
    pendingByTrack: Record<string, number>;
    decodedBlocks: number;
    decodeMeanMs: number | null;
    decodeP95Ms: number | null;
    decodeMaxMs: number | null;
    roundtripMeanMs: number | null;
    roundtripP95Ms: number | null;
    dropped: number;
    received: number;
    activeStreams: number;
    workerUptimeSeconds: number;
    cpuSource: string;
    memoryLimitations: string;
}
