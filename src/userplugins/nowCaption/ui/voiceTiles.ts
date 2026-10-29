/**
 * Participant tile geometry, exact Discord identity lookup and explicitly chosen
 * tile associations. Never pair track numbers, nicknames or green speaking rings
 * with participants automatically. Manual placement is per track instance and
 * is invalidated after voice membership changes to prevent name/track swaps.
 */
import { findByProps } from "@webpack";
import { SelectedChannelStore, VoiceStateStore } from "@webpack/common";

import type { Slot } from "../core/types";

export interface TileRect { left: number; top: number; width: number; height: number; }
export type PlacementReason = "manual" | "verified" | "identity_unverified" |
    "tile_not_found" | "tile_conflict" | "tile_detached" | "channel_changed" | "membership_changed";
const ID = /^\d{15,22}$/;
const TILE_SELECTOR = '[data-nowcaption-user-id], [class*="tile__"], [class*="tile_"], [class*="videoTile"], [class*="videoContainer"], [class*="voiceUser"], [class*="participant"]';
let selectedStore: any;
let membersStore: any;
let lastScan = 0;
let cached = new Map<string, TileRect>();
let cachedStreams = new Map<string, TileRect>(); // stream previews of people who also have a voice tile
let cachedMembers = "";
const RECHECK_MS = 700;
let lastScanInfo = { candidates: 0, plausible: 0, uniqueIDs: 0, conflicts: 0 };

interface TileBinding {
    instance: number;
    node: Element;
    channel: string;
    members: string;
    userId?: string;
    checkedAt: number;
}
const manual = new Map<number, TileBinding>();
let stopPicker: (() => void) | undefined;
let picking = false;

function getStores() {
    try { if (SelectedChannelStore?.getVoiceChannelId) selectedStore = SelectedChannelStore; } catch { /* store initializing */ }
    try { if (VoiceStateStore?.getVoiceStatesForChannel) membersStore = VoiceStateStore; } catch { /* store initializing */ }
    // Fallback lookups run once (null = missing): a findByProps miss scans every module and logs an error.
    try { if (selectedStore === undefined) selectedStore = findByProps("getVoiceChannelId") ?? null; } catch { selectedStore = null; }
    try { if (membersStore === undefined) membersStore = findByProps("getVoiceStatesForChannel") ?? null; } catch { membersStore = null; }
}
export function currentVoiceChannel(): string {
    getStores();
    try { const id = selectedStore?.getVoiceChannelId?.(); return typeof id === "string" ? id : ""; }
    catch { return ""; }
}
export function currentMembers(): Set<string> {
    const channel = currentVoiceChannel();
    if (!channel) return new Set();
    try {
        const raw = membersStore?.getVoiceStatesForChannel?.(channel);
        const keys = Array.isArray(raw) ? raw.map((v: any) => v?.userId ?? v?.user?.id) : Object.keys(raw ?? {});
        return new Set(keys.filter((id: unknown): id is string => typeof id === "string" && ID.test(id)));
    } catch { return new Set(); }
}
function signature(members: Set<string>): string { return [...members].sort().join(","); }

