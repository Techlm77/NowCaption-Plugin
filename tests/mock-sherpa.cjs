class OnlineRecognizer {
    createStream(){return {n:0,ready:false,acceptWaveform({samples}) {this.n+=samples.length;this.ready=true;}};}
    isReady(s){return s.ready;}
    decode(s){s.ready=false;}
    getResult(){return {tokens:['test']};}
}
module.exports={OnlineRecognizer};
