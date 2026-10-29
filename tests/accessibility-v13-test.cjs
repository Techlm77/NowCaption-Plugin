const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const base=path.resolve(__dirname,'../src/userplugins/nowCaption');
function load(file, stubs, globals={}) {
    const js=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};
    vm.runInNewContext(js,{module:mod,exports:mod.exports,require:id=>{if(id in stubs)return stubs[id];throw Error(`Unexpected import in ${file}: ${id}`);},...globals});
    return mod.exports;
}
const dummy=new Proxy({},{get(_target,key){return ()=>{};}});
const card=load('ui/components/CaptionCard.ts',{
    '@webpack/common':{React:{createElement:()=>{}}},'../../core/state':{runtime:{},MAX_CAPTIONED:4},'../../core/diagnostics':dummy,
    '../../core/settings':{clamp:()=>{},fontStack:()=>{},layouts:()=>{},preferences:{},saveLayout:()=>{}},
    '../../core/speakerProfiles':dummy,'../identity':{displayName:()=>''},'./captionModel':{CaptionViewModel:class{}},'../tileGeometry':{tileCaptionRect:()=>undefined}
});
assert.equal(card.rowPx(15),24);
assert.equal(card.rowSnappedHeight(145,15),146);
assert.equal(card.rowSnappedHeight(160,15),170);
assert.equal((card.rowSnappedHeight(222,20)-card.FRAME_HEIGHT)%card.rowPx(20),0,'resize height must be an integral font row');

const preferences={showEverywhere:false};
const location={pathname:'/channels/123/987'};
const nav=load('ui/reactUI.ts',{
    './styles.css':{},'@webpack':{findByProps:(method)=>method==='getVoiceChannelId'?{getVoiceChannelId:()=> '987'}:{getChannelId:()=> '987'}},
    '@webpack/common':{React:{createElement:()=>{}},createRoot:()=>{}},
    '../audio/capture':dummy,'../audio/levelPreview':dummy,'../core/diagnostics':dummy,
    '../core/fonts':dummy,'../core/settings':{clamp:()=>{},FONTS:[],fontStack:()=>{},preferences,savePreferences:()=>{}},
    '../core/speakerProfiles':dummy,'../core/state':{runtime:{},slots:new Map()},
    './diagnosticsPanel':dummy,'./components/CaptionCard':dummy,'./identity':dummy,'./voiceTiles':{voiceTileRects:()=>new Map(),tileOwner:()=>undefined}
},{location});
assert.equal(nav.onVoicePage(),true,'a selected voice channel must show captions');
location.pathname='/channels/123/555';
assert.equal(nav.onVoicePage(),false,'text route must override stale getChannelId');
location.pathname='/channels/123';
assert.equal(nav.onVoicePage(),false,'server overview must hide captions');
preferences.showEverywhere=true;
assert.equal(nav.onVoicePage(),true,'explicit always-show preference overrides navigation');

async function testLevelMeter(){
    let clock=1000;
    const connected=[];
    class AudioContextMock {
        destination={};
        async resume(){}
        createMediaStreamSource(stream){const source={stream,connect:()=>connected.push('source'),disconnect:()=>{}};return source;}
        createAnalyser(){return {fftSize:2048,smoothingTimeConstant:0,connect:()=>{},disconnect:()=>{},
            getFloatTimeDomainData(b){b.fill(0);if(b._audio){};
                const sample=this._slotName === 'A1' ? .10 : 0;
                b.fill(sample);
            },_slotName:connected.length===0?'A1':'A2'};}
        createGain(){return {gain:{value:1},connect:()=>{},disconnect:()=>{}};}
        async close(){}
    }
    const slots=new Map([['A1',{id:'A1',instanceKey:1,track:{readyState:'live'}}],['A2',{id:'A2',instanceKey:2,track:{readyState:'live'}}]]);
    const meter=load('audio/levelPreview.ts',{'../core/diagnostics':dummy,'../core/state':{slots}},
        {AudioContext:AudioContextMock,MediaStream:class{constructor(tracks){this.tracks=tracks;}},Float32Array,performance:{now:()=>clock},Math,Promise,Map});
    await meter.startLevelPreview();
    assert.equal(meter.isLevelPreviewOn(),true);
    meter.sampleLevelPreview();
    assert(slots.get('A1').levelActiveUntil>clock,'speaking track should light up');
    assert.equal(slots.get('A2').levelActiveUntil??0,0,'silent track must not falsely light up');
    meter.stopLevelPreview();
    assert.equal(meter.isLevelPreviewOn(),false);
    assert.equal(slots.get('A1').levelActiveUntil,0,'stop must clear speaking state');
}

async function testRecognitionToggle(){
    let stopped=0, closed=0, removed=0;
    const slot={id:'A1',text:'previous words',rms:.5,incoming:new Float32Array(640),used:10};
    const tracked=new Map([['A1',slot]]);
    const runtime={busy:false,monitorOn:true,engineReady:true,context:{close:async()=>{closed++;}}};
    const capture=load('audio/capture.ts',{
        '../core/diagnostics':dummy,'../core/profiler':dummy,
        '../core/state':{slots:tracked,peers:new Set(),RATE:16000,BLOCK:640,MAX_TRACKS:25,MAX_CAPTIONED:4,captionedCount:()=>[...tracked.values()].filter(s=>s.enabled).length,runtime},
        '../core/settings':{clamp:x=>x},'./onsetLatency':dummy,'./workletSource':{WORKLET_SOURCE:''}
    },{VencordNative:{pluginHelpers:{NowCaption:{remove:async()=>{removed++;return true;},stop:async()=>{stopped++;return true;}}}},
        performance:{now:()=>3000},Float32Array,Map,Set,console});
    capture.setCaptureCallbacks({tracksChange:()=>{},trackRelease:()=>{},message:()=>{}});
    await capture.stopRecognition();
    assert.equal(stopped,1);assert.equal(closed,1);assert.equal(removed,1);
    assert.equal(runtime.monitorOn,false);assert.equal(runtime.engineReady,false);
    assert.equal(runtime.busy,false);assert.equal(tracked.size,1,'stop must preserve tracked speakers for restart');
    assert.equal(slot.text,'','stop should clear stale captions');
}

assert(!fs.readFileSync(path.join(base,'ui/reactUI.ts'),'utf8').includes('Discord ID (optional)'),'useless manual Discord ID field removed');
assert(fs.readFileSync(path.join(base,'ui/reactUI.ts'),'utf8').includes('Stop captions'),'capture toggle must stop');
assert(fs.readFileSync(path.join(base,'ui/components/CaptionCard.ts'),'utf8').includes('Captions stopped'),'card must show stopped state');
Promise.all([testLevelMeter(),testRecognitionToggle()]).then(()=>console.log('v13 row sizing, voice-only visibility, source meter, stop/start preserving tracks: PASS')).catch(e=>{console.error(e);process.exitCode=1;});