/** Only inspect explicitly named identity fields. Never traverse arbitrary arrays/props. */
export function embeddedId(obj: any): string | undefined {
    if (!obj || typeof obj !== "object") return;
    const values = [obj.userId, obj.user?.id, obj.participant?.userId, obj.participant?.user?.id,
        obj.voiceState?.userId, obj.member?.userId, obj.tile?.userId];
    const ids = new Set(values.filter((v: unknown): v is string => typeof v === "string" && ID.test(v)));
    return ids.size === 1 ? [...ids][0] : undefined;
}
export function plausibleTileRect(r: TileRect, winW: number, winH: number): boolean {
    return Number.isFinite(r.width) && Number.isFinite(r.height) &&
        r.width >= 90 && r.height >= 90 && r.width < winW * 0.97 && r.height < winH * 0.97 &&
        r.left >= -10 && r.top >= -10 && r.left < winW && r.top < winH &&
        r.left + r.width > 0 && r.top + r.height > 0;
}
function rectOf(el: Element): TileRect {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
}
function fiberId(node: Element, allowed: Set<string>, found: Set<string>) {
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    let fiber = key ? (node as any)[key] : null;
    for (let depth = 0; fiber && depth < 9; depth++, fiber = fiber.return) {
        const id = embeddedId(fiber.memoizedProps) ?? embeddedId(fiber.pendingProps);
        if (id && allowed.has(id)) found.add(id);
        if (found.size > 1) return;
    }
}
/** Bounded breadth-first traversal handles deeply nested Discord avatar wrappers. */
export function idsForElement(el: Element, allowed: Set<string>): Set<string> {
    const found = new Set<string>();
    const todo: Element[] = [el];
    for (let i = 0; i < todo.length && i < 48; i++) {
        const node = todo[i];
        const id = node.getAttribute?.("data-nowcaption-user-id") ?? node.getAttribute?.("data-user-id");
        if (id && allowed.has(id)) found.add(id);
        fiberId(node, allowed, found);
        if (found.size > 1) return found;
        if (i < 30) for (const child of Array.from(node.children ?? []).slice(0, 10)) {
            if (todo.length < 48) todo.push(child);
        }
    }
    return found;
}
/** A stream preview is not necessarily the person's microphone participant tile.
 * Only use strong explicit UI markers when disambiguating two disjoint tiles
 * with the same verified account; never guess based on participant ordering.
 */
