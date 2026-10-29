// v19: four captioned speakers at once, bounded long sessions (segments), A1-A25 track ids.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const ts=require('typescript');
const base=path.join(__dirname,'../src/userplugins/nowCaption');
function load(file,stubs,globals={}) {
    const js=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const m={exports:{}};
    new Function('require','module','exports',...Object.keys(globals),js)(name=>{
        if(Object.hasOwn(stubs,name))return stubs[name];
        throw Error(`Missing stub ${name}`);
    },m,m.exports,...Object.values(globals));
    return m.exports;
}

// Caption card model: a new segment keeps the text shown so far, and the kept history is bounded.
const {CaptionStability}=load('core/captionStability.ts',{});
const {CaptionViewModel,HISTORY_CHARS}=load('ui/components/captionModel.ts',{'../../core/captionStability':{CaptionStability}});
const view=new CaptionViewModel();
view.update('hello there',0,1);
assert.equal(view.snapshot().text,'hello there');
view.update('',100,2);
assert.equal(view.snapshot().text,'hello there','an empty new segment keeps the earlier text');
view.update('how are you',200,2);
assert.equal(view.snapshot().text,'hello there how are you','new segment continues after the earlier text');
for(let segment=3;segment<40;segment++) view.update(`segment ${segment} `+'words '.repeat(30),segment*100,segment);
const shown=view.snapshot().text;
assert(shown.length<=HISTORY_CHARS+400,`history stays bounded (${shown.length} chars)`);
assert(shown.startsWith('segment ')||shown.startsWith('words '),'history is cut at a word boundary');
assert(shown.endsWith('words'),'latest segment is shown');
// A slow render can miss a segment's last words; the final text handed over with the segment change fills them in.
const late=new CaptionViewModel();
late.update('one two',0,7);
late.update('next part',100,8,'one two three four');
assert.equal(late.snapshot().text,'one two three four next part','final words of the finished segment are kept');
view.reset();
assert.equal(view.snapshot().text,'Waiting for speech');
view.update('first',0,undefined);
view.update('first second',50,undefined);
assert.equal(view.snapshot().text,'first second','captions without segment numbers still work');

