/* In-memory, bounded, content-free event journal. No transcripts, IDs or raw audio. */
export type Level = "debug" | "info" | "warn" | "error";
export type EventRecord = { time: string; elapsedMs: number; level: Level; area: string; event: string; data?: Record<string, string | number | boolean | null> };
const MAX_EVENTS = 600;
const events: EventRecord[] = [];
const started = performance.now();
let detailed = false;
let consoleOutput = false;
let listener: (() => void) | undefined;

export function setDiagnosticsOptions(options: { detailed?: boolean; consoleOutput?: boolean }): void {
    if (typeof options.detailed === "boolean") detailed = options.detailed;
    if (typeof options.consoleOutput === "boolean") consoleOutput = options.consoleOutput;
    info("diagnostics", "options_updated", { detailed, consoleOutput });
}
export function getDiagnosticsOptions() { return { detailed, consoleOutput }; }
export function setDiagnosticsListener(next?: () => void) { listener = next; }

// Only known metric-like values should be supplied. Never pass user-generated strings.
function write(level: Level, area: string, event: string, data?: EventRecord["data"]): void {
    if (level === "debug" && !detailed) return;
    const entry: EventRecord = {
        time: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
        level, area: area.slice(0, 36), event: event.slice(0, 64), data
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    if (consoleOutput || level === "error") {
        const print = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
        print(`[NowCaption/${entry.area}] ${entry.event}`, entry.data ?? "");
    }
    if (level !== "debug") listener?.();
}
export const debug = (area: string, event: string, data?: EventRecord["data"]) => write("debug", area, event, data);
export const info = (area: string, event: string, data?: EventRecord["data"]) => write("info", area, event, data);
export const warn = (area: string, event: string, data?: EventRecord["data"]) => write("warn", area, event, data);
export const error = (area: string, event: string, data?: EventRecord["data"]) => write("error", area, event, data);
export function recentEvents(limit = 100): EventRecord[] { return events.slice(-Math.max(0, Math.min(MAX_EVENTS, limit))); }
export function clearEvents() { events.length = 0; info("diagnostics", "cleared"); }
export function dispose() { listener = undefined; events.length = 0; detailed = false; consoleOutput = false; }

export function exportDiagnosticJson(data: object): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nowcaption-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    info("diagnostics", "exported");
}