function screenSharePreview(el: Element): boolean {
    const cl = typeof el.className === "string" ? el.className : "";
    const label = el.getAttribute?.("aria-label") ?? "";
    if (/(?:streamPreview|streamTile|watchStream|screenShareTile)/i.test(cl) ||
        /watch stream|screen share preview/i.test(label)) return true;
    try {
        const control = el.querySelector?.('[aria-label*="Watch Stream"], [class*="streamPreview"], [class*="watchStream"]');
        return !!control;
    } catch { return false; }
}
function contains(a: TileRect, b: TileRect): boolean {
    return b.left >= a.left - 2 && b.top >= a.top - 2 &&
        b.left + b.width <= a.left + a.width + 2 && b.top + b.height <= a.top + a.height + 2;
}
/** Exact-ID mapping only; mark conflicting non-contained tiles as ambiguous. */
export function voiceTileRects(): Map<string, TileRect> {
    const now = performance.now();
    const active = currentMembers();
    const members = signature(active);
    // A join or leave reflows Discord's grid, so positions from before it are stale.
    if (now - lastScan < 220 && members === cachedMembers) return cached;
    lastScan = now;
    cachedMembers = members;
    const found = new Map<string, { rect: TileRect; streamPreview: boolean }>();
    const streams = new Map<string, TileRect>();
    const rejected = new Set<string>();
    let plausible = 0, conflicts = 0;
    const candidates = Array.from(document.querySelectorAll(TILE_SELECTOR)).slice(0, 750);
    for (const el of candidates) {
        if (el.closest?.("#nowcaption-react-mount")) continue;
        const r = rectOf(el);
        if (!plausibleTileRect(r, innerWidth, innerHeight) || !el.getClientRects().length) continue;
        plausible++;
        const ids = idsForElement(el, active);
        if (ids.size !== 1) { if (ids.size > 1) conflicts++; continue; }
        const id = [...ids][0];
        if (rejected.has(id)) continue;
        const prior = found.get(id);
        const next = { rect: r, streamPreview: screenSharePreview(el) };
        if (!prior) found.set(id, next);
        else if (contains(prior.rect, r)) continue;
        else if (contains(r, prior.rect)) found.set(id, next);
        else if (prior.streamPreview !== next.streamPreview) {
            // The same user can have a stream-preview tile plus a regular
            // voice tile. Prefer the voice tile for their spoken captions.
            streams.set(id, prior.streamPreview ? prior.rect : next.rect);
            if (prior.streamPreview) found.set(id, next);
        } else { found.delete(id); streams.delete(id); rejected.add(id); conflicts++; }
    }
    const resolved = new Map([...found].map(([id, v]) => [id, v.rect]));
    for (const [id, v] of found) if (v.streamPreview) streams.set(id, v.rect);
    lastScanInfo = { candidates: candidates.length, plausible, uniqueIDs: resolved.size, conflicts };
    cached = resolved;
    cachedStreams = streams;
    return resolved;
}
export function tileScanStats() { return { ...lastScanInfo }; }
/** Do not auto-attach tentative matches from voice activity. */
export function tileOwner(slot: Slot): string | undefined {
    // Screen sharing changes the source kind, not the verified person behind
    // the audio. Do not drop a verified owner when they start streaming.
    if (!slot.verifiedUserId) return;
    return currentMembers().has(slot.verifiedUserId) ? slot.verifiedUserId : undefined;
}
function bindingFor(slot: Slot): TileBinding | undefined {
    const key = slot.instanceKey;
    if (key === undefined) return;
    const b = manual.get(key);
    if (!b) return;
    const channel = currentVoiceChannel();
    if (!channel || channel !== b.channel || !b.node.isConnected || signature(currentMembers()) !== b.members ||
        // A verified identity outranks a manual pick, unless the picked tile showed that same person.
        (slot.verifiedUserId && b.userId !== slot.verifiedUserId) ||
        (slot.track?.readyState && slot.track.readyState !== "live") || !stillShowsPick(b)) {
        manual.delete(key);
        return;
    }
    return b;
}
/** Discord can change what a tile shows (focus/spotlight) without any membership change. */
function stillShowsPick(b: TileBinding): boolean {
    const now = performance.now();
    if (now - b.checkedAt < RECHECK_MS) return true;
    b.checkedAt = now;
    const ids = idsForElement(b.node, currentMembers());
    return b.userId ? ids.size === 1 && ids.has(b.userId) : ids.size === 0;
}
export function isManuallyAttached(slot: Slot): boolean { return Boolean(bindingFor(slot)); }
/**
 * Where a track's captions go. A verified person's stream audio shares their voice tile, unless their voice
 * is captioned too (pass the captioned slots): then it uses their stream preview, or floats.
 */
export function tileForSlot(slot: Slot, captioned: Iterable<Slot> = []): TileRect | undefined {
    const binding = bindingFor(slot);
    if (binding) {
        const rect = rectOf(binding.node);
        return plausibleTileRect(rect, innerWidth, innerHeight) ? rect : undefined;
    }
    const id = tileOwner(slot);
    if (!id) return undefined;
    const voice = voiceTileRects().get(id);
    if (slot.sourceKind !== "stream") return voice;
    for (const other of captioned) {
        if (other !== slot && other.enabled && other.sourceKind !== "stream" && other.verifiedUserId === id) {
            const preview = cachedStreams.get(id);
            return preview && preview !== voice ? preview : undefined;
        }
    }
    return voice;
}
export function placementState(slot: Slot): { source: "manual" | "verified" | "none"; reason: string; tile?: TileRect } {
    if (bindingFor(slot)) {
        const tile = tileForSlot(slot);
        return { source: "manual", reason: tile ? "manual_attached" : "manual_tile_invalid", tile };
    }
    const owner = tileOwner(slot);
    if (!owner) return { source: "none", reason: slot.suggestedUserId ? "identity_tentative" : "identity_unverified" };
    const tile = voiceTileRects().get(owner);
    return { source: "verified", reason: tile ? "verified_tile_found" : "tile_not_found", tile };
}
/**
 * Explicit per-track tile selection for Discord builds where internal user IDs
 * or inbound SSRC mapping are unavailable. The listener exists only during a
 * user-invoked picker, and stops after a click or Escape.
 */
