// Test worklet PCM framing and onset-to-partial-caption timing without Discord.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR || path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const base=path.join(__dirname,'../src/userplugins/nowCaption');
const workletSource=fs.readFileSync(path.join(base,'audio/workletSource.ts'),'utf8').match(/String\.raw`([\s\S]*?)`/)[1];
let ctor;
const sent=[];
class Base { constructor(){this.port={postMessage(value,transfers){sent.push({value,transfers});}};}}
const context={AudioWorkletProcessor:Base,registerProcessor:(_name,c)=>{ctor=c;},Float32Array,Math,Number};
vm.runInNewContext(workletSource,context);
assert.equal(typeof ctor,'function');
const p=new ctor();
for(let n=0;n<10;n++){
 const input=new Float32Array(128).fill(.18);
 p.process([[input]],[[new Float32Array(128)]]);
}
assert.equal(sent.length,2,'1280 input samples produce 2 x 640-sample blocks');
for(const {value,transfers} of sent) {
 assert.equal(value.buffer.byteLength,640*4);
 assert.equal(transfers.length,1);
 assert.equal(transfers[0],value.buffer);
 assert.ok(value.rms>.17&&value.rms<.19);
}
// v19: a stop message ends the processor (a disconnected node would otherwise keep running), and
// loading the module again into the same AudioContext doesn't register the name twice (that throws).
assert.equal(p.process([[new Float32Array(128)]],[[new Float32Array(128)]]),true);
p.port.onmessage({data:{type:'stop'}});
assert.equal(p.process([[new Float32Array(128)]],[[new Float32Array(128)]]),false,'stopped processor ends');
// Each addModule evaluates a new module scope over the same AudioWorkletGlobalScope: copy the globals.
let registrations=0;
assert.equal(context.__nowCaptionCaptureRegistered,true);
vm.runInNewContext(workletSource,{...context,registerProcessor:()=>{registrations++;}});
assert.equal(registrations,0,'second load into the same context skips registerProcessor');
const source=fs.readFileSync(path.join(base,'audio/onsetLatency.ts'),'utf8');
const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const m={exports:{}};vm.runInNewContext(transpiled,{module:m,exports:m.exports,Math,Map,Number,performance:{now:()=>0}});
const t=m.exports;
t.audioBlock('A1',.09,1000);
assert.equal(t.captionChanged('A1',1250),250);
assert.equal(t.captionChanged('A1',1330),null,'only first change counts');
t.audioBlock('A1',.09,1400);
assert.equal(t.captionChanged('A1',1450),null,'continuous speech is one segment');
t.audioBlock('A1',.08,2400);
assert.equal(t.captionChanged('A1',2700),300);
const result=t.latencySnapshot().A1;
assert.equal(result.samples,2);
assert.equal(result.meanMs,275);
t.clearLatency();
assert.equal(Object.keys(t.latencySnapshot()).length,0);
console.log('AudioWorklet framing and onset-to-partial timing: PASS');
