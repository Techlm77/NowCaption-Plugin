const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const dir = path.join(__dirname,'../src/userplugins/nowCaption');
let time=7000;
function load(file,imports,globals={}) {
    const src = fs.readFileSync(path.join(dir,file),'utf8');
    const js = ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const m = {exports:{}};
    vm.runInNewContext(js,{module:m,exports:m.exports,require:id=>{
        if(Object.prototype.hasOwnProperty.call(imports,id))return imports[id];
        throw Error(`Missing mock ${id}`);
    },performance:{now:()=>time},console,Set,Map,Number,Object,Math,...globals});
    return m.exports;
}
const alex='123456789012345678', blair='987654321098765432';
let members = new Set([alex,blair]);
const selected={getVoiceChannelId:()=> 'live-voice'};
const states={getVoiceStatesForChannel:()=>Object.fromEntries([...members].map(id=>[id,{userId:id}]))};
const imports={'@webpack':{findByProps:()=>{throw Error('Dynamic lookup unavailable')}},
    '@webpack/common':{SelectedChannelStore:selected,VoiceStateStore:states}};
class FakeElement {
    constructor(className='',box={left:0,top:0,width:20,height:20},attr={}) {
        this.className=className;this.box=box;this.attr=attr;this.children=[];this.parentElement=null;this.isConnected=true;
    }
    append(child){this.children.push(child);child.parentElement=this;return child;}
    getBoundingClientRect(){return this.box;}
    getClientRects(){return [this.box];}
    getAttribute(key){return this.attr[key]??null;}
    closest(selector){if(selector==='#nowcaption-react-mount')return null;return null;}
}
const avatar=new FakeElement('avatar', {left:100,top:100,width:40,height:40});
const tile = new FakeElement('videoTile__hashed',{left:75,top:75,width:350,height:250});
const nested=tile.append(new FakeElement('panel',{left:80,top:80,width:340,height:238}));
let node=nested;
for(let i=0;i<5;i++)node=node.append(new FakeElement('wrap',{left:90,top:90,width:300,height:200}));
node.append(avatar);
node.attr['data-user-id']=alex;
const tile2 = new FakeElement('videoTile__hashed',{left:450,top:75,width:350,height:250});
const other = tile2.append(new FakeElement('content',{left:460,top:83,width:320,height:225}, {'data-user-id':blair}));
let listener={};
const doc={querySelectorAll:()=>[tile,tile2],addEventListener:(n,fn)=>listener[n]=fn,
    removeEventListener:(n,fn)=>{if(listener[n]===fn)delete listener[n]}};
const timers=[];
const ui=load('ui/voiceTiles.ts',imports,{document:doc,innerWidth:1200,innerHeight:800,Element:FakeElement,
    setTimeout:(fn)=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
assert.equal(ui.idsForElement(tile,new Set([alex,blair])).has(alex),true,'find ID six wrappers deep');
assert.equal(ui.voiceTileRects().get(alex).width,350,'discover true tile through nested ID');
assert.equal(ui.voiceTileRects().get(blair).width,350);
const fiberNode=new FakeElement('tile',{left:0,top:0,width:350,height:220});
let fiber={memoizedProps:{user:{id:alex}},return:null};
for(let i=0;i<6;i++)fiber={memoizedProps:{},return:fiber};
fiberNode.__reactFiber$test=fiber;
assert.equal(ui.idsForElement(fiberNode,new Set([alex,blair])).has(alex),true,'find user in nested React fiber');
node.attr['data-user-id']=blair;
assert.equal(ui.idsForElement(tile,new Set([alex,blair])).size,1,'single changed ID remains unique');
node.attr['data-user-id']=alex;
const conflict=tile.append(new FakeElement('other',{left:95,top:95,width:40,height:40},{'data-user-id':blair}));
assert.equal(ui.idsForElement(tile,new Set([alex,blair])).size,2,'conflicting user IDs must be rejected');
tile.children.pop();
const slot={id:'A1',instanceKey:321,sourceKind:'voice',track:{readyState:'live'},suggestedUserId:alex};
assert.equal(ui.tileOwner(slot),undefined,'do not auto-anchor tentative activity matches');
slot.verifiedUserId=alex;
assert.equal(ui.tileOwner(slot),alex,'allow verified current-VC owner');
slot.verifiedUserId=undefined;
assert.equal(ui.tileForSlot(slot),undefined,'do not automatically associate without verified identity');
let callback=null;
assert(ui.beginTilePick(slot,(ok,msg)=>{callback={ok,msg};}), 'manual picker starts');
listener.pointerdown({button:0,target:avatar,preventDefault(){},stopImmediatePropagation(){}});
assert(callback?.ok,'manual selection succeeds for nested avatar click');
// The click that follows the picked pointerdown must not reach Discord (it would focus the tile and reflow the grid).
let swallowed=false;
assert.equal(typeof listener.click,'function','follow-up click is intercepted');
listener.click({type:'click',preventDefault(){swallowed=true;},stopImmediatePropagation(){}});
assert(swallowed,'follow-up click is swallowed');
assert.equal(listener.click,undefined,'click interception ends after one click');
assert.equal(ui.tileForSlot(slot).width,350,'manual selection attaches full participant tile');
assert(ui.isManuallyAttached(slot));
tile.box={left:200,top:120,width:250,height:240};
assert.equal(ui.tileForSlot(slot).left,200,'manual attached card follows tile position during reflow');
members.add('111111111111111111');
assert.equal(ui.tileForSlot(slot),undefined,'joining participant invalidates unverified manual association');
members.delete('111111111111111111');
assert(ui.beginTilePick(slot,()=>{}));
listener.pointerdown({button:0,target:avatar,preventDefault(){},stopImmediatePropagation(){}});
tile.isConnected=false;
assert.equal(ui.tileForSlot(slot),undefined,'unmounted tile invalidates manual association');
ui.resetVoiceTiles();

const speaker=load('audio/voiceIdentity.ts',{
    '@webpack':{findByProps:()=>{throw Error('No global SSRC mapper')}} ,
    '@webpack/common':{MediaEngineStore:{getMediaEngine:()=>({connections:new Set([
        {context:'default',destroyed:false,getUserIdBySsrc:ssrc=>ssrc===42?alex:undefined},
        {context:'stream',destroyed:false,getUserIdBySsrc:()=>blair}
    ])})}},
    '../core/diagnostics':{info(){}},'../core/state':{slots:new Map()},
    '../core/speakerProfiles':{loadVerifiedProfile:()=>null}
});
assert.equal(speaker.mapAudioSsrc(42,'voice').userId,alex,'look up SSRC on live default media connection');
assert.equal(speaker.mapAudioSsrc(42,'voice').ambiguous,false,'stream connection must not conflict with voice identity');
console.log('PASS: nested DOM/fiber discovery, explicit per-track tile picker, reflow, membership/DOM invalidation, connection SSRC mapping');
