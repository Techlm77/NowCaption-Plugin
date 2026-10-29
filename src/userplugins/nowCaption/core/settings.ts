import type { Layout, Preferences } from "./types";

export const LAYOUT_KEY = "nowcaption-private-speaker-layout-v3";
const OLD_LAYOUT_KEY = "nowcaption-private-speaker-positions-v2";
const PREFS_KEY = "nowcaption-private-appearance-v3";
export const FONTS = [
    { value: "system", label: "System" },
    { value: "sans", label: "Sans-serif" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Monospace" },
    { value: "atkinson", label: "Atkinson Next" },
    { value: "lexend", label: "Lexend" },
    { value: "opendyslexic", label: "OpenDyslexic" }
] as const;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function fontStack(key: string): string {
    switch (key) {
        case "mono": return "ui-monospace, 'DejaVu Sans Mono', monospace";
        case "serif": return "Georgia, 'DejaVu Serif', serif";
        case "atkinson": return "'NowCaption Atkinson', 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', system-ui, sans-serif";
        case "lexend": return "'NowCaption Lexend', Lexend, system-ui, sans-serif";
        case "opendyslexic": return "'NowCaption OpenDyslexic', OpenDyslexic, 'Open Dyslexic', system-ui, sans-serif";
        case "sans": return "Arial, 'DejaVu Sans', sans-serif";
        default: return "system-ui, sans-serif";
    }
}

function load(): Preferences {
    const defaults: Preferences = {
        fontSize: 15, font: "system", color: "#f6f7fb", scrollbars: "hidden", showEverywhere: false, captionPlacement: "tiles", captionMode: "immediate"
    };
    try {
        const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
        if (!stored || typeof stored !== "object") return defaults;
        return {
            fontSize: Number.isFinite(stored.fontSize) ? clamp(stored.fontSize, 12, 30) : defaults.fontSize,
            font: FONTS.some(font => font.value === stored.font) ? stored.font : defaults.font,
            color: typeof stored.color === "string" && /^#[0-9a-fA-F]{6}$/.test(stored.color) ? stored.color : defaults.color,
            scrollbars: stored.scrollbars === "thin" ? "thin" : "hidden",
            showEverywhere: stored.showEverywhere === true,
            captionPlacement: stored.captionPlacement === "floating" ? "floating" : "tiles",
            captionMode: "immediate"
        };
    } catch { return defaults; }
}
export let preferences = load();
export function savePreferences(): void {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); } catch { /* optional */ }
}
export function layouts(): Record<string, Layout> {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY) ?? localStorage.getItem(OLD_LAYOUT_KEY) ?? "{}";
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}
export function saveLayout(id: string, patch: Partial<Layout>): void {
    try {
        const all = layouts();
        all[id] = { ...all[id], ...patch };
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
    } catch { /* optional */ }
}