// Native bridge: at most four registered tracks, valid ids A1-A25, segment numbers passed through.
class FakeWorker {
    constructor(){this.handlers={};this.sent=[];setImmediate(()=>this.emit('message',{type:'ready'}));}
    on(name,fn){this.handlers[name]=fn;}
    emit(name,value){this.handlers[name]?.(value);}
    postMessage(message){this.sent.push(message);}
    terminate(){return Promise.resolve(0);}
}
let fake;
const native=load('native.ts',{
    'node:fs':{existsSync:()=>true},
    'node:module':{createRequire:()=>({resolve:()=>'/runtime/node_modules/sherpa-onnx-node/addon.js'})},
    'node:os':{homedir:()=>'/home/tester'},
    'node:path':path,
    'node:perf_hooks':{performance},
    'node:worker_threads':{Worker:class extends FakeWorker{constructor(...a){super(...a);fake=this;}}},
    './core/state':{MAX_CAPTIONED:4,MAX_TRACKS:25},
    './engine/runtimePaths':{getRuntimeRoot:()=>'/runtime',MODEL_DIRECTORY:'model-v4'},
    './workerSource':{WORKER_SOURCE:'worker'}
});
(async()=>{
    assert.deepEqual(await native.start(),{ok:true});
    for(const id of ['A1','A2','A3','A4']) assert.equal(native.add(null,id),true,`${id} accepted`);
    assert.equal(native.add(null,'A5'),false,'a fifth captioned speaker is refused');
    assert.equal(native.add(null,'A2'),true,'re-adding an active speaker is fine');
    native.remove(null,'A1');
    assert.equal(native.add(null,'A5'),true,'a slot frees up after removal');
    assert.equal(native.add(null,'A25'),false,'still four at most');
    for(const bad of ['A0','A26','A07','B1','A1 ','A100']) assert.equal(native.add(null,bad),false,`${bad} rejected`);
    assert.equal(fake.sent.filter(m=>m.type==='add').length,5);
    assert.equal(native.feed(null,'A2',new Float32Array(640)),true,'Float32Array frame accepted');
    assert.equal(native.feed(null,'A2',new Float32Array(640).buffer),true,'ArrayBuffer frame accepted');
    assert.equal(native.feed(null,'A2',new Float32Array(320)),false,'wrong block size rejected');
    assert.equal(native.feed(null,'A9',new Float32Array(640)),false,'unregistered track rejected');
    fake.emit('message',{type:'caption',track:'A2',text:'hello',segment:3});
    fake.emit('message',{type:'caption',track:'A1',text:'removed track',segment:1});
    assert.deepEqual(JSON.parse(JSON.stringify(native.poll())),[{track:'A2',text:'hello',segment:3}],'segment passed through; removed tracks dropped');
    // Updates are combined per track and segment, keeping segment order, so a slow poll loses no final words.
    for(let i=1;i<=200;i++)fake.emit('message',{type:'caption',track:'A2',text:'w'.repeat(i),segment:4});
    fake.emit('message',{type:'caption',track:'A3',text:'other',segment:1});
    fake.emit('message',{type:'caption',track:'A2',text:'new',segment:5});
    assert.deepEqual(JSON.parse(JSON.stringify(native.poll())),[{track:'A2',text:'w'.repeat(200),segment:4},{track:'A3',text:'other',segment:1},{track:'A2',text:'new',segment:5}]);
    // A speaker change: queued captions dropped, and the old stream's late captions ignored until the worker confirms.
    fake.emit('message',{type:'caption',track:'A2',text:'old person',segment:5});
    assert.equal(native.reset(null,'A2'),true);
    assert.equal(fake.sent.at(-1).type,'reset');
    fake.emit('message',{type:'caption',track:'A2',text:'old person still',segment:5});
    assert.deepEqual(native.poll(),[],'nothing from before the reset');
    fake.emit('message',{type:'resetDone',track:'A2'});
    fake.emit('message',{type:'caption',track:'A2',text:'new person',segment:6});
    assert.deepEqual(JSON.parse(JSON.stringify(native.poll())),[{track:'A2',text:'new person',segment:6}]);
    assert.equal(native.reset(null,'A9'),false,'only registered tracks');
    await native.stop();

    // Error messages reach the screen and screenshots: the home folder (and its user name) shows as ~.
    const missing=load('native.ts',{
        'node:fs':{existsSync:()=>false},'node:module':{createRequire:()=>({resolve:()=>{throw Error('no');}})},
        'node:os':{homedir:()=>'/home/tester'},'node:path':path,'node:perf_hooks':{performance},'node:worker_threads':{Worker:FakeWorker},
        './core/state':{MAX_CAPTIONED:4,MAX_TRACKS:25},
        './engine/runtimePaths':{getRuntimeRoot:()=>'/home/tester/.local/share/nowcaption-vesktop',MODEL_DIRECTORY:'model-v4'},
        './workerSource':{WORKER_SOURCE:'worker'}
    });
    const failed=await missing.start();
    assert.equal(failed.ok,false);
    assert.match(failed.error,/~\/\.local\/share\/nowcaption-vesktop\/models\/model-v4/);
    assert.doesNotMatch(failed.error,/tester/,'no user name in the message');

    // Worker: four streams at most; a long passage starts a new segment in a pause.
    const src=fs.readFileSync(path.join(base,'workerSource.ts'),'utf8');
    const worker=new Worker(src.match(/String\.raw`([\s\S]*?)`/)[1],{eval:true,workerData:{addonEntry:path.join(__dirname,'mock-sherpa-script.cjs'),model:'/tmp/fake-model'}});
    const captions=[];let metrics=null;
    const timeout=setTimeout(()=>{console.error('Worker test timed out');void worker.terminate();process.exitCode=1;},8000);
    let seq=0;
    const block=(speech)=>{const pcm=new Float32Array(640);if(speech)pcm[0]=0.5;worker.postMessage({type:'feed',track:'A1',seq:++seq,samples:pcm.buffer},[pcm.buffer]);};
    await new Promise((resolve,reject)=>{
        worker.on('error',reject);
        worker.on('message',message=>{
            if(message.type==='fatal')reject(Error(message.error));
            if(message.type==='caption')captions.push(message);
            if(message.type==='metrics'){metrics=message;resolve();}
            if(message.type==='ready'){
                for(const id of ['A1','A2','A3','A4','A5'])worker.postMessage({type:'add',track:id});
                for(let i=0;i<110;i++)block(true);      // about 600+ characters of speech
                for(let i=0;i<32;i++)block(false);      // a 1.28 s pause
                block(true);                            // speech resumes in segment 2
                for(let i=0;i<700;i++)block(true);      // non-stop talk past the hard limit
                for(let i=0;i<11;i++)block(false);      // a 0.44 s breath
                block(true);
                for(let i=0;i<1200;i++)block(true);     // audio that never pauses at all (past 8,000 chars)
                worker.postMessage({type:'reset',track:'A1'}); // the person behind the track changed
                block(true);
                worker.postMessage({type:'stats'});
            }
        });
    });
    clearTimeout(timeout);
    await worker.terminate();
    assert.equal(metrics.activeStreams,4,'the worker keeps at most four recognizer streams');
    const first=captions.filter(c=>c.segment===1);
    assert(first.at(-1).text.length>=600,'segment 1 grew past the segment length');
    const second=captions.filter(c=>c.segment===2);
    assert.equal(second[0].text,'word1','after the pause, the new segment starts from fresh text');
    assert(second.at(-1).text.length>=4000,'segment 2 ran on through non-stop talk');
    const third=captions.filter(c=>c.segment===3);
    assert.equal(third[0].text,'word1','a short breath after the hard limit starts segment 3');
    assert(captions.some(c=>c.segment===4),'audio that never pauses still starts a new segment');
    const afterReset=captions.at(-1);
    assert.equal(afterReset.text,'word1','after a reset the stream starts from nothing');
    assert(afterReset.segment>4,'in a new segment');
    assert(captions.every(c=>c.text.length<=8000),'no caption message grows without bound');
    console.log('PASS v19: four captioned speakers (UI, bridge, worker), A1-A25 ids, bounded long sessions with segment history');
})().catch(e=>{console.error(e);process.exitCode=1;});
