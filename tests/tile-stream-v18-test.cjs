const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const ts=require('typescript');
const base=path.join(__dirname,'../src/userplugins/nowCaption');
function load(relative, stubs, globals={}) {
 const js=ts.transpileModule(fs.readFileSync(path.join(base,relative),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(js,{exports:m.exports,module:m,require:x=>{if(x in stubs)return stubs[x];throw Error(`Missing stub ${x}`);},performance:{now:()=>clock},Set,Map,Math,Number,Object,...globals});
 return m.exports;
}
let clock=3000;
const uid='123456789012345678';let members={[uid]:{userId:uid}};
const imports={'@webpack':{findByProps:()=>undefined},'@webpack/common':{SelectedChannelStore:{getVoiceChannelId:()=> 'voice'},VoiceStateStore:{getVoiceStatesForChannel:()=>members}}};
class Tile {
 constructor(c,x,id){this.className=c;this.rect={left:x,top:90,width:320,height:200};this.attrs={'data-user-id':id};this.isConnected=true;this.children=[];}
 getBoundingClientRect(){return this.rect;}
 getClientRects(){return [this.rect];}
 getAttribute(k){return this.attrs[k]??null;}
 closest(){return null;}
}
const voice=new Tile('videoTile__voice',50,uid);
const stream=new Tile('streamPreview streamTile',400,uid);
const doc={querySelectorAll:()=>[stream,voice]};
const tiles=load('ui/voiceTiles.ts',imports,{document:doc,innerWidth:900,innerHeight:700});
let r=tiles.voiceTileRects().get(uid);
assert(r,'speaker with active screen share still has a tile');
assert.equal(r.left,50,'prefer participant tile rather than screen preview for verified speaker');
const slot={id:'A5',instanceKey:22,sourceKind:'stream',verifiedUserId:uid,track:{readyState:'live'}};
assert.equal(tiles.tileOwner(slot),uid,'stream audio must not discard verified Discord ID');
assert.equal(tiles.tileForSlot(slot).left,50,'stream audio anchored on correct person');
voice.rect={left:170,top:130,width:280,height:180};clock+=260;
assert.equal(tiles.tileForSlot(slot).left,170,'anchored overlay tracks Discord grid reposition');
delete members[uid];clock+=260;
assert.equal(tiles.tileForSlot(slot),undefined,'remove association when verified owner leaves');
const geom=load('ui/tileGeometry.ts',{},{});
for(const fontSize of [12,16,24,30]) {
 const box=geom.tileCaptionRect({left:20,top:80,width:390,height:300},fontSize,900,700);
 assert.equal(box.top,88,'top placement stays inside Discord tile');
 assert.equal(box.height,3*Math.ceil(fontSize*1.55)+8,'exactly three text rows + 8px measured padding');
}
const identity=fs.readFileSync(path.join(base,'ui/identity.ts'),'utf8');
assert(identity.indexOf('user?.globalName')<identity.indexOf('return slot.label.trim()'), 'live Discord name wins over outdated manual alias');
const ui=fs.readFileSync(path.join(base,'ui/reactUI.ts'),'utf8');
assert(!ui.includes('Optional speaker name'),'unused label field removed');
assert(!ui.includes('field("Name"'),'unused name field removed');
assert(ui.includes('"Show captions"')&&ui.includes('"Hide captions"'),'source toggle is functional');
assert(ui.includes('slot && (!slot.verifiedUserId || isManuallyAttached(slot)) && preferences.captionPlacement==="tiles"'),'manual fallback only on unresolved identities (Clear stays reachable)');
assert(ui.includes('slot.verifiedUserId ? null : h("button"'),'no new manual pick once verified');
const css=fs.readFileSync(path.join(base,'ui/styles.css'),'utf8');
assert(css.includes('padding:4px 9px'),'CSS padding matches geometry');
console.log('PASS v18: verified stream audio attached to speaker tile; competing stream preview disambiguation; reflow; membership removal; top placement and 3-line sizing; simplified Speakers controls');
