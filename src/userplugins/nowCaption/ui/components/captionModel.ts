import { CaptionStability } from "../../core/captionStability";

const WAITING = "Waiting for speech";
/** Earlier segments kept on the card for scrolling back; older words drop off at a word boundary. */
export const HISTORY_CHARS = 3000;

function trimHistory(text: string): string {
    if (text.length <= HISTORY_CHARS) return text;
    const cut = text.indexOf(" ", text.length - HISTORY_CHARS);
    return cut < 0 ? text.slice(-HISTORY_CHARS) : text.slice(cut + 1);
}

/**
 * One continuously growing speech passage, not a list of caption lines.
 * The recognizer supplies cumulative hypotheses within a segment. Settled words stay in place
 * while the most recent, provisional words remain immediately visible. When the worker starts a
 * new segment (a fresh stream in a pause, to keep long calls light), everything shown so far is kept
 * and the new segment continues after it.
 * Browser wrapping is purely a function of the available width and font.
 */
export class CaptionViewModel {
    private readonly stability = new CaptionStability();
    private committed = "";
    private history = "";
    private segment: number | undefined;
    private text = WAITING;

    snapshot(): { text: string; } {
        return { text: this.text };
    }

    /** `finished`: the final text of the segment(s) that just ended, when the card may not have shown all of it. */
    update(hypothesis: string, now: number, segment?: number, finished?: string): boolean {
        if (segment !== undefined && this.segment !== undefined && segment !== this.segment) {
            const earlier = finished !== undefined
                ? `${this.history} ${finished.replace(/\s+/g, " ").toLowerCase()}`
                : this.text === WAITING ? "" : this.text;
            this.history = trimHistory(earlier.trim());
            this.stability.reset();
            this.committed = "";
        }
        this.segment = segment;
        // Preserve the recognizer's word sequence. Never add case, punctuation,
        // paragraph breaks or a presentation-layer character/word cutoff.
        const normalized = hypothesis.replace(/\s+/g, " ").trim().toLowerCase();
        if (!normalized) {
            if (segment !== undefined && this.history) return this.show(this.history);
            if (this.text === WAITING) return false;
            this.reset();
            return true;
        }

        const delta = this.stability.update(normalized, now, "immediate");
        if (!delta.changed) return false;
        if (delta.reset) this.committed = "";
        this.committed += delta.append;
        return this.show(`${this.history} ${this.committed}${delta.draft}`);
    }

    reset(): void {
        this.stability.reset();
        this.committed = "";
        this.history = "";
        this.segment = undefined;
        this.text = WAITING;
    }

    private show(text: string): boolean {
        const updated = text.replace(/\s+/g, " ").trim() || WAITING;
        if (updated === this.text) return false;
        this.text = updated;
        return true;
    }
}