export function pickTileElement(target: Element | null): Element | undefined {
    let node = target;
    let best: { node: Element; score: number } | undefined;
    for (let depth = 0; node && depth < 13; depth++, node = node.parentElement) {
        if (node.closest?.("#nowcaption-react-mount")) break;
        const rect = rectOf(node);
        if (!plausibleTileRect(rect, innerWidth, innerHeight)) continue;
        const cl = typeof node.className === "string" ? node.className : "";
        const semantic = /(?:^|\s|[-_])(tile|voiceuser|participant|videocontainer|videotile)(?:[-_]|\s|$)/i.test(cl) ||
            /tile__|tile_|videoTile|videoContainer/i.test(cl);
        const score = (semantic ? 100 : 0) - depth + (rect.width >= 160 ? 5 : 0) + (rect.height >= 135 ? 5 : 0);
        if (!best || score > best.score) best = { node, score };
    }
    return best?.node;
}
export function cancelTilePick() { stopPicker?.(); stopPicker = undefined; picking = false; }
export function tilePickActive() { return picking; }
export function beginTilePick(slot: Slot, done: (ok: boolean, reason: string) => void): boolean {
    cancelTilePick();
    if (slot.instanceKey === undefined || !currentVoiceChannel()) return false;
    picking = true;
    const key = slot.instanceKey;
    const channel = currentVoiceChannel();
    const members = signature(currentMembers());
    const cancel = () => {
        document.removeEventListener("pointerdown", clicked, true);
        document.removeEventListener("keydown", keyPressed, true);
        stopPicker = undefined;
        picking = false;
    };
    const keyPressed = (e: KeyboardEvent) => {
        if (e.key === "Escape") { cancel(); done(false, "Tile selection cancelled"); }
    };
    const clicked = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const t = e.target instanceof Element ? e.target : null;
        if (t?.closest("#nowcaption-react-mount")) return;
        e.preventDefault(); e.stopImmediatePropagation();
        swallowFollowingClick();
        const node = pickTileElement(t);
        cancel();
        if (!node) { done(false, "No participant tile found at that position"); return; }
        const ids = idsForElement(node, currentMembers());
        // A conflicting tile is not safe even after a manual click.
        if (ids.size > 1 || (ids.size === 1 && slot.verifiedUserId && !ids.has(slot.verifiedUserId))) {
            done(false, "Ambiguous or mismatched participant tile"); return;
        }
        manual.set(key, { instance: key, node, channel, members, userId: ids.size === 1 ? [...ids][0] : undefined, checkedAt: performance.now() });
        done(true, "Caption attached to the selected participant tile");
    };
    stopPicker = cancel;
    document.addEventListener("pointerdown", clicked, true);
    document.addEventListener("keydown", keyPressed, true);
    return true;
}
/**
 * preventDefault() on pointerdown doesn't stop the click that follows it. Swallow that too, or Discord would
 * focus the tile or open the stream, reflow the grid and drop the binding that was just made.
 */
function swallowFollowingClick() {
    const types = ["pointerup", "mouseup", "click"];
    const swallow = (e: Event) => {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.type === "click") stop();
    };
    const stop = () => {
        clearTimeout(timer);
        for (const type of types) document.removeEventListener(type, swallow, true);
    };
    for (const type of types) document.addEventListener(type, swallow, true);
    const timer = setTimeout(stop, 1000);
}
export function detachManualTile(slot: Slot) { if (slot.instanceKey !== undefined) manual.delete(slot.instanceKey); }
export function resetVoiceTiles() {
    cancelTilePick(); manual.clear(); cached.clear(); cachedStreams.clear(); cachedMembers = ""; lastScan = 0;
    selectedStore = membersStore = undefined;
    lastScanInfo = { candidates: 0, plausible: 0, uniqueIDs: 0, conflicts: 0 };
}
