/* AudioWorklet sends exactly 640 Float32 samples / 40 ms at 16 kHz.
 * The ArrayBuffer is transferred to the renderer (zero copy for this hop).
 * No disk writes, additional recording, or audio output.
 * The node is created with channelCountMode "explicit" and one channel, so stereo input arrives downmixed.
 * A {type:"stop"} message ends the processor; otherwise it would keep running after being disconnected.
 */
export const WORKLET_SOURCE = String.raw`
class NowCaptionCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(640);
    this.used = 0;
    this.squares = 0;
    this.stopped = false;
    this.port.onmessage = event => { if (event.data && event.data.type === 'stop') this.stopped = true; };
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    const input = inputs[0] && inputs[0][0];
    if (input) {
      for (let i=0;i<input.length;i++) {
        const v = Number.isFinite(input[i]) ? Math.max(-1,Math.min(1,input[i])) : 0;
        this.block[this.used++] = v;
        this.squares += v*v;
        if (this.used===640) {
          const frame=this.block;
          const rms=Math.sqrt(this.squares/640);
          this.port.postMessage({type:'pcm',buffer:frame.buffer,rms},[frame.buffer]);
          this.block=new Float32Array(640);
          this.squares=0;
          this.used=0;
        }
      }
    }
    // Output remains silent. This graph only keeps capture processing alive.
    const out=outputs[0] && outputs[0][0];
    if(out) out.fill(0);
    return true;
  }
}
// Registering the same name twice in one AudioContext throws.
if (!globalThis.__nowCaptionCaptureRegistered) {
  registerProcessor('nowcaption-capture-v7',NowCaptionCaptureProcessor);
  globalThis.__nowCaptionCaptureRegistered = true;
}
`;
