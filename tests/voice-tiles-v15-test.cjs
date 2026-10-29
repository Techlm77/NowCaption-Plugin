const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require(require.resolve('typescript',{paths:[__dirname,process.env.VENCORD_DIR||path.join(os.homedir(),'Documents/Vencord-source'),process.cwd()]}));
const base=path.join(__dirname,'../src/userplugins/nowCaption');
function load(file,stubs,globals={}){
 const js=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(js,{module:m,exports:m.exports,require:id=>{if(id in stubs)return stubs[id];throw Error(`Unknown dependency ${id}`);},Map,Set,Object,Number,performance:{now:()=>clock},...globals});
 return m.exports;
}
let clock=2000;const uid='123456789012345678', uid2='987654321098765432';
let channel='v1',members={[uid]:{userId:uid},[uid2]:{userId:uid2}};
const voice={getVoiceChannelId:()=>channel},states={getVoiceStatesForChannel:()=>members};
const lookups={getVoiceChannelId:voice,getVoiceStatesForChannel:states};
const store={getMediaEngine:()=>engine};
const engine={listener:null,on(event,fn){assert.equal(event,'VoiceActivity');this.listener=fn;},off(event,fn){if(this.listener===fn)this.listener=null;}};
const findByProps=key=>key==='getMediaEngine'?store:lookups[key];
const slot={id:'A1',instanceKey:9,sourceKind:'voice',track:{readyState:'live'},levelRms:.12};
const slots=new Map([['A1',slot]]);
const tracer={info:()=>{}};
const cor=load('audio/voiceCorrelation.ts',{'@webpack':{findByProps},'@webpack/common':{SelectedChannelStore:undefined,VoiceStateStore:undefined,UserStore:undefined},'../core/diagnostics':tracer,'../core/state':{slots}});
cor.beginVoiceCorrelation();assert(engine.listener);
cor.sampleVoiceCorrelation(); // Establish current channel; don't pair with old signal
for(let i=0;i<52;i++){
 clock+=120;engine.listener(uid,.7);cor.sampleVoiceCorrelation();
}
assert.equal(slot.suggestedUserId,uid,'unambiguous sustained activity may suggest a user');
assert.notEqual(slot.verifiedUserId,uid,'suggestion is never verified identity');
// Joining or leaving never shifts a label to another person. Mapping follows IDs.
delete members[uid];clock+=200;
cor.sampleVoiceCorrelation();assert.equal(slot.suggestedUserId,undefined);
members={[uid2]:{userId:uid2}};
for(let i=0;i<52;i++){clock+=120;engine.listener(uid2,.7);cor.sampleVoiceCorrelation();}
assert.equal(slot.suggestedUserId,uid2,'suggestion is based on voice user ID, never A1 or grid position');
// Ambiguous overlapping activity must not create a label.
cor.stopVoiceCorrelation();assert.equal(slot.suggestedUserId,undefined);assert.equal(engine.listener,null);
const tiles=load('ui/voiceTiles.ts',{'@webpack':{findByProps},'@webpack/common':{SelectedChannelStore:undefined,VoiceStateStore:undefined}}, {document:{querySelectorAll:()=>[]},innerWidth:1280,innerHeight:720});
assert.equal(tiles.embeddedId({user:{id:uid}}),uid);
assert.equal(tiles.embeddedId({user:{id:uid},userId:uid2}),undefined,'conflicting ids fail closed');
assert.equal(tiles.embeddedId({users:[{id:uid}]}),undefined,'do not recurse into arbitrary collections');
assert.equal(tiles.plausibleTileRect({left:20,top:20,width:300,height:225},1280,720),true);
assert.equal(tiles.plausibleTileRect({left:0,top:0,width:1280,height:700},1280,720),false);
slot.verifiedUserId=uid2;
assert.equal(tiles.tileOwner(slot),uid2);
slot.sourceKind='stream';assert.equal(tiles.tileOwner(slot),uid2,'verified stream audio remains attached to its participant');
const card=fs.readFileSync(path.join(base,'ui/components/CaptionCard.ts'),'utf8');
assert.match(card,/nc15-tile-caption/);assert.match(card,/className:"nc10-card"/);
const css=fs.readFileSync(path.join(base,'ui/styles.css'),'utf8');
assert.match(css,/nc15-tile-caption\{position:fixed/);assert.match(css,/pointer-events:none/);
console.log('PASS: activity correlation, no verified guesses, join/leave reset, ID-exact tile positioning, floating fallback');
// Simulate a Discord grid reflow: target must follow the same exact user ID,
// regardless of tile position or participant order.
function tile(id,x,y){
 let rect={left:x,top:y,width:300,height:200};
 return {getAttribute:key=>key==='data-user-id'?id:null,
    querySelectorAll:()=>[],children:[],getBoundingClientRect:()=>rect,
    getClientRects:()=>[rect],closest:()=>null,move(nx,ny){rect={...rect,left:nx,top:ny};}};
}
members={[uid]:{userId:uid},[uid2]:{userId:uid2}};
const alex=tile(uid,20,70),other=tile(uid2,350,70);
const docs={querySelectorAll:()=>[alex,other]};
const visual=load('ui/voiceTiles.ts',{'@webpack':{findByProps},'@webpack/common':{SelectedChannelStore:undefined,VoiceStateStore:undefined}},
 {document:docs,innerWidth:1280,innerHeight:720});
clock+=1000;
assert.equal(visual.voiceTileRects().get(uid).left,20);
assert.equal(visual.voiceTileRects().get(uid2).left,350);
alex.move(350,70);other.move(20,70);
clock+=250;
assert.equal(visual.voiceTileRects().get(uid).left,350,'reflow must follow user id');
assert.equal(visual.voiceTileRects().get(uid2).left,20,'reflow must not swap captions');
channel='v2';members={[uid2]:{userId:uid2}};
clock+=250;
assert.equal(visual.voiceTileRects().has(uid),false,'leave must remove stale tile mapping');
console.log('PASS: tile reflow maintains correct speaker and leave removes old tile');
