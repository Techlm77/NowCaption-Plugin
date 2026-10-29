// Scripted recognizer for worker tests: a block whose first sample is > 0.4 "says" one more word,
// anything else is silence. reset() starts the stream's text again, like sherpa-onnx.
class OnlineRecognizer {
    createStream(){
        return {text:'',ready:false,words:0,acceptWaveform({samples}) {
            this.ready=true;
            if(samples.length && samples[0]>0.4) this.text+=(this.text?' ':'')+`word${++this.words}`;
        }};
    }
    isReady(s){return s.ready;}
    decode(s){s.ready=false;}
    getResult(s){return {text:s.text};}
    reset(s){s.text='';s.words=0;s.ready=false;}
}
module.exports={OnlineRecognizer};
