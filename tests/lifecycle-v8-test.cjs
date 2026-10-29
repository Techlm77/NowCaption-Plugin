const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require(require.resolve('typescript',{paths:[__dirname,path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const source=fs.readFileSync(path.join(__dirname,'../src/userplugins/nowCaption/audio/capture.ts'),'utf8');
const script=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const slots=new Map(), events=[], sourceListeners=new Map();
const mockNative={remove:async()=>true};
const stubs={
 '../core/diagnostics': {info:(...a)=>events.push(a),warn:()=>{},debug:()=>{}},
 '../core/profiler': {remove:()=>{}},
 '../core/state': {slots,peers:new Set(),runtime:{},RATE:16000,BLOCK:640,MAX_TRACKS:25,MAX_CAPTIONED:4},
 '../core/settings': {clamp:(x)=>x},
 './onsetLatency':{clearLatency:()=>{}},
 './workletSource':{WORKLET_SOURCE:''}
};
const m={exports:{}};
const ctx={module:m,exports:m.exports,require:(s)=>{if(!stubs[s]) throw Error(`Missing ${s}`);return stubs[s]},VencordNative:{pluginHelpers:{NowCaption:mockNative}},performance:{now:()=>9000},Map,Set,Array,Float32Array,console};
vm.runInNewContext(script,ctx);
const capture=m.exports;
let releases=0,changes=0;
capture.setCaptureCallbacks({trackRelease:()=>{releases++},tracksChange:()=>{changes++},message:()=>{}});
const make=(id)=>({id,pc:{connectionState:'connected',signalingState:'stable',getTransceivers:()=>[]},track:{readyState:'live'},enabled:false});
const first=make('A1'); slots.set('A1',first);
const second=make('A1');slots.set('A1',second);
capture.releaseTrack(first,'old_track_event');
assert.strictEqual(slots.get('A1'),second,'stale release must not delete reused slot ID');
assert.equal(releases,0);
capture.releaseTrack(second,'ended');
assert.equal(slots.size,0);
assert.equal(releases,1);
assert.equal(changes,1);
const third=make('A2');third.sourceStream={removeEventListener:(name,fn)=>sourceListeners.set(name,fn)};third.sourceRemovedHandler=()=>{};
slots.set('A2',third);
capture.releaseTrack(third,'stream_removed');
assert.equal(typeof sourceListeners.get('removetrack'),'function');
assert.equal(third.sourceRemovedHandler,undefined);
assert.equal(slots.size,0);
console.log('Track lifecycle and stale A1 reuse: PASS');
