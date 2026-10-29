/* Offline, self-contained fonts supplied at local install time.
 * This module is exclusively about caption font availability; no ASR/audio.
 * All font files and OFL notices are fetched, verified, and embedded by installer.
 */
import * as diagnostic from "./diagnostics";
import { embeddedFontAssets } from "./fontAssets.generated";

const registered = new Map<string, Promise<boolean>>();
const installed = new Set<FontFace>();
let generation = 0;

export const bundledFamilies = ["atkinson", "lexend", "opendyslexic"] as const;
export function isBundledFont(key: string): boolean {
    return embeddedFontAssets.some(asset => asset.key === key);
}
export function availableBundledFamilies(): string[] {
    return bundledFamilies.filter(key => isBundledFont(key));
}

function decodeBase64(value: string): ArrayBuffer {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
}

export function ensureFontLoaded(key: string): Promise<boolean> {
    if (!bundledFamilies.includes(key as typeof bundledFamilies[number])) return Promise.resolve(true);
    const existing = registered.get(key);
    if (existing) return existing;
    const files = embeddedFontAssets.filter(asset => asset.key === key);
    if (!files.length) {
        diagnostic.warn("font", "bundle_missing", { font: key });
        return Promise.resolve(false);
    }
    const token = generation;
    // Install a family's faces only when all of them loaded: a partial family would stay installed,
    // and every retry would add another copy of the faces that did load.
    const promise = Promise.all(files.map(async asset => {
        const face = new FontFace(asset.family, decodeBase64(asset.dataBase64), {
            style: asset.style,
            weight: asset.weight
        });
        await face.load();
        return face;
    })).then(faces => {
        if (token !== generation) return false;
        for (const face of faces) {
            document.fonts.add(face);
            installed.add(face);
        }
        diagnostic.info("font", "bundle_loaded", { font: key, faces: files.length });
        return true;
    }).catch(() => {
        diagnostic.warn("font", "bundle_load_failed", { font: key });
        registered.delete(key);
        return false;
    });
    registered.set(key, promise);
    return promise;
}

export function disposeFonts(): void {
    generation++;
    for (const face of installed) document.fonts.delete(face);
    installed.clear();
    registered.clear();
}
