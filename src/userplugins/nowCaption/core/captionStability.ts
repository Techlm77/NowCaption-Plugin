/* Stable, incremental display cursor for cumulative streaming-ASR hypotheses.
 * Stores no audio and never alters the words returned by the recognizer.
 * Confirmed prefixes are immutable to avoid backtracking through older captions.
 */
export type CaptionMode = "steady" | "immediate";
export interface CaptionDelta {
    append: string;
    draft: string;
    reset: boolean;
    changed: boolean;
}
const SETTLE_MS = 850;
const LAST_WORD_MS = 380;

function commonPrefix(a: string, b: string): number {
    const limit = Math.min(a.length, b.length);
    let i = 0;
    while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
}

// Keep the last two words provisional, and only commit at word boundaries.
function safeBoundary(text: string, limit: number, from: number): number {
    if (limit <= from) return from;
    const prefix = text.slice(from, limit);
    const boundaries: number[] = [];
    const whitespace = /\s+/g;
    let match: RegExpExecArray | null;
    while ((match = whitespace.exec(prefix))) boundaries.push(from + match.index + match[0].length);
    return boundaries.length >= 2 ? boundaries[boundaries.length - 2] : from;
}

// In steady mode, suppress an unfinished last word, except after a brief pause.
function visibleDraft(raw: string, paused: boolean, mode: CaptionMode): string {
    if (mode === "immediate" || paused || !raw) return raw;
    const lastSpace = raw.search(/\S+$/);
    // Wait for the word boundary, or reveal it after a brief quiet interval.
    if (lastSpace <= 0) return "";
    return raw.slice(0, lastSpace).trimEnd();
}

export class CaptionStability {
    private previous = "";
    private committed = 0;
    private changedAt = 0;
    private lastDraft = "";

    update(text: string, time: number, mode: CaptionMode): CaptionDelta {
        const isNew = text !== this.previous;
        let reset = false;
        if (isNew) {
            // A recognizer stream reset can replace the whole cumulative transcript.
            // Tiny older revisions should not replace settled on-screen words.
            const overlap = commonPrefix(this.previous, text);
            if (this.previous && overlap < this.committed &&
                (overlap <= 3 || this.committed - overlap > 100) &&
                (text.length < this.committed || text.length < this.previous.length * 0.5)) {
                this.committed = 0;
                this.lastDraft = "";
                reset = true;
            }
            this.changedAt = time;
        }
        let append = "";
        if (text.length >= this.committed) {
            if (!isNew && text && time - this.changedAt >= SETTLE_MS) {
                // A trailing word has no boundary in trimmed ASR text; keep it provisional
                // even through silence, or its next correction could split that word.
                const lastBreak = Math.max(text.lastIndexOf(" "),text.lastIndexOf("\n"),text.lastIndexOf("\t")) + 1;
                if (lastBreak > this.committed) {
                    append = text.slice(this.committed,lastBreak);
                    this.committed = lastBreak;
                }
            } else if (isNew && this.previous) {
                const overlap = commonPrefix(this.previous, text);
                const boundary = safeBoundary(text, Math.min(overlap, text.length), this.committed);
                if (boundary > this.committed) {
                    append = text.slice(this.committed, boundary);
                    this.committed = boundary;
                }
            }
        }
        this.previous = text;
        const unfinished = text.length >= this.committed ? text.slice(this.committed) : "";
        const draft = visibleDraft(unfinished, time - this.changedAt >= LAST_WORD_MS, mode).trim();
        const changed = reset || !!append || draft !== this.lastDraft;
        this.lastDraft = draft;
        return { append, draft, reset, changed };
    }
    reset(): void { this.previous="";this.committed=0;this.changedAt=0;this.lastDraft=""; }
}
