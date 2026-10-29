const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const file=path.join(__dirname,'../src/userplugins/nowCaption/audio/capture.ts');
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const slots=new Map(), peers=new Set(), logs=[];
const stubs={
 '../core/diagnostics':{info:(...x)=>logs.push(x),debug:()=>{},warn:()=>{}},
 '../core/profiler':{remove:()=>{}},
 '../core/state':{slots,peers,runtime:{},RATE:16000,BLOCK:640,MAX_TRACKS:25,MAX_CAPTIONED:4},
 '../core/settings':{clamp:x=>x},
 './onsetLatency':{clearLatency:()=>{}},
 './workletSource':{WORKLET_SOURCE:''}
};
const context={module:{exports:{}},exports:{},require:(id)=>stubs[id]||(()=>{throw Error(id)})(),
 VencordNative:{pluginHelpers:{NowCaption:{remove:async()=>true}}},performance:{now:()=>9000},
 Map,Set,Array,Float32Array,console};
context.exports=context.module.exports;
vm.runInNewContext(code,context);
const api=context.module.exports;
let changes=0,releases=0;
api.setCaptureCallbacks({tracksChange:()=>changes++,trackRelease:()=>releases++,message:()=>{}});
function emitter(){
 const listeners=new Map();
 return {on:()=>listeners,addEventListener:(name,fn)=>{const s=listeners.get(name)||new Set();s.add(fn);listeners.set(name,s);},
 removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),emit:(name,event)=>{for(const fn of [...(listeners.get(name)||[])])fn(event);}};
}
const pc={...emitter(),connectionState:'connected',getTransceivers:()=>[],signalingState:'stable'};
const track={...emitter(),kind:'audio',readyState:'live',muted:false};
const stream={...emitter(),getTracks:()=>[track]};
api.enableObservation();api.observeScopedConnection(pc);
assert.equal(api.getScopedObservations(),1);
pc.emit('track',{track,receiver:{},streams:[stream]});
assert.equal(slots.size,1);
assert.equal(peers.size,1);
const s=slots.get('A1');assert(s&&s.track===track);
stream.emit('removetrack',{track});
assert.equal(slots.size,0);
assert.equal(releases,1);
assert.equal(track.on().get('ended').size,0,'on-ended listener must be unregistered');
api.disableObservation();
const inactive={...emitter(),connectionState:'connected'};
api.observeScopedConnection(inactive);
assert.equal(inactive.on().get('track'),undefined,'disabled plugin must not observe new connections');
console.log('Scoped track event, stream departure and observer disable: PASS');
