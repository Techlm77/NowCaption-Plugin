/* Audible-onset-to-first-CHANGED-partial-caption estimate.
 * Not acoustic end-to-end latency: network capture, Discord jitter and
 * full sentence finalisation are outside our observable clock.
 */
const VOICE_THRESHOLD = 0.011;
const REARM_SILENCE_MS = 650;
const TIMEOUT_MS = 10000;
class Ring {
    private values: number[] = [];
    add(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > TIMEOUT_MS) return;
        this.values.push(value);
        if (this.values.length > 120) this.values.shift();
    }
    summary() {
        const ordered = [...this.values].sort((a,b)=>a-b);
        return {samples:this.values.length,meanMs:this.values.length ?
            Math.round(this.values.reduce((a,b)=>a+b,0)/this.values.length) : null,
            p95Ms:ordered.length ? Math.round(ordered[Math.ceil(ordered.length*.95)-1]) : null};
    }
}
interface TrackOnset { lastLoud: number; waitingSince: number | null; sample: Ring; }
const slots = new Map<string, TrackOnset>();
function get(id:string):TrackOnset {
    let item=slots.get(id);
    if(!item) slots.set(id,item={lastLoud:-Infinity,waitingSince:null,sample:new Ring()});
    return item;
}
export function audioBlock(id:string,rms:number,receivedAt=performance.now()) {
    const entry=get(id);
    if(rms>=VOICE_THRESHOLD) {
        if(receivedAt-entry.lastLoud>=REARM_SILENCE_MS) entry.waitingSince=receivedAt;
        entry.lastLoud=receivedAt;
    }
    if(entry.waitingSince!==null && receivedAt-entry.waitingSince>TIMEOUT_MS) entry.waitingSince=null;
}
export function captionChanged(id:string,receivedAt=performance.now()):number | null {
    const entry=get(id);
    if(entry.waitingSince===null) return null;
    const elapsed=receivedAt-entry.waitingSince;
    entry.waitingSince=null;
    entry.sample.add(elapsed);
    return elapsed >= 0 && elapsed <= TIMEOUT_MS ? Math.round(elapsed) : null;
}
export function latencySnapshot() {
    return Object.fromEntries([...slots].map(([id,s])=>[id,s.sample.summary()]));
}
export function clearLatency(id?:string) {if(id) slots.delete(id); else slots.clear();}
